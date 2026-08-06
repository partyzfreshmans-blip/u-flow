/**
 * Orders.js — reads a day's work out of the read-only source tab and turns it
 * into the stop list every screen renders.
 *
 * The pipeline, in order:
 *   rows for the chosen date  ->  drop finished/cancelled statuses
 *   ->  resolve each order's real coordinate (_PINFIX wins over CS_Lat/Long)
 *   ->  group orders into one stop per place
 *   ->  put each stop in a zone from its coordinate
 *   ->  overlay who has claimed what (from _ASSIGN)
 *
 * Nothing in here writes to the source tab, and nothing in here reads an
 * address string to make a decision.
 */

/** Reads the day, cached. The cache key carries the data version, so
 * redrawing a zone or fixing a pin invalidates every cached day at once. */
function buildDay_(dateKey) {
  var cacheKey = 'day:' + dateKey + ':' + dataVersion_();
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;
  var day = computeDay_(dateKey);
  cachePut_(cacheKey, day, cfgNum_('CACHE_SECONDS', 30));
  return day;
}

function computeDay_(dateKey) {
  var timezone = tz_();
  var resolved = orderColumns_();
  var cols = resolved.columns;
  var sheet = ordersSheet_();
  var lastRow = sheet.getLastRow();

  var day = {
    dateKey: dateKey,
    stops: [],
    warehouse: { lat: cfgNum_('WAREHOUSE_LAT', 18.5622345), lng: cfgNum_('WAREHOUSE_LNG', 99.0413487) },
    counts: { rowsScanned: 0, rowsForDate: 0, ordersToDeliver: 0, ordersFinished: 0 },
    generatedAt: nowStamp_(timezone),
  };
  if (lastRow < 2) return day;

  // Pass 1: read only the delivery-date column to find which rows matter.
  var dateValues = sheet.getRange(2, cols.deliveryDate, lastRow - 1, 1).getValues();
  var isUS = localeIsUS_();
  var matched = [];
  for (var i = 0; i < dateValues.length; i++) {
    if (toDateKey_(dateValues[i][0], timezone, isUS) === dateKey) matched.push(i + 2);
  }
  day.counts.rowsScanned = dateValues.length;
  day.counts.rowsForDate = matched.length;
  if (!matched.length) return day;

  // Pass 2: one block read spanning only the matched rows and only up to the
  // last column actually used — never getDataRange().
  var maxCol = 1;
  Object.keys(cols).forEach(function (field) { if (cols[field] > maxCol) maxCol = cols[field]; });
  var firstRow = matched[0];
  var lastMatchedRow = matched[matched.length - 1];
  var block = sheet.getRange(firstRow, 1, lastMatchedRow - firstRow + 1, maxCol).getValues();

  var pinFixes = activePinFixMap_();
  var bounds = boundsFromConfig_();

  var orders = [];
  for (var m = 0; m < matched.length; m++) {
    var row = block[matched[m] - firstRow];
    var status = safeText_(row[cols.status - 1]);
    if (isFinishedStatus_(status)) { day.counts.ordersFinished++; continue; }

    var orderNo = safeText_(row[cols.orderNo - 1]);
    if (!orderNo) continue; // a blank order number can't be tracked or reconciled

    var phoneRaw = cols.phone ? safeText_(row[cols.phone - 1]) : '';
    var phone = phoneKey_(phoneRaw);
    var sheetLat = toCoord_(row[cols.lat - 1]);
    var sheetLng = toCoord_(row[cols.lng - 1]);

    var lat = sheetLat;
    var lng = sheetLng;
    var coordSource = 'order';
    var fix = phone ? pinFixes[phone] : null;
    if (fix) {
      lat = fix.latNew;
      lng = fix.lngNew;
      coordSource = 'pinfix';
    }

    var flags = [];
    if (lat === null || lng === null) flags.push('no_coord');
    else if (!inBounds_(lat, lng, bounds)) flags.push('out_of_bounds');

    orders.push({
      orderNo: orderNo,
      customer: safeText_(row[cols.customer - 1]),
      phone: phone,
      phoneDial: phoneDial_(phoneRaw),
      itemCount: cols.itemCount ? toNumber_(row[cols.itemCount - 1]) : 0,
      amount: toNumber_(row[cols.totalAmount - 1]),
      payment: cols.payment ? safeText_(row[cols.payment - 1]) : '',
      status: status,
      autoRoute: cols.autoRoute ? safeText_(row[cols.autoRoute - 1]) : '',
      subdistrict: cols.subdistrict ? safeText_(row[cols.subdistrict - 1]) : '',
      address: cols.address ? safeText_(row[cols.address - 1]) : '',
      lat: lat,
      lng: lng,
      sheetLat: sheetLat,
      sheetLng: sheetLng,
      coordSource: coordSource,
      flags: flags,
      sheetRow: matched[m],
    });

    if (cols.whLat && cols.whLng) {
      var wLat = toCoord_(row[cols.whLat - 1]);
      var wLng = toCoord_(row[cols.whLng - 1]);
      if (wLat !== null && wLng !== null) day.warehouse = { lat: wLat, lng: wLng };
    }
  }
  day.counts.ordersToDeliver = orders.length;

  var stops = groupIntoStops_(orders);
  applyZones_(stops, listZones_());
  applyAssignments_(stops, dateKey);
  day.stops = stops;
  return day;
}

