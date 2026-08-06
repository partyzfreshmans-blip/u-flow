/**
 * SheetIO.js — the only file that talks to the spreadsheet directly.
 *
 * Two rules everything else depends on:
 *   1. The source tab (คำสั่งซื้อ) is opened read-only. There is no write
 *      helper in this file that can target it — writeRows_/appendRows_ refuse
 *      any tab whose name does not start with "_".
 *   2. Reads are batched. Never call getValue()/setValue() in a loop.
 */

function ss_() {
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('สคริปต์นี้ต้องผูกกับสเปรดชีต (bound script) เท่านั้น');
  if (ss.getId() !== EXPECTED_SPREADSHEET_ID) {
    throw new Error(
      'สคริปต์ผูกอยู่กับไฟล์ผิด (' + ss.getId() + ') — ต้องเป็น ' + EXPECTED_SPREADSHEET_ID +
      ' หรือแก้ EXPECTED_SPREADSHEET_ID ใน Config.js ถ้าย้ายไฟล์จริง'
    );
  }
  return ss;
}

/** Spreadsheet timezone — every date this app formats or compares uses it,
 * never the script's or the browser's, so "วันนี้" means the same thing on a
 * driver's phone as in the sheet. */
function tz_() {
  return ss_().getSpreadsheetTimeZone() || 'Asia/Bangkok';
}

/** True when the sheet displays dates month-first. Only consulted for text
 * dates — real Date cells carry no ambiguity. See toDateKey_(). */
function localeIsUS_() {
  var locale = ss_().getSpreadsheetLocale() || '';
  return locale.indexOf('en_US') === 0 || locale === 'en';
}

/** Resolves the read-only source tab by name, falling back to its gid so a
 * rename doesn't break the app (and vice versa). */
function ordersSheet_() {
  var ss = ss_();
  var byName = ss.getSheetByName(ORDERS_TAB_NAME);
  if (byName) return byName;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === ORDERS_TAB_GID) return sheets[i];
  }
  throw new Error('ไม่พบแท็บ "' + ORDERS_TAB_NAME + '" (gid ' + ORDERS_TAB_GID + ') ในสเปรดชีต');
}

/** Our own tabs. Created by setupAll() — this throws rather than creating one
 * on the fly so a typo in a tab name can't quietly spawn an empty tab. */
function ownSheet_(name) {
  if (name.charAt(0) !== '_') throw new Error('ownSheet_ ใช้ได้เฉพาะแท็บที่ขึ้นต้นด้วย _');
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('ยังไม่มีแท็บ ' + name + ' — เปิดเมนู "Unii Routes" แล้วกด "ติดตั้ง/ตรวจสอบระบบ" ก่อน');
  return sheet;
}

function assertOwnTab_(name) {
  if (!name || name.charAt(0) !== '_') {
    throw new Error('ปฏิเสธการเขียนลงแท็บ "' + name + '" — เขียนได้เฉพาะแท็บที่ขึ้นต้นด้วย _ เท่านั้น');
  }
}

// ---------- generic row I/O over our own tabs ----------

/** Reads a whole "_" tab as an array of objects keyed by its header row.
 * Each object also carries _row (1-based sheet row) for targeted updates. */
function readObjects_(tabName) {
  var sheet = ownSheet_(tabName);
  var lastRow = sheet.getLastRow();
  var headers = HEADERS[tabName];
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (isBlankRow_(row)) continue;
    var obj = { _row: r + 2 };
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    out.push(obj);
  }
  return out;
}

function isBlankRow_(row) {
  for (var i = 0; i < row.length; i++) {
    if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return false;
  }
  return true;
}

