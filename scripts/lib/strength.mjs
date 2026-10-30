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

const COMPOUND_RE = /スクワット|ベンチプレス|デッド|ロウ|ローイング|懸垂|チンニング|チンアップ|プルアップ|ラットプル|ショルダープレス|ミリタリー|オーバーヘッド|インクライン.*プレス|ディップ|レッグプレス|ハックスクワット|squat|bench|deadlift|row|pull ?up|chin|lat ?pull|overhead|military|shoulder press|dip|leg press/i;
// 「レッグ プレス」のような空白入りの表記もそろえてから判定する
const squash = (name) => String(name).normalize('NFKC').replace(/[\s・･]/g, '');
export const isCompound = (name) => COMPOUND_RE.test(squash(name));

// 上から順に判定（「レッグエクステンション」は脚、「ショルダープレス」は肩、「リストカール オーバー ベンチ」は腕 など）
const PART_RULES = [
  ['legs', /スクワット|レッグ|ランジ|カーフ|ブルガリアン|ヒップ|アダクション|アブダクション|グルート|ルーマニアン|squat|leg|lunge|calf|hip|glute|rdl/i],
  ['shoulders', /ショルダー|サイド|リア|フロントレイズ|アップライト|オーバーヘッド|ミリタリー|フェイスプル|デルト|shoulder|lateral|rear|delt|face ?pull|overhead|military|upright/i],
  ['back', /ロウ|ローイング|懸垂|チンニング|チンアップ|プルアップ|ラット|プルダウン|プルオーバー|デッド|シュラッグ|背|row|pull|chin|lat|deadlift|shrug/i],
  ['arms', /カール|トライセプス|プッシュダウン|エクステンション|キックバック|フレンチ|スカルクラッシャー|二頭|三頭|アーム|curl|tricep|bicep|pushdown|extension|kickback|skull/i],
  ['chest', /ベンチ|チェスト|フライ|ディップ|インクライン|デクライン|ダンベルプレス|プッシュアップ|腕立て|胸|ペック|bench|chest|fly|dip|push ?up|pec|incline|decline/i],
  ['core', /クランチ|プランク|腹筋|アブ|レッグレイズ|ツイスト|crunch|plank|ab|twist/i],
];
export const PART_LABELS = { back: '背中', shoulders: '肩', legs: '脚', chest: '胸', arms: '腕', core: '体幹', other: 'その他' };

export function bodyPart(name) {
  const n = squash(name);
  // 「レッグレイズ」は体幹
  if (/レッグレイズ|leg raise/i.test(n)) return 'core';
  for (const [part, re] of PART_RULES) if (re.test(n)) return part;
  return 'other';
}

// 時間で記録した種目（有酸素）は reps がないので自然に除外される。
// 「0kg × 1回」はクランチ・プランクなどの実施チェックなので除外
export const workingSets = (sets = []) => sets.filter((s) => !s.warmup && (s.reps ?? 0) > 0 && !(!s.weightKg && s.reps <= 1));

const CARDIO_NAME_RE = /ジムスタジオ|トレッドミル|自転車|バイク(?!セップ)|ランニング|ジョギング|ウォーキング|クロストレーナー|エリプティカル|ステアマスター|ステップマシン|ズンバ|エアロ|スイム|水泳|ボクシング|ヨガ|ダンス|縄跳び|treadmill|bike|cycling|running|jogging|walking|elliptical|stair|swim|zumba|rowing machine/i;

/**
 * 種目の種類を付ける
 *  - cardio … ジムスタジオ・トレッドミルなど（CSV では「回数／時間」列が分、「ウエイト／距離」列が距離や速度）
 *  - check  … クランチ・プランクの「0kg × 1回（いつものセット・1分）」のような実施チェック
 */
export function classifyExercises(exercises) {
  return exercises.map((ex) => {
    if (ex.kind) return ex;
    if (CARDIO_NAME_RE.test(squash(ex.name))) {
      const minutes = ex.sets.reduce((n, s) => n + (s.minutes ?? s.reps ?? 0), 0);
      const sets = ex.sets.map((s) => ({ minutes: s.minutes ?? s.reps ?? 0, ...(s.weightKg ? { value: s.weightKg } : {}), ...(s.note ? { note: s.note } : {}) }));
      return { ...ex, kind: 'cardio', minutes, sets };
    }
    if (ex.sets.length && ex.sets.every((s) => !s.weightKg && (s.reps ?? 0) <= 1)) return { ...ex, kind: 'check' };
    return ex;
  });
}
export const hasStrength = (log) => (log.exercises ?? []).some((e) => !e.kind && workingSets(e.sets).length);
export const hasCardio = (log) => (log.exercises ?? []).some((e) => e.kind === 'cardio');

