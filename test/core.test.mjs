import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseDurationMinutes, weekStart } from '../scripts/lib/util.mjs';
import { normalizeDay, mergeDay, payloadDays, parseWorkouts } from '../scripts/lib/ingest.mjs';
import { dailyTargets, bmr } from '../scripts/lib/plan.mjs';
import { classifyWorkout, todaysSession } from '../scripts/lib/training.mjs';
import { analyze } from '../scripts/lib/analyze.mjs';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../config/goals.json', import.meta.url)));

test('ショートカットの値を数値にする', () => {
  assert.equal(parseNumber('72.4 kg'), 72.4);
  assert.equal(parseNumber('2,100'), 2100);
  assert.equal(parseNumber('500\n600\n'), 1100); // 複数サンプルは合計
  assert.equal(parseNumber(''), null);
});

test('睡眠時間の単位を推定する', () => {
  assert.equal(parseDurationMinutes('7:12'), 432);
  assert.equal(parseDurationMinutes(7.5), 450);
  assert.equal(parseDurationMinutes('432'), 432);
  assert.equal(parseDurationMinutes(25920), 432);
  assert.equal(parseDurationMinutes('7時間12分'), 432);
});

test('ペイロードを正規化してマージする', () => {
  const a = normalizeDay({ date: '2026-11-02', weight: { kg: '72.4 kg', bodyFatPct: '0.18' }, sleep: { minutes: '6.5' } });
  assert.equal(a.weight.kg, 72.4);
  assert.equal(a.weight.bodyFatPct, 18);
  assert.equal(a.sleep.minutes, 390);
  const b = normalizeDay({ date: '2026-11-02', nutrition: { kcal: '1,850', protein: '120' }, workouts: '筋力トレーニング,60,320\nウォーキング,30,120' });
  const m = mergeDay(a, b);
  assert.equal(m.weight.kg, 72.4);
  assert.equal(m.nutrition.kcal, 1850);
  assert.equal(m.workouts.length, 2);
  assert.throws(() => normalizeDay({ date: '../etc' }));
  assert.equal(payloadDays({ days: '[{"date":"2026-11-01"}]' }).length, 1);
});

test('ワークアウト種別の判定', () => {
  assert.equal(classifyWorkout('Traditional Strength Training'), 'strength');
  assert.equal(classifyWorkout('機能的筋力トレーニング'), 'strength');
  assert.equal(classifyWorkout('ランニング'), 'cardio');
  assert.equal(parseWorkouts([{ type: 'Running', duration: 1800 }])[0].minutes, 30);
});

test('目標カロリーは安全なペースと下限を守る', () => {
  const t = dailyTargets(config, 75, 2500, '2026-11-01');
  assert.ok(t.kcal < 2500 && t.kcal > 1500);
  assert.equal(t.proteinG, 150);
  // 非現実的な目標 → 上限ペースに制限し警告フラグ
  const hard = dailyTargets({ ...config, goal: { ...config.goal, targetWeightKg: 50 } }, 75, 2500, '2026-11-01');
  assert.equal(hard.goalAtRisk, true);
  assert.ok(hard.kcal >= bmr(config.profile, 75) - 1);
});

test('寝不足の日は筋トレのボリュームを落とす', () => {
  const s = todaysSession(config, '2026-11-02', { weekStrengthDone: 0, plannedStrengthLeft: 4, lastSleepMinutes: 300, doneToday: [] });
  assert.equal(s.kind, 'strength');
  assert.match(s.items[0].prescription, /^2セット/);
  assert.equal(s.adjustments.length, 1);
});

test('記録がなくてもダッシュボードを生成できる', () => {
  const d = analyze(config, [], new Date('2026-11-01T03:00:00Z'));
  assert.equal(d.today, '2026-11-01');
  assert.equal(d.milestones.length, config.milestones.length);
  assert.ok(d.targets.kcal > 0);
});

test('週の始まりは月曜', () => {
  assert.equal(weekStart('2026-11-01'), '2026-10-26'); // 日曜
  assert.equal(weekStart('2026-11-02'), '2026-11-02');
});
