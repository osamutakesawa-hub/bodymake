// 記録から食事・トレーニング・回復のアドバイスを生成するルールエンジン
import { round } from './util.mjs';

const PROTEIN_FOODS = [
  { name: '鶏むね肉（皮なし）100g', p: 23, kcal: 105 },
  { name: 'プロテイン1杯（水割り）', p: 20, kcal: 110 },
  { name: 'ギリシャヨーグルト1個', p: 10, kcal: 90 },
  { name: 'サラダチキン1個', p: 24, kcal: 120 },
  { name: 'ツナ缶（水煮）1缶', p: 13, kcal: 60 },
  { name: '卵2個', p: 12, kcal: 150 },
  { name: '納豆1パック', p: 8, kcal: 90 },
  { name: '鮭の切り身1切れ', p: 20, kcal: 150 },
];

/** タンパク質の不足分を埋める食品の組み合わせ（カロリーが低い順に貪欲法） */
export function proteinFillers(shortfallG) {
  const sorted = [...PROTEIN_FOODS].sort((a, b) => a.kcal / a.p - b.kcal / b.p);
  const out = [];
  let left = shortfallG;
  for (const f of sorted) {
    if (left <= 0 || out.length >= 3) break;
    out.push(f);
    left -= f.p;
  }
  return out;
}

const MEAL_IDEAS = {
  breakfast: [
    'オートミール40g＋プロテイン＋バナナ',
    '卵2個＋全粒粉トースト＋ギリシャヨーグルト',
    'ご飯150g＋納豆＋味噌汁＋ゆで卵',
  ],
  lunch: [
    '鶏むね定食（ご飯200g・サラダ・味噌汁）',
    'コンビニ：サラダチキン＋おにぎり2個＋サラダ',
    '刺身定食（ご飯普通盛り）',
  ],
  dinner: [
    '鮭の塩焼き＋ご飯150g＋野菜たっぷりの汁物',
    '豚ヒレの生姜焼き＋ご飯150g＋温野菜',
    '鶏もも（皮なし）の鍋＋〆なし',
  ],
  snack: ['プロテイン1杯', 'ギリシャヨーグルト＋ナッツ10g', 'ゆで卵2個'],
};

/** 1日の目標を朝・昼・夕・間食に配分し、メニュー例を付ける */
export function mealPlan(targets, dayIndex, isTrainingDay) {
  const split = isTrainingDay
    ? { breakfast: 0.25, lunch: 0.3, snack: 0.15, dinner: 0.3 }
    : { breakfast: 0.25, lunch: 0.35, snack: 0.1, dinner: 0.3 };
  const labels = { breakfast: '朝食', lunch: '昼食', snack: isTrainingDay ? 'トレ前後' : '間食', dinner: '夕食' };
  return Object.entries(split).map(([k, f]) => ({
    key: k,
    label: labels[k],
    kcal: round(targets.kcal * f, -1),
    proteinG: round(targets.proteinG * f),
    carbsG: round(targets.carbsG * f),
    idea: MEAL_IDEAS[k][dayIndex % MEAL_IDEAS[k].length],
  }));
}

/**
 * ctx: analyze.mjs が組み立てる集計値
 * 戻り値: [{ level: 'critical'|'warning'|'good'|'info', category, title, detail }]
 */
