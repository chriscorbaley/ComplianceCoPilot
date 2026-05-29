import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { Blob } from 'node:buffer';
import 'dotenv/config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = parseInt(process.env.PORT ?? '8787', 10);

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY missing. Copy server/.env.example to server/.env and set the key.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.diskStorage({}),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const CLASSIFY_SYSTEM_PROMPT = `You are a tax compliance assistant. The user has spoken a note about a business activity. Return ONLY valid JSON with no preamble:
{
  "activity_type": "hours_log|business_trip|meeting_minutes|expense",
  "description": "string",
  "duration_hours": "number|null",
  "date": "YYYY-MM-DD or today",
  "destination": "string|null",
  "business_purpose": "string|null",
  "strategy_category": "real_estate|augusta_rule|s_corp|business_travel|home_office|family_management|str",
  "meeting_type": "string|null",
  "trip_type": "domestic|international|null",
  "total_days": "number|null",
  "business_days": "number|null",
  "personal_days": "number|null",
  "business_day_pct": "number|null",
  "transport_deduct_pct": "number|null",
  "compliance_verdict": "full_deduction|partial_deduction|not_deductible|null",
  "compliance_notes": "plain English explanation of deductibility|null",
  "day_by_day_log": "[{date, type: business|travel|personal, description}]|null"
}`;

const MEETING_MINUTES_SYSTEM_PROMPT = `You are a tax compliance document generator. Format the following meeting transcript into a professional compliance-ready meeting minutes document with these sections: Meeting Details (type, date, location, attendees), Agenda Items Discussed, Key Decisions Made, Action Items, Compliance Notes relevant to the strategy. Format it cleanly with clear headings. This document will be used as IRS audit documentation.`;

// Augusta Rule (IRC §280A(g)) minutes use the same GPT-4 pipeline as every
// other meeting, but with a strategy-specific prompt that adds the RENTAL
// ARRANGEMENT and 280A(g) compliance sections an Augusta audit file needs. The
// meeting details themselves are supplied in the user message below.
const AUGUSTA_MINUTES_SYSTEM_PROMPT = `You are a tax compliance document generator. Format the following Augusta Rule meeting information into professional compliance-ready meeting minutes using the exact same format as the company standard minutes template.

Generate formatted meeting minutes with these sections:
1. MEETING DETAILS — date, location, type, attendees present
2. CALL TO ORDER — formal opening statement
3. BUSINESS DISCUSSED — detailed summary of the meeting purpose and discussions
4. RENTAL ARRANGEMENT — document the rental rate agreed upon and basis for the rate referencing comparable venue pricing
5. DECISIONS MADE — key decisions and agreements reached
6. COMPLIANCE NOTES — note that this meeting satisfies Augusta Rule IRC 280A(g) documentation requirements
7. ADJOURNMENT — formal closing statement

Format exactly as professional corporate minutes. This document will be used as IRS audit documentation for the Augusta Rule strategy.`;

const ITINERARY_SYSTEM_PROMPT = `You parse a spoken description of a business trip into a strict JSON object. Output JSON only — no prose, no markdown.

Schema:
{
  "destination": string,
  "trip_type": "domestic" | "international",
  "total_days": integer,
  "business_days": integer,
  "personal_days": integer,
  "travel_days": integer,
  "days": [
    { "date": "YYYY-MM-DD" | "Day N", "kind": "business" | "travel" | "personal", "label": string }
  ],
  "purpose": string,
  "countries": string[] (only if trip_type is international)
}

Rules for parsing:
- The day of departure and the day of return are travel days. Mark them kind: "travel".
- total_days = business_days + personal_days + travel_days.
- "domestic" means the trip stays inside the United States. Anything outside the US is "international".
- If a day's purpose is unclear, default to business.
- Use concise labels (e.g. "Client meetings in Frankfurt", "Sightseeing day").`;

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/transcribe', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded under field "file"' });
  }
  try {
    const buffer = fs.readFileSync(req.file.path);
    const blob = new Blob([buffer], { type: req.file.mimetype || 'audio/m4a' });

    const form = new FormData();
    form.append('file', blob, req.file.originalname || 'audio.m4a');
    form.append('model', 'whisper-1');
    if (req.body.prompt) form.append('prompt', String(req.body.prompt));
    if (req.body.language) form.append('language', String(req.body.language));

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `Whisper: ${text || r.statusText}` });
    }
    const data = await r.json();
    res.json({ text: (data.text ?? '').trim() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => undefined);
    }
  }
});

