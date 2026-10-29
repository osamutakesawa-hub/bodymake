#!/usr/bin/env node
// iPhone から届いたデータを data/days/YYYY-MM-DD.json に保存する
//   node scripts/ingest.mjs --event "$GITHUB_EVENT_PATH"   # GitHub Actions（repository_dispatch）
//   node scripts/ingest.mjs payload.json                    # 手動
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDay, mergeDay, payloadDays } from './lib/ingest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const daysDir = path.join(root, 'data', 'days');

const args = process.argv.slice(2);
const eventIdx = args.indexOf('--event');
let payload;
if (eventIdx >= 0) {
  const event = JSON.parse(fs.readFileSync(args[eventIdx + 1], 'utf8'));
  payload = event.client_payload ?? event.inputs?.payload;
  if (typeof payload === 'string') payload = JSON.parse(payload);
} else if (args[0]) {
  payload = JSON.parse(fs.readFileSync(args[0], 'utf8'));
} else {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
}

fs.mkdirSync(daysDir, { recursive: true });
const days = payloadDays(payload);
if (!days.length) {
  console.error('ペイロードが空です');
  process.exit(1);
}
for (const raw of days) {
  const rec = normalizeDay(raw);
  const file = path.join(daysDir, `${rec.date}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const merged = mergeDay(existing, rec);
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  console.log(`saved ${rec.date}: ${Object.keys(rec).filter((k) => !['date', 'syncedAt'].includes(k)).join(', ') || '(no fields)'}`);
}
