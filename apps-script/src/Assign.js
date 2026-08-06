/**
 * Assign.js — claiming a stop, giving it back, and closing the job.
 *
 * Two things protect a claim from two drivers tapping at the same instant:
 *
 *   1. A script lock around read-then-append, so only one claim is ever in
 *      flight at a time.
 *   2. _ASSIGN being an append-only log resolved first-row-wins. If a lock
 *      ever times out and two rows do land, every reader still agrees on who
 *      got the stop — the earlier row — instead of the answer depending on
 *      who reads when.
 *
 * The second one is what makes this safe rather than merely usually correct,
 * so it stays even though the lock normally prevents the situation.
 */

/** Every write path runs inside this. 20s is chosen against the worst
 * realistic wait: one claim reads the day fresh (~1-2s) plus the append. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('ระบบกำลังบันทึกรายการของคนอื่นอยู่ — รอสักครู่แล้วกดใหม่');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Inside a lock the cache must be bypassed: a claim decision made against a
 * 30-second-old snapshot is exactly the race this is meant to prevent. */
function freshStop_(dateKey, stopKey) {
  var day = computeDay_(dateKey);
  for (var i = 0; i < day.stops.length; i++) {
    if (day.stops[i].stopKey === stopKey) return { day: day, stop: day.stops[i] };
  }
  throw new Error('ไม่พบจุดส่งนี้ในวันที่เลือกแล้ว — อาจถูกเปลี่ยนวันจัดส่งหรือยกเลิก');
}

function assertClaimable_(stop, driver) {
  if (stop.lat === null || stop.lng === null) throw new Error('จุดนี้ยังไม่มีพิกัด จองไม่ได้ — แจ้งแอดมิน');
  if (stop.zoneId === ZONE_UNASSIGNED && !stop.crossZone) throw new Error('จุดนี้ยังไม่มีโซน จองไม่ได้ — แจ้งแอดมิน');
  if (stop.crossZone) return;
  if (driver.zoneIds.indexOf(stop.zoneId) === -1) {
    var owners = zoneOwnerMap_()[stop.zoneId];
    throw new Error('จุดนี้อยู่โซน ' + (stop.zoneName || stop.zoneId) + (owners && owners.length ? ' ของ ' + owners.join(', ') : '') + ' — ให้แอดมินปล่อยข้ามโซนก่อน');
  }
}

/** Row template so every append writes the full 16 columns in one shape. */
function assignRow_(stop, order, dateKey, driverId, status, extra) {
  var row = {
    order_no: order.orderNo,
    delivery_date: dateKey,
    stop_key: stop.stopKey,
    driver_id: driverId,
    zone_id_locked: stop.zoneId,
    status: status,
    claimed_at: '',
    done_at: '',
    gps_lat: '',
    gps_lng: '',
    gps_accuracy_m: '',
    distance_from_pin_m: '',
    gps_flag: '',
    fail_reason: '',
    note: '',
    updated_at: nowStamp_(tz_()),
  };
  if (extra) Object.keys(extra).forEach(function (key) { row[key] = extra[key]; });
  return row;
}

// ---------- driver actions ----------

/**
 * Claims a whole stop at once — one shop, one trip, one tap. _ASSIGN still
 * gets a row per order number so the day reconciles against the accounts
 * line by line.
 */
function claimStop_(driver, dateKey, stopKey) {
  return withLock_(function () {
    var found = freshStop_(dateKey, stopKey);
    var stop = found.stop;

    if (stop.driverId && stop.driverId !== driver.driverId) {
      throw new Error((stop.driverName || 'คนขับอีกคน') + ' จองจุดนี้ไปก่อนแล้ว');
    }
    if (stop.driverId === driver.driverId) return { alreadyMine: true, stop: stop };
    assertClaimable_(stop, driver);

    var stamp = nowStamp_(tz_());
    var rows = stop.orders.map(function (order) {
      return assignRow_(stop, order, dateKey, driver.driverId, 'claimed', { claimed_at: stamp });
    });
    appendObjects_(TAB.assign, rows);
    bumpDataVersion_();

    stop.driverId = driver.driverId;
    stop.driverName = driver.displayName;
    stop.state = 'claimed';
    stop.zoneLocked = true;
    return { alreadyMine: false, stop: stop };
  });
}

