// 筋トレログ（種目・重量・回数）の分析：推定1RM・次回の目標・部位別セット数・停滞検知
import { addDays, daysBetween, round } from './util.mjs';

/** 種目名の表記ゆれをそろえる（全角英数→半角、空白・中黒の除去、小文字化） */
export function normalizeName(name = '') {
  return String(name)
    .normalize('NFKC')
    .replace(/[\s・･\-_/（）()]/g, '')
    .toLowerCase();
}

/** 推定1RM（Epley式）。自重種目（重量0）は回数をそのまま指標にする */
export function e1rm(weightKg, reps) {
  if (!reps) return null;
  if (!weightKg) return reps;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

const COMPOUND_RE = /スクワット|ベンチ|デッド|ロウ|ローイング|懸垂|チンニング|ラットプル|ショルダープレス|ミリタリー|オーバーヘッド|インクライン.*プレス|ディップ|レッグプレス|ハックスクワット|squat|bench|deadlift|row|pull ?up|chin|lat ?pull|overhead|military|shoulder press|dip|leg press/i;
export const isCompound = (name) => COMPOUND_RE.test(String(name).normalize('NFKC'));

// 上から順に判定（「レッグエクステンション」は脚、「ショルダープレス」は肩 など）
const PART_RULES = [
  ['legs', /スクワット|レッグ|ランジ|カーフ|ブルガリアン|ヒップ|アダクション|アブダクション|グルート|ルーマニアン|squat|leg|lunge|calf|hip|glute|rdl/i],
  ['shoulders', /ショルダー|サイド|リア|フロントレイズ|アップライト|オーバーヘッド|ミリタリー|フェイスプル|デルト|shoulder|lateral|rear|delt|face ?pull|overhead|military|upright/i],
  ['back', /ロウ|ローイング|懸垂|チンニング|ラット|プルダウン|プルオーバー|デッド|シュラッグ|背|row|pull|chin|lat|deadlift|shrug/i],
  ['chest', /ベンチ|チェスト|フライ|ディップ|インクライン|デクライン|ダンベルプレス|プッシュアップ|腕立て|胸|ペック|bench|chest|fly|dip|push ?up|pec|incline|decline/i],
  ['arms', /カール|トライセプス|プッシュダウン|エクステンション|キックバック|フレンチ|スカルクラッシャー|二頭|三頭|アーム|curl|tricep|bicep|pushdown|extension|kickback|skull/i],
  ['core', /クランチ|プランク|腹筋|アブ|レッグレイズ|ツイスト|crunch|plank|ab|twist/i],
];
export const PART_LABELS = { back: '背中', shoulders: '肩', legs: '脚', chest: '胸', arms: '腕', core: '体幹', other: 'その他' };

export function bodyPart(name) {
  const n = String(name).normalize('NFKC');
  // 「レッグレイズ」は体幹
  if (/レッグレイズ|leg raise/i.test(n)) return 'core';
  for (const [part, re] of PART_RULES) if (re.test(n)) return part;
  return 'other';
}

const workingSets = (sets = []) => sets.filter((s) => !s.warmup && (s.reps ?? 0) > 0);

/**
 * 種目ごとの履歴 [{date, sets, top, best1rm, volume}]
 * skip(date) が true の日（軽い日など）は筋力の指標から除く
 */
export function exerciseHistory(logs, { skip = () => false } = {}) {
  const map = new Map();
  for (const log of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (skip(log.date)) continue;
    for (const ex of log.exercises ?? []) {
      const sets = workingSets(ex.sets);
      if (!sets.length) continue;
      const key = normalizeName(ex.name);
      if (!map.has(key)) map.set(key, { key, name: ex.name, part: bodyPart(ex.name), compound: isCompound(ex.name), sessions: [] });
      const top = sets.reduce((a, s) => ((s.weightKg ?? 0) > (a.weightKg ?? 0) || ((s.weightKg ?? 0) === (a.weightKg ?? 0) && s.reps > a.reps) ? s : a));
      const entry = map.get(key);
      entry.name = ex.name; // 最新の表記を使う
      entry.sessions.push({
        date: log.date,
        sets,
        top,
        best1rm: round(Math.max(...sets.map((s) => e1rm(s.weightKg, s.reps) ?? 0)), 1),
        volume: round(sets.reduce((n, s) => n + (s.weightKg ?? 0) * s.reps, 0)),
      });
    }
  }
  return map;
}

/** 種目ごとの伸び：直近2週間のベスト・自己ベスト・4週間前との比較・停滞 */
export function exerciseProgress(history, today) {
  const bestIn = (s, from, to) => {
    const xs = s.filter((x) => {
      const d = daysBetween(x.date, today);
      return d >= from && d <= to;
    });
    return xs.length ? Math.max(...xs.map((x) => x.best1rm)) : null;
  };
  const out = [];
  for (const h of history.values()) {
    const s = h.sessions;
    const last = s.at(-1);
    const best = Math.max(...s.map((x) => x.best1rm));
    const recent = bestIn(s, 0, 13);
    const monthAgo = bestIn(s, 28, 41);
    const recent3w = bestIn(s, 0, 20);
    const before3w = bestIn(s, 21, 62);
    out.push({
      key: h.key,
      name: h.name,
      part: h.part,
      compound: h.compound,
      sessions: s.length,
      sessions4w: s.filter((x) => daysBetween(x.date, today) < 28).length,
      lastDate: last.date,
      lastSets: last.sets.map(({ weightKg, reps }) => ({ weightKg, reps })),
      last1rm: recent ?? last.best1rm,
      best1rm: best,
      prDate: s.find((x) => x.best1rm === best)?.date,
      change4wPct: recent !== null && monthAgo ? round(((recent - monthAgo) / monthAgo) * 100, 1) : null,
      // 3週間以上の記録があり、直近3週間で以前のベストを超えていない
      stalled: s.length >= 4 && recent3w !== null && before3w !== null && recent3w <= before3w,
      series: s.map((x) => ({ date: x.date, e1rm: x.best1rm, top: `${x.top.weightKg ?? 0}kg×${x.top.reps}` })),
    });
  }
  return out.sort((a, b) => b.sessions4w - a.sessions4w || b.sessions - a.sessions);
}

export const parseRange = (str) => {
  const m = String(str).match(/(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [Number(str) || 8, Number(str) || 12];
};

const fmtW = (w) => (w ? `${round(w, 2)}kg` : '自重');
export const formatSets = (sets) => {
  if (!sets?.length) return '';
  const sameW = sets.every((s) => (s.weightKg ?? 0) === (sets[0].weightKg ?? 0));
  return sameW ? `${fmtW(sets[0].weightKg)} × ${sets.map((s) => s.reps).join('・')}` : sets.map((s) => `${fmtW(s.weightKg)}×${s.reps}`).join('、');
};

const roundTo = (w, step) => Math.round(w / step) * step;

/**
 * 次回の目標（ダブルプログレッション）
 *  - トップ重量の全セットが回数レンジの上限に届いた → 重量アップ・回数は下限から
 *  - 届いていない → 同じ重量で各セット+1回（上限まで）
 *  - 回復週 → 重量85%・回数は下限
 */
export function nextTarget(lastSets, repRange, setCount, { deload = false } = {}) {
  const sets = workingSets(lastSets);
  if (!sets.length) return null;
  const [lo, hi] = repRange;
  const topW = Math.max(...sets.map((s) => s.weightKg ?? 0));
  const top = sets.filter((s) => (s.weightKg ?? 0) === topW);
  const n = setCount ?? top.length;
  const pad = (arr) => Array.from({ length: n }, (_, i) => arr[Math.min(i, arr.length - 1)]);

  if (deload) {
    const w = topW ? roundTo(topW * 0.85, topW >= 20 ? 2.5 : 1) : 0;
    return { weightKg: w, reps: pad([lo]), increase: false, text: `${fmtW(w)} × ${pad([lo]).join('・')}（回復週）` };
  }
  if (!topW) {
    const reps = pad(top.map((s) => Math.min(s.reps + 1, Math.max(hi, s.reps + 1))));
    return { weightKg: 0, reps, increase: false, text: `自重 × ${reps.join('・')}` };
  }
  if (top.every((s) => s.reps >= hi)) {
    const inc = topW >= 40 ? 2.5 : topW >= 10 ? 2 : 1;
    const w = round(topW + inc, 2);
    return { weightKg: w, reps: pad([lo]), increase: true, text: `${fmtW(w)} × ${pad([lo]).join('・')}（+${inc}kg に挑戦）` };
  }
  const reps = pad(top.map((s) => Math.min(hi, Math.max(lo, s.reps + 1))));
  return { weightKg: topW, reps, increase: false, text: `${fmtW(topW)} × ${reps.join('・')}` };
}

/** 週の部位別セット数（月〜今日） */
export function weeklySetsByPart(logs, from, to) {
  const out = {};
  for (const log of logs) {
    if (log.date < from || log.date > to) continue;
    for (const ex of log.exercises ?? []) {
      const part = bodyPart(ex.name);
      out[part] = (out[part] ?? 0) + workingSets(ex.sets).length;
    }
  }
  return out;
}

/** ログの主な部位（セット数が最も多い部位） */
export function mainPart(log) {
  const count = {};
  for (const ex of log.exercises ?? []) {
    const p = bodyPart(ex.name);
    count[p] = (count[p] ?? 0) + Math.max(1, workingSets(ex.sets).length);
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
}

/**
 * 今日と同じメニューの直近のログ。種目の部位で照合し（曜日をずらしても拾える）、
 * 同じ強度（軽い日／重い日）の日を優先する
 */
export function previousSessionLog(logs, config, date, sessionFor, partsOf) {
  const { key, intensity } = sessionFor(config, date);
  const parts = partsOf(key);
  const past = logs.filter((l) => l.date < date && l.exercises?.length).sort((a, b) => b.date.localeCompare(a.date));
  const matches = parts?.length ? past.filter((l) => parts.includes(mainPart(l))) : past.filter((l) => sessionFor(config, l.date).key === key);
  return matches.find((l) => sessionFor(config, l.date).intensity === intensity) ?? matches[0] ?? null;
}

export function recentPRs(progress, today, days = 7) {
  return progress.filter((p) => p.sessions >= 2 && p.prDate && daysBetween(p.prDate, today) < days && p.prDate !== p.series[0].date);
}

export const strengthWindowStart = (today) => addDays(today, -89);
