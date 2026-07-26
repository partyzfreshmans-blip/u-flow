// Sheet dates arrive as M/D/YYYY (no leading zeros), optionally followed by
// " H:MM:SS" for datetime columns. Every "day key" in this app is the plain
// ISO date form YYYY-MM-DD — the same format a native <input type="date">
// reads and writes, so sheet dates, delivery-date overrides, and date-filter
// inputs all speak one format with no extra conversion layer.

export function parseSheetDate(raw: string): Date | null {
  const s = (raw ?? '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Parses a sheet date column straight to its ISO day key, or null if blank/unparseable. */
export function sheetDateToDayKey(raw: string): string | null {
  const d = parseSheetDate(raw);
  return d ? dayKey(d) : null;
}

export function dayKeyToDate(key: string): Date | null {
  const m = (key ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export function formatThaiShortDate(d: Date): string {
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatThaiWeekdayDate(d: Date): string {
  return `${THAI_WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function todayDayKey(): string {
  return dayKey(new Date());
}

/** ISO day key -> the sheet's own "M/D/YYYY" text form (no leading zeros), so
 * a freshly-saved date reads identically to one fetched straight from the sheet. */
export function isoToSheetDateText(iso: string): string {
  const d = dayKeyToDate(iso);
  if (!d) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Whole-day difference b - a, in days (positive when b is later). */
export function daysBetweenKeys(a: string, b: string): number {
  const da = dayKeyToDate(a);
  const db = dayKeyToDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
