// iPhone（ショートカット）から届いたペイロードを日次レコードに正規化・マージする
import { parseNumber, parseDurationMinutes, isYmd, round } from './util.mjs';

const pick = (obj, ...keys) => {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== '') return obj[k];
  return undefined;
};

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/**
 * ワークアウトは配列 [{type, minutes, kcal}] のほか、
 * ショートカットで作りやすい文字列 "筋力トレーニング,60,320\nランニング,30,250" も受け付ける
 */
export function parseWorkouts(v) {
  if (v === null || v === undefined || v === '') return undefined;
  let items = v;
  if (typeof v === 'string') {
    items = v
      .split(/[\n;]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [type, minutes, kcal] = line.split(/\s*[,|]\s*/);
        return { type, minutes, kcal };
      });
  }
  if (!Array.isArray(items)) items = [items];
  const list = items
    .map((w) => ({
      type: String(pick(w, 'type', 'name', '種類') ?? 'Workout').trim(),
      minutes: round(parseDurationMinutesWorkout(pick(w, 'minutes', 'duration', 'durationMin')), 0),
      kcal: round(parseNumber(pick(w, 'kcal', 'energy', 'activeEnergy')), 0),
      start: pick(w, 'start', 'startDate') ?? undefined,
    }))
    .filter((w) => w.type);
  return list;
}

// ワークアウト時間は「時間」単位で来ることは稀なので、24以下でも分として扱う（秒だけ換算）
function parseDurationMinutesWorkout(v) {
  if (typeof v === 'string' && /:/.test(v)) return parseDurationMinutes(v);
  const n = parseNumber(v);
  if (n === null) return null;
  return n >= 1000 ? n / 60 : n;
}

/** 1日分のペイロード → 正規化レコード */
export function normalizeDay(p) {
  if (!p || !isYmd(p.date)) throw new Error(`date (YYYY-MM-DD) が必要です: ${JSON.stringify(p?.date)}`);
  const w = p.weight ?? {};
  const s = p.sleep ?? {};
  const n = p.nutrition ?? {};
  const a = p.activity ?? {};

  let weightKg = parseNumber(typeof w === 'object' ? pick(w, 'kg', 'weight', 'weightKg') : w);
  if (weightKg !== null && weightKg > 250) weightKg = weightKg / 1000; // g で来た場合
  let bodyFatPct = parseNumber(pick(w, 'bodyFatPct', 'bodyFat', 'fat'));
  if (bodyFatPct !== null && bodyFatPct < 1) bodyFatPct = bodyFatPct * 100; // 0.18 → 18%

  const rec = {
    date: p.date,
    weight: compact({
      kg: round(weightKg, 2),
      bodyFatPct: round(bodyFatPct, 1),
      muscleKg: round(parseNumber(pick(w, 'muscleKg', 'leanKg', 'leanMassKg')), 2),
    }),
    sleep: compact({
      minutes: parseDurationMinutes(typeof s === 'object' ? pick(s, 'minutes', 'asleep', 'duration', 'hours') : s),
      deepMinutes: parseDurationMinutes(pick(s, 'deepMinutes', 'deep')),
      remMinutes: parseDurationMinutes(pick(s, 'remMinutes', 'rem')),
    }),
    nutrition: compact({
      kcal: round(parseNumber(pick(n, 'kcal', 'energy', 'calories')), 0),
      proteinG: round(parseNumber(pick(n, 'proteinG', 'protein')), 0),
      fatG: round(parseNumber(pick(n, 'fatG', 'fat')), 0),
      carbsG: round(parseNumber(pick(n, 'carbsG', 'carbs', 'carbohydrates')), 0),
    }),
    activity: compact({
      steps: round(parseNumber(pick(a, 'steps')), 0),
      activeKcal: round(parseNumber(pick(a, 'activeKcal', 'activeEnergy')), 0),
    }),
    workouts: parseWorkouts(p.workouts),
    syncedAt: p.syncedAt ?? new Date().toISOString(),
  };
  return Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined));
}

/** 既存レコードに新しいレコードを重ねる（届いた項目だけ上書き） */
export function mergeDay(existing, incoming) {
  if (!existing) return incoming;
  const out = { ...existing, date: incoming.date, syncedAt: incoming.syncedAt };
  for (const key of ['weight', 'sleep', 'nutrition', 'activity']) {
    if (incoming[key]) out[key] = { ...(existing[key] ?? {}), ...incoming[key] };
  }
  // ワークアウトはショートカットが「その日の全件」を送る前提で置き換える
  if (incoming.workouts) out.workouts = incoming.workouts;
  return out;
}

/** client_payload は1日分 or { days: [...] } のどちらでも可 */
export function payloadDays(payload) {
  if (!payload) return [];
  if (typeof payload.days === 'string') payload = { ...payload, days: JSON.parse(payload.days) };
  if (Array.isArray(payload.days)) return payload.days;
  return [payload];
}