export function buildAdvice(ctx) {
  const a = [];
  const add = (level, category, title, detail) => a.push({ level, category, title, detail });
  const t = ctx.targets;

  // --- 目標とペース ---
  if (ctx.mode === 'recomp') recompAdvice(ctx, add);
  else cutAdvice(ctx, add);

  // --- 食事 ---
  const w = ctx.week7;
  if (w.proteinAvg !== null && w.proteinAvg < t.proteinG * 0.9) {
    const short = round(t.proteinG - w.proteinAvg);
    const foods = proteinFillers(short).map((f) => `${f.name}（P${f.p}g）`).join('、');
    add('warning', 'nutrition', `タンパク質が1日平均${short}g不足`, `7日平均${round(w.proteinAvg)}g / 目標${t.proteinG}g。追加するなら：${foods}。40代以降は1回に30〜40gを3〜4回に分けると筋肉の合成が高まりやすくなります`);
  } else if (w.proteinAvg !== null && w.proteinAvg < t.proteinG) {
    add('info', 'nutrition', `タンパク質はあと${round(t.proteinG - w.proteinAvg)}g`, `7日平均${round(w.proteinAvg)}g / 目標${t.proteinG}g。間食をプロテインかヨーグルトにすれば届きます。`);
  } else if (w.proteinAvg !== null) {
    add('good', 'nutrition', 'タンパク質は目標達成', `7日平均${round(w.proteinAvg)}g（目標${t.proteinG}g）`);
  }
  if (w.kcalAvg !== null) {
    if (w.kcalAvg > t.kcal * 1.1) add('warning', 'nutrition', `カロリーが平均${round(w.kcalAvg - t.kcal, -1)}kcalオーバー`, '夜の主食を半分に、飲み物・間食から削るのが一番ラクです。');
    else if (w.kcalAvg < t.kcal * 0.8) add('warning', 'nutrition', '食べなさすぎです', `7日平均${round(w.kcalAvg, -1)}kcalは目標より20%以上少なく、筋量低下とリバウンドのリスクがあります。トレーニング前後に炭水化物を足しましょう。`);
  }
  if (w.loggedNutritionDays < 5) add('info', 'data', '食事記録を毎日つけましょう', `直近7日で記録は${w.loggedNutritionDays}日。カロリーの自動調整は記録が多いほど正確になります。`);

  // --- 回復 ---
  if (w.sleepAvg !== null && w.sleepAvg < t.sleepMinutes - 30) {
    add('warning', 'recovery', `睡眠が平均${Math.floor(w.sleepAvg / 60)}時間${round(w.sleepAvg % 60)}分と不足`, '睡眠不足は食欲増加と筋分解につながります。就寝時刻を固定し、カフェインは14時まで、寝る1時間前はスマホを置きましょう。');
  } else if (w.sleepAvg !== null) {
    add('good', 'recovery', '睡眠は確保できています', `7日平均${Math.floor(w.sleepAvg / 60)}時間${round(w.sleepAvg % 60)}分`);
  }
  if (w.stepsAvg !== null && w.stepsAvg < t.steps * 0.8) {
    add('info', 'activity', '歩数を増やしましょう', `7日平均${round(w.stepsAvg, -2).toLocaleString()}歩。食後10分の散歩・1駅歩くで+2,000歩は簡単に稼げます。`);
  }

  // --- トレーニング ---
  if (ctx.week.strengthNeeded > 0 && ctx.week.daysLeft < ctx.week.strengthNeeded) {
    add('warning', 'training', `今週の筋トレがあと${ctx.week.strengthNeeded}回足りません`, '残り日数が足りない場合は、全身メニュー1回にまとめて主要種目だけ行いましょう。');
  }
  if (ctx.training.adjustments.length) {
    add('info', 'training', '今日のメニューを調整しました', ctx.training.adjustments.join(' / '));
  }

  // --- 筋力（FitnessPoint のログ） ---
  const st = ctx.strength;
  if (st?.hasData) {
    if (st.declining.length) {
      add('warning', 'training', `主要種目の推定1RMが下がっています：${st.declining.map((d) => `${d.name}（${d.change4wPct}%）`).join('、')}`, '4週間で5%以上の低下は、筋肉が落ち始めているサインです。重い日の前日と当日のカロリーを+200kcal、睡眠を7時間以上確保し、回復週を前倒ししてください。');
    }
    if (st.stalled.length) {
      add('info', 'training', `3週間伸びていない種目：${st.stalled.map((d) => d.name).join('、')}`, '①回数レンジを変える（6〜8回 ⇄ 10〜12回）②同じ部位の別種目に3〜4週間入れ替える ③疲労が溜まっているなら回復週を入れる、のどれかを試しましょう。');
    }
    if (st.prs.length) {
      add('good', 'training', `今週の自己ベスト更新：${st.prs.map((p) => p.name).join('、')}`, `推定1RM ${st.prs.map((p) => `${p.name} ${p.best1rm}kg`).join('・')}。体脂肪を落としながら筋力が伸びているのは、筋肉が増えている良いサインです。`);
    }
  }

  // --- データ ---
  for (const s of ctx.staleSources) {
    add('info', 'data', `${s.label}のデータが${s.days}日届いていません`, 'iPhoneのショートカット（オートメーション）が動いているか確認してください。');
  }

  const order = { critical: 0, warning: 1, info: 2, good: 3 };
  return a.sort((x, y) => order[x.level] - order[y.level]);
}

