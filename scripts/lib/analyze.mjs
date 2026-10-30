// 日次レコード + 目標設定 → ダッシュボード用データ
import { addDays, daysBetween, localDate, mean, round, weekStart, dateRange } from './util.mjs';
import { trendSeries, plannedWeight, plannedBodyFat, plannedLeanMass, normalizeGoal, estimateTdee, dailyTargets, dayKcalAdjust, milestones } from './plan.mjs';
import { classifyWorkout, todaysSession, plannedStrengthLeft, weekPlan, sessionFor, sessionParts } from './training.mjs';
import { exerciseHistory, exerciseProgress, weeklySetsByPart, previousSessionLog, recentPRs, PART_LABELS, hasStrength, hasCardio, inferIntensity } from './strength.mjs';
import { buildAdvice, mealPlan } from './advice.mjs';

function status(actual, target, { tolerance = 0.1, mode = 'atLeast' } = {}) {
  if (actual === null || actual === undefined) return 'pending';
  const r = actual / target;
  if (mode === 'atLeast') return r >= 1 ? 'good' : r >= 1 - tolerance ? 'warning' : 'critical';
  if (mode === 'atMost') return r <= 1 + tolerance * 0.5 ? 'good' : r <= 1 + tolerance ? 'warning' : 'critical';
  // range
  return Math.abs(r - 1) <= tolerance ? 'good' : Math.abs(r - 1) <= tolerance * 2 ? 'warning' : 'critical';
}

function workoutKinds(rec) {
  return (rec?.workouts ?? []).map((w) => w.kind ?? classifyWorkout(w.type));
}

