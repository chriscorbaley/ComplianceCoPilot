// Client-side OpenAI integration. All key-bearing calls are routed through the
// proxy at EXPO_PUBLIC_PROXY_URL (see server/index.js) — the OpenAI key never
// touches this device. The tax-compliance and itinerary system prompts also
// live on the proxy, so the contract is server-enforced.
//
// This module exposes:
//   • recording helpers (m4a, 44100 Hz) using expo-av
//   • transcribe(uri)        → /transcribe (Whisper)
//   • classify(transcript)   → /classify  (GPT-4o, tax-compliance schema)
//     When the model returns trip_type, IRS deductibility is computed from the
//     compliance_rules table and merged in. Nothing is hardcoded here.
//   • analyzeItinerary(transcript) → /itinerary (used by the Travel Analyzer)
//   • routeFromClassification(...) — Dashboard mic → correct screen + pre-fill

import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import type {
  CommonActions,
  NavigationProp,
} from '@react-navigation/native';

import {
  loadComplianceRules,
  type ComplianceRules,
} from './complianceRules';
import {
  evaluateFromCounts,
  type DeductibilityResult,
  type TripType,
  type Verdict,
} from './deductibilityEngine';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL;

export class MissingProxyError extends Error {
  constructor() {
    super(
      'Set EXPO_PUBLIC_PROXY_URL in .env and run the proxy in server/ (see server/README.md).',
    );
    this.name = 'MissingProxyError';
  }
}

export class ProxyUnreachableError extends Error {
  readonly url: string;
  readonly cause?: unknown;
  constructor(url: string, cause?: unknown) {
    const onDevice = Platform.OS === 'ios' || Platform.OS === 'android';
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
    const hint =
      onDevice && isLocalhost
        ? `\n\nThis device cannot reach "${url}" — "localhost" on a phone means the phone itself, not your dev Mac. Set EXPO_PUBLIC_PROXY_URL to your Mac's LAN IP (e.g. http://192.168.x.x:8787) and restart Expo.`
        : `\n\nCheck that the proxy is running ("npm run dev" in server/) and that ${url} is reachable from this device on the same network.`;
    super(`Cannot reach OpenAI proxy at ${url}.${hint}`);
    this.name = 'ProxyUnreachableError';
    this.url = url;
    this.cause = cause;
  }
}

const requireProxy = (): string => {
  if (!PROXY_URL) throw new MissingProxyError();
  return PROXY_URL.replace(/\/$/, '');
};

// Probes /health before a key call so we can distinguish "proxy unreachable"
// from "transcribe/classify failed". Throws ProxyUnreachableError with full
// diagnostic context; everything is also dumped to console.warn so it lands
// in Metro logs.
async function probeProxy(base: string): Promise<void> {
  const url = `${base}/health`;
  try {
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.warn('[openai] proxy /health non-OK', { url, status: r.status, body });
      throw new ProxyUnreachableError(base, `health ${r.status}: ${body || r.statusText}`);
    }
  } catch (e) {
    if (e instanceof ProxyUnreachableError) throw e;
    console.warn('[openai] proxy /health threw', {
      url,
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    });
    throw new ProxyUnreachableError(base, e);
  }
}

// ────────────────────────────── Recording ───────────────────────────────

// m4a / AAC at 44.1 kHz, mono, 64 kbps. Whisper accepts this format directly.
export const M4A_44100_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

export async function ensureMicPermission(): Promise<boolean> {
  const perm = await Audio.requestPermissionsAsync();
  return perm.status === 'granted';
}

export async function prepareAudioMode(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });
}

export async function releaseAudioMode(): Promise<void> {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
}

export async function startRecording(): Promise<Audio.Recording> {
  await prepareAudioMode();
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync(M4A_44100_OPTIONS);
  await rec.startAsync();
  return rec;
}

export async function stopRecordingAndGetUri(
  rec: Audio.Recording,
): Promise<string | null> {
  try {
    await rec.stopAndUnloadAsync();
  } catch {
    // ignore — may have been stopped already
  }
  return rec.getURI();
}

// ────────────────────────────── Proxy calls ─────────────────────────────

// Whisper accepts m4a/mp3/mp4/wav/webm/mpga/mpeg/oga/ogg/flac. We record m4a.
const WHISPER_SUPPORTED = new Set(['m4a', 'mp3', 'mp4', 'wav', 'webm', 'mpga', 'mpeg', 'oga', 'ogg', 'flac']);

