// トレーニングプログラム・フェーズ・ワークアウト判定
import { addDays, daysBetween, weekday } from './util.mjs';

const STRENGTH_RE = /strength|筋力|weight|functional|core|コア|cross|クロス|resistance/i;
const CARDIO_RE = /run|walk|cycl|bike|swim|hiit|elliptical|row|stair|hik|cardio|ラン|ウォーク|ウォーキング|サイクリング|水泳|スイム|エリプティカル|ステア|ハイキング|有酸素|ダンス|dance/i;

export function classifyWorkout(type = '') {
  if (STRENGTH_RE.test(type)) return 'strength';
  if (CARDIO_RE.test(type)) return 'cardio';
  return 'other';
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const SESSIONS = {
  push: {
    name: '上半身プッシュ（胸・肩・三頭）',
    kind: 'strength',
    exercises: ['ベンチプレス', 'インクライン・ダンベルプレス', 'ショルダープレス', 'サイドレイズ', 'トライセプス・プッシュダウン'],
  },
  pull: {
    name: '上半身プル（背中・二頭）',
    kind: 'strength',
    exercises: ['懸垂 or ラットプルダウン', 'ベントオーバーロウ', 'シーテッドロウ', 'フェイスプル', 'バーベルカール'],
  },
  lower: {
    name: '下半身A（スクワット中心）',
    kind: 'strength',
    exercises: ['スクワット', 'ルーマニアン・デッドリフト', 'レッグプレス', 'レッグカール', 'カーフレイズ'],
  },
  lower2: {
    name: '下半身B＋体幹（ヒンジ中心）',
    kind: 'strength',
    exercises: ['デッドリフト', 'ブルガリアン・スクワット', 'ヒップスラスト', 'レッグエクステンション', 'ハンギングレッグレイズ'],
  },
  full: {
    name: '全身',
    kind: 'strength',
    exercises: ['スクワット', 'ベンチプレス', 'ベントオーバーロウ', 'ショルダープレス', 'プランク'],
  },
  cardio: {
    name: '有酸素（Zone2）＋腹筋',
    kind: 'cardio',
    exercises: ['傾斜ウォーク or バイク 35〜45分（会話できる強度）', 'アブローラー 3×10', 'プランク 3×45秒'],
  },
  rest: {
    name: '休養日',
    kind: 'rest',
    exercises: ['ウォーキングで歩数目標を達成', 'ストレッチ・モビリティ 10分'],
  },
};

/**
 * 期間を3フェーズに分ける（開始〜目標日の割合）
 *  - 基礎期: フォームと筋力の土台。ボリューム中
 *  - 減量期: 高重量を維持して筋量を守る。有酸素を追加
 *  - 仕上げ期: 強度維持・ボリューム減、NEAT↑
 */
export function phaseFor(config, date) {
  const total = daysBetween(config.profile.startDate, config.goal.targetDate);
  const f = daysBetween(config.profile.startDate, date) / total;
  if (f < 0.4) return { key: 'foundation', name: '基礎期', sets: 3, reps: '8〜12', rpe: '7〜8', note: 'フォーム最優先。毎週どれか1種目で重量 or 回数を更新' };
  if (f < 0.8) return { key: 'cut', name: '減量期', sets: 3, reps: '6〜10', rpe: '8', note: '重量を落とさないことが筋量維持の鍵。セット数は維持' };
  return { key: 'peak', name: '仕上げ期', sets: 2, reps: '6〜10', rpe: '8', note: 'ボリュームを2割減らし疲労を抜く。歩数を増やして仕上げる' };
}

export function sessionKeyFor(config, date) {
  return config.program?.[DAY_KEYS[weekday(date)]] ?? 'rest';
}

/** 今日のメニュー（睡眠・週の進捗で調整） */
export function todaysSession(config, date, ctx) {
  const phase = phaseFor(config, date);
  let key = sessionKeyFor(config, date);
  const adjustments = [];

  // 週の筋トレ回数が足りなくなりそうなら、有酸素/休養日を筋トレに振り替える
  const needed = config.weekly.strengthSessions - ctx.weekStrengthDone;
  if (SESSIONS[key].kind !== 'strength' && !ctx.doneToday?.length && needed > 0 && needed > ctx.plannedStrengthLeft) {
    key = 'full';
    adjustments.push(`今週の筋トレがあと${needed}回足りないため、今日は全身メニューに振り替え`);
  }

  const session = SESSIONS[key];
  let sets = phase.sets;
  let rpe = phase.rpe;
  if (session.kind === 'strength' && ctx.lastSleepMinutes !== null && ctx.lastSleepMinutes < 360) {
    sets = Math.max(2, sets - 1);
    rpe = '7';
    adjustments.push(`昨夜の睡眠が${Math.floor(ctx.lastSleepMinutes / 60)}時間${ctx.lastSleepMinutes % 60}分と短いため、各種目−1セット・RPE7まで`);
  }
  if (session.kind === 'cardio' && ctx.stalled) {
    adjustments.push('体重の停滞対策で有酸素を+10分');
  }

  const items = session.exercises.map((name) =>
    session.kind === 'strength' ? { name, prescription: `${sets}セット × ${phase.reps}回（RPE ${rpe}）` } : { name, prescription: '' }
  );
  return { key, name: session.name, kind: session.kind, phase, items, adjustments, done: ctx.doneToday?.includes(session.kind) ?? false };
}

/** 今週（月〜日）の残りの日に予定されている筋トレ数（今日含む） */
export function plannedStrengthLeft(config, date) {
  const wd = weekday(date);
  let n = 0;
  for (let i = 0; i <= (wd === 0 ? 0 : 7 - wd); i++) {
    if (SESSIONS[sessionKeyFor(config, addDays(date, i))]?.kind === 'strength') n++;
  }
  return n;
}

/** 1週間の予定表 */
export function weekPlan(config, mondayYmd) {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(mondayYmd, i);
    const key = sessionKeyFor(config, date);
    return { date, key, name: SESSIONS[key].name, kind: SESSIONS[key].kind };
  });
}
