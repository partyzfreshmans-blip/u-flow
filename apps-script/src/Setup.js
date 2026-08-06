/**
 * Setup.js — creates and repairs the five "_" tabs, and the spreadsheet menu
 * the manager uses.
 *
 * setupAll() is idempotent: run it as often as you like. It only ever adds
 * what is missing — an existing tab keeps its data, an existing _CONFIG key
 * keeps its value.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Unii Routes')
    .addItem('ติดตั้ง / ตรวจสอบระบบ', 'setupAll')
    .addItem('ตรวจหัวตารางแท็บคำสั่งซื้อ', 'showColumnReport')
    .addSeparator()
    .addItem('ตั้ง PIN แอดมินใหม่', 'promptSetAdminPin')
    .addItem('ล้างแคช', 'clearCaches')
    .addSeparator()
    .addItem('รันชุดทดสอบ', 'showTestResults')
    .addToUi();
}

function setupAll() {
  var created = [];
  Object.keys(TAB).forEach(function (key) {
    var name = TAB[key];
    if (ensureTab_(name)) created.push(name);
  });
  seedConfigDefaults_();
  applyValidation_();
  var adminPin = ensureAdminPin_();
  authSecret_(); // generates and stores the token signing key on first run
  seedStarterZones_();
  bumpDataVersion_();

  var lines = [];
  lines.push(created.length ? 'สร้างแท็บใหม่: ' + created.join(', ') : 'แท็บครบแล้ว ไม่ได้สร้างใหม่');
  if (adminPin) lines.push('\nPIN แอดมินเริ่มต้นคือ  ' + adminPin + '\nจดไว้แล้วเปลี่ยนได้จากเมนู "ตั้ง PIN แอดมินใหม่"');
  lines.push('\nขั้นถัดไป: Deploy > New deployment > Web app แล้วเปิดลิงก์บนมือถือ');

  var ui = safeUi_();
  if (ui) ui.alert('Unii Routes', lines.join('\n'), ui.ButtonSet.OK);
  return lines.join('\n');
}

/** Returns true when the tab had to be created. */
function ensureTab_(name) {
  var ss = ss_();
  var sheet = ss.getSheetByName(name);
  var isNew = false;
  if (!sheet) {
    sheet = ss.insertSheet(name);
    isNew = true;
  }
  var headers = HEADERS[name];
  var existing = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0] : [];
  var needsHeader = false;
  for (var i = 0; i < headers.length; i++) {
    if (safeText_(existing[i]) !== headers[i]) { needsHeader = true; break; }
  }
  if (needsHeader) {
    // Only the header row is ever rewritten, never data rows below it.
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return isNew;
}

function seedConfigDefaults_() {
  var sheet = ownSheet_(TAB.config);
  var existing = {};
  var rows = readObjects_(TAB.config);
  for (var i = 0; i < rows.length; i++) existing[safeText_(rows[i].key)] = true;
  var toAdd = [];
  for (var d = 0; d < CONFIG_DEFAULTS.length; d++) {
    var row = CONFIG_DEFAULTS[d];
    if (existing[row[0]]) continue;
    toAdd.push({ key: row[0], value: row[1], description: row[2] });
  }
  if (toAdd.length) appendObjects_(TAB.config, toAdd);
  sheet.autoResizeColumn(1);
  CacheService.getScriptCache().remove('config');
}

function applyValidation_() {
  validateColumn_(TAB.assign, 'status', ['available', 'claimed', 'done', 'failed']);
  validateColumn_(TAB.assign, 'gps_flag', ['ok', 'far', 'denied', 'unavailable']);
  validateColumn_(TAB.pinfix, 'method', ['current_location', 'drag_marker']);
  checkboxColumn_(TAB.drivers, 'active');
  checkboxColumn_(TAB.zones, 'active');
  checkboxColumn_(TAB.pinfix, 'active');
}