/** その日のメインの重量（3回以上挙げたセットの最大。単発の挑戦やウォームアップに引っ張られないように） */
function workWeight(sets) {
  const ws = workingSets(sets).filter((x) => x.reps >= 3);
  return ws.length ? Math.max(...ws.map((x) => x.weightKg ?? 0)) : null;
}

/**
 * 記録の中身から、その日が「軽い日」か「重い日」かを推定する。
 * 種目ごとに、直近6週間でいちばん重かったメイン重量と比べ、中央値が85%未満なら軽い日。
 * （曜日の予定どおりとは限らないため、実際の重量で判定する）
 */
export function inferIntensity(logs) {
  const out = new Map();
  const recent = new Map(); // 種目 → [{date, w}]
  for (const log of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    const ratios = [];
    const todays = [];
    for (const ex of log.exercises ?? []) {
      if (ex.kind) continue;
      const w = workWeight(ex.sets);
      if (!w) continue;
      const key = normalizeName(ex.name);
      const past = (recent.get(key) ?? []).filter((p) => daysBetween(p.date, log.date) <= 42);
      if (past.length) ratios.push(w / Math.max(...past.map((p) => p.w)));
      todays.push([key, w]);
    }
    if (ratios.length) {
      ratios.sort((a, b) => a - b);
      out.set(log.date, ratios[Math.floor(ratios.length / 2)] < 0.85 ? 'light' : 'heavy');
    }
    for (const [key, w] of todays) {
      const list = (recent.get(key) ?? []).filter((p) => daysBetween(p.date, log.date) <= 42);
      list.push({ date: log.date, w });
      recent.set(key, list);
    }
  }
  return out;
}

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
      // 重量つきの種目は、その日の自重セットを1RMの計算に混ぜない（自重30回 ≠ 30kg）
      const weighted = sets.filter((s) => s.weightKg > 0);
      const basis = weighted.length ? weighted : sets;
      const top = basis.reduce((a, s) => ((s.weightKg ?? 0) > (a.weightKg ?? 0) || ((s.weightKg ?? 0) === (a.weightKg ?? 0) && s.reps > a.reps) ? s : a));
      const entry = map.get(key);
      entry.name = ex.name; // 最新の表記を使う
      entry.sessions.push({
        date: log.date,
        sets,
        top,
        best1rm: round(Math.max(...basis.map((s) => e1rm(s.weightKg, s.reps) ?? 0)), 1),
        bodyweightOnly: !weighted.length,
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
    let s = h.sessions.filter((x) => x.date <= today);
    // 重量をつけてやったことがある種目は、自重だけの日を比較に使わない
    if (s.some((x) => !x.bodyweightOnly)) s = s.filter((x) => !x.bodyweightOnly);
    const last = s.at(-1);
    // 最近8週間やっていない種目は一覧に出さない（自己ベストは全期間から）
    if (!last || daysBetween(last.date, today) > 56) continue;
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
      firstDate: s[0].date,
      change4wPct: recent !== null && monthAgo ? round(((recent - monthAgo) / monthAgo) * 100, 1) : null,
      // 停滞：直近3週間に2回以上やっていて、その前の6週間のベストを2%以上下回ったまま
      stalled: s.filter((x) => daysBetween(x.date, today) <= 20).length >= 2 && recent3w !== null && before3w !== null && recent3w < before3w * 0.98,
      series: s.filter((x) => daysBetween(x.date, today) <= 180).map((x) => ({ date: x.date, e1rm: x.best1rm, top: `${x.top.weightKg ?? 0}kg×${x.top.reps}` })),
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
  // メインの重量：いちばんセット数が多い重量（同数なら重いほう）。軽いウォームアップや1セットだけのトップセットに引っ張られないように
  const freq = new Map();
  for (const s of sets) freq.set(s.weightKg ?? 0, (freq.get(s.weightKg ?? 0) ?? 0) + 1);
  const topW = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const top = sets.filter((s) => (s.weightKg ?? 0) === topW);
  const others = sets.filter((s) => (s.weightKg ?? 0) > topW);
  const extra = others.length ? `（ほかに ${others.map((s) => `${fmtW(s.weightKg)}×${s.reps}`).join('、')}）` : '';
  const n = setCount ?? top.length;
  const pad = (arr) => Array.from({ length: n }, (_, i) => arr[Math.min(i, arr.length - 1)]);

  if (deload) {
    const w = topW ? roundTo(topW * 0.85, topW >= 20 ? 2.5 : 1) : 0;
    return { weightKg: w, reps: pad([lo]), increase: false, text: `${fmtW(w)} × ${pad([lo]).join('・')}（回復週）` };
  }
  if (!topW) {
    const reps = pad(top.map((s) => s.reps + 1));
    return { weightKg: 0, reps, increase: false, text: `自重 × ${reps.join('・')}` };
  }
  if (top.every((s) => s.reps >= hi)) {
    const inc = topW >= 40 ? 2.5 : topW >= 10 ? 2 : 1;
    const w = round(topW + inc, 2);
    return { weightKg: w, reps: pad([lo]), increase: true, text: `${fmtW(w)} × ${pad([lo]).join('・')}（+${inc}kg に挑戦）${extra}` };
  }
  const reps = pad(top.map((s) => Math.min(hi, Math.max(lo, s.reps + 1))));
  return { weightKg: topW, reps, increase: false, text: `${fmtW(topW)} × ${reps.join('・')}${extra}` };
}

/** 週の部位別セット数（月〜今日） */
export function weeklySetsByPart(logs, from, to) {
  const out = {};
  for (const log of logs) {
    if (log.date < from || log.date > to) continue;
    for (const ex of log.exercises ?? []) {
      if (ex.kind) continue;
      const part = bodyPart(ex.name);
      out[part] = (out[part] ?? 0) + hardSets(ex.sets).length;
    }
  }
  return out;
}

/**
 * ウォームアップを除いた本番セット。推定1RMがその日の最大の70%未満のセットは準備運動とみなす
 * （20kg×20 は除外、100kg×20 の高回数セットは本番として数える）
 */
export function hardSets(sets) {
  const ws = workingSets(sets);
  const max = Math.max(0, ...ws.map((x) => (x.weightKg ? e1rm(x.weightKg, x.reps) : 0)));
  return max ? ws.filter((x) => (x.weightKg ? e1rm(x.weightKg, x.reps) : 0) >= max * 0.7) : ws;
}

/** ログの主な部位（セット数が最も多い部位） */
export function mainPart(log) {
  const count = {};
  for (const ex of log.exercises ?? []) {
    const n = workingSets(ex.sets).length;
    if (!n) continue;
    const p = bodyPart(ex.name);
    count[p] = (count[p] ?? 0) + n;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
}

/**
 * 今日と同じメニューの直近のログ。種目の部位で照合し（曜日をずらしても拾える）、
 * 同じ強度（軽い日／重い日）の日を優先する
 */
export function previousSessionLog(logs, config, date, sessionFor, partsOf, intensityOf = (d) => sessionFor(config, d).intensity) {
  const { key, intensity } = sessionFor(config, date);
  const parts = partsOf(key);
  const past = logs.filter((l) => l.date < date && hasStrength(l)).sort((a, b) => b.date.localeCompare(a.date));
  const matches = parts?.length ? past.filter((l) => parts.includes(mainPart(l))) : past.filter((l) => sessionFor(config, l.date).key === key);
  // 今日が軽い日なら軽い日の記録、重い日なら重い日の記録を優先
  const want = intensity === 'light' ? 'light' : 'heavy';
  return matches.find((l) => intensityOf(l.date) === want) ?? matches[0] ?? null;
}

export function recentPRs(progress, today, days = 7) {
  return progress.filter((p) => p.sessions >= 2 && p.prDate && daysBetween(p.prDate, today) < days && p.prDate !== p.firstDate);
}

export const strengthWindowStart = (today) => addDays(today, -89);
