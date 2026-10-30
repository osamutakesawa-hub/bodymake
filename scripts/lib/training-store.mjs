import fs from 'node:fs';
import path from 'node:path';
import { normalizeName } from './strength.mjs';

/** 筋トレログの読み込み（data/training/YYYY-MM-DD.json） */
export function loadTrainingLogs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/** 同じ日の別のスクリーンショット：同じ種目は置き換え、新しい種目は追加 */
export function mergeTrainingLog(existing, incoming) {
  if (!existing) return { ...incoming, importedAt: new Date().toISOString() };
  const exercises = [...existing.exercises];
  for (const ex of incoming.exercises) {
    const i = exercises.findIndex((e) => normalizeName(e.name) === normalizeName(ex.name));
    if (i >= 0) exercises[i] = ex;
    else exercises.push(ex);
  }
  return { ...existing, exercises, source: existing.source === incoming.source ? existing.source : 'mixed', importedAt: new Date().toISOString() };
}