/** Appends rows in one call. `objects` are plain objects; missing keys become ''. */
function appendObjects_(tabName, objects) {
  assertOwnTab_(tabName);
  if (!objects.length) return;
  var sheet = ownSheet_(tabName);
  var headers = HEADERS[tabName];
  var rows = objects.map(function (obj) {
    return headers.map(function (h) {
      var v = obj[h];
      return v === undefined || v === null ? '' : v;
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

/** Overwrites one existing row (1-based sheet row) in a single call. */
function updateObjectRow_(tabName, rowIndex, obj) {
  assertOwnTab_(tabName);
  var sheet = ownSheet_(tabName);
  var headers = HEADERS[tabName];
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

/**
 * _ASSIGN rows for one delivery date only.
 *
 * This tab is append-only and never pruned, so it grows by roughly a hundred
 * rows every working day — reading all of it on every request would get
 * slower for the rest of the app's life. Same two-pass trick the order read
 * uses: scan the one date column, then read a single block spanning only the
 * matching rows (they cluster, because rows are appended on the day they
 * happen).
 */
function readAssignRowsForDate_(dateKey) {
  var sheet = ownSheet_(TAB.assign);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = HEADERS._ASSIGN;
  var dateCol = headers.indexOf('delivery_date') + 1;
  var dates = sheet.getRange(2, dateCol, lastRow - 1, 1).getValues();

  var first = -1;
  var last = -1;
  for (var i = 0; i < dates.length; i++) {
    if (assignDateKey_(dates[i][0]) !== dateKey) continue;
    if (first === -1) first = i + 2;
    last = i + 2;
  }
  if (first === -1) return [];

  var values = sheet.getRange(first, 1, last - first + 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    if (assignDateKey_(values[r][dateCol - 1]) !== dateKey) continue;
    var obj = { _row: first + r };
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = values[r][c];
    out.push(obj);
  }
  return out;
}

/** This app always writes delivery_date as 'yyyy-MM-dd' text, but a human
 * editing the tab can leave a real date cell behind — both must compare
 * equal or a hand-corrected row would silently stop counting. */
function assignDateKey_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, tz_(), 'yyyy-MM-dd');
  }
  return safeText_(value);
}

// ---------- _CONFIG ----------

function configMap_() {
  var cached = CacheService.getScriptCache().get('config');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through to a fresh read */ }
  }
  var map = {};
  var rows = readObjects_(TAB.config);
  for (var i = 0; i < rows.length; i++) map[String(rows[i].key).trim()] = String(rows[i].value);
  CacheService.getScriptCache().put('config', JSON.stringify(map), 60);
  return map;
}

function cfg_(key, fallback) {
  var v = configMap_()[key];
  return v === undefined || v === '' ? fallback : v;
}

function cfgNum_(key, fallback) {
  var n = Number(cfg_(key, fallback));
  return isFinite(n) ? n : Number(fallback);
}

function setConfig_(key, value) {
  var sheet = ownSheet_(TAB.config);
  var rows = readObjects_(TAB.config);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].key).trim() === key) {
      sheet.getRange(rows[i]._row, 2).setValue(value);
      CacheService.getScriptCache().remove('config');
      return;
    }
  }
  appendObjects_(TAB.config, [{ key: key, value: value, description: '' }]);
  CacheService.getScriptCache().remove('config');
}

// ---------- cache versioning ----------
//
// Day results are cached for CACHE_SECONDS, but anything that can change what
// a cached day looks like (a zone redrawn, a pin fixed, a driver's zones
// edited, a stop claimed) bumps this counter, which is part of every cache
// key. Without it a driver could keep seeing a stale "available" pin for a
// full cache window after someone else took it.

function dataVersion_() {
  var v = PropertiesService.getScriptProperties().getProperty('data_version');
  return v ? v : '0';
}

function bumpDataVersion_() {
  var props = PropertiesService.getScriptProperties();
  var next = String(Number(props.getProperty('data_version') || '0') + 1);
  props.setProperty('data_version', next);
  CacheService.getScriptCache().remove('config');
  return next;
}

/** CacheService rejects entries over 100KB; a big day would otherwise throw
 * mid-request, so an oversized payload just skips the cache. */
function cachePut_(key, obj, seconds) {
  try {
    var json = JSON.stringify(obj);
    if (json.length > 95000) return;
    CacheService.getScriptCache().put(key, json, seconds);
  } catch (e) {
    Logger.log('cache put failed: ' + e);
  }
}

function cacheGet_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ---------- source tab: header resolution ----------

/**
 * Maps every logical field in ORDER_FIELDS to a 1-based column in the source
 * tab, by header text where possible. Returns { columns, report } — the
 * report is what the admin "ตรวจหัวตาราง" screen shows, so a header rename in
 * the source sheet is a visible, diagnosable thing rather than silently wrong
 * data.
 */
function orderColumns_() {
  var cached = cacheGet_('ordercols:' + dataVersion_());
  if (cached) return cached;

  var sheet = ordersSheet_();
  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];

  var byExact = {};
  var byLower = {};
  for (var c = 0; c < headerRow.length; c++) {
    var text = String(headerRow[c] || '').trim();
    if (!text) continue;
    if (byExact[text] === undefined) byExact[text] = c + 1;
    var lower = text.toLowerCase();
    if (byLower[lower] === undefined) byLower[lower] = c + 1;
  }

  var columns = {};
  var report = [];
  var missing = [];
  Object.keys(ORDER_FIELDS).forEach(function (field) {
    var spec = ORDER_FIELDS[field];
    var col = 0;
    var how = '';
    var matchedHeader = '';
    for (var i = 0; i < spec.names.length && !col; i++) {
      var name = spec.names[i];
      if (byExact[name]) { col = byExact[name]; how = 'header'; matchedHeader = name; }
      else if (byLower[name.toLowerCase()]) { col = byLower[name.toLowerCase()]; how = 'header'; matchedHeader = name; }
    }
    if (!col && spec.fallbackCol) {
      col = spec.fallbackCol;
      how = 'fallback';
      matchedHeader = String(headerRow[col - 1] || '').trim();
    }
    columns[field] = col;
    report.push({
      field: field,
      column: col ? columnLetter_(col) : '—',
      how: how || 'missing',
      expected: spec.names.join(' / '),
      actualHeader: matchedHeader,
      required: !!spec.required,
    });
    if (!col && spec.required) missing.push(field + ' (' + spec.names.join('/') + ')');
  });

  if (missing.length) {
    throw new Error('หาคอลัมน์ที่จำเป็นในแท็บ "' + ORDERS_TAB_NAME + '" ไม่เจอ: ' + missing.join(', '));
  }

  var result = { columns: columns, report: report, lastColumn: lastCol };
  cachePut_('ordercols:' + dataVersion_(), result, 300);
  return result;
}

function columnLetter_(col) {
  var s = '';
  var n = col;
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
