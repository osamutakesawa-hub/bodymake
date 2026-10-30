import fs from 'node:fs';
import path from 'node:path';
import { normalizeName } from './strength.mjs';
import { checkSummary } from './fitnesspoint-text.mjs';

/** 筋トレログの読み込み（data/training/YYYY-MM-DD.json） */
export function loadTrainingLogs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/**
 * 同じ日の別のスクリーンショット：同じ種目は置き換え、新しい種目は追加。
 * 画面上部の合計（summary）があれば、合わせた内容と照合して読み取り漏れをチェックする
 */
export function mergeTrainingLog(existing, incoming) {
  const now = new Date().toISOString();
  let out;
  if (!existing) out = { ...incoming };
  else {
    const exercises = [...existing.exercises];
    for (const ex of incoming.exercises) {
      const i = exercises.findIndex((e) => normalizeName(e.name) === normalizeName(ex.name));
      if (i >= 0) exercises[i] = ex;
      else exercises.push(ex);
    }
    out = {
      ...existing,
      exercises,
      summary: incoming.summary ?? existing.summary ?? null,
      source: existing.source === incoming.source ? existing.source : 'mixed',
    };
  }
  out.importedAt = now;
  out.check = checkSummary(out.exercises, out.summary);
  if (!out.check) delete out.check;
  if (!out.summary) delete out.summary;
  return out;
}
