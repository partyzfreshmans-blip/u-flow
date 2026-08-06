/**
 * Drivers.js — the _DRIVERS registry.
 *
 * driver_id is the stable key (used in _ASSIGN), display_name is what the
 * driver taps on the login screen. pin_code holds a hash, never the PIN.
 */

function listDrivers_() {
  var rows = readObjects_(TAB.drivers);
  return rows.map(function (row) {
    return {
      _row: row._row,
      driverId: safeText_(row.driver_id),
      displayName: safeText_(row.display_name),
      phone: safeText_(row.phone),
      zoneIds: splitZoneIds_(row.zone_ids),
      colorHex: safeText_(row.color_hex) || '#2f6fed',
      active: toBool_(row.active),
      pinHash: safeText_(row.pin_code),
      createdAt: safeText_(row.created_at),
    };
  }).filter(function (d) { return d.driverId; });
}

function splitZoneIds_(value) {
  return safeText_(value)
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

function findDriver_(driverId) {
  var id = safeText_(driverId);
  var all = listDrivers_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].driverId === id) return all[i];
  }
  return null;
}

/** What the login screen is allowed to see before anyone has authenticated:
 * names to tap, nothing else. No phone numbers, no zones, no hashes. */
function publicDriverList_() {
  return listDrivers_()
    .filter(function (d) { return d.active; })
    .map(function (d) { return { driverId: d.driverId, displayName: d.displayName, colorHex: d.colorHex }; });
}

/** Creates or updates a driver. A blank `pin` on an update keeps the existing
 * PIN — so editing someone's zones never silently resets how they log in. */
function saveDriver_(input) {
  var driverId = safeText_(input.driverId);
  if (!driverId) throw new Error('ต้องมีรหัสคนขับ (driver_id)');
  if (!/^[A-Za-z0-9_-]+$/.test(driverId)) throw new Error('รหัสคนขับใช้ได้เฉพาะ A-Z a-z 0-9 _ - เท่านั้น');
  var displayName = safeText_(input.displayName);
  if (!displayName) throw new Error('ต้องมีชื่อที่แสดง');

  var pin = safeText_(input.pin);
  if (pin && !isFourDigitPin_(pin)) throw new Error('PIN ต้องเป็นตัวเลข 4 หลัก');

  var existing = findDriver_(driverId);
  if (!existing && !pin) throw new Error('คนขับใหม่ต้องตั้ง PIN 4 หลัก');

  var zoneIds = (input.zoneIds || []).map(function (z) { return safeText_(z); }).filter(function (z) { return z; });
  var record = {
    driver_id: driverId,
    display_name: displayName,
    phone: safeText_(input.phone),
    zone_ids: zoneIds.join(','),
    color_hex: safeText_(input.colorHex) || (existing ? existing.colorHex : '#2f6fed'),
    active: input.active === false ? false : true,
    pin_code: pin ? hashPin_(pin) : (existing ? existing.pinHash : ''),
    created_at: existing ? existing.createdAt : nowStamp_(tz_()),
  };

  if (existing) updateObjectRow_(TAB.drivers, existing._row, record);
  else appendObjects_(TAB.drivers, [record]);

  clearFailedAttempts_('driver:' + driverId);
  bumpDataVersion_();
  return true;
}

/** Deactivates rather than deletes: _ASSIGN rows reference driver_id, and a
 * deleted row would turn every past claim into an unexplained blank. */
function deactivateDriver_(driverId) {
  var driver = findDriver_(driverId);
  if (!driver) throw new Error('ไม่พบคนขับ ' + driverId);
  updateObjectRow_(TAB.drivers, driver._row, {
    driver_id: driver.driverId,
    display_name: driver.displayName,
    phone: driver.phone,
    zone_ids: driver.zoneIds.join(','),
    color_hex: driver.colorHex,
    active: false,
    pin_code: driver.pinHash,
    created_at: driver.createdAt,
  });
  bumpDataVersion_();
  return true;
}
