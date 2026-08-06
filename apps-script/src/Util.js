/**
 * Util.js — parsing helpers for values that come out of a spreadsheet
 * maintained by hand, where "the same" value shows up in several shapes.
 */

/** Sheet cells hold real Dates, text dates, or blanks. Returns 'yyyy-MM-dd'
 * or '' — never a Date, so every comparison downstream is a string compare.
 *
 * A real Date cell is authoritative and formatted in the spreadsheet's own
 * timezone (formatting it in UTC would shift early-morning dates back a day).
 * Text is parsed with the day/month order implied by the spreadsheet locale,
 * because "8/7/2026" is genuinely ambiguous and the sheet's own display is
 * the only evidence available. Buddhist-era years are converted. */
function toDateKey_(value, tz, localeIsUS) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  var text = String(value).trim();
  if (!text) return '';

  var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return isoKey_(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  var slash = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (slash) {
    var a = Number(slash[1]);
    var b = Number(slash[2]);
    var year = Number(slash[3]);
    var month = localeIsUS ? a : b;
    var day = localeIsUS ? b : a;
    // An impossible month with a valid alternative reading wins over the
    // locale guess — "25/12/2026" is December 25th in any locale.
    if (month > 12 && day <= 12) { var swap = month; month = day; day = swap; }
    return isoKey_(year, month, day);
  }
  return '';
}

function isoKey_(year, month, day) {
  if (year < 100) year += 2000;
  if (year > 2400) year -= 543; // Buddhist era
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return '';
  return year + '-' + pad2_(month) + '-' + pad2_(day);
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

function todayKey_(tz) {
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function nowStamp_(tz) {
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
}

/** Amounts arrive as numbers or as "1,589.00". Returns 0 for anything
 * unparseable — a stop is never dropped over a bad amount. */
function toNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  var n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

/** Coordinates must be genuinely numeric — blank, '-', 'N/A' and friends all
 * become null so they can be flagged rather than silently plotted at 0,0. */
function toCoord_(value) {
  if (typeof value === 'number') return isFinite(value) && value !== 0 ? value : null;
  if (value === null || value === undefined) return null;
  var text = String(value).trim();
  if (!text) return null;
  var n = Number(text.replace(/[^0-9.\-]/g, ''));
  if (!isFinite(n) || n === 0) return null;
  return n;
}

/** Phone formats in this data are inconsistent ("66 823848337",
 * "082-384-8337", "0823848337"). The last 9 digits are the part that actually
 * identifies the subscriber, so that's the key — same convention the existing
 * warehouse app already uses against this spreadsheet. */
function phoneKey_(value) {
  var digits = String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/** Display form for the call button: national 0XXXXXXXXX where possible. */
function phoneDial_(value) {
  var digits = String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 11 && digits.indexOf('66') === 0) return '0' + digits.slice(2);
  if (digits.length === 9) return '0' + digits;
  return digits;
}

function toBool_(value) {
  if (typeof value === 'boolean') return value;
  var text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === 'ใช่';
}

function safeText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
