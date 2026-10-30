#!/usr/bin/env node
// 6週間分のサンプル記録でダッシュボードのデモを生成（docs/data.json を上書き）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './lib/analyze.mjs';
import { loadConfig } from './lib/store.mjs';
import { addDays, localDate, weekday } from './lib/util.mjs';
import { SESSIONS, sessionFor } from './lib/training.mjs';
import { isCompound } from './lib/strength.mjs';

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
  // 体脂肪率がゆっくり下がり、除脂肪体重が少しずつ増えるリコンプの想定
  const lean = config.profile.startWeightKg * (1 - config.profile.startBodyFatPct / 100) + i * 0.012;
  const bfPct = config.profile.startBodyFatPct - i * 0.03;
  const w = lean / (1 - bfPct / 100) + noise(0.45);
  const plan = wd === 4 ? undefined : 'Traditional Strength Training';
  const skipped = rand() < 0.15;
  records.push({
    date,
    weight: rand() < 0.9 ? { kg: +w.toFixed(1), bodyFatPct: +(bfPct + noise(0.8)).toFixed(1) } : undefined,
    sleep: { minutes: Math.round(400 + noise(60) - (wd === 6 ? -30 : 0)) },
    nutrition: rand() < 0.88
      ? isToday
        ? { kcal: 1180, proteinG: 88, fatG: 35, carbsG: 130 }
        : { kcal: Math.round(2350 + noise(300)), proteinG: Math.round(155 + noise(30)), fatG: Math.round(60 + noise(15)), carbsG: Math.round(240 + noise(50)) }
      : undefined,
    activity: { steps: Math.round((isToday ? 4200 : 7600) + noise(2500)) },
    workouts: plan && !skipped && !isToday ? [{ type: plan, minutes: 60, kcal: 320, kind: 'strength' }] : undefined,
  });
}

// 筋トレログ：重い日は2週ごとに主種目+2.5kg、軽い日は約60%の重量
const BASE = { 懸垂orラットプルダウン: 55, ベントオーバーロウ: 60, シーテッドロウ: 50, ショルダープレス: 35, サイドレイズ: 8, 'リアデルト（フェイスプル）': 20, スクワット: 80, 'ルーマニアン・デッドリフト': 70, レッグプレス: 140, レッグカール: 40, レッグエクステンション: 45, カーフレイズ: 60, ベンチプレス: 70, 'インクライン・ダンベルプレス': 24, ケーブルフライorディップス: 15, バーベルカール: 30, 'トライセプス・エクステンション': 25, ハンマーカール: 12 };
const training = [];
for (const r of records) {
  if (!r.workouts) continue;
  const i = records.indexOf(r);
  const { key, intensity } = sessionFor(demoConfig, r.date);
  if (SESSIONS[key].kind !== 'strength') continue;
  const exercises = SESSIONS[key].exercises.map((e) => {
    const name = e.name.replace(/ or /, 'or');
    const main = isCompound(name);
    const base = BASE[name] ?? 30;
    const step = main ? 2.5 : 1;
    const w = intensity === 'light' ? Math.round((base * 0.6) / step) * step : base + Math.floor(i / 14) * step;
    const top = intensity === 'light' ? 14 : main ? 8 + (Math.floor(i / 3) % 3) : 11;
    return { name: name.replace('or', ' or '), sets: Array.from({ length: intensity === 'light' ? 2 : main ? 3 : 3 }, (_, k) => ({ weightKg: w, reps: Math.max(5, top - k) })) };
  });
  training.push({ date: r.date, source: 'demo', exercises });
}

const data = analyze(demoConfig, records, now, { demo: true, training });
fs.writeFileSync(path.join(root, 'docs', 'data.json'), JSON.stringify(data, null, 1) + '\n');
console.log(`デモデータを docs/data.json に書き出しました（today=${data.today}）`);
