// Supabase Edge Function: rss-scanner
//
// Scheduled to run daily (configured via supabase/config.toml or the Dashboard
// Cron UI). Pulls 3 RSS feeds, sends new items to GPT-4-turbo, and inserts any
// non-null impact analyses into public.regulatory_alerts with
// status = 'pending_review'. The admin inbox subscribes to the table in realtime
// so badge counts update without polling.
//
// Deploy:
//   supabase functions deploy rss-scanner
// Schedule (daily 09:00 UTC):
//   supabase functions schedule create rss-scanner --cron "0 9 * * *"
//
// Required environment variables (set via `supabase secrets set`):
//   SUPABASE_URL                — supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (bypasses RLS)
//   OPENAI_API_KEY              — OpenAI key for GPT-4-turbo

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const FEEDS: Array<{ source: 'IRS' | 'TaxCourt' | 'Congress'; url: string }> = [
  { source: 'IRS',      url: 'https://www.irs.gov/newsroom/feed' },
  { source: 'TaxCourt', url: 'https://www.ustaxcourt.gov/USTCWebService/RSS.aspx' },
  { source: 'Congress', url: 'https://www.congress.gov/rss/new-legislation.xml' },
];

const ANALYSIS_PROMPT = `Does this document affect any of these tax strategies or IRC sections: real estate professional status IRC 469, Augusta Rule IRC 280A, S-Corp reasonable compensation IRC 3121, business travel deductibility IRC 162 and 274, home office IRC 280A, family management company? If yes return JSON: {affected_strategies: [], ai_summary: "3 sentences max", affected_rule_keys: [], suggested_values: {rule_key: value}}. If no impact return null.`;

interface RssItem {
  guid: string;
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
}

interface AnalysisResult {
  affected_strategies: string[];
  ai_summary: string;
  affected_rule_keys: string[];
  suggested_values: Record<string, unknown>;
}

// ── XML / RSS parsing ───────────────────────────────────────────────────────

function pickTag(xml: string, tag: string): string | undefined {
  // Capture: <tag ...>VALUE</tag> or <tag ...><![CDATA[VALUE]]></tag>
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return undefined;
  const inner = m[1];
  const cdata = inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (cdata ? cdata[1] : inner).trim();
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  // RSS 2.0 <item> ... </item>
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = pickTag(block, 'title') ?? '';
    const link = pickTag(block, 'link') ?? '';
    const guid = pickTag(block, 'guid') ?? link ?? title;
    const pubDate = pickTag(block, 'pubDate');
    const description = pickTag(block, 'description');
    if (!title && !link) continue;
    items.push({ guid, title, link, pubDate, description });
  }
  // Atom <entry> ... </entry>
  if (items.length === 0) {
    const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xml)) !== null) {
      const block = m[1];
      const title = pickTag(block, 'title') ?? '';
      const idTag = pickTag(block, 'id');
      const linkMatch = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      const link = linkMatch?.[1] ?? '';
      const guid = idTag ?? link ?? title;
      const pubDate = pickTag(block, 'updated') ?? pickTag(block, 'published');
      const description = pickTag(block, 'summary') ?? pickTag(block, 'content');
      if (!title && !link) continue;
      items.push({ guid, title, link, pubDate, description });
    }
  }
  return items;
}

async function fetchFeed(url: string): Promise<RssItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'ComplianceCoPilot-RSS/1.0 (+admin)' },
    });
    if (!res.ok) return [];
    return parseRss(await res.text());
  } catch {
    return [];
  }
}

// ── GPT-4-turbo call ────────────────────────────────────────────────────────

async function analyzeItem(item: RssItem, openaiKey: string): Promise<AnalysisResult | null> {
  const userBody = [
    `Title: ${item.title}`,
    item.link ? `URL: ${item.link}` : '',
    item.description ? `Summary: ${stripTags(item.description)}` : '',
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You analyze tax-related regulatory updates and return strictly valid JSON. ' +
            'If no impact, return {"impact": null}. Otherwise return the requested object ' +
            'wrapped as {"impact": { ... }}.',
        },
        { role: 'user', content: `${ANALYSIS_PROMPT}\n\nDocument:\n${userBody}` },
      ],
    }),
  });

  if (!res.ok) return null;
  const body = await res.json();
  const text: string | undefined = body?.choices?.[0]?.message?.content;
  if (!text) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const impact = parsed?.impact ?? parsed;
  if (!impact || impact === null) return null;
  if (typeof impact !== 'object') return null;

  const result: AnalysisResult = {
    affected_strategies: Array.isArray(impact.affected_strategies) ? impact.affected_strategies : [],
    ai_summary: typeof impact.ai_summary === 'string' ? impact.ai_summary : '',
    affected_rule_keys: Array.isArray(impact.affected_rule_keys) ? impact.affected_rule_keys : [],
    suggested_values:
      impact.suggested_values && typeof impact.suggested_values === 'object'
        ? impact.suggested_values
        : {},
  };
  // Require at least one of strategies/keys/values to count as impact.
  if (
    result.affected_strategies.length === 0 &&
    result.affected_rule_keys.length === 0 &&
    Object.keys(result.suggested_values).length === 0
  ) {
    return null;
  }
  return result;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function parseDate(s?: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');

  if (!supabaseUrl || !serviceKey || !openaiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  let totalFetched = 0;
  let totalNew = 0;
  let totalAnalyzed = 0;
  let totalInserted = 0;
  let totalDiscarded = 0;

  for (const feed of FEEDS) {
    const items = await fetchFeed(feed.url);
    totalFetched += items.length;
    if (items.length === 0) continue;

    // Step 1: filter out already-processed GUIDs.
    const guids = items.map((i) => i.guid).filter(Boolean);
    const { data: known } = await supabase
      .from('processed_rss_items')
      .select('guid')
      .in('guid', guids);
    const knownSet = new Set((known ?? []).map((r: { guid: string }) => r.guid));
    const fresh = items.filter((i) => i.guid && !knownSet.has(i.guid));
    totalNew += fresh.length;

    for (const item of fresh) {
      totalAnalyzed += 1;
      const impact = await analyzeItem(item, openaiKey);

      // Step 3: discard null silently — but still record the guid so we don't
      // re-analyze on the next run.
      await supabase.from('processed_rss_items').insert({
        guid: item.guid,
        source: feed.source,
      });

      if (!impact) {
        totalDiscarded += 1;
        continue;
      }

      // Step 4: insert non-null responses as pending_review.
      const { error } = await supabase.from('regulatory_alerts').insert({
        source: feed.source,
        document_title: item.title,
        document_url: item.link || null,
        published_date: parseDate(item.pubDate),
        affected_strategies: impact.affected_strategies,
        ai_summary: impact.ai_summary,
        affected_rule_keys: impact.affected_rule_keys,
        suggested_values: impact.suggested_values,
        status: 'pending_review',
      });
      if (!error) totalInserted += 1;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      totalFetched,
      totalNew,
      totalAnalyzed,
      totalInserted,
      totalDiscarded,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