function cutAdvice(ctx, add) {
  const t = ctx.targets;
  if (t.goalAtRisk) {
    add(
      'critical',
      'goal',
      '今の目標は期限内に安全なペースを超えています',
      `必要ペースは週${t.neededWeeklyRateKg}kgですが、筋量を守れる上限は週${t.maxWeeklyRateKg}kgです。このペースだと3月末は約${ctx.achievableKg}kgの見込みです。目標体重を見直すか、体脂肪率を主目標にしましょう。`
    );
  }
  if (ctx.recentRateKg !== null && ctx.trendDays >= 14) {
    const lossRate = -ctx.recentRateKg; // 正 = 減っている
    if (lossRate > t.maxWeeklyRateKg * 1.1) {
      add('warning', 'nutrition', '体重の落ち方が速すぎます', `直近2週間で週${round(lossRate, 2)}kgのペースです。筋肉が落ちやすいので、主に炭水化物で+150〜200kcal増やしてください。`);
    } else if (t.neededWeeklyRateKg > 0 && lossRate < 0.1) {
      add('warning', 'nutrition', '体重が停滞しています', `直近2週間でほぼ変化なし。目標カロリーを−150kcal（ご飯を軽く1杯分）するか、1日の歩数を+2,000歩増やしましょう。`);
    } else if (t.neededWeeklyRateKg > 0 && lossRate >= t.weeklyRateKg * 0.7) {
      add('good', 'goal', '順調なペースです', `直近2週間で週${round(lossRate, 2)}kg減。この調子を維持しましょう。`);
    }
  }
  if (ctx.deltaVsPlanKg !== null) {
    if (ctx.deltaVsPlanKg > 1) add('warning', 'goal', `計画ラインより${round(ctx.deltaVsPlanKg, 1)}kg遅れています`, '目標カロリーは自動で再計算されています。週の平均カロリーを目標内に収めることを最優先に。');
    else if (ctx.deltaVsPlanKg < -1) add('good', 'goal', `計画より${round(-ctx.deltaVsPlanKg, 1)}kg先行しています`, '急ぎすぎは筋量低下のリスク。トレーニングの重量が落ちていないか確認しましょう。');
  }
}

/** 筋肉を増やしつつ体脂肪率を下げる（リコンプ）。体重ではなく体脂肪率・除脂肪体重で判断する */
function recompAdvice(ctx, add) {
  const t = ctx.targets;
  if (t.goalAtRisk) {
    add('critical', 'goal', '体脂肪率の目標が期限内には厳しいペースです', `脂肪をあと${t.fatToLoseKg}kg落とす必要があり、週${t.neededWeeklyRateKg}kg必要です。筋肉を守れる上限（週${t.maxWeeklyRateKg}kg）を超えるため、目標体脂肪率か期限の見直しを検討してください。`);
  }
  const enough = ctx.trendDays >= 14;
  if (enough && ctx.leanRate !== null && ctx.leanRate < -0.2) {
    add('warning', 'training', '除脂肪体重（筋肉）が減っています', `直近2週間で週${round(ctx.leanRate, 2)}kg。①タンパク質を目標まで ②重い日の炭水化物を+50g ③睡眠7時間以上 の3つを優先してください。重い日の主種目の重量が落ちていないかも確認を。`);
  }
  if (enough && ctx.recentRateKg !== null && -ctx.recentRateKg > t.maxWeeklyRateKg * 1.1) {
    add('warning', 'nutrition', '体重の落ち方が速すぎます', `週${round(-ctx.recentRateKg, 2)}kgのペースは筋肉も落ちやすい速さです。重い日を中心に+150〜200kcal（ご飯1杯分）増やしてください。`);
  }
  if (ctx.trendDays >= 21 && ctx.bfRate !== null && ctx.bfRate >= 0 && t.neededWeeklyRateKg > 0) {
    add('warning', 'nutrition', '体脂肪率が下がっていません', '休養日と軽い日のカロリーを−150kcal（ご飯を半分に）するか、1日の歩数を+2,000歩増やしてください。重い日のカロリーは削らないこと。');
  }
  if (enough && ctx.bfRate !== null && ctx.leanRate !== null && ctx.bfRate < 0 && ctx.leanRate >= 0) {
    add('good', 'goal', '理想的に体が変わっています', `体脂肪率 週${round(ctx.bfRate, 2)}%・除脂肪 週${ctx.leanRate >= 0 ? '+' : ''}${round(ctx.leanRate, 2)}kg。脂肪が落ちて筋肉が増えています。体重の増減は気にしなくて大丈夫です。`);
  }
  if (ctx.deltaVsPlanBf !== null && ctx.deltaVsPlanBf > 1) {
    add('warning', 'goal', `体脂肪率が計画より${round(ctx.deltaVsPlanBf, 1)}%高いです`, '目標カロリーは自動で再計算されています。休養日の夜の主食と間食を見直しましょう。');
  }
  if (!enough) {
    add('info', 'data', '体組成計の数値は2週間の流れで判断します', '体脂肪率は水分量で1日に1〜2%ぶれます。毎朝同じ条件（起床・トイレ後・朝食前）で測り、日々の上下は気にしないでください。');
  }
}
