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

// ---- FitnessPoint ログ ----
import { csvToLogs, parseDate, parseSetText } from '../scripts/lib/fitnesspoint-csv.mjs';
import { e1rm, nextTarget, bodyPart, exerciseHistory, exerciseProgress } from '../scripts/lib/strength.mjs';
import { mergeTrainingLog } from '../scripts/lib/training-store.mjs';

test('CSV：1行1セット形式（英語ヘッダ・クォート・lbs換算）', () => {
  const csv = 'Date,Exercise,Set,Weight (lbs),Reps\n"2026/10/23 18:01","Bench Press",1,135,10\n2026/10/23,Bench Press,2,135,8\n10/24/2026,Squat,1,185,5\n';
  const { logs } = csvToLogs(csv);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].exercises[0].sets.length, 2);
  assert.equal(logs[0].exercises[0].sets[0].weightKg, 61.24);
  assert.equal(logs[1].date, '2026-10-24');
});

test('CSV：日本語ヘッダ・1セルに複数セット', () => {
  const csv = '日付,種目,セット内容\n2026年10月30日,ベンチプレス,"60kg×10, 60kg×9"\n2026年10月30日,懸垂,0×8×3\n';
  const { logs } = csvToLogs(csv);
  assert.equal(logs[0].exercises[0].sets.length, 2);
  assert.equal(logs[0].exercises[1].sets.length, 3);
  assert.throws(() => csvToLogs('a,b\n1,2\n'), /列を判定できません/);
});

test('日付と1セル内セット表記の解釈', () => {
  assert.equal(parseDate('Oct 30, 2026'), '2026-10-30');
  assert.equal(parseDate('30/10/2026'), '2026-10-30');
  assert.deepEqual(parseSetText('62.5 × 8'), [{ weightKg: 62.5, reps: 8 }]);
});

test('次回の目標（ダブルプログレッション）', () => {
  const s = (w, ...reps) => reps.map((r) => ({ weightKg: w, reps: r }));
  assert.equal(nextTarget(s(60, 10, 9, 8), [6, 10], 3).text, '60kg × 10・10・9');
  const up = nextTarget(s(60, 10, 10, 10), [6, 10], 3);
  assert.equal(up.increase, true);
  assert.equal(up.weightKg, 62.5);
  assert.equal(nextTarget(s(60, 10, 10, 10), [6, 10], 3, { deload: true }).weightKg, 50);
  assert.equal(nextTarget(s(10, 12, 12), [10, 12], 3).weightKg, 12); // ダンベル +2kg
  assert.equal(Math.round(e1rm(100, 10)), 133);
});

test('部位の判定', () => {
  assert.equal(bodyPart('レッグエクステンション'), 'legs');
  assert.equal(bodyPart('ショルダープレス'), 'shoulders');
  assert.equal(bodyPart('インクライン・ダンベルプレス'), 'chest');
  assert.equal(bodyPart('ラットプルダウン'), 'back');
  assert.equal(bodyPart('トライセプス・エクステンション'), 'arms');
  assert.equal(bodyPart('ハンギングレッグレイズ'), 'core');
});

test('スクリーンショットの追記と、軽い日を除いた筋力判定', () => {
  const a = { date: '2026-11-06', exercises: [{ name: 'ベンチプレス', sets: [{ weightKg: 70, reps: 8 }] }] };
  const m = mergeTrainingLog(a, { date: '2026-11-06', source: 'screenshot', exercises: [{ name: 'ベンチ プレス', sets: [{ weightKg: 70, reps: 9 }] }, { name: 'カール', sets: [{ weightKg: 30, reps: 10 }] }] });
  assert.equal(m.exercises.length, 2);
  assert.equal(m.exercises[0].sets[0].reps, 9);

  const logs = [
    { date: '2026-10-02', exercises: [{ name: 'ベンチプレス', sets: [{ weightKg: 70, reps: 8 }] }] },
    { date: '2026-10-28', exercises: [{ name: 'ベンチプレス', sets: [{ weightKg: 42, reps: 15 }] }] }, // 軽い日（水）
    { date: '2026-11-01', exercises: [{ name: 'ベンチプレス', sets: [{ weightKg: 72.5, reps: 8 }] }] },
  ];
  const p = exerciseProgress(exerciseHistory(logs, { skip: (d) => d === '2026-10-28' }), '2026-11-02');
  assert.ok(p[0].change4wPct > 0);
  assert.equal(p[0].sessions, 2);
});

test('筋トレログから今日のメニューと週の回数を出す', () => {
  const logs = [{ date: '2026-10-30', exercises: [{ name: 'ラットプルダウン', sets: [{ weightKg: 55, reps: 10 }, { weightKg: 55, reps: 10 }, { weightKg: 55, reps: 10 }] }] }];
  const d = analyze(raw, [], new Date('2026-11-06T03:00:00Z'), { training: logs }); // 金曜＝背中・肩（重）
  assert.equal(d.training.fromLog, true);
  assert.match(d.training.items[0].target, /^57\.5kg/);
  const d2 = analyze(raw, [], new Date('2026-10-31T03:00:00Z'), { training: logs });
  assert.equal(d2.week.goals.find((g) => g.key === 'strength').actual, 1);
});