function boundsFromConfig_() {
  return {
    latMin: cfgNum_('BOUNDS_LAT_MIN', 17.9),
    latMax: cfgNum_('BOUNDS_LAT_MAX', 19.3),
    lngMin: cfgNum_('BOUNDS_LNG_MIN', 98.4),
    lngMax: cfgNum_('BOUNDS_LNG_MAX', 99.6),
  };
}

function isFinishedStatus_(status) {
  var text = safeText_(status);
  for (var i = 0; i < DONE_STATUSES.length; i++) {
    if (text === DONE_STATUSES[i]) return true;
  }
  return false;
}

/**
 * One pin per place.
 *
 * Grouped by phone number first, coordinate second — not by coordinate alone.
 * The same shop ordering twice in a day is the case this exists for, and in
 * real data those two orders do NOT always carry byte-identical coordinates:
 * one may predate a pin fix, or come from a different capture. Phone is the
 * value that actually identifies the shop, and it's the same key _PINFIX uses,
 * so a fixed pin and its orders always land in the same group.
 *
 * Orders with no phone fall back to a rounded coordinate (5 decimals ~ 1.1m).
 * Two different shops are never merged just for being near each other.
 */
function groupIntoStops_(orders) {
  var byKey = {};
  var stops = [];
  for (var i = 0; i < orders.length; i++) {
    var order = orders[i];
    var key;
    if (order.phone) key = 'p:' + order.phone;
    else if (order.lat !== null && order.lng !== null) key = 'c:' + order.lat.toFixed(5) + ',' + order.lng.toFixed(5);
    else key = 'o:' + order.orderNo; // no phone and no coordinate: its own stop, so it can't hide inside another

    if (!byKey[key]) {
      byKey[key] = {
        stopKey: key,
        customer: order.customer,
        phone: order.phone,
        phoneDial: order.phoneDial,
        lat: order.lat,
        lng: order.lng,
        coordSource: order.coordSource,
        sheetLat: order.sheetLat,
        sheetLng: order.sheetLng,
        address: order.address,
        subdistrict: order.subdistrict,
        autoRoute: order.autoRoute,
        orders: [],
        orderCount: 0,
        itemCount: 0,
        amount: 0,
        flags: [],
        zoneId: ZONE_UNASSIGNED,
        zoneName: '',
        zoneColor: UNASSIGNED_COLOR,
        zoneLocked: false,
        state: 'available',
        driverId: '',
        driverName: '',
        crossZone: false,
      };
      stops.push(byKey[key]);
    }

    var stop = byKey[key];
    // A coordinate from a pin fix always wins for the whole stop; otherwise
    // the first non-empty coordinate seen sticks.
    if (order.coordSource === 'pinfix' && stop.coordSource !== 'pinfix') {
      stop.lat = order.lat;
      stop.lng = order.lng;
      stop.coordSource = 'pinfix';
    } else if (stop.lat === null && order.lat !== null) {
      stop.lat = order.lat;
      stop.lng = order.lng;
    }
    if (!stop.address && order.address) stop.address = order.address;
    if (!stop.subdistrict && order.subdistrict) stop.subdistrict = order.subdistrict;
    if (!stop.phoneDial && order.phoneDial) stop.phoneDial = order.phoneDial;

    stop.orders.push({
      orderNo: order.orderNo,
      itemCount: order.itemCount,
      amount: order.amount,
      payment: order.payment,
      status: order.status,
      autoRoute: order.autoRoute,
    });
    stop.orderCount++;
    stop.itemCount += order.itemCount;
    stop.amount += order.amount;
  }

  // Flags are recomputed from the stop's final coordinate, not inherited from
  // whichever order happened to arrive first.
  var bounds = boundsFromConfig_();
  for (var s = 0; s < stops.length; s++) {
    var st = stops[s];
    st.flags = [];
    if (st.lat === null || st.lng === null) st.flags.push('no_coord');
    else if (!inBounds_(st.lat, st.lng, bounds)) st.flags.push('out_of_bounds');
  }
  return stops;
}

