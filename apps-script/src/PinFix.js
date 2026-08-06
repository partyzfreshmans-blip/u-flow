/**
 * PinFix.js — corrected customer coordinates, keyed by phone number.
 *
 * Keyed by phone and not by order number on purpose: the same shop orders
 * again next week under a new order number, and a pin fixed once has to keep
 * applying forever. The old coordinate is always kept so a wrong fix can be
 * reverted from the admin screen.
 */

function listPinFixes_() {
  var rows = readObjects_(TAB.pinfix);
  return rows.map(function (row) {
    return {
      _row: row._row,
      phone: phoneKey_(row.phone),
      phoneRaw: safeText_(row.phone),
      customerName: safeText_(row.customer_name),
      latNew: toCoord_(row.lat_new),
      lngNew: toCoord_(row.lng_new),
      latOld: toCoord_(row.lat_old),
      lngOld: toCoord_(row.lng_old),
      method: safeText_(row.method),
      fixedBy: safeText_(row.fixed_by),
      fixedAt: safeText_(row.fixed_at),
      active: toBool_(row.active),
    };
  }).filter(function (p) { return p.phone; });
}

/** phone -> the one active fix that applies. Later rows win, so re-fixing a
 * pin is just another append and the sheet keeps the whole history. */
function activePinFixMap_() {
  var map = {};
  var all = listPinFixes_();
  for (var i = 0; i < all.length; i++) {
    var fix = all[i];
    if (!fix.active) { delete map[fix.phone]; continue; }
    if (fix.latNew === null || fix.lngNew === null) continue;
    map[fix.phone] = fix;
  }
  return map;
}

function savePinFix_(input, fixedBy) {
  var phone = phoneKey_(input.phone);
  if (!phone) throw new Error('ไม่มีเบอร์โทรของลูกค้ารายนี้ — แก้หมุดโดยอ้างอิงเบอร์ไม่ได้');
  var latNew = toCoord_(input.latNew);
  var lngNew = toCoord_(input.lngNew);
  if (latNew === null || lngNew === null) throw new Error('พิกัดใหม่ไม่ถูกต้อง');

  var method = input.method === 'drag_marker' ? 'drag_marker' : 'current_location';
  appendObjects_(TAB.pinfix, [{
    phone: safeText_(input.phone) || phone,
    customer_name: safeText_(input.customerName),
    lat_new: latNew,
    lng_new: lngNew,
    lat_old: input.latOld === undefined || input.latOld === null || input.latOld === '' ? '' : toCoord_(input.latOld),
    lng_old: input.lngOld === undefined || input.lngOld === null || input.lngOld === '' ? '' : toCoord_(input.lngOld),
    method: method,
    fixed_by: safeText_(fixedBy),
    fixed_at: nowStamp_(tz_()),
    active: true,
  }]);
  bumpDataVersion_();
  return true;
}

/** Reverting deactivates every active fix for that phone, which drops the
 * customer back to whatever CS_Lat/CS_Long says. The rows stay for the audit
 * trail. */
function revertPinFix_(phone) {
  var key = phoneKey_(phone);
  var sheet = ownSheet_(TAB.pinfix);
  var all = listPinFixes_();
  var touched = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].phone !== key || !all[i].active) continue;
    sheet.getRange(all[i]._row, HEADERS._PINFIX.indexOf('active') + 1).setValue(false);
    touched++;
  }
  if (!touched) throw new Error('ไม่พบการแก้หมุดที่ใช้งานอยู่ของเบอร์นี้');
  bumpDataVersion_();
  return touched;
}
