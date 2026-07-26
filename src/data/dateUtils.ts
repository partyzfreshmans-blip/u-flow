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

/** Parses "M/D/YYYY H:MM:SS" (or a bare "M/D/YYYY"), returning the date plus
 * the hour of day when a time component is present. */
function parseSheetDateTime(raw: string): { date: Date; hour: number | null } | null {
  const date = parseSheetDate(raw);
  if (!date) return null;
  const m = (raw ?? '').match(/(\d{1,2}):(\d{2})/);
  return { date, hour: m ? Number(m[1]) : null };
}

/** "7/24/2026 8:00:00" -> "24 ก.ค. 2026 08:00"; falls back to the raw text
 * (or "—") when it doesn't parse. */
export function formatOrderedAt(raw: string): string {
  const parsed = parseSheetDateTime(raw);
  if (!parsed) return (raw ?? '').trim() || '—';
  const timeMatch = (raw ?? '').match(/(\d{1,2}):(\d{2})/);
  const timePart = timeMatch ? ` ${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '';
  return `${formatThaiShortDate(parsed.date)}${timePart}`;
}

/** Suggested delivery day, per the warehouse's cutoff rule: ordered before
 * 16:00 -> ship the next day; at/after 16:00 (or the order time is unknown)
 * -> ship the day after that. Returns an ISO day key, or null if the order's
 * date/time text doesn't parse at all. */
export function suggestedDeliveryDayKey(orderedAtText: string): string | null {
  const parsed = parseSheetDateTime(orderedAtText);
  if (!parsed) return null;
  const cutoffPassed = parsed.hour != null && parsed.hour >= 16;
  return dayKey(addDays(parsed.date, cutoffPassed ? 2 : 1));
}

/** Parses "M/D/YYYY H:MM:SS" (or a bare "M/D/YYYY") into a millisecond
 * timestamp for stable most-recent-first sorting, including minutes/seconds
 * (unlike parseSheetDateTime's hour-only precision). Returns null when the
 * text doesn't parse at all. */
export function sheetDateTimeToMs(raw: string): number | null {
  const date = parseSheetDate(raw);
  if (!date) return null;
  const m = (raw ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const d = new Date(date);
  if (m) {
    d.setHours(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0, 0);
  }
  return d.getTime();
}

/** Whole-day difference b - a, in days (positive when b is later). */
export function daysBetweenKeys(a: string, b: string): number {
  const da = dayKeyToDate(a);
  const db = dayKeyToDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