function applyZones_(stops, zones) {
  for (var i = 0; i < stops.length; i++) {
    var stop = stops[i];
    if (stop.lat === null || stop.lng === null) {
      stop.zoneId = ZONE_UNASSIGNED;
      stop.zoneName = 'ไม่มีพิกัด';
      stop.zoneColor = UNASSIGNED_COLOR;
      continue;
    }
    var zone = zoneForPoint_(stop.lat, stop.lng, zones);
    if (zone) {
      stop.zoneId = zone.zoneId;
      stop.zoneName = zone.zoneName;
      stop.zoneColor = zone.colorHex;
    } else {
      stop.zoneId = ZONE_UNASSIGNED;
      stop.zoneName = 'ยังไม่มีโซน';
      stop.zoneColor = UNASSIGNED_COLOR;
      if (stop.flags.indexOf('out_of_bounds') === -1) stop.flags.push('unassigned_zone');
    }
  }
}

/**
 * Overlays _ASSIGN onto the stops.
 *
 * _ASSIGN is an append-only log, and a claim is resolved by "first row wins"
 * rather than by locking: two drivers who tap at the same moment both append,
 * and both then read the same answer about who got it. Rows are processed in
 * sheet order, which is append order.
 *
 * A stop's locked zone comes from the claim, which is why redrawing a zone
 * mid-day never pulls a job out of the hands of whoever already took it,
 * while unclaimed stops re-zone immediately.
 */
function resolveAssignmentLog_(rows, dateKey) {
  var byOrder = {};
  var crossZone = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (safeText_(row.delivery_date) !== dateKey) continue;
    var orderNo = safeText_(row.order_no);
    if (!orderNo) continue;
    var status = safeText_(row.status) || 'available';
    var driverId = safeText_(row.driver_id);
    var note = safeText_(row.note);
    var current = byOrder[orderNo];

    // The cross-zone grant rides on the note column and is sticky: a driver
    // releasing the stop afterwards must not quietly re-close it to its zone.
    if (note.indexOf(CROSS_ZONE_OFF) !== -1) crossZone[orderNo] = false;
    else if (note.indexOf(CROSS_ZONE_ON) !== -1) crossZone[orderNo] = true;

    if (status === 'available') { delete byOrder[orderNo]; continue; } // released
    if (current && current.driverId !== driverId) continue; // someone else already holds it
    byOrder[orderNo] = {
      driverId: driverId,
      status: status,
      zoneLocked: safeText_(row.zone_id_locked),
      claimedAt: safeText_(row.claimed_at),
      doneAt: safeText_(row.done_at),
      failReason: safeText_(row.fail_reason),
    };
  }
  return { byOrder: byOrder, crossZone: crossZone };
}

function applyAssignments_(stops, dateKey) {
  var resolved = resolveAssignmentLog_(readAssignRowsForDate_(dateKey), dateKey);
  var byOrder = resolved.byOrder;
  var crossZone = resolved.crossZone;

  var driverNames = {};
  var drivers = listDrivers_();
  for (var d = 0; d < drivers.length; d++) driverNames[drivers[d].driverId] = drivers[d].displayName;

  for (var s = 0; s < stops.length; s++) {
    var stop = stops[s];
    var holder = '';
    var states = [];
    var lockedZone = '';
    for (var o = 0; o < stop.orders.length; o++) {
      if (crossZone[stop.orders[o].orderNo]) stop.crossZone = true;
      var assignment = byOrder[stop.orders[o].orderNo];
      if (!assignment) {
        // An order added after the stop was claimed has no row of its own
        // yet. It stays part of the stop and gets one when the driver closes
        // the job — that's what keeps a late order from becoming a second,
        // duplicate pin at the same shop.
        states.push('available');
        stop.orders[o].assignStatus = 'available';
        continue;
      }
      holder = holder || assignment.driverId;
      if (!lockedZone && assignment.zoneLocked) lockedZone = assignment.zoneLocked;
      states.push(assignment.status);
      stop.orders[o].assignStatus = assignment.status;
      stop.orders[o].failReason = assignment.failReason;
    }
    if (!holder) continue;

    stop.driverId = holder;
    stop.driverName = driverNames[holder] || holder;
    if (lockedZone) {
      stop.zoneId = lockedZone;
      stop.zoneLocked = true;
    }
    stop.state = rollUpState_(states);
  }
}

/** A stop is only "done" when every order on it is; a single failure shows as
 * failed so it can't disappear behind its successful siblings. */
function rollUpState_(states) {
  var hasFailed = false;
  var allDone = true;
  for (var i = 0; i < states.length; i++) {
    if (states[i] === 'failed') hasFailed = true;
    if (states[i] !== 'done') allDone = false;
  }
  if (hasFailed) return 'failed';
  if (allDone) return 'done';
  return 'claimed';
}
