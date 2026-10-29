#!/usr/bin/env node
// 6週間分のサンプル記録でダッシュボードのデモを生成（docs/data.json を上書き）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './lib/analyze.mjs';
import { loadConfig } from './lib/store.mjs';
import { addDays, localDate, weekday } from './lib/util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig(path.join(root, 'config', 'goals.json'));

// 再現できるよう固定シードの乱数
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = (amp) => (rand() - 0.5) * 2 * amp;

const now = process.argv[2] ? new Date(`${process.argv[2]}T12:00:00+09:00`) : new Date();
const today = localDate(now, config.timezone);
const days = 42;
const start = addDays(today, -(days - 1));
const demoConfig = { ...config, profile: { ...config.profile, startDate: start } };

const records = [];
for (let i = 0; i < days; i++) {
  const date = addDays(start, i);
  const wd = weekday(date);
  const isToday = i === days - 1;
  const w = config.profile.startWeightKg - i * 0.06 + noise(0.45);
  const plan = { 1: 'Traditional Strength Training', 2: 'Traditional Strength Training', 3: 'Walking', 4: 'Traditional Strength Training', 5: 'Traditional Strength Training', 6: 'Running' }[wd];
  const skipped = rand() < 0.15;
  records.push({
    date,
    weight: rand() < 0.9 ? { kg: +w.toFixed(1), bodyFatPct: +(config.profile.startBodyFatPct - i * 0.05 + noise(0.6)).toFixed(1) } : undefined,
    sleep: { minutes: Math.round(400 + noise(60) - (wd === 6 ? -30 : 0)) },
    nutrition: rand() < 0.88
      ? isToday
        ? { kcal: 1180, proteinG: 88, fatG: 35, carbsG: 130 }
        : { kcal: Math.round(2150 + noise(300)), proteinG: Math.round(125 + noise(30)), fatG: Math.round(60 + noise(15)), carbsG: Math.round(240 + noise(50)) }
      : undefined,
    activity: { steps: Math.round((isToday ? 4200 : 7600) + noise(2500)) },
    workouts: plan && !skipped && !isToday ? [{ type: plan, minutes: plan.includes('Strength') ? 60 : 35, kcal: plan.includes('Strength') ? 320 : 260 }] : undefined,
  });
}

const data = analyze(demoConfig, records, now, { demo: true });
fs.writeFileSync(path.join(root, 'docs', 'data.json'), JSON.stringify(data, null, 1) + '\n');
console.log(`デモデータを docs/data.json に書き出しました（today=${data.today}）`);
