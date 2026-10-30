// FitnessPoint などの筋トレアプリの CSV を日別ログに変換する
// 列名は英語・日本語のよくある表記を自動判定する（1行1セットの縦持ち形式／1行に複数セットの形式の両方に対応）
import { round } from './util.mjs';

/** RFC4180 準拠の簡易CSVパーサ（クォート・改行入りセル対応、区切りは , ; タブを自動判定） */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const COLS = {
  date: /^(date|day|日付|日時|日にち|実施日|workout ?date|start ?time|開始日時|time|日)$/i,
  exercise: /^(exercise|exercise ?name|name|種目|種目名|エクササイズ|エクササイズ名|exercise ?title|movement)$/i,
  set: /^(set|set ?#|set ?no\.?|set ?order|セット|セット数|セット番号|セットno\.?)$/i,
  weight: /^(weight|weight ?\(kg\)|weight ?\(lbs?\)|kg|lbs?|重量|重さ|重量\(kg\)|重量（kg）|load)$/i,
  reps: /^(reps?|repetitions|回数|レップ|レップ数|count)$/i,
  unit: /^(unit|units|単位|weight ?unit)$/i,
  sets: /^(sets|セット内容|記録|details|内容)$/i,
  warmup: /^(warm ?up|ウォームアップ|set ?type|種類|タイプ)$/i,
  note: /^(notes?|memo|メモ|備考|comment)$/i,
};

function detectColumns(header) {
  const idx = {};
  header.forEach((h, i) => {
    const name = h.normalize('NFKC').trim();
    for (const [k, re] of Object.entries(COLS)) if (idx[k] === undefined && re.test(name)) idx[k] = i;
  });
  // 「Weight (lbs)」などの単位入りヘッダ
  const wh = idx.weight !== undefined ? header[idx.weight].toLowerCase() : '';
  return { idx, lbs: /lb/.test(wh) };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = (n) => String(n).padStart(2, '0');

/** "2026/10/30 18:05" "2026-10-30" "10/30/2026" "Oct 30, 2026" "2026年10月30日" → "2026-10-30" */
export function parseDate(s) {
  if (!s) return null;
  s = String(s).normalize('NFKC').trim();
  let m = s.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    // 先頭が12より大きければ日/月/年
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a > 12 ? `${m[3]}-${pad2(b)}-${pad2(a)}` : `${m[3]}-${pad2(a)}-${pad2(b)}`;
  }
  m = s.match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad2(MONTHS[m[1].toLowerCase()])}-${pad2(m[2])}`;
  m = s.match(/(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad2(MONTHS[m[2].toLowerCase()])}-${pad2(m[1])}`;
  return null;
}

const num = (v) => {
  const m = String(v ?? '').normalize('NFKC').replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** "60kg x 10, 62.5 × 8" / "60×10×3" のような1セル内のセット表記 */
export function parseSetText(text, lbs = false) {
  const out = [];
  const s = String(text ?? '').normalize('NFKC');
  const re = /(\d+(?:\.\d+)?)\s*(kg|lbs?|キロ)?\s*[x×*✕]\s*(\d+)(?:\s*(?:回|reps?))?(?:\s*[x×*✕]\s*(\d+)\s*(?:sets?|セット)?)?/gi;
  let m;
  while ((m = re.exec(s))) {
    let w = Number(m[1]);
    if (lbs || /lb/i.test(m[2] ?? '')) w = w * 0.4536;
    const times = m[4] ? Number(m[4]) : 1;
    for (let i = 0; i < times; i++) out.push({ weightKg: round(w, 2), reps: Number(m[3]) });
  }
  return out;
}

/**
 * CSV テキスト → [{ date, source: 'csv', exercises: [{ name, sets: [{weightKg, reps}] }] }]
 * 列が判定できない場合はヘッダを含むエラーを投げる
 */
export function csvToLogs(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV にデータ行がありません');
  // 先頭数行のうち、日付列と種目列が見つかる行をヘッダとみなす
  let hIdx = rows.slice(0, 5).findIndex((r) => {
    const { idx } = detectColumns(r);
    return idx.date !== undefined && idx.exercise !== undefined;
  });
  if (hIdx < 0) throw new Error(`CSV の列を判定できませんでした。ヘッダ: ${rows[0].join(' | ')}`);
  const { idx, lbs } = detectColumns(rows[hIdx]);
  if (idx.weight === undefined && idx.reps === undefined && idx.sets === undefined) {
    throw new Error(`重量・回数の列が見つかりません。ヘッダ: ${rows[hIdx].join(' | ')}`);
  }

  const byDate = new Map();
  let skipped = 0;
  for (const r of rows.slice(hIdx + 1)) {
    const date = parseDate(r[idx.date]);
    const name = (r[idx.exercise] ?? '').trim();
    if (!date || !name) { skipped++; continue; }
    const rowLbs = lbs || (idx.unit !== undefined && /lb/i.test(r[idx.unit] ?? ''));
    let sets;
    if (idx.weight !== undefined || idx.reps !== undefined) {
      let w = idx.weight !== undefined ? num(r[idx.weight]) ?? 0 : 0;
      if (rowLbs) w = w * 0.4536;
      const reps = idx.reps !== undefined ? num(r[idx.reps]) : null;
      sets = reps ? [{ weightKg: round(w, 2), reps }] : [];
    } else {
      sets = parseSetText(r[idx.sets], rowLbs);
    }
    if (idx.warmup !== undefined && /warm|ウォーム|w-?up/i.test(r[idx.warmup] ?? '')) sets = sets.map((s) => ({ ...s, warmup: true }));
    if (!sets.length) { skipped++; continue; }

    if (!byDate.has(date)) byDate.set(date, new Map());
    const exMap = byDate.get(date);
    if (!exMap.has(name)) exMap.set(name, { name, sets: [] });
    exMap.get(name).sets.push(...sets);
  }
  const logs = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, exMap]) => ({ date, source: 'csv', exercises: [...exMap.values()] }));
  return { logs, skipped, columns: Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, rows[hIdx][i]])) };
}
