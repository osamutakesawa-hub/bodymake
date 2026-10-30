// トレーニングプログラム・フェーズ・ワークアウト判定
import { addDays, daysBetween, weekday, weekStart } from './util.mjs';
import { isCompound, nextTarget, parseRange, formatSets, normalizeName, workingSets } from './strength.mjs';

const STRENGTH_RE = /strength|筋力|weight|functional|core|コア|cross|クロス|resistance/i;
const CARDIO_RE = /run|walk|cycl|bike|swim|hiit|elliptical|row|stair|hik|cardio|ラン|ウォーク|ウォーキング|サイクリング|水泳|スイム|エリプティカル|ステア|ハイキング|有酸素|ダンス|dance/i;

export function classifyWorkout(type = '') {
  if (STRENGTH_RE.test(type)) return 'strength';
  if (CARDIO_RE.test(type)) return 'cardio';
  return 'other';
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// main: 高重量で伸ばす主種目 / それ以外は補助種目
const ex = (name, main = false) => ({ name, main });

export const SESSIONS = {
  back_shoulders: {
    parts: ['back', 'shoulders'],
    name: '背中・肩',
    kind: 'strength',
    exercises: [
      ex('懸垂 or ラットプルダウン', true),
      ex('ベントオーバーロウ', true),
      ex('シーテッドロウ'),
      ex('ショルダープレス', true),
      ex('サイドレイズ'),
      ex('リアデルト（フェイスプル）'),
    ],
  },
  legs: {
    parts: ['legs'],
    name: '脚',
    kind: 'strength',
    exercises: [ex('スクワット', true), ex('ルーマニアン・デッドリフト', true), ex('レッグプレス'), ex('レッグカール'), ex('レッグエクステンション'), ex('カーフレイズ')],
  },
  chest_arms: {
    parts: ['chest', 'arms'],
    name: '胸・腕',
    kind: 'strength',
    exercises: [
      ex('ベンチプレス', true),
      ex('インクライン・ダンベルプレス', true),
      ex('ケーブルフライ or ディップス'),
      ex('バーベルカール'),
      ex('トライセプス・エクステンション'),
      ex('ハンマーカール'),
    ],
  },
  push: { parts: ['chest', 'shoulders'], name: '上半身プッシュ（胸・肩・三頭）', kind: 'strength', exercises: [ex('ベンチプレス', true), ex('インクライン・ダンベルプレス', true), ex('ショルダープレス', true), ex('サイドレイズ'), ex('トライセプス・プッシュダウン')] },
  pull: { parts: ['back', 'arms'], name: '上半身プル（背中・二頭）', kind: 'strength', exercises: [ex('懸垂 or ラットプルダウン', true), ex('ベントオーバーロウ', true), ex('シーテッドロウ'), ex('フェイスプル'), ex('バーベルカール')] },
  lower: { parts: ['legs'], name: '下半身A（スクワット中心）', kind: 'strength', exercises: [ex('スクワット', true), ex('ルーマニアン・デッドリフト', true), ex('レッグプレス'), ex('レッグカール'), ex('カーフレイズ')] },
  lower2: { parts: ['legs'], name: '下半身B（ヒンジ中心）', kind: 'strength', exercises: [ex('デッドリフト', true), ex('ブルガリアン・スクワット', true), ex('ヒップスラスト'), ex('レッグエクステンション'), ex('ハンギングレッグレイズ')] },
  full: { name: '全身', kind: 'strength', exercises: [ex('スクワット', true), ex('ベンチプレス', true), ex('ベントオーバーロウ', true), ex('ショルダープレス'), ex('プランク')] },
  cardio: { name: '有酸素（Zone2）＋腹筋', kind: 'cardio', exercises: [ex('傾斜ウォーク or バイク 35〜45分（会話できる強度）'), ex('アブローラー 3×10'), ex('プランク 3×45秒')] },
  rest: { name: '休養日', kind: 'rest', exercises: [ex('完全休養（筋肉は休んでいる間に育ちます）'), ex('散歩で歩数目標を達成'), ex('ストレッチ・モビリティ 10分')] },
};

/** "back_shoulders:heavy" → { key, intensity } */
export function parseProgramEntry(v = 'rest') {
  const [key, intensity = 'normal'] = String(v).split(':');
  return { key: SESSIONS[key] ? key : 'rest', intensity };
}

export function sessionFor(config, date) {
  return parseProgramEntry(config.program?.[DAY_KEYS[weekday(date)]]);
}
export const sessionParts = (key) => SESSIONS[key]?.parts ?? null;
export const sessionKeyFor = (config, date) => sessionFor(config, date).key;

/**
 * 期間を3フェーズに分ける（開始〜目標日の割合）
 * recomp（筋肉を増やしつつ体脂肪を落とす）と cut（減量）で内容が変わる
 */
export function phaseFor(config, date) {
  const total = daysBetween(config.profile.startDate, config.goal.targetDate);
  const f = daysBetween(config.profile.startDate, date) / total;
  if (config.goal.mode === 'recomp') {
    if (f < 0.25) return { key: 'adapt', name: '適応期', mainSets: 3, accSets: 3, mainReps: '6〜10', accReps: '10〜15', rpe: '7〜8', note: '重い日はフォームを固めながら、主種目の基準重量を決める期間。毎回「前回＋1回 or ＋2.5kg」を狙う' };
    if (f < 0.85) return { key: 'build', name: '筋肥大期', mainSets: 4, accSets: 3, mainReps: '6〜10', accReps: '10〜15', rpe: '8〜9', note: '重い日の主種目は4セット。上限の回数に届いたら重量を上げる（ダブルプログレッション）' };
    return { key: 'peak', name: '仕上げ期', mainSets: 3, accSets: 2, mainReps: '6〜8', accReps: '10〜12', rpe: '8', note: '重量は維持してボリュームを少し落とし、疲労を抜きながら仕上げる' };
  }
  if (f < 0.4) return { key: 'foundation', name: '基礎期', mainSets: 3, accSets: 3, mainReps: '8〜12', accReps: '10〜12', rpe: '7〜8', note: 'フォーム最優先。毎週どれか1種目で重量 or 回数を更新' };
  if (f < 0.8) return { key: 'cut', name: '減量期', mainSets: 3, accSets: 3, mainReps: '6〜10', accReps: '10〜12', rpe: '8', note: '重量を落とさないことが筋量維持の鍵。セット数は維持' };
  return { key: 'peak', name: '仕上げ期', mainSets: 2, accSets: 2, mainReps: '6〜10', accReps: '10〜12', rpe: '8', note: 'ボリュームを2割減らし疲労を抜く。歩数を増やして仕上げる' };
}

/** 開始から deloadEveryWeeks 週ごとの最後の1週は回復週（デロード） */
export function isDeloadWeek(config, date) {
  const every = config.weekly?.deloadEveryWeeks;
  if (!every) return false;
  const w = Math.floor(daysBetween(weekStart(config.profile.startDate), weekStart(date)) / 7);
  return w >= 0 && w % every === every - 1;
}

/** 今日のメニュー（強度・フェーズ・デロード・睡眠・週の進捗で調整） */
export function todaysSession(config, date, ctx) {
  const phase = phaseFor(config, date);
  let { key, intensity } = sessionFor(config, date);
  const adjustments = [];

  // 週の筋トレ回数が足りなくなりそうなら、有酸素の日を筋トレに振り替える（休養日はそのまま休む）
  const needed = config.weekly.strengthSessions - ctx.weekStrengthDone;
  if (SESSIONS[key].kind === 'cardio' && !ctx.doneToday?.length && needed > 0 && needed > ctx.plannedStrengthLeft) {
    key = 'full';
    intensity = 'normal';
    adjustments.push(`今週の筋トレがあと${needed}回足りないため、今日は全身メニューに振り替え`);
  }

  const session = SESSIONS[key];
  const deload = session.kind === 'strength' && isDeloadWeek(config, date);
  let mainSets = phase.mainSets;
  let accSets = phase.accSets;
  let rpe = phase.rpe;
  let mainReps = phase.mainReps;
  let accReps = phase.accReps;
  let label = '';

  if (intensity === 'light') {
    label = 'アクティブリカバリー';
    mainSets = 2;
    accSets = 2;
    mainReps = '12〜15';
    accReps = '12〜15';
    rpe = '6〜7';
  } else if (intensity === 'heavy') {
    label = 'がっつり';
  }
  if (deload) {
    mainSets = Math.max(2, mainSets - 1);
    accSets = Math.max(1, accSets - 1);
    rpe = '6〜7';
    adjustments.push(`回復週（デロード）：重量は普段の85%・セット数−1。${config.weekly.deloadEveryWeeks}週に1回、関節と神経系を回復させて次の週に伸ばします`);
  }
  if (session.kind === 'strength' && ctx.lastSleepMinutes !== null && ctx.lastSleepMinutes < 360) {
    mainSets = Math.max(2, mainSets - 1);
    accSets = Math.max(1, accSets - 1);
    if (intensity !== 'light') rpe = '7〜8';
    adjustments.push(`昨夜の睡眠が${Math.floor(ctx.lastSleepMinutes / 60)}時間${ctx.lastSleepMinutes % 60}分と短いため、各種目−1セット・限界まで追い込まない`);
  }
  if (session.kind === 'cardio' && ctx.stalled) adjustments.push('停滞対策で有酸素を+10分');

  const prescribe = (main) => {
    const sets = main ? mainSets : accSets;
    const reps = main ? mainReps : accReps;
    return { sets, reps, text: `${sets}セット × ${reps}回（RPE ${rpe}）` };
  };

  // 前回の同じセッションのログがあれば、実際にやった種目で「前回 → 今日の目標」を出す
  const prev = session.kind === 'strength' ? ctx.previous : null;
  const prevIntensity = prev ? ctx.intensityOf?.(prev.date) ?? sessionFor(config, prev.date).intensity : null;
  let items;
  if (prev?.exercises?.length) {
    items = prev.exercises.filter((ex) => !ex.kind && workingSets(ex.sets).length).map((ex) => {
      const main = isCompound(ex.name);
      const p = prescribe(main);
      const hist = ctx.history?.get(normalizeName(ex.name));
      const [lo] = parseRange(p.reps);
      let target;
      if (intensity === 'light' && prevIntensity === 'light') {
        // 軽い日は伸ばす日ではないので、前回と同じ内容でOK（加圧などのやり方もそのまま）
        const bfr = /加圧/.test(ex.note ?? '');
        target = { text: `${formatSets(workingSets(ex.sets))}（前回どおり${bfr ? '・加圧' : ''}・追い込まない）`, increase: false };
      } else if (prevIntensity === intensity || (prevIntensity !== 'light' && intensity !== 'light')) {
        target = nextTarget(ex.sets, parseRange(p.reps), p.sets, { deload });
      } else if (intensity === 'light') {
        // 重い日の記録 → 軽い日は約60%の重量
        const topW = Math.max(...ex.sets.map((x) => x.weightKg ?? 0));
        const w = topW ? Math.round((topW * 0.6) / 2.5) * 2.5 : 0;
        target = { text: `${w ? `${w}kg` : '自重'} × ${Array(p.sets).fill(lo).join('・')}（重い日の約60%）`, increase: false };
      } else {
        // 軽い日の記録しかない → 重い日の履歴（軽い日を除いた記録）があればそこから
        const heavyLast = hist?.sessions.at(-1);
        target = heavyLast ? nextTarget(heavyLast.sets, parseRange(p.reps), p.sets, { deload }) : null;
      }
      return {
        name: ex.name,
        main,
        prescription: p.text,
        last: formatSets(ex.sets.filter((s) => !s.warmup)),
        lastDate: prev.date,
        target: target?.text ?? null,
        increase: target?.increase ?? false,
        best1rm: hist ? Math.max(...hist.sessions.map((x) => x.best1rm)) : null,
        note: ex.note ?? null,
      };
    });
  } else {
    items = session.exercises.map((e) => {
      if (session.kind !== 'strength') return { name: e.name, prescription: '' };
      const load = intensity === 'light' ? '（重い日の約60%の重量）' : e.main && !deload ? '・前回より+1回 or +2.5kg' : '';
      return { name: e.name, main: e.main, prescription: prescribe(e.main).text + load };
    });
  }
  if (intensity === 'light') items.push({ name: 'ウォーキング or バイク 20分＋ストレッチ', prescription: '血流を上げて回復を促す' });

  const intensityNote =
    intensity === 'light'
      ? '軽い日は「効かせて血流を上げる」日。追い込まず、フォームと可動域を丁寧に'
      : intensity === 'heavy'
        ? '主種目は最初に。セット間は2〜3分休む。最後のセットは「あと1〜2回できる」まで'
        : '';
  return {
    key,
    intensity,
    name: label ? `${session.name}（${label}）` : session.name,
    kind: session.kind,
    phase: {
      ...phase,
      note:
        session.kind === 'rest'
          ? '今日は完全休養。週6回のトレーニングで伸ばすための大事な回復日です。タンパク質はトレ日と同じだけ摂りましょう'
          : [phase.note, intensityNote].filter(Boolean).join('。'),
    },
    deload,
    fromLog: Boolean(prev?.exercises?.length),
    previousDate: prev?.date ?? null,
    items,
    adjustments,
    done: ctx.doneToday?.includes(session.kind) ?? false,
  };
}

/** 指定日〜その週の日曜までに予定されている筋トレ数 */
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
    const { key, intensity } = sessionFor(config, date);
    const tag = intensity === 'light' ? '軽' : intensity === 'heavy' ? '重' : '';
    return { date, key, intensity, name: SESSIONS[key].name + (tag ? `（${tag}）` : ''), kind: SESSIONS[key].kind };
  });
}
