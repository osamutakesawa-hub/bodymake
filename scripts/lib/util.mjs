// 共通ユーティリティ（日付・数値パース・統計）

/** "72.4 kg" / "2,100" / 72.4 / ["1","2"] などから数値を取り出す。取れなければ null */
export function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) {
    const nums = v.map(parseNumber).filter((n) => n !== null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }
  const s = String(v).replace(/[,，]/g, '').trim();
  // ショートカットは複数サンプルを改行区切りで返すことがあるので合計する
  if (/\n/.test(s)) return parseNumber(s.split(/\n+/));
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 睡眠時間を「分」に正規化。"7:12" / "7.2"(時間) / "432"(分) / "25920"(秒) を受け付ける */
export function parseDurationMinutes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const hm = v.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    const jp = v.match(/(\d+)\s*時間\s*(?:(\d+)\s*分)?/);
    if (jp) return Number(jp[1]) * 60 + Number(jp[2] || 0);
  }
  const n = parseNumber(v);
  if (n === null || n <= 0) return null;
  if (n <= 24) return Math.round(n * 60); // 時間
  if (n >= 1000) return Math.round(n / 60); // 秒
  return Math.round(n); // 分
}

export const round = (n, d = 0) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
export const mean = (arr) => {
  const xs = arr.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** タイムゾーン上の YYYY-MM-DD */
export function localDate(date = new Date(), timeZone = 'Asia/Tokyo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** 0=日 … 6=土 */
export function weekday(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

/** その日を含む週の月曜日 */
export function weekStart(ymd) {
  const wd = weekday(ymd);
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
