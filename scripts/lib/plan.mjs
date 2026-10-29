// エネルギー・マクロ・体重推移・マイルストーンの計算
import { addDays, daysBetween, dateRange, mean, round, clamp } from './util.mjs';

export const KCAL_PER_KG_FAT = 7700;
const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

/** Mifflin-St Jeor 基礎代謝 */
export function bmr({ sex, age, heightCm }, weightKg) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

/**
 * 体重のトレンド（指数移動平均）。日々の水分変動に振り回されないための値。
 * 測定がない日は直前のトレンドを引き継ぐ。
 */
export function trendSeries(records, from, to, alpha = 0.15) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const out = [];
  let t = null;
  let bfT = null;
  let leanT = null;
  const bfAlpha = 0.1; // 体組成計の体脂肪率は日々のブレが大きいので、よりなだらかに
  for (const d of dateRange(from, to)) {
    const w = byDate.get(d)?.weight?.kg ?? null;
    const bf = byDate.get(d)?.weight?.bodyFatPct ?? null;
    if (w !== null) t = t === null ? w : t + alpha * (w - t);
    if (bf !== null) bfT = bfT === null ? bf : bfT + bfAlpha * (bf - bfT);
    const lean = w !== null && bf !== null ? w * (1 - bf / 100) : null;
    if (lean !== null) leanT = leanT === null ? lean : leanT + bfAlpha * (lean - leanT);
    out.push({
      date: d,
      weight: w,
      trend: t === null ? null : round(t, 2),
      bodyFatPct: bf,
      bfTrend: bfT === null ? null : round(bfT, 2),
      leanMassKg: lean === null ? null : round(lean, 2),
      leanTrend: leanT === null ? null : round(leanT, 2),
    });
  }
  return out;
}

/**
 * 目標設定の補完。recomp（筋肉を増やしつつ体脂肪率を下げる）では
 * 目標体重 = 目標除脂肪体重 ÷ (1 − 目標体脂肪率) で決まる
 */
export function normalizeGoal(config) {
  const p = config.profile;
  const g = { mode: 'cut', ...config.goal };
  const startLean = p.startBodyFatPct != null ? p.startWeightKg * (1 - p.startBodyFatPct / 100) : null;
  if (g.mode === 'recomp') {
    if (g.targetLeanMassKg == null && startLean !== null) g.targetLeanMassKg = round(startLean + (g.leanGainKg ?? 2), 1);
    if (g.targetWeightKg == null && g.targetLeanMassKg != null) g.targetWeightKg = round(g.targetLeanMassKg / (1 - g.targetBodyFatPct / 100), 1);
  }
  return { ...config, goal: g, profile: { ...p, startLeanMassKg: startLean === null ? null : round(startLean, 1) } };
}

export function plannedLeanMass(config, date) {
  const { startDate, startLeanMassKg } = config.profile;
  const { targetDate, targetLeanMassKg } = config.goal;
  if (startLeanMassKg == null || targetLeanMassKg == null) return null;
  const f = clamp(daysBetween(startDate, date) / daysBetween(startDate, targetDate), 0, 1);
  return round(startLeanMassKg + (targetLeanMassKg - startLeanMassKg) * f, 2);
}

/** 計画ライン：開始日の体重→目標日の目標体重を直線で結ぶ */
export function plannedWeight(config, date) {
  const { startDate, startWeightKg } = config.profile;
  const { targetDate, targetWeightKg } = config.goal;
  const total = daysBetween(startDate, targetDate);
  const f = clamp(daysBetween(startDate, date) / total, 0, 1);
  return round(startWeightKg + (targetWeightKg - startWeightKg) * f, 2);
}

export function plannedBodyFat(config, date) {
  const { startDate, startBodyFatPct } = config.profile;
  const { targetDate, targetBodyFatPct } = config.goal;
  if (startBodyFatPct == null || targetBodyFatPct == null) return null;
  const f = clamp(daysBetween(startDate, date) / daysBetween(startDate, targetDate), 0, 1);
  return round(startBodyFatPct + (targetBodyFatPct - startBodyFatPct) * f, 2);
}

/**
 * 推定TDEE。最初は式（BMR×活動係数）、記録が貯まるほど
 * 「実際の摂取カロリー − 体重トレンド変化」から逆算した実測値を重視する。
 */
export function estimateTdee(config, records, trend, today) {
  const current = trend.at(-1)?.trend ?? config.profile.startWeightKg;
  const formula = bmr(config.profile, current) * (ACTIVITY[config.profile.activityLevel] ?? 1.55);

  const window = 21;
  const from = addDays(today, -window);
  const logged = records.filter((r) => r.date > from && r.date <= today && r.nutrition?.kcal > 800);
  const tFrom = trend.find((p) => p.date === from)?.trend;
  const tNow = trend.find((p) => p.date === today)?.trend;
  let observed = null;
  if (logged.length >= 10 && tFrom != null && tNow != null) {
    const avgIntake = mean(logged.map((r) => r.nutrition.kcal));
    observed = avgIntake - ((tNow - tFrom) * KCAL_PER_KG_FAT) / window;
  }
  const w = observed === null ? 0 : Math.min(1, logged.length / window) * 0.7;
  return {
    formula: round(formula),
    observed: observed === null ? null : round(observed),
    tdee: round(formula * (1 - w) + (observed ?? 0) * w),
    observedWeight: round(w, 2),
  };
}

