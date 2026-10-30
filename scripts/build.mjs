#!/usr/bin/env node
// data/days/*.json + config/goals.json → docs/data.json（ダッシュボードが読む）
//   AI_COACH=1 かつ ANTHROPIC_API_KEY があれば Claude のコメントも付与
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './lib/analyze.mjs';
import { loadConfig, loadRecords } from './lib/store.mjs';
import { loadTrainingLogs } from './lib/training-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig(path.join(root, 'config', 'goals.json'));
const records = loadRecords(path.join(root, 'data', 'days'));
const training = loadTrainingLogs(path.join(root, 'data', 'training'));
const outFile = path.join(root, 'docs', 'data.json');

if (!records.length && !training.length) {
  console.log('記録がまだないため、docs/data.json（デモ）はそのままにします');
  process.exit(0);
}

const data = analyze(config, records, new Date(), { training });

if (process.env.AI_COACH === '1') {
  try {
    const { aiCoach } = await import('./lib/ai-coach.mjs');
    data.aiCoach = await aiCoach(data);
  } catch (err) {
    console.warn('AIコーチの生成に失敗（ルールベースのアドバイスのみ表示します）:', err.message);
  }
}
// 前回のAIコメントは当日中なら引き継ぐ（同期のたびにAPIを呼ばないため）
if (!data.aiCoach && fs.existsSync(outFile)) {
  try {
    const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    if (prev.aiCoach && prev.today === data.today && !prev.demo) data.aiCoach = prev.aiCoach;
  } catch {}
}

fs.writeFileSync(outFile, JSON.stringify(data, null, 1) + '\n');
console.log(`docs/data.json を更新（${records.length}日分の記録・筋トレログ${training.length}日分, today=${data.today}）`);
