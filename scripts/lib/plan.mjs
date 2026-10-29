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
  for (const d of dateRange(from, to)) {
    const w = byDate.get(d)?.weight?.kg ?? null;
    if (w !== null) t = t === null ? w : t + alpha * (w - t);
    out.push({ date: d, weight: w, trend: t === null ? null : round(t, 2) });
  }
  return out;
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
  return round(startBodyFatPct + (targetBodyFatPct - startBodyFatPct) * f, 1);
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
export function dailyTargets(config, trendWeight, tdee, today) {
  const daysLeft = Math.max(1, daysBetween(today, config.goal.targetDate));
  const remainingKg = trendWeight - config.goal.targetWeightKg;
  const maxRate = (config.goal.maxWeeklyLossPct / 100) * trendWeight;
  const neededRate = remainingKg > 0 ? remainingKg / (daysLeft / 7) : 0;
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
    deficit: round(deficit),
    goalAtRisk: neededRate > maxRate * 1.001,
    kcalFloored: tdee - deficit < floor,
    daysLeft,
  };
}

/** マイルストーンに計画上の体重・体脂肪率を付けて、現在の進捗を判定 */
export function milestones(config, trend, today) {
  const list = config.milestones?.length ? config.milestones : [{ date: config.goal.targetDate, label: 'ゴール' }];
  const current = trend.at(-1)?.trend ?? null;
  return list.map((m) => {
    const targetKg = m.weightKg ?? plannedWeight(config, m.date);
    const targetBf = m.bodyFatPct ?? plannedBodyFat(config, m.date);
    const passed = m.date < today;
    const atDate = passed ? trend.find((p) => p.date === m.date)?.trend ?? null : null;
    const ref = passed ? atDate : current;
    return {
      ...m,
      targetWeightKg: round(targetKg, 1),
      targetBodyFatPct: targetBf,
      daysLeft: daysBetween(today, m.date),
      status: passed ? (ref !== null && ref <= targetKg + 0.3 ? 'achieved' : 'missed') : 'upcoming',
      actualWeightKg: atDate,
    };
  });
}