function validateColumn_(tabName, header, values) {
  var sheet = ownSheet_(tabName);
  var col = HEADERS[tabName].indexOf(header) + 1;
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/** Deliberately a validation rule and NOT insertCheckboxes(): inserting
 * checkboxes writes FALSE into every cell of the range, which makes
 * getLastRow() report the bottom of the sheet and sends every later append to
 * row 1001 with a thousand phantom rows above it. A requireCheckbox rule
 * renders the same tickbox and leaves the cells genuinely empty. */
function checkboxColumn_(tabName, header) {
  var sheet = ownSheet_(tabName);
  var col = HEADERS[tabName].indexOf(header) + 1;
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/** Generates a random admin PIN on first setup and returns it once, so it can
 * be shown to the person running setup. Returns '' when one already exists —
 * a re-run never silently changes how the manager logs in. */
function ensureAdminPin_() {
  if (cfg_('ADMIN_PIN_HASH', '')) return '';
  var pin = String(Math.floor(1000 + Math.random() * 9000));
  setConfig_('ADMIN_PIN_HASH', hashPin_(pin));
  return pin;
}

function promptSetAdminPin() {
  var ui = safeUi_();
  if (!ui) throw new Error('ใช้เมนูนี้จากในสเปรดชีตเท่านั้น');
  var response = ui.prompt('ตั้ง PIN แอดมินใหม่', 'ใส่ตัวเลข 4 หลัก', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var pin = safeText_(response.getResponseText());
  if (!isFourDigitPin_(pin)) {
    ui.alert('PIN ต้องเป็นตัวเลข 4 หลักเท่านั้น');
    return;
  }
  setConfig_('ADMIN_PIN_HASH', hashPin_(pin));
  clearFailedAttempts_('admin');
  ui.alert('เปลี่ยน PIN แอดมินแล้ว');
}

/** Two starter zones split Chiang Mai from Lamphun across the accepted
 * coordinate box, purely so the app has something to show on day one. They
 * are meant to be redrawn on the admin zone screen — nothing in the code
 * depends on their shape. Seeded only when _ZONES is completely empty. */
function seedStarterZones_() {
  if (readObjects_(TAB.zones).length) return;
  var bounds = boundsFromConfig_();
  var split = 18.62; // roughly the Chiang Mai / Lamphun boundary
  appendObjects_(TAB.zones, [
    {
      zone_id: 'Z1',
      zone_name: 'Z1 ลำพูน (ตัวอย่าง — วาดใหม่ได้)',
      color_hex: '#2f9e6f',
      priority: 100,
      polygon_geojson: JSON.stringify({ type: 'Polygon', coordinates: [boxRing_(bounds.lngMin, bounds.latMin, bounds.lngMax, split)] }),
      active: true,
      updated_at: nowStamp_(tz_()) + ' · setup',
    },
    {
      zone_id: 'Z2',
      zone_name: 'Z2 เชียงใหม่ (ตัวอย่าง — วาดใหม่ได้)',
      color_hex: '#2f6fed',
      priority: 100,
      polygon_geojson: JSON.stringify({ type: 'Polygon', coordinates: [boxRing_(bounds.lngMin, split, bounds.lngMax, bounds.latMax)] }),
      active: true,
      updated_at: nowStamp_(tz_()) + ' · setup',
    },
  ]);
}

/** GeoJSON ring for an axis-aligned box, closed (first point repeated). */
function boxRing_(lngMin, latMin, lngMax, latMax) {
  return [[lngMin, latMin], [lngMax, latMin], [lngMax, latMax], [lngMin, latMax], [lngMin, latMin]];
}

function clearCaches() {
  bumpDataVersion_();
  var ui = safeUi_();
  if (ui) ui.alert('ล้างแคชแล้ว — รีเฟรชแอพบนมือถือได้เลย');
}

function showColumnReport() {
  var resolved = orderColumns_();
  var lines = ['แท็บ "' + ORDERS_TAB_NAME + '" — คอลัมน์ที่แอพใช้', ''];
  for (var i = 0; i < resolved.report.length; i++) {
    var item = resolved.report[i];
    var how = item.how === 'header' ? 'ตรงชื่อหัวตาราง' : (item.how === 'fallback' ? 'เดาจากตำแหน่งเดิม' : 'ไม่พบ');
    lines.push(item.field + '  →  ' + item.column + '  (' + how + ')' + (item.actualHeader ? '  "' + item.actualHeader + '"' : ''));
  }
  var ui = safeUi_();
  if (ui) ui.alert('ตรวจหัวตาราง', lines.join('\n'), ui.ButtonSet.OK);
  return lines.join('\n');
}

/** Menu handlers run with a UI; the same functions called from a trigger or
 * the editor do not. */
function safeUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}