// Returns file size in bytes for a file:// URI, or null if it cannot be
// inspected. RN's fetch can read file:// URIs as blobs, so we use that to
// avoid adding expo-file-system as a hard dep.
async function inspectAudioFile(uri: string): Promise<{ size: number | null; type: string }> {
  try {
    const r = await fetch(uri);
    const blob = await r.blob();
    return { size: blob.size, type: blob.type || '' };
  } catch (e) {
    console.warn('[openai] could not stat audio file', {
      uri,
      message: e instanceof Error ? e.message : String(e),
    });
    return { size: null, type: '' };
  }
}

export async function transcribe(
  uri: string,
  opts: { prompt?: string; language?: string } = {},
): Promise<string> {
  const base = requireProxy();
  const ext = (uri.split('.').pop() ?? 'm4a').toLowerCase();
  const filename = `recording.${ext}`;
  const fullUrl = `${base}/transcribe`;

  if (!WHISPER_SUPPORTED.has(ext)) {
    throw new Error(
      `Audio extension ".${ext}" is not in Whisper's supported list (${[...WHISPER_SUPPORTED].join(', ')}). Recording config in services/openai.ts must produce one of these.`,
    );
  }

  const fileInfo = await inspectAudioFile(uri);
  console.warn('[openai] transcribe → preflight', {
    proxy: base,
    fullUrl,
    uri,
    ext,
    size: fileInfo.size,
    blobType: fileInfo.type,
    platform: Platform.OS,
  });
  if (fileInfo.size === 0) {
    throw new Error(`Audio file at ${uri} is empty — recording produced 0 bytes.`);
  }

  // Verify the proxy is reachable first so we surface a clear error instead
  // of a generic "Network request failed" from the multipart upload.
  await probeProxy(base);

  const form = new FormData();
  form.append('file', {
    uri,
    name: filename,
    type: ext === 'm4a' ? 'audio/m4a' : `audio/${ext}`,
  } as unknown as Blob);
  if (opts.prompt) form.append('prompt', opts.prompt);
  if (opts.language) form.append('language', opts.language);

  let res: Response;
  try {
    res = await fetch(fullUrl, { method: 'POST', body: form });
  } catch (e) {
    console.warn('[openai] transcribe fetch threw', {
      fullUrl,
      uri,
      size: fileInfo.size,
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    });
    throw new ProxyUnreachableError(base, e);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn('[openai] transcribe non-OK response', {
      fullUrl,
      status: res.status,
      statusText: res.statusText,
      detail,
    });
    throw new Error(`Transcribe ${res.status}: ${detail || res.statusText}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}

export type ActivityType =
  | 'hours_log'
  | 'business_trip'
  | 'meeting_minutes'
  | 'expense';

export type StrategyCategory =
  | 'real_estate'
  | 'augusta_rule'
  | 's_corp'
  | 'business_travel'
  | 'home_office'
  | 'family_management'
  | 'str';

export interface DayLogEntry {
  date: string;
  type: 'business' | 'travel' | 'personal';
  description: string;
}

export interface ClassifiedNote {
  activity_type: ActivityType;
  description: string;
  duration_hours: number | null;
  date: string;
  destination: string | null;
  business_purpose: string | null;
  strategy_category: StrategyCategory;
  meeting_type: string | null;
  trip_type: TripType | null;
  total_days: number | null;
  business_days: number | null;
  personal_days: number | null;
  business_day_pct: number | null;
  transport_deduct_pct: number | null;
  compliance_verdict: Verdict | null;
  compliance_notes: string | null;
  day_by_day_log: DayLogEntry[] | null;
}

const todayIso = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const normalizeNullable = <T>(v: unknown, parse: (x: unknown) => T): T | null => {
  if (v === null || v === undefined || v === 'null') return null;
  try {
    return parse(v);
  } catch {
    return null;
  }
};

const toNumberOrNull = (v: unknown): number | null =>
  normalizeNullable(v, (x) => {
    const n = typeof x === 'string' ? parseFloat(x) : Number(x);
    if (!Number.isFinite(n)) throw new Error('not a number');
    return n;
  });

const toStringOrNull = (v: unknown): string | null =>
  normalizeNullable(v, (x) => {
    const s = String(x).trim();
    if (!s) throw new Error('empty');
    return s;
  });

const isVerdict = (v: unknown): v is Verdict =>
  v === 'full_deduction' || v === 'partial_deduction' || v === 'not_deductible';

const isTripType = (v: unknown): v is TripType =>
  v === 'domestic' || v === 'international';

const isDayKind = (v: unknown): v is 'business' | 'travel' | 'personal' =>
  v === 'business' || v === 'travel' || v === 'personal';

function shape(raw: Record<string, unknown>): ClassifiedNote {
  const activityType = raw.activity_type;
  const allowedActivity: ActivityType[] = [
    'hours_log',
    'business_trip',
    'meeting_minutes',
    'expense',
  ];
  const safeActivity = (allowedActivity as string[]).includes(
    String(activityType),
  )
    ? (activityType as ActivityType)
    : 'hours_log';

  const allowedStrategy: StrategyCategory[] = [
    'real_estate',
    'augusta_rule',
    's_corp',
    'business_travel',
    'home_office',
    'family_management',
    'str',
  ];
  const rawStrategy = raw.strategy_category;
  const safeStrategy = (allowedStrategy as string[]).includes(
    String(rawStrategy),
  )
    ? (rawStrategy as StrategyCategory)
    : 'real_estate';

  const dayLog: DayLogEntry[] | null = (() => {
    if (!Array.isArray(raw.day_by_day_log)) return null;
    const entries = raw.day_by_day_log
      .map((d) => d as Record<string, unknown>)
      .filter((d) => isDayKind(d.type))
      .map((d) => ({
        date: String(d.date ?? ''),
        type: d.type as 'business' | 'travel' | 'personal',
        description: String(d.description ?? ''),
      }));
    return entries.length ? entries : null;
  })();

  return {
    activity_type: safeActivity,
    description: String(raw.description ?? ''),
    duration_hours: toNumberOrNull(raw.duration_hours),
    date:
      typeof raw.date === 'string' && raw.date && raw.date !== 'today'
        ? raw.date
        : todayIso(),
    destination: toStringOrNull(raw.destination),
    business_purpose: toStringOrNull(raw.business_purpose),
    strategy_category: safeStrategy,
    meeting_type: toStringOrNull(raw.meeting_type),
    trip_type: isTripType(raw.trip_type) ? raw.trip_type : null,
    total_days: toNumberOrNull(raw.total_days),
    business_days: toNumberOrNull(raw.business_days),
    personal_days: toNumberOrNull(raw.personal_days),
    business_day_pct: toNumberOrNull(raw.business_day_pct),
    transport_deduct_pct: toNumberOrNull(raw.transport_deduct_pct),
    compliance_verdict: isVerdict(raw.compliance_verdict)
      ? raw.compliance_verdict
      : null,
    compliance_notes: toStringOrNull(raw.compliance_notes),
    day_by_day_log: dayLog,
  };
}

// When the model returns a trip_type, replace its compliance fields with the
// result of the deterministic IRS engine. Thresholds come from compliance_rules.
function applyDeductibilityIfTrip(
  note: ClassifiedNote,
  rules: ComplianceRules,
): ClassifiedNote {
  if (!note.trip_type || !note.total_days || note.total_days <= 0) {
    return note;
  }
  const result: DeductibilityResult = evaluateFromCounts({
    trip_type: note.trip_type,
    destination: note.destination ?? 'Trip',
    purpose: note.business_purpose ?? note.description,
    total_days: note.total_days,
    business_days: note.business_days ?? 0,
    rules,
  });
  return {
    ...note,
    total_days: result.total_days,
    business_days: result.business_days,
    personal_days: result.personal_days,
    business_day_pct: result.business_day_pct,
    transport_deduct_pct: result.breakdown.transportation_pct,
    compliance_verdict: result.verdict,
    compliance_notes: result.rationale,
  };
}

export async function classify(transcript: string): Promise<ClassifiedNote> {
  const base = requireProxy();
  const fullUrl = `${base}/classify`;
  let res: Response;
  try {
    res = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, today: todayIso() }),
    });
  } catch (e) {
    console.warn('[openai] classify fetch threw', {
      fullUrl,
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    });
    throw new ProxyUnreachableError(base, e);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn('[openai] classify non-OK response', {
      fullUrl,
      status: res.status,
      statusText: res.statusText,
      detail,
    });
    throw new Error(`Classify ${res.status}: ${detail || res.statusText}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const note = shape(raw);
  const rules = await loadComplianceRules();
  return applyDeductibilityIfTrip(note, rules);
}

// One-shot helper: record-then-classify. Used by Dashboard and Hours strips.
export async function classifyFromRecording(
  rec: Audio.Recording,
): Promise<{ transcript: string; note: ClassifiedNote }> {
  const uri = await stopRecordingAndGetUri(rec);
  await releaseAudioMode();
  if (!uri) throw new Error('No audio captured');
  const transcript = await transcribe(uri);
  if (!transcript) throw new Error('Whisper returned an empty transcript');
  const note = await classify(transcript);
  return { transcript, note };
}

// ─────────────────────── Meeting minutes generator ──────────────────────

export interface GenerateMinutesInput {
  transcript: string;
  meeting_type: string;
  meeting_date: string; // YYYY-MM-DD
  location: string;
  attendee_count: number | null;
}

export async function generateMinutesDocument(
  input: GenerateMinutesInput,
): Promise<string> {
  const base = requireProxy();
  const fullUrl = `${base}/generate-minutes`;
  let res: Response;
  try {
    res = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (e) {
    console.warn('[openai] generate-minutes fetch threw', {
      fullUrl,
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    });
    throw new ProxyUnreachableError(base, e);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn('[openai] generate-minutes non-OK response', {
      fullUrl,
      status: res.status,
      statusText: res.statusText,
      detail,
    });
    throw new Error(`Generate minutes ${res.status}: ${detail || res.statusText}`);
  }
  const data = (await res.json()) as { document?: string };
  const document = (data.document ?? '').trim();
  if (!document) throw new Error('Empty minutes document returned');
  return document;
}

// ─────────────────────────── Itinerary parser ───────────────────────────

import type { ParsedItinerary, DayKind } from './deductibilityEngine';

const validateItinerary = (raw: unknown): ParsedItinerary => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Itinerary response is not an object');
  }
  const o = raw as Record<string, unknown>;
  const tripType = o.trip_type;
  if (tripType !== 'domestic' && tripType !== 'international') {
    throw new Error('trip_type must be "domestic" or "international"');
  }
  const days: ParsedItinerary['days'] = Array.isArray(o.days)
    ? o.days
        .map((d) => d as Record<string, unknown>)
        .filter((d) => isDayKind(d.kind))
        .map((d) => ({
          date: String(d.date ?? ''),
          kind: d.kind as DayKind,
          label: String(d.label ?? ''),
        }))
    : [];
  return {
    destination: String(o.destination ?? ''),
    trip_type: tripType,
    total_days: Number(o.total_days) || 0,
    business_days: Number(o.business_days) || 0,
    personal_days: Number(o.personal_days) || 0,
    travel_days: Number(o.travel_days) || 0,
    days,
    purpose: String(o.purpose ?? ''),
    countries: Array.isArray(o.countries)
      ? (o.countries as unknown[]).map(String)
      : undefined,
  };
};

export async function analyzeItinerary(
  transcript: string,
): Promise<ParsedItinerary> {
  const base = requireProxy();
  const fullUrl = `${base}/itinerary`;
  let res: Response;
  try {
    res = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
  } catch (e) {
    console.warn('[openai] itinerary fetch threw', {
      fullUrl,
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    });
    throw new ProxyUnreachableError(base, e);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn('[openai] itinerary non-OK response', {
      fullUrl,
      status: res.status,
      statusText: res.statusText,
      detail,
    });
    throw new Error(`Itinerary ${res.status}: ${detail || res.statusText}`);
  }
  const raw = await res.json();
  return validateItinerary(raw);
}

// ───────────────────────── Dashboard mic routing ────────────────────────

type AnyNav = NavigationProp<Record<string, object | undefined>> & {
  dispatch: (action: unknown) => void;
};

export function routeFromClassification(
  navigation: AnyNav,
  commonActions: typeof CommonActions,
  note: ClassifiedNote,
): void {
  const target = ((): { tab: string } => {
    switch (note.activity_type) {
      case 'hours_log':
        return { tab: 'Hours' };
      case 'business_trip':
        return { tab: 'Trips' };
      case 'meeting_minutes':
        return { tab: 'Minutes' };
      case 'expense':
        return { tab: 'Docs' };
      default:
        return { tab: 'Dashboard' };
    }
  })();

  navigation.dispatch(
    commonActions.navigate({
      name: 'Tabs',
      params: { screen: target.tab },
    }),
  );
}