async function callChat(systemPrompt, userContent) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Chat ${r.status}: ${text || r.statusText}`);
  }
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  return JSON.parse(content);
}

app.post('/classify', async (req, res) => {
  const transcript = String(req.body?.transcript ?? '').trim();
  if (!transcript) return res.status(400).json({ error: 'transcript required' });
  const today = String(req.body?.today ?? new Date().toISOString().slice(0, 10));
  try {
    const parsed = await callChat(
      CLASSIFY_SYSTEM_PROMPT,
      `Today's date: ${today}\n\nUser note: ${transcript}`,
    );
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/generate-minutes', async (req, res) => {
  const transcript = String(req.body?.transcript ?? '').trim();
  if (!transcript) return res.status(400).json({ error: 'transcript required' });
  const meetingType = String(req.body?.meeting_type ?? '').trim() || 'Business meeting';
  const meetingDate = String(req.body?.meeting_date ?? '').trim() || new Date().toISOString().slice(0, 10);
  const location = String(req.body?.location ?? '').trim() || 'Not specified';
  const attendeeCount = req.body?.attendee_count != null ? String(req.body.attendee_count) : 'Not specified';

  // The Augusta Rule Log Activity form sends meeting_type 'augusta_rule' plus a
  // few structured fields (rental rate, duration, attendees, purpose). Route
  // those through the Augusta prompt with a Meeting Details block; everything
  // else (including Augusta meetings recorded via the Minutes screen) keeps the
  // standard prompt.
  const isAugusta = meetingType.toLowerCase() === 'augusta_rule';

  let systemPrompt = MEETING_MINUTES_SYSTEM_PROMPT;
  let userContent;
  if (isAugusta) {
    const rentalRate =
      req.body?.rental_rate != null && req.body.rental_rate !== ''
        ? String(req.body.rental_rate)
        : 'Not specified';
    const durationHours =
      req.body?.duration_hours != null && req.body.duration_hours !== ''
        ? String(req.body.duration_hours)
        : 'Not specified';
    const attendees = String(req.body?.attendees ?? '').trim() || 'Not specified';
    const meetingPurpose =
      String(req.body?.meeting_purpose ?? '').trim() || transcript;
    const augustaMeetingType =
      String(req.body?.augusta_meeting_type ?? '').trim() || 'Business meeting';

    systemPrompt = AUGUSTA_MINUTES_SYSTEM_PROMPT;
    userContent = `Meeting Details:
Date: ${meetingDate}
Location: ${location}
Meeting Type: ${augustaMeetingType}
Attendees: ${attendees}
Duration: ${durationHours} hours
Rental Rate: $${rentalRate} per day
Business Purpose: ${meetingPurpose}`;
  } else {
    userContent = `Meeting Type: ${meetingType}
Date: ${meetingDate}
Location: ${location}
Attendee Count: ${attendeeCount}

Transcript:
${transcript}`;
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `Chat ${r.status}: ${text || r.statusText}` });
    }
    const data = await r.json();
    const document = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!document) return res.status(502).json({ error: 'Empty response from model' });
    res.json({ document });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/itinerary', async (req, res) => {
  const transcript = String(req.body?.transcript ?? '').trim();
  if (!transcript) return res.status(400).json({ error: 'transcript required' });
  try {
    const parsed = await callChat(ITINERARY_SYSTEM_PROMPT, transcript);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`OpenAI proxy listening on http://localhost:${PORT}`);
});