/** Gives the stop back so someone else can take it. Only ever affects rows
 * this driver holds, and never a stop already closed — an accidental tap
 * after delivery must not reopen finished work. */
function releaseStop_(driver, dateKey, stopKey) {
  return withLock_(function () {
    var found = freshStop_(dateKey, stopKey);
    var stop = found.stop;
    if (!stop.driverId) return { stop: stop };
    if (stop.driverId !== driver.driverId) throw new Error('จุดนี้เป็นของ ' + (stop.driverName || 'คนอื่น') + ' — ปล่อยคืนแทนกันไม่ได้');
    if (stop.state === 'done' || stop.state === 'failed') throw new Error('จุดนี้ปิดงานไปแล้ว ปล่อยคืนไม่ได้ — ให้แอดมินแก้ให้');

    var rows = stop.orders.map(function (order) {
      return assignRow_(stop, order, dateKey, driver.driverId, 'available', { note: 'released_by_driver' });
    });
    appendObjects_(TAB.assign, rows);
    bumpDataVersion_();

    stop.driverId = '';
    stop.driverName = '';
    stop.state = 'available';
    return { stop: stop };
  });
}

/**
 * Closes the job — successfully or not.
 *
 * The GPS reading is taken by the phone at the moment the button is pressed
 * and sent here; this app never tracks anyone continuously. A reading that is
 * far from the pin, refused, or unavailable is recorded and flagged but never
 * blocks the close: the driver is standing at the shop either way, and the
 * usual cause of "far" is a wrong pin, not a wrong driver.
 */
function completeStop_(driver, dateKey, stopKey, outcome, gps, failReason, note) {
  if (outcome !== 'done' && outcome !== 'failed') throw new Error('ผลการส่งไม่ถูกต้อง');
  if (outcome === 'failed' && !safeText_(failReason)) throw new Error('เลือกเหตุผลที่ส่งไม่สำเร็จก่อน');

  return withLock_(function () {
    var found = freshStop_(dateKey, stopKey);
    var stop = found.stop;
    if (!stop.driverId) throw new Error('ต้องจองจุดนี้ก่อนถึงจะปิดงานได้');
    if (stop.driverId !== driver.driverId) throw new Error('จุดนี้เป็นของ ' + (stop.driverName || 'คนอื่น') + ' — ปิดงานแทนกันไม่ได้');

    var reading = evaluateGps_(stop, gps);
    var stamp = nowStamp_(tz_());
    var rows = [];
    for (var i = 0; i < stop.orders.length; i++) {
      var order = stop.orders[i];
      // Orders already closed are left alone; an order that joined the stop
      // after it was claimed gets closed here along with the rest.
      if (order.assignStatus === 'done' || order.assignStatus === 'failed') continue;
      rows.push(assignRow_(stop, order, dateKey, driver.driverId, outcome, {
        claimed_at: '',
        done_at: stamp,
        gps_lat: reading.lat,
        gps_lng: reading.lng,
        gps_accuracy_m: reading.accuracy,
        distance_from_pin_m: reading.distance,
        gps_flag: reading.flag,
        fail_reason: outcome === 'failed' ? safeText_(failReason) : '',
        note: safeText_(note),
      }));
    }
    if (!rows.length) throw new Error('ทุกออเดอร์ในจุดนี้ปิดงานไปแล้ว');
    appendObjects_(TAB.assign, rows);
    bumpDataVersion_();

    stop.state = outcome;
    return { stop: stop, gpsFlag: reading.flag, distance: reading.distance };
  });
}

/**
 * Turns a browser geolocation result into the four GPS columns.
 *
 * The "far" threshold adds the reading's own accuracy to the configured
 * distance. A phone that reports ±400m in a dense street is not evidence the
 * driver is somewhere else, and flagging those would bury the handful of
 * genuinely wrong pins in noise the manager then learns to ignore.
 */
