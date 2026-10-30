// FitnessPoint のワークアウト詳細画面の文字（iPhone の「画像からテキストを抽出」の結果）を解析する
//
//   エクササイズ / 4 / セット数 / 12 / ボリューム / 13580 kg / 回数 / 180   ← 画面上部の合計
//   レッグ プレス                                                       ← 種目名（#1 の直前の行）
//   #1: 100 kg x 20 レップ                                               ← セット
//   #4: 177 kg x 10 レップ
//   precor vsl10                                                        ← セットのメモ
//   ジムスタジオ
//   #1: 40 分                                                           ← 時間で記録する種目（有酸素）
//   ズンバ
import { round } from './util.mjs';
import { parseDate } from './fitnesspoint-csv.mjs';

const SET_RE = /^#?\s*(\d{1,2})\s*[:：.]\s*(.+)$/;
const WEIGHT_REPS_RE = /([\d.,]+)\s*(kg|lbs?|キロ)?\s*[x×X✕*]\s*(\d+)/i;
const REPS_ONLY_RE = /^(\d+)\s*(?:レップ|回|reps?)/i;
const MINUTES_RE = /(\d+(?:\.\d+)?)\s*分/;
const HMS_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const SUMMARY_LABELS = { エクササイズ: 'exercises', セット数: 'sets', ボリューム: 'volumeKg', 回数: 'reps' };

function parseSet(content) {
  const c = content.normalize('NFKC').trim();
  let m = c.match(WEIGHT_REPS_RE);
  if (m) {
    let w = Number(m[1].replace(',', '.'));
    if (/lb/i.test(m[2] ?? '')) w *= 0.4536;
    return { weightKg: round(w, 2), reps: Number(m[3]) };
  }
  if ((m = c.match(REPS_ONLY_RE))) return { weightKg: 0, reps: Number(m[1]) };
  if ((m = c.match(MINUTES_RE))) return { minutes: Number(m[1]) };
  if ((m = c.match(HMS_RE))) return { minutes: m[3] ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]) + Number(m[2]) / 60 };
  return null;
}

/** "10月30日" のように年がない日付は、送った日（ref）から年を補う */
function parseDateLoose(line, ref) {
  const full = parseDate(line);
  if (full) return full;
  const m = line.normalize('NFKC').match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m || !ref) return null;
  let y = Number(ref.slice(0, 4));
  if (Number(m[1]) > Number(ref.slice(5, 7))) y -= 1; // 1月に12月の記録を送った場合
  return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

/** 画面上部の合計（ラベルと数値を出現順に対応させる。縦並び・横並びのどちらでも可） */
function parseSummary(lines) {
  const labels = [];
  const values = [];
  for (const line of lines) {
    for (const [label, key] of Object.entries(SUMMARY_LABELS)) {
      const i = line.indexOf(label);
      if (i >= 0) labels.push({ key, pos: i });
    }
    if (/^[\d,.\s]+(kg|lbs?)?([\d,.\s]+(kg|lbs?)?)*$/i.test(line)) {
      for (const m of line.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)) values.push(Number(m[1].replace(/,/g, '')));
    }
  }
  if (!labels.length || labels.length !== values.length) return null;
  return Object.fromEntries(labels.map((l, i) => [l.key, values[i]]));
}

export function parseFitnessPointText(text, { refDate } = {}) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.normalize('NFKC').trim())
    .filter(Boolean);

  const exercises = [];
  const header = [];
  let pending = []; // 直前のセット以降に出てきた、セットではない行
  let current = null;
  let lastSet = null;

  for (const line of lines) {
    const m = line.match(SET_RE);
    const set = m ? parseSet(m[2]) : null;
    if (!set) {
      pending.push(line);
      continue;
    }
    const idx = Number(m[1]);
    if (idx === 1 || !current) {
      // 新しい種目：直前の行が種目名、それより前は前のセットのメモ
      const name = pending.pop() ?? '不明な種目';
      if (lastSet && pending.length) lastSet.note = pending.join(' ');
      else if (!current) header.push(...pending);
      current = { name, sets: [] };
      exercises.push(current);
    } else if (lastSet && pending.length) {
      lastSet.note = pending.join(' ');
    }
    pending = [];
    current.sets.push(set);
    lastSet = set;
  }
  if (lastSet && pending.length) lastSet.note = pending.join(' ');

  for (const ex of exercises) {
    if (ex.sets.every((s) => s.minutes != null)) {
      ex.kind = 'cardio';
      ex.minutes = ex.sets.reduce((n, s) => n + s.minutes, 0);
    }
    const notes = [...new Set(ex.sets.map((s) => s.note).filter(Boolean))];
    if (notes.length) ex.note = notes.join(' / ');
  }

  const date = header.map((l) => parseDateLoose(l, refDate)).find(Boolean) ?? null;
  return { date, exercises, summary: parseSummary(header) };
}

/** 画面の合計（ボリューム・セット数）と読み取った内容を照合して、読み取り漏れを検出 */
export function checkSummary(exercises, summary) {
  if (!summary) return null;
  const allSets = exercises.flatMap((e) => e.sets ?? []);
  const readVolumeKg = round(allSets.reduce((n, s) => n + (s.weightKg ?? 0) * (s.reps ?? 0), 0));
  const readSets = allSets.length;
  const volOk = summary.volumeKg == null || Math.abs(readVolumeKg - summary.volumeKg) <= Math.max(5, summary.volumeKg * 0.01);
  const setsOk = summary.sets == null || readSets === summary.sets;
  return { ok: volOk && setsOk, readVolumeKg, readSets, volumeKg: summary.volumeKg ?? null, sets: summary.sets ?? null };
}
