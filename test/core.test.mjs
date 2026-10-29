import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseDurationMinutes, weekStart } from '../scripts/lib/util.mjs';
import { normalizeDay, mergeDay, payloadDays, parseWorkouts } from '../scripts/lib/ingest.mjs';
import { dailyTargets, bmr, normalizeGoal, dayKcalAdjust } from '../scripts/lib/plan.mjs';
import { classifyWorkout, todaysSession, isDeloadWeek, weekPlan } from '../scripts/lib/training.mjs';
import { analyze } from '../scripts/lib/analyze.mjs';
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(new URL('../config/goals.json', import.meta.url)));
const config = normalizeGoal(raw);
// 減量モードの検証用
const cutConfig = normalizeGoal({
  ...raw,
  profile: { ...raw.profile, age: 35, heightCm: 172, startWeightKg: 75, startBodyFatPct: 20, startDate: '2026-11-01' },
  goal: { mode: 'cut', targetDate: '2027-03-31', targetWeightKg: 68, targetBodyFatPct: 12, maxWeeklyLossPct: 1.0 },
});

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

test('減量モード：目標カロリーは安全なペースと下限を守る', () => {
  const t = dailyTargets(cutConfig, 75, 2500, '2026-11-01');
  assert.ok(t.kcal < 2500 && t.kcal > 1500);
  assert.equal(t.proteinG, 150);
  const hard = dailyTargets({ ...cutConfig, goal: { ...cutConfig.goal, targetWeightKg: 50 } }, 75, 2500, '2026-11-01');
  assert.equal(hard.goalAtRisk, true);
  assert.ok(hard.kcal >= bmr(cutConfig.profile, 75) - 1);
});

test('リコンプ：目標体重は除脂肪体重と目標体脂肪率から決まる', () => {
  // 86kg × 26.1% → 除脂肪 63.6kg、+2kg → 65.6kg、22% → 84.1kg
  assert.equal(config.profile.startLeanMassKg, 63.6);
  assert.equal(config.goal.targetLeanMassKg, 65.6);
  assert.equal(config.goal.targetWeightKg, 84.1);
  // 落とすのは脂肪だけ：22.4kg → 18.5kg
  const t = dailyTargets(config, 86, 2600, '2026-10-29', 26.1);
  assert.equal(t.fatToLoseKg, 3.9);
  assert.ok(t.deficit > 150 && t.deficit < 250, `deficit=${t.deficit}`);
  assert.equal(t.goalAtRisk, false);
});

test('重い日は多め・軽い日と休養日は少なめ（週の合計は同じ）', () => {
  const week = weekPlan(config, '2026-11-02');
  const sum = week.reduce((n, d) => n + dayKcalAdjust(config, d.intensity, d.kind), 0);
  assert.equal(dayKcalAdjust(config, 'heavy', 'strength'), 150);
  assert.ok(Math.abs(sum) <= 40, `sum=${sum}`);
});

test('週の予定：月〜水は軽い日、木は休み、金〜日は重い日', () => {
  const week = weekPlan(config, '2026-11-02');
  assert.deepEqual(week.map((d) => d.intensity === 'normal' ? d.key : d.intensity), ['light', 'light', 'light', 'rest', 'heavy', 'heavy', 'heavy']);
});

test('寝不足の重い日はボリュームを落とす・デロード週', () => {
  const ctx = { weekStrengthDone: 0, plannedStrengthLeft: 3, doneToday: [] };
  const fri = todaysSession(config, '2026-11-06', { ...ctx, lastSleepMinutes: 300 });
  assert.equal(fri.intensity, 'heavy');
  assert.match(fri.items[0].prescription, /^2セット/);
  assert.equal(fri.adjustments.length, 1);
  const light = todaysSession(config, '2026-11-02', { ...ctx, lastSleepMinutes: 450 });
  assert.match(light.items[0].prescription, /12〜15回/);
  // 開始週（10/26の週）を1週目として、6週目（11/30の週）が回復週
  assert.equal(isDeloadWeek(config, '2026-11-29'), false);
  assert.equal(isDeloadWeek(config, '2026-11-30'), true);
  assert.equal(isDeloadWeek(config, '2026-12-07'), false);
  // 木曜の休養日は回数不足でも振り替えない
  const thu = todaysSession(config, '2026-11-05', { weekStrengthDone: 0, plannedStrengthLeft: 3, doneToday: [], lastSleepMinutes: null });
  assert.equal(thu.kind, 'rest');
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

test('アプリ別の取り込み（Sleep Cycle の就寝中のみ・フィットネスポイント）', () => {
  const a = normalizeDay({ date: '2026-11-03', sleep: { minutes: '', inBedMinutes: '7:30' }, strengthWorkouts: 'Workout', workouts: 'ウォーキング' });
  assert.equal(a.sleep.minutes, 450);
  assert.deepEqual(a.workouts.map((w) => w.kind ?? classifyWorkout(w.type)), ['strength', 'cardio']);
  // 後から手入力だけ届いても、アプリ由来の記録は消えない
  const m = mergeDay(a, normalizeDay({ date: '2026-11-03', manualWorkout: '有酸素' }));
  assert.equal(m.workouts.length, 3);
  // 同じグループが再送されたら置き換え
  const m2 = mergeDay(m, normalizeDay({ date: '2026-11-03', strengthWorkouts: 'A\nB' }));
  assert.equal(m2.workouts.filter((w) => w.group === 'strengthApp').length, 2);
});