function evaluateGps_(stop, gps) {
  var blank = { lat: '', lng: '', accuracy: '', distance: '', flag: 'unavailable' };
  if (!gps) return blank;
  if (gps.status === 'denied') { blank.flag = 'denied'; return blank; }

  var lat = toCoord_(gps.lat);
  var lng = toCoord_(gps.lng);
  if (lat === null || lng === null) return blank;

  var accuracy = toNumber_(gps.accuracy);
  var result = { lat: lat, lng: lng, accuracy: accuracy || '', distance: '', flag: 'ok' };
  if (stop.lat === null || stop.lng === null) return result; // nothing to measure against

  var distance = Math.round(haversineMeters_(stop.lat, stop.lng, lat, lng));
  result.distance = distance;
  result.flag = distance > cfgNum_('GPS_FAR_METERS', 300) + (accuracy || 0) ? 'far' : 'ok';
  return result;
}

// ---------- admin actions ----------

/** Hands a stop to a named driver regardless of zone — the "someone called in
 * sick" and "this one is urgent" lever. Releases the current holder first so
 * the log reads as a clean handover rather than two overlapping claims. */
function adminAssignStop_(dateKey, stopKey, driverId) {
  var driver = findDriver_(driverId);
  if (!driver) throw new Error('ไม่พบคนขับ ' + driverId);
  if (!driver.active) throw new Error('คนขับคนนี้ถูกปิดใช้งานอยู่');

  return withLock_(function () {
    var found = freshStop_(dateKey, stopKey);
    var stop = found.stop;
    if (stop.driverId === driver.driverId) return { stop: stop };

    var stamp = nowStamp_(tz_());
    var rows = [];
    if (stop.driverId) {
      rows = rows.concat(stop.orders.map(function (order) {
        return assignRow_(stop, order, dateKey, stop.driverId, 'available', { note: 'reassigned_by_admin' });
      }));
    }
    rows = rows.concat(stop.orders.map(function (order) {
      return assignRow_(stop, order, dateKey, driver.driverId, 'claimed', { claimed_at: stamp, note: 'assigned_by_admin' });
    }));
    appendObjects_(TAB.assign, rows);
    bumpDataVersion_();

    stop.driverId = driver.driverId;
    stop.driverName = driver.displayName;
    stop.state = 'claimed';
    return { stop: stop };
  });
}

/** Takes a stop back off whoever holds it, without giving it to anyone. */
function adminReleaseStop_(dateKey, stopKey) {
  return withLock_(function () {
    var found = freshStop_(dateKey, stopKey);
    var stop = found.stop;
    if (!stop.driverId) return { stop: stop };
    var rows = stop.orders.map(function (order) {
      return assignRow_(stop, order, dateKey, stop.driverId, 'available', { note: 'released_by_admin' });
    });
    appendObjects_(TAB.assign, rows);
    bumpDataVersion_();
    stop.driverId = '';
    stop.driverName = '';
    stop.state = 'available';
    return { stop: stop };
  });
}

/** "ปล่อยข้ามโซน" for one stop: any active driver may claim it. Written as an
 * available-status row carrying the marker in its note, which leaves the
 * holder resolution untouched. */
function adminSetCrossZone_(dateKey, stopKey, allow) {
  return withLock_(function () {
    var found = freshStop_(dateKey, stopKey);
    var stop = found.stop;
    // The marker row carries status "available", which is also how a release
    // is recorded — so writing one while a driver holds the stop would take
    // the job out of their hands as a side effect. Blocked in both
    // directions; moving a claimed stop is what adminAssignStop_ is for.
    if (stop.driverId) throw new Error('จุดนี้มีคนจองอยู่ — ถ้าจะย้ายให้ใช้ "มอบหมายให้คนขับ" หรือ "ดึงคืน" ก่อน');
    var rows = stop.orders.map(function (order) {
      return assignRow_(stop, order, dateKey, '', 'available', { note: allow ? CROSS_ZONE_ON : CROSS_ZONE_OFF });
    });
    appendObjects_(TAB.assign, rows);
    bumpDataVersion_();
    stop.crossZone = !!allow;
    return { stop: stop };
  });
}