/** 今日からゴールまでに必要な減量ペースと、1日のカロリー・PFC目標 */
export function dailyTargets(config, trendWeight, tdee, today, bodyFatPct = null) {
  const daysLeft = Math.max(1, daysBetween(today, config.goal.targetDate));
  const weeksLeft = daysLeft / 7;
  const maxRate = (config.goal.maxWeeklyLossPct / 100) * trendWeight;
  let neededRate;
  let fatToLoseKg = null;
  if (config.goal.mode === 'recomp' && bodyFatPct != null && config.goal.targetLeanMassKg != null) {
    // 落とすのは脂肪だけ。脂肪1kg = 7700kcal（筋肉が増える分の体重増は不足カロリーに含めない）
    const bf = config.goal.targetBodyFatPct;
    const fatTarget = (config.goal.targetLeanMassKg * bf) / (100 - bf);
    fatToLoseKg = trendWeight * (bodyFatPct / 100) - fatTarget;
    neededRate = Math.max(0, fatToLoseKg / weeksLeft);
  } else {
    const remainingKg = trendWeight - config.goal.targetWeightKg;
    neededRate = remainingKg > 0 ? remainingKg / weeksLeft : 0;
  }
  const rate = Math.min(neededRate, maxRate);
  const deficit = (rate * KCAL_PER_KG_FAT) / 7;

  const floor = Math.max(bmr(config.profile, trendWeight), config.profile.sex === 'female' ? 1200 : 1500);
  const kcal = Math.max(floor, tdee - deficit);

  const protein = config.daily.proteinGPerKg * trendWeight;
  const fat = Math.max(0.6 * trendWeight, (kcal * config.daily.fatPctOfKcal) / 100 / 9);
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);

  return {
    kcal: round(kcal, -1),
    proteinG: round(protein),
    fatG: round(fat),
    carbsG: round(carbs),
    sleepMinutes: round(config.daily.sleepHours * 60),
    steps: config.daily.steps,
    weeklyRateKg: round(rate, 2),
    neededWeeklyRateKg: round(neededRate, 2),
    maxWeeklyRateKg: round(maxRate, 2),
    fatToLoseKg: round(fatToLoseKg, 1),
    deficit: round(deficit),
    goalAtRisk: neededRate > maxRate * 1.001,
    kcalFloored: tdee - deficit < floor,
    daysLeft,
  };
}

/** 曜日ごとのカロリー配分：重い日に多め、軽い日・休養日に少なめ（週の合計は同じ） */
export function dayKcalAdjust(config, intensity, kind) {
  const bonus = config.daily.heavyDayBonusKcal ?? 0;
  if (!bonus) return 0;
  const days = Object.values(config.program ?? {}).map((v) => String(v));
  const heavy = days.filter((v) => v.endsWith(':heavy')).length;
  const others = days.length - heavy;
  if (intensity === 'heavy') return bonus;
  if (!others) return 0;
  return -Math.round((bonus * heavy) / others / 10) * 10;
}

/** マイルストーンに計画上の体重・体脂肪率を付けて、現在の進捗を判定 */
export function milestones(config, trend, today) {
  const list = config.milestones?.length ? config.milestones : [{ date: config.goal.targetDate, label: 'ゴール' }];
  return list.map((m) => {
    const targetKg = m.weightKg ?? plannedWeight(config, m.date);
    const targetBf = m.bodyFatPct ?? plannedBodyFat(config, m.date);
    const targetLean = m.leanMassKg ?? plannedLeanMass(config, m.date);
    const passed = m.date < today;
    const at = passed ? trend.find((p) => p.date === m.date) ?? null : null;
    let achieved;
    if (config.goal.mode === 'recomp') {
      // 体脂肪率が目標以下 かつ 除脂肪体重が目標の-0.5kg以内なら達成
      achieved = at?.bfTrend != null && at.bfTrend <= targetBf + 0.3 && (at.leanTrend == null || targetLean == null || at.leanTrend >= targetLean - 0.5);
    } else {
      achieved = at?.trend != null && at.trend <= targetKg + 0.3;
    }
    return {
      ...m,
      targetWeightKg: round(targetKg, 1),
      targetBodyFatPct: targetBf,
      targetLeanMassKg: round(targetLean, 1),
      daysLeft: daysBetween(today, m.date),
      status: passed ? (achieved ? 'achieved' : 'missed') : 'upcoming',
      actualWeightKg: at?.trend ?? null,
      actualBodyFatPct: at?.bfTrend ?? null,
      actualLeanMassKg: at?.leanTrend ?? null,
    };
  });
}
