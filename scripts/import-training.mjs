#!/usr/bin/env node
// data/inbox/ に置かれた FitnessPoint の CSV・スクリーンショットを data/training/YYYY-MM-DD.json に取り込む
//   CSV         … 過去ログの一括インポート（その日の記録を置き換え）
//   画像        … 毎日の記録。Claude が種目・重量・回数を読み取る（ANTHROPIC_API_KEY が必要）
// 処理したファイルは削除、失敗したものは data/inbox/failed/ に移動する
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvToLogs } from './lib/fitnesspoint-csv.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { isImage, readScreenshot } from './lib/screenshot-reader.mjs';
import { loadConfig } from './lib/store.mjs';
import { localDate, isYmd } from './lib/util.mjs';
import { mergeTrainingLog } from './lib/training-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inbox = path.join(root, 'data', 'inbox');
const failedDir = path.join(inbox, 'failed');
const trainingDir = path.join(root, 'data', 'training');
const config = loadConfig(path.join(root, 'config', 'goals.json'));
const today = localDate(new Date(), config.timezone);

fs.mkdirSync(trainingDir, { recursive: true });
const files = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => fs.statSync(path.join(inbox, f)).isFile() && !f.startsWith('.')) : [];
if (!files.length) {
  console.log('inbox は空です');
  process.exit(0);
}

function save(log, mode) {
  const file = path.join(trainingDir, `${log.date}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const merged = mode === 'replace' ? { ...log, importedAt: new Date().toISOString() } : mergeTrainingLog(existing, log);
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
}

function fail(f, err) {
  fs.mkdirSync(failedDir, { recursive: true });
  fs.renameSync(path.join(inbox, f), path.join(failedDir, f));
  fs.writeFileSync(path.join(failedDir, `${f}.error.txt`), `${err.message}\n`);
  console.error(`✗ ${f}: ${err.message}`);
}

let client = null;
for (const f of files.sort()) {
  const full = path.join(inbox, f);
  try {
    if (/\.(csv|txt)$/i.test(f)) {
      const { logs, skipped, columns } = csvToLogs(fs.readFileSync(full, 'utf8'));
      for (const log of logs) save(log, 'replace');
      console.log(`✓ ${f}: ${logs.length}日分（${logs[0]?.date}〜${logs.at(-1)?.date}）を取り込み。列=${JSON.stringify(columns)}${skipped ? `・読めなかった行 ${skipped}` : ''}`);
    } else if (isImage(f)) {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('スクリーンショットの読み取りには ANTHROPIC_API_KEY（GitHub Secrets）が必要です');
      client ??= new Anthropic();
      const result = await readScreenshot(full, client);
      if (!result.isWorkoutLog || !result.exercises.length) throw new Error('筋トレの記録画面として読み取れませんでした');
      // 日付：画面の日付 → ファイル名の日付 → 今日
      const fromName = f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
      const date = isYmd(result.date) && result.date <= today ? result.date : fromName ?? today;
      save({ date, source: 'screenshot', exercises: result.exercises }, 'merge');
      console.log(`✓ ${f}: ${date} ${result.exercises.map((e) => `${e.name}(${e.sets.length})`).join(', ')}`);
    } else {
      throw new Error('対応していないファイル形式です（CSV / JPEG / PNG）');
    }
    fs.unlinkSync(full);
  } catch (err) {
    fail(f, err);
  }
}