export function analyze(rawConfig, records, now = new Date(), { demo = false, training: trainingLogs = [] } = {}) {
  const config = normalizeGoal(rawConfig);
  const recomp = config.goal.mode === 'recomp';
  const tz = config.timezone ?? 'Asia/Tokyo';
  const today = localDate(now, tz);
  const sorted = [...records].filter((r) => r.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((r) => [r.date, r]));
  const logs = trainingLogs.filter((l) => l.date <= today && l.exercises?.length).sort((a, b) => a.date.localeCompare(b.date));
  const logByDate = new Map(logs.map((l) => [l.date, l]));
  // ヘルスケアのワークアウト＋筋トレログ（ログがある日は筋トレ1回として数える）
  const kindsFor = (date) => {
    const kinds = workoutKinds(byDate.get(date));
    const log = logByDate.get(date);
    if (log && hasStrength(log) && !kinds.includes('strength')) kinds.push('strength');
    if (log && hasCardio(log) && !kinds.includes('cardio')) kinds.push('cardio');
    return kinds;
  };
  const first = sorted[0]?.date ?? today;
  const from = first < config.profile.startDate ? first : config.profile.startDate;
  const trend = trendSeries(sorted, from <= today ? from : today, today);

  const weighIns = sorted.filter((r) => r.weight?.kg);
  const lastWeigh = weighIns.at(-1) ?? null;
  const trendWeight = trend.at(-1)?.trend ?? config.profile.startWeightKg;
  const lastBf = [...sorted].reverse().find((r) => r.weight?.bodyFatPct)?.weight.bodyFatPct ?? null;
  const bfNow = trend.at(-1)?.bfTrend ?? lastBf ?? config.profile.startBodyFatPct ?? null;
  const leanNow = trend.at(-1)?.leanTrend ?? (bfNow != null ? trendWeight * (1 - bfNow / 100) : null);

  const energy = estimateTdee(config, sorted, trend, today);
  const targets = dailyTargets(config, trendWeight, energy.tdee, today, bfNow);

  // 直近14日のトレンドの傾き（kg/週）
  const t14 = trend.find((p) => p.date === addDays(today, -14))?.trend ?? null;
  const recentRateKg = t14 !== null ? round(((trendWeight - t14) / 14) * 7, 2) : null;
  const projectedKg =
    recentRateKg !== null ? round(trendWeight + (recentRateKg / 7) * daysBetween(today, config.goal.targetDate), 1) : null;
  const achievableKg = round(trendWeight - targets.maxWeeklyRateKg * (targets.daysLeft / 7), 1);
  // 体脂肪率（%/週）と除脂肪体重（kg/週）の直近14日の傾き
  const p14 = trend.find((p) => p.date === addDays(today, -14));
  const bfRate = p14?.bfTrend != null && bfNow != null && trend.at(-1)?.bfTrend != null ? round(((bfNow - p14.bfTrend) / 14) * 7, 2) : null;
  const leanRate = p14?.leanTrend != null && trend.at(-1)?.leanTrend != null ? round(((leanNow - p14.leanTrend) / 14) * 7, 2) : null;
  const weeksToGoal = daysBetween(today, config.goal.targetDate) / 7;
  const projectedBf = bfRate !== null ? round(bfNow + bfRate * weeksToGoal, 1) : null;
  const projectedLean = leanRate !== null ? round(leanNow + leanRate * weeksToGoal, 1) : null;

  // --- 7日集計 ---
  const last7 = dateRange(addDays(today, -6), today).map((d) => byDate.get(d));
  // 当日は記録途中なので食事の平均からは除外
  const last7Closed = dateRange(addDays(today, -7), addDays(today, -1)).map((d) => byDate.get(d));
  const week7 = {
    kcalAvg: mean(last7Closed.map((r) => (r?.nutrition?.kcal > 800 ? r.nutrition.kcal : null))),
    proteinAvg: mean(last7Closed.map((r) => (r?.nutrition?.kcal > 800 ? r.nutrition.proteinG ?? null : null))),
    sleepAvg: mean(last7.map((r) => r?.sleep?.minutes ?? null)),
    stepsAvg: mean(last7Closed.map((r) => r?.activity?.steps ?? null)),
    loggedNutritionDays: last7Closed.filter((r) => r?.nutrition?.kcal > 800).length,
  };

  // --- 今週（月〜日） ---
  const monday = weekStart(today);
  const weekDates = dateRange(monday, today);
  const weekRecs = weekDates.map((d) => byDate.get(d));
  const closedWeekRecs = weekRecs.slice(0, -1);
  const strengthDone = weekDates.reduce((n, d) => n + kindsFor(d).filter((k) => k === 'strength').length, 0);
  const cardioDone = weekDates.reduce((n, d) => n + kindsFor(d).filter((k) => k === 'cardio').length, 0);
  const todayRec = byDate.get(today);
  const doneToday = kindsFor(today);
  // 軽い日・重い日は記録の重量から推定（曜日どおりとは限らない）。筋力の推移は軽い日を除いて判定する
  const inferred = inferIntensity(logs);
  const intensityOf = (date) => inferred.get(date) ?? (sessionFor(config, date).intensity === 'light' ? 'light' : 'heavy');
  const history = exerciseHistory(logs, { skip: (date) => intensityOf(date) === 'light' });
  const progress = exerciseProgress(history, today);

  const lastSleepMinutes = todayRec?.sleep?.minutes ?? null;
  const stalled = recomp ? bfRate !== null && targets.neededWeeklyRateKg > 0 && bfRate >= 0 : recentRateKg !== null && targets.neededWeeklyRateKg > 0 && recentRateKg > -0.1;
  const training = todaysSession(config, today, {
    weekStrengthDone: strengthDone - doneToday.filter((k) => k === 'strength').length,
    plannedStrengthLeft: plannedStrengthLeft(config, addDays(today, 1)) * (today === addDays(monday, 6) ? 0 : 1),
    lastSleepMinutes,
    stalled,
    doneToday,
    previous: previousSessionLog(logs, config, today, sessionFor, sessionParts, intensityOf),
    intensityOf,
    history,
  });

  // 今日だけのカロリー（重い日は多め・休養日は少なめ。週平均は targets.kcal）
  const adj = dayKcalAdjust(config, training.intensity, training.kind);
  targets.kcalToday = targets.kcal + adj;
  targets.carbsToday = Math.max(0, targets.carbsG + Math.round(adj / 4));
  targets.dayAdjustKcal = adj;

  const prevSunday = addDays(monday, -1);
  const atWeekStart = trend.find((p) => p.date === prevSunday) ?? null;
  const weekChange = atWeekStart?.trend != null ? round(trendWeight - atWeekStart.trend, 2) : null;
  const weekBfChange = atWeekStart?.bfTrend != null && bfNow != null ? round(bfNow - atWeekStart.bfTrend, 2) : null;
  const weekLeanChange = atWeekStart?.leanTrend != null && leanNow != null ? round(leanNow - atWeekStart.leanTrend, 2) : null;
  const bfWeeklyTarget = recomp && config.profile.startBodyFatPct != null
    ? round((config.goal.targetBodyFatPct - config.profile.startBodyFatPct) / (daysBetween(config.profile.startDate, config.goal.targetDate) / 7), 2)
    : null;
  const leanWeeklyTarget = recomp && config.goal.targetLeanMassKg != null && config.profile.startLeanMassKg != null
    ? round((config.goal.targetLeanMassKg - config.profile.startLeanMassKg) / (daysBetween(config.profile.startDate, config.goal.targetDate) / 7), 2)
    : null;
  const daysElapsed = weekDates.length;
  const weekKcal = mean(closedWeekRecs.map((r) => (r?.nutrition?.kcal > 800 ? r.nutrition.kcal : null)));
  const weekProtein = mean(closedWeekRecs.map((r) => (r?.nutrition?.kcal > 800 ? r.nutrition.proteinG ?? null : null)));
  const weekSleep = mean(weekRecs.map((r) => r?.sleep?.minutes ?? null));
  const weekSteps = mean(closedWeekRecs.map((r) => r?.activity?.steps ?? null));
  const weighDays = weekRecs.filter((r) => r?.weight?.kg).length;

  // 部位別の週セット数（筋肥大の目安：1部位あたり週10〜20セット）
  const [setMin, setMax] = config.weekly.setsPerMuscle ?? [10, 20];
  const partsInProgram = new Set(['back', 'shoulders', 'legs', 'chest', 'arms']);
  const setsThisWeek = weeklySetsByPart(logs, monday, today);
  const setsByPart = logs.length
    ? [...partsInProgram].map((part) => {
        const sets = setsThisWeek[part] ?? 0;
        return { part, label: PART_LABELS[part], sets, min: setMin, max: setMax, status: sets > setMax + 2 ? 'warning' : sets >= setMin ? 'good' : 'pending' };
      })
    : [];

  const week = {
    setsByPart,
    start: monday,
    end: addDays(monday, 6),
    daysLeft: daysBetween(today, addDays(monday, 6)) + 1,
    strengthNeeded: Math.max(0, config.weekly.strengthSessions - strengthDone),
    goals: [
      { key: 'strength', label: '筋トレ', actual: strengthDone, target: config.weekly.strengthSessions, unit: '回', status: strengthDone >= config.weekly.strengthSessions ? 'good' : 'pending' },
      { key: 'cardio', label: '有酸素', actual: cardioDone, target: config.weekly.cardioSessions, unit: '回', status: cardioDone >= config.weekly.cardioSessions ? 'good' : 'pending' },
      ...(recomp
        ? [
            { key: 'bf', label: '体脂肪率の変化', actual: weekBfChange, target: bfWeeklyTarget, unit: '%', status: weekBfChange === null ? 'pending' : weekBfChange <= 0 ? 'good' : weekBfChange <= 0.3 ? 'warning' : 'critical' },
            { key: 'lean', label: '除脂肪体重の変化', actual: weekLeanChange, target: leanWeeklyTarget, unit: 'kg', status: weekLeanChange === null ? 'pending' : weekLeanChange >= 0 ? 'good' : weekLeanChange >= -0.3 ? 'warning' : 'critical' },
          ]
        : [{ key: 'weight', label: '体重変化', actual: weekChange, target: -targets.weeklyRateKg, unit: 'kg', status: weekChange === null ? 'pending' : weekChange <= -targets.weeklyRateKg * (daysElapsed / 7) * 0.7 ? 'good' : weekChange <= 0 ? 'warning' : 'critical' }]),
      { key: 'kcal', label: '平均カロリー', actual: round(weekKcal, -1), target: targets.kcal, unit: 'kcal', status: status(weekKcal, targets.kcal, { mode: 'atMost' }) },
      { key: 'protein', label: '平均タンパク質', actual: round(weekProtein), target: targets.proteinG, unit: 'g', status: status(weekProtein, targets.proteinG) },
      { key: 'sleep', label: '平均睡眠', actual: round(weekSleep), target: targets.sleepMinutes, unit: 'min', status: status(weekSleep, targets.sleepMinutes, { tolerance: 0.07 }) },
      { key: 'steps', label: '平均歩数', actual: round(weekSteps, -1), target: targets.steps, unit: '歩', status: status(weekSteps, targets.steps, { tolerance: 0.2 }) },
      { key: 'weighins', label: '体重測定', actual: weighDays, target: daysElapsed, unit: '日', status: weighDays >= daysElapsed ? 'good' : weighDays >= daysElapsed - 1 ? 'warning' : 'critical' },
    ].filter((g) => g.target !== 0),
    plan: weekPlan(config, monday).map((d) => {
      const kinds = kindsFor(d.date);
      return { ...d, done: d.kind === 'rest' ? null : kinds.includes(d.kind) || (d.kind === 'strength' && kinds.includes('strength')), logged: kinds, past: d.date < today, today: d.date === today };
    }),
  };

  // --- 今日の目標 ---
  const n = todayRec?.nutrition ?? {};
  const todayGoals = [
    { key: 'weighin', label: '体重測定', actual: todayRec?.weight?.kg ?? null, target: null, unit: 'kg', status: todayRec?.weight?.kg ? 'good' : 'pending' },
    { key: 'sleep', label: '睡眠（昨夜）', actual: lastSleepMinutes, target: targets.sleepMinutes, unit: 'min', status: status(lastSleepMinutes, targets.sleepMinutes, { tolerance: 0.1 }) },
    { key: 'kcal', label: 'カロリー', actual: n.kcal ?? null, target: targets.kcalToday, unit: 'kcal', status: n.kcal == null ? 'pending' : n.kcal > targets.kcalToday * 1.1 ? 'critical' : n.kcal > targets.kcalToday * 1.03 ? 'warning' : n.kcal >= targets.kcalToday * 0.9 ? 'good' : 'pending' },
    { key: 'protein', label: 'タンパク質', actual: n.proteinG ?? null, target: targets.proteinG, unit: 'g', status: n.proteinG == null ? 'pending' : n.proteinG >= targets.proteinG ? 'good' : 'pending' },
    { key: 'fat', label: '脂質', actual: n.fatG ?? null, target: targets.fatG, unit: 'g', status: n.fatG == null ? 'pending' : n.fatG > targets.fatG * 1.2 ? 'warning' : 'good' },
    { key: 'carbs', label: '炭水化物', actual: n.carbsG ?? null, target: targets.carbsToday, unit: 'g', status: n.carbsG == null ? 'pending' : n.carbsG > targets.carbsToday * 1.2 ? 'warning' : 'good' },
    { key: 'steps', label: '歩数', actual: todayRec?.activity?.steps ?? null, target: targets.steps, unit: '歩', status: (todayRec?.activity?.steps ?? 0) >= targets.steps ? 'good' : 'pending' },
    { key: 'training', label: 'トレーニング', actual: training.kind === 'rest' ? null : training.done ? 1 : 0, target: training.kind === 'rest' ? null : 1, unit: '', status: training.kind === 'rest' ? 'good' : training.done ? 'good' : 'pending', note: training.name },
  ];

  // --- 3月末ゴール ---
  const start = config.profile.startWeightKg;
  const goalKg = config.goal.targetWeightKg;
  const planToday = plannedWeight(config, today);
  const startBf = config.profile.startBodyFatPct;
  const bfProgress = recomp && startBf != null && bfNow != null && startBf !== config.goal.targetBodyFatPct
    ? round(Math.max(0, Math.min(1, (startBf - bfNow) / (startBf - config.goal.targetBodyFatPct))) * 100)
    : null;
  const goal = {
    mode: config.goal.mode,
    targetDate: config.goal.targetDate,
    targetLeanMassKg: config.goal.targetLeanMassKg ?? null,
    startLeanMassKg: config.profile.startLeanMassKg ?? null,
    plannedTodayLeanKg: plannedLeanMass(config, today),
    projectedBodyFatPct: projectedBf,
    projectedLeanMassKg: projectedLean,
    deltaVsPlanBf: bfNow != null && plannedBodyFat(config, today) != null ? round(bfNow - plannedBodyFat(config, today), 1) : null,
    deltaVsPlanLean: leanNow != null && plannedLeanMass(config, today) != null ? round(leanNow - plannedLeanMass(config, today), 1) : null,
    remainingBf: bfNow != null ? round(bfNow - config.goal.targetBodyFatPct, 1) : null,
    targetWeightKg: goalKg,
    targetBodyFatPct: config.goal.targetBodyFatPct,
    startWeightKg: start,
    startBodyFatPct: config.profile.startBodyFatPct,
    daysLeft: daysBetween(today, config.goal.targetDate),
    weeksLeft: round(daysBetween(today, config.goal.targetDate) / 7, 1),
    progressPct: bfProgress !== null ? bfProgress : start !== goalKg ? round(Math.max(0, Math.min(1, (start - trendWeight) / (start - goalKg))) * 100) : 100,
    plannedTodayKg: planToday,
    plannedTodayBodyFatPct: plannedBodyFat(config, today),
    deltaVsPlanKg: round(trendWeight - planToday, 2),
    projectedKg,
    achievableKg,
    remainingKg: round(trendWeight - goalKg, 1),
  };

  // --- データ鮮度 ---
  const sourceDefs = [
    ['weight', '体重', (r) => r.weight?.kg],
    ['sleep', '睡眠', (r) => r.sleep?.minutes],
    ['nutrition', '食事', (r) => r.nutrition?.kcal],
    ['activity', '歩数', (r) => r.activity?.steps],
    ['workouts', 'トレーニング', (r) => r.workouts?.length],
  ];
  const apps = config.apps ?? {};
  const sources = sourceDefs.map(([key, label, get]) => {
    const lastDate = [...sorted].reverse().find((r) => get(r))?.date ?? null;
    return { key, label: apps[key] ? `${label}（${apps[key]}）` : label, lastDate, days: lastDate ? daysBetween(lastDate, today) : null };
  });
  const staleSources = sorted.length ? sources.filter((s) => s.key !== 'workouts' && (s.days === null || s.days >= 2)) : [];

  const started = weighIns.length && today >= config.profile.startDate;
  const deltaVsPlanKg = started ? goal.deltaVsPlanKg : null;
  const lastLog = logs.at(-1) ?? null;
  const strength = {
    hasData: logs.length > 0,
    sessions: logs.length,
    firstDate: logs[0]?.date ?? null,
    lastDate: lastLog?.date ?? null,
    exercises: progress.slice(0, 12),
    prs: recentPRs(progress, today).map(({ name, best1rm, prDate }) => ({ name, best1rm, prDate })),
    stalled: progress.filter((p) => p.stalled && p.compound).slice(0, 3).map(({ name, last1rm, best1rm }) => ({ name, last1rm, best1rm })),
    // 画面の合計と読み取り内容が合わない日（スクショの撮り漏れ・読み違い）
    incomplete: logs.filter((l) => l.check && !l.check.ok && l.date >= addDays(today, -7)).map((l) => ({ date: l.date, ...l.check })),
    declining: progress.filter((p) => p.compound && p.change4wPct !== null && p.change4wPct <= -5).map(({ name, change4wPct }) => ({ name, change4wPct })),
  };
  const advice = buildAdvice({
    strength,
    mode: config.goal.mode,
    bfRate,
    leanRate,
    deltaVsPlanBf: started ? goal.deltaVsPlanBf : null,
    weightKg: trendWeight,
    targets,
    achievableKg,
    recentRateKg,
    trendDays: weighIns.length ? daysBetween(weighIns[0].date, today) : 0,
    deltaVsPlanKg,
    week7,
    week,
    training,
    staleSources,
  });

  // --- グラフ用時系列 ---
  const chartFrom = addDays(today, -89) > config.profile.startDate ? addDays(today, -89) : config.profile.startDate;
  const weightSeries = trend
    .filter((p) => p.date >= chartFrom)
    .map((p) => ({ ...p, plan: plannedWeight(config, p.date), planBf: plannedBodyFat(config, p.date), planLean: plannedLeanMass(config, p.date) }));
  const daily = dateRange(addDays(today, -27), today).map((d) => {
    const r = byDate.get(d);
    const kinds = kindsFor(d);
    return {
      date: d,
      kcal: r?.nutrition?.kcal ?? null,
      proteinG: r?.nutrition?.proteinG ?? null,
      sleepMinutes: r?.sleep?.minutes ?? null,
      steps: r?.activity?.steps ?? null,
      strength: kinds.filter((k) => k === 'strength').length,
      cardio: kinds.filter((k) => k === 'cardio').length,
    };
  });

  const isTrainingDay = training.kind === 'strength';
  return {
    generatedAt: now.toISOString(),
    today,
    demo,
    profile: { sex: config.profile.sex, age: config.profile.age, heightCm: config.profile.heightCm },
    current: {
      trendWeightKg: round(trendWeight, 1),
      lastWeightKg: lastWeigh?.weight.kg ?? null,
      lastWeighDate: lastWeigh?.date ?? null,
      bodyFatPct: bfNow != null ? round(bfNow, 1) : null,
      lastBodyFatPct: lastBf,
      leanMassKg: leanNow != null ? round(leanNow, 1) : null,
      changeFromStartLeanKg: leanNow != null && config.profile.startLeanMassKg != null ? round(leanNow - config.profile.startLeanMassKg, 1) : null,
      changeFromStartBf: bfNow != null && startBf != null ? round(bfNow - startBf, 1) : null,
      bfRatePerWeek: bfRate,
      leanRatePerWeek: leanRate,
      changeFromStartKg: round(trendWeight - start, 1),
      recentRateKgPerWeek: recentRateKg,
    },
    energy,
    targets,
    todayGoals,
    remainingToday: {
      kcal: n.kcal != null ? round(targets.kcalToday - n.kcal, -1) : targets.kcalToday,
      proteinG: n.proteinG != null ? round(targets.proteinG - n.proteinG) : targets.proteinG,
    },
    meals: mealPlan({ ...targets, kcal: targets.kcalToday, carbsG: targets.carbsToday }, daysBetween('2026-01-01', today), isTrainingDay),
    training,
    week,
    goal,
    milestones: milestones(config, trend, today),
    advice,
    sources,
    strength,
    series: { weight: weightSeries, daily },
    aiCoach: null,
  };
}