test('前回の記録は種目の部位で照合する（曜日をずらしても拾える）', () => {
  const logs = [
    { date: '2026-10-30', exercises: [{ name: 'ベンチプレス', sets: [{ weightKg: 70, reps: 8 }] }] }, // 金曜に胸をやった
    { date: '2026-10-28', exercises: [{ name: 'ベントオーバーロウ', sets: [{ weightKg: 40, reps: 15 }] }] }, // 水曜に背中（軽）
  ];
  const d = analyze(raw, [], new Date('2026-11-06T03:00:00Z'), { training: logs }); // 金曜＝背中・肩
  assert.equal(d.training.items[0].name, 'ベントオーバーロウ');
  assert.equal(d.training.items[0].target, null); // 軽い日の重量からは重い日の目標を出さない
  const sun = analyze(raw, [], new Date('2026-11-08T03:00:00Z'), { training: logs }); // 日曜＝胸・腕
  assert.equal(sun.training.items[0].name, 'ベンチプレス');
});

// ---- FitnessPoint のスクリーンショット（文字認識テキスト） ----
import { parseFitnessPointText, checkSummary } from '../scripts/lib/fitnesspoint-text.mjs';
import { isCompound } from '../scripts/lib/strength.mjs';

const legsText = fs.readFileSync(new URL('./fixtures/fitnesspoint-legs.txt', import.meta.url), 'utf8');

test('ワークアウト詳細画面のテキストを解析（実画面のサンプル）', () => {
  const r = parseFitnessPointText(legsText, { refDate: '2026-10-30' });
  assert.deepEqual(r.exercises.map((e) => e.name), ['レッグ プレス', 'レッグ エクステンション', 'シーテッド レッグ カール', 'ジムスタジオ']);
  assert.deepEqual(r.exercises[0].sets.map((s) => `${s.weightKg}x${s.reps}`), ['100x20', '100x20', '100x20', '177x10']);
  assert.equal(r.exercises[0].sets[3].note, 'precor vsl10');
  assert.equal(r.exercises[1].note, '伸ばして1秒静止を意識する');
  assert.equal(r.exercises[3].kind, 'cardio');
  assert.equal(r.exercises[3].minutes, 40);
  assert.deepEqual(r.summary, { exercises: 4, volumeKg: 13580, sets: 12, reps: 180 });
  // 画面の合計（13580kg・12セット）と一致
  assert.equal(checkSummary(r.exercises, r.summary).ok, true);
  // 1種目読み落とすと不一致になる
  assert.equal(checkSummary(r.exercises.slice(1), r.summary).ok, false);
});

test('合計が横並びで認識された場合と、年なしの日付', () => {
  const t = '10月30日(金)\nエクササイズ ボリューム\n1 600 kg\nセット数 回数\n1 10\nベンチ プレス\n#1: 60 kg x 10 レップ\n';
  const r = parseFitnessPointText(t, { refDate: '2026-10-31' });
  assert.equal(r.date, '2026-10-30');
  assert.deepEqual(r.summary, { exercises: 1, volumeKg: 600, sets: 1, reps: 10 });
  // 1月に前年12月の記録を送った場合は前年
  assert.equal(parseFitnessPointText('12月30日\nスクワット\n#1: 80 kg x 8 レップ', { refDate: '2027-01-02' }).date, '2026-12-30');
});

test('空白入りの種目名・重量の違うセットが混ざる場合の次回目標', () => {
  assert.equal(isCompound('レッグ プレス'), true);
  assert.equal(bodyPart('シーテッド レッグ カール'), 'legs');
  const r = parseFitnessPointText(legsText);
  // レッグプレス：メインは 100kg × 20（3セット）。177kg × 10 はトップセットとして併記
  const lp = nextTarget(r.exercises[0].sets, [12, 15], 2);
  assert.equal(lp.weightKg, 102.5);
  assert.match(lp.text, /ほかに 177kg×10/);
  // レッグエクステンション：16kg のウォームアップではなく 61kg が基準
  assert.equal(nextTarget(r.exercises[1].sets, [10, 15], 3).weightKg, 63.5);
});

test('ズンバは有酸素、筋トレの部位はトレ記録から', () => {
  const r = parseFitnessPointText(legsText);
  const logs = [{ date: '2026-10-31', exercises: r.exercises }];
  const d = analyze(raw, [], new Date('2026-10-31T12:00:00Z'), { training: logs }); // 土曜＝脚（重）
  assert.deepEqual(d.week.plan.find((p) => p.date === '2026-10-31').logged.sort(), ['cardio', 'strength']);
  assert.equal(d.week.setsByPart.find((p) => p.part === 'legs').sets, 11);
  const next = analyze(raw, [], new Date('2026-11-07T03:00:00Z'), { training: logs }); // 次の土曜
  assert.deepEqual(next.training.items.map((i) => i.name), ['レッグ プレス', 'レッグ エクステンション', 'シーテッド レッグ カール']);
  assert.equal(next.training.items[2].note, '1秒スクイーズ');
});
