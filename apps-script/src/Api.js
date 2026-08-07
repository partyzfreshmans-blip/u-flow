/**
 * Api.js — everything the browser can call, and nothing else.
 *
 * Every function here returns { ok: true, data } or { ok: false, error } so
 * the client has exactly one shape to handle. Every one that touches real
 * data checks a token first: this web app is reachable by anyone with the
 * link, so "the UI didn't show a login" is never the thing protecting data.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Unii Routes — สาขา 584')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Lets Index.html pull in the CSS/JS partials. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function ok_(data) {
  return { ok: true, data: data };
}

function fail_(error) {
  return { ok: false, error: String(error && error.message ? error.message : error) };
}

function guard_(fn) {
  try {
    return ok_(fn());
  } catch (e) {
    Logger.log(e && e.stack ? e.stack : e);
    return fail_(e);
  }
}

// ---------- public ----------

/** Pre-login payload: enough to draw the login screen and nothing more. */
function api_bootstrap() {
  return guard_(function () {
    return {
      drivers: publicDriverList_(),
      refreshSeconds: cfgNum_('REFRESH_SECONDS', 20),
      today: todayKey_(tz_()),
      hasZones: listZones_().length > 0,
    };
  });
}

function api_driverLogin(driverId, pin) {
  return guard_(function () {
    var id = safeText_(driverId);
    assertNotLockedOut_('driver:' + id);
    var driver = findDriver_(id);
    if (!driver || !driver.active || !verifyPin_(pin, driver.pinHash)) {
      recordFailedAttempt_('driver:' + id);
      throw new Error('PIN ไม่ถูกต้อง');
    }
    clearFailedAttempts_('driver:' + id);
    return {
      token: issueToken_('driver', driver.driverId, TOKEN_TTL_DAYS_DRIVER * 24 * 3600),
      driver: { driverId: driver.driverId, displayName: driver.displayName, zoneIds: driver.zoneIds, colorHex: driver.colorHex },
    };
  });
}

function api_adminLogin(pin) {
  return guard_(function () {
    assertNotLockedOut_('admin');
    var hash = cfg_('ADMIN_PIN_HASH', '');
    if (!hash) throw new Error('ยังไม่ได้ตั้ง PIN แอดมิน — เปิดสเปรดชีตแล้วกดเมนู Unii Routes > ติดตั้ง/ตรวจสอบระบบ');
    if (!verifyPin_(pin, hash)) {
      recordFailedAttempt_('admin');
      throw new Error('PIN ไม่ถูกต้อง');
    }
    clearFailedAttempts_('admin');
    return { token: issueToken_('admin', 'admin', TOKEN_TTL_HOURS_ADMIN * 3600) };
  });
}

// ---------- driver ----------

/**
 * A driver's view of one day.
 *
 * Zones are a wall: stops inside the driver's own zones come back complete,
 * stops in someone else's zone come back stripped down to "there is a stop
 * here and it belongs to <zone>" — the customer, phone and amount are not
 * sent to a phone that isn't allowed to act on them. Stops with no zone or no
 * coordinate are not sent to drivers at all; they are the admin's to clear.
 */
function api_driverDay(token, dateKey) {
  return guard_(function () {
    var auth = requireDriver_(token);
    var driver = auth.driver;
    var date = normalizeRequestedDate_(dateKey);
    var day = buildDay_(date);

    var myZones = {};
    for (var i = 0; i < driver.zoneIds.length; i++) myZones[driver.zoneIds[i]] = true;
    var zoneOwners = zoneOwnerMap_();

    var mine = [];
    var others = [];
    var summary = { mineTotal: 0, mineClaimed: 0, mineDone: 0, mineAmount: 0, mineCollected: 0 };

    for (var s = 0; s < day.stops.length; s++) {
      var stop = day.stops[s];
      if (stop.lat === null || stop.lng === null) continue; // can't be put on a map at all

      // A stop already assigned to this driver is always visible to them,
      // even when it sits outside their zones or has no zone at all — that's
      // how an admin hand-assignment reaches the person it was given to.
      // Without this, "ปล่อยข้ามโซน" and manual assignment would both drop
      // the stop into a hole nobody sees.
      var isMine = stop.driverId && stop.driverId === driver.driverId;
      if (!isMine && !stop.crossZone && stop.zoneId === ZONE_UNASSIGNED) continue; // admin's to clear

      // crossZone is the admin's per-stop override: the stop behaves as if it
      // were in this driver's zone, for every driver, until it's claimed.
      if (isMine || myZones[stop.zoneId] || stop.crossZone) {
        var copy = cloneStop_(stop);
        copy.mine = stop.driverId === driver.driverId;
        copy.canInteract = true;
        mine.push(copy);
        summary.mineTotal++;
        summary.mineAmount += stop.amount;
        if (stop.state === 'claimed' && copy.mine) summary.mineClaimed++;
        if (stop.state === 'done') summary.mineDone++;
        if (stop.state === 'done' && copy.mine) summary.mineCollected += stop.amount;
      } else {
        others.push({
          stopKey: stop.stopKey,
          lat: stop.lat,
          lng: stop.lng,
          zoneId: stop.zoneId,
          zoneName: stop.zoneName,
          zoneColor: stop.zoneColor,
          ownerNames: zoneOwners[stop.zoneId] || [],
          canInteract: false,
        });
      }
    }

    return {
      dateKey: date,
      driver: { driverId: driver.driverId, displayName: driver.displayName, zoneIds: driver.zoneIds },
      stops: mine,
      otherStops: others,
      summary: summary,
      warehouse: day.warehouse,
      refreshSeconds: cfgNum_('REFRESH_SECONDS', 20),
      failReasons: FAIL_REASONS,
      generatedAt: day.generatedAt,
    };
  });
}

// ---------- driver actions (claim / release / close / fix pin) ----------

function api_driverClaim(token, dateKey, stopKey) {
  return guard_(function () {
    var auth = requireDriver_(token);
    if (!auth.driver) throw new Error('บัญชีนี้ไม่ใช่คนขับ');
    var result = claimStop_(auth.driver, normalizeRequestedDate_(dateKey), safeText_(stopKey));
    return { alreadyMine: result.alreadyMine, stop: result.stop };
  });
}

function api_driverRelease(token, dateKey, stopKey) {
  return guard_(function () {
    var auth = requireDriver_(token);
    if (!auth.driver) throw new Error('บัญชีนี้ไม่ใช่คนขับ');
    return releaseStop_(auth.driver, normalizeRequestedDate_(dateKey), safeText_(stopKey));
  });
}

/** `payload.gps` is whatever the phone managed to produce at the moment the
 * button was pressed — including { status: 'denied' } when the driver refused.
 * None of those outcomes blocks the close. */
function api_driverComplete(token, dateKey, stopKey, payload) {
  return guard_(function () {
    var auth = requireDriver_(token);
    if (!auth.driver) throw new Error('บัญชีนี้ไม่ใช่คนขับ');
    var body = payload || {};
    return completeStop_(
      auth.driver,
      normalizeRequestedDate_(dateKey),
      safeText_(stopKey),
      safeText_(body.outcome),
      body.gps,
      body.failReason,
      body.note
    );
  });
}

/** "ใช้ตำแหน่งฉันตอนนี้" — the driver is standing at the shop, which is the
 * most accurate fix this data will ever get. Keyed by phone, so it applies to
 * every future order from the same shop. */
function api_driverFixPin(token, dateKey, stopKey, lat, lng) {
  return guard_(function () {
    var auth = requireDriver_(token);
    if (!auth.driver) throw new Error('บัญชีนี้ไม่ใช่คนขับ');
    var date = normalizeRequestedDate_(dateKey);
    var day = buildDay_(date);
    var stop = null;
    for (var i = 0; i < day.stops.length; i++) {
      if (day.stops[i].stopKey === safeText_(stopKey)) stop = day.stops[i];
    }
    if (!stop) throw new Error('ไม่พบจุดส่งนี้');
    if (!stop.phone) throw new Error('จุดนี้ไม่มีเบอร์โทร แก้หมุดถาวรไม่ได้ — แจ้งแอดมิน');

    savePinFix_({
      phone: stop.phoneDial || stop.phone,
      customerName: stop.customer,
      latNew: lat,
      lngNew: lng,
      latOld: stop.sheetLat,
      lngOld: stop.sheetLng,
      method: 'current_location',
    }, auth.driver.displayName);
    return true;
  });
}

/** zoneId -> display names of the active drivers holding it, so an
 * out-of-zone tap can say whose stop it is. */
function zoneOwnerMap_() {
  var map = {};
  var drivers = listDrivers_();
  for (var i = 0; i < drivers.length; i++) {
    if (!drivers[i].active) continue;
    for (var z = 0; z < drivers[i].zoneIds.length; z++) {
      var zoneId = drivers[i].zoneIds[z];
      if (!map[zoneId]) map[zoneId] = [];
      map[zoneId].push(drivers[i].displayName);
    }
  }
  return map;
}

function cloneStop_(stop) {
  return JSON.parse(JSON.stringify(stop));
}

/** Guards against a client sending junk, and defaults to today. */
function normalizeRequestedDate_(dateKey) {
  var text = safeText_(dateKey);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return todayKey_(tz_());
}

// ---------- admin ----------

function api_adminDay(token, dateKey) {
  return guard_(function () {
    requireAdmin_(token);
    var date = normalizeRequestedDate_(dateKey);
    var day = buildDay_(date);
    var zoneOwners = zoneOwnerMap_();

    var exceptions = { noCoord: [], outOfBounds: [], noZone: [], unclaimed: [] };
    var byDriver = {};
    var totals = { stops: 0, orders: 0, amount: 0, claimed: 0, done: 0, failed: 0 };

    for (var i = 0; i < day.stops.length; i++) {
      var stop = day.stops[i];
      totals.stops++;
      totals.orders += stop.orderCount;
      totals.amount += stop.amount;
      if (stop.state === 'claimed') totals.claimed++;
      if (stop.state === 'done') totals.done++;
      if (stop.state === 'failed') totals.failed++;

      var brief = {
        stopKey: stop.stopKey,
        customer: stop.customer,
        phoneDial: stop.phoneDial,
        orderCount: stop.orderCount,
        amount: stop.amount,
        address: stop.address || stop.subdistrict,
        lat: stop.lat,
        lng: stop.lng,
        zoneId: stop.zoneId,
        zoneName: stop.zoneName,
        state: stop.state,
        driverName: stop.driverName,
      };
      if (stop.flags.indexOf('no_coord') !== -1) exceptions.noCoord.push(brief);
      if (stop.flags.indexOf('out_of_bounds') !== -1) exceptions.outOfBounds.push(brief);
      if (stop.zoneId === ZONE_UNASSIGNED && stop.flags.indexOf('no_coord') === -1) exceptions.noZone.push(brief);
      if (stop.state === 'available') exceptions.unclaimed.push(brief);

      if (stop.driverId) {
        if (!byDriver[stop.driverId]) byDriver[stop.driverId] = { driverId: stop.driverId, driverName: stop.driverName, stops: 0, orders: 0, amount: 0, done: 0 };
        byDriver[stop.driverId].stops++;
        byDriver[stop.driverId].orders += stop.orderCount;
        byDriver[stop.driverId].amount += stop.amount;
        if (stop.state === 'done') byDriver[stop.driverId].done++;
      }
    }

    var workload = Object.keys(byDriver).map(function (k) { return byDriver[k]; });
    var drivers = listDrivers_();
    for (var d = 0; d < drivers.length; d++) {
      if (!drivers[d].active || byDriver[drivers[d].driverId]) continue;
      workload.push({ driverId: drivers[d].driverId, driverName: drivers[d].displayName, stops: 0, orders: 0, amount: 0, done: 0 });
    }

    return {
      dateKey: date,
      stops: day.stops,
      counts: day.counts,
      totals: totals,
      exceptions: exceptions,
      workload: workload,
      zoneOwners: zoneOwners,
      drivers: drivers.filter(function (d) { return d.active; }).map(function (d) {
        return { driverId: d.driverId, displayName: d.displayName, zoneIds: d.zoneIds };
      }),
      warehouse: day.warehouse,
      generatedAt: day.generatedAt,
    };
  });
}

// ---------- admin actions on a single stop ----------

function api_adminAssign(token, dateKey, stopKey, driverId) {
  return guard_(function () {
    requireAdmin_(token);
    return adminAssignStop_(normalizeRequestedDate_(dateKey), safeText_(stopKey), safeText_(driverId));
  });
}

function api_adminReleaseStop(token, dateKey, stopKey) {
  return guard_(function () {
    requireAdmin_(token);
    return adminReleaseStop_(normalizeRequestedDate_(dateKey), safeText_(stopKey));
  });
}

function api_adminCrossZone(token, dateKey, stopKey, allow) {
  return guard_(function () {
    requireAdmin_(token);
    return adminSetCrossZone_(normalizeRequestedDate_(dateKey), safeText_(stopKey), !!allow);
  });
}

/** Dragging a pin on the admin map — the retroactive counterpart to a
 * driver's "use my location". Same _PINFIX record, different method. */
function api_adminMovePin(token, payload) {
  return guard_(function () {
    requireAdmin_(token);
    var body = payload || {};
    savePinFix_({
      phone: body.phone,
      customerName: body.customerName,
      latNew: body.lat,
      lngNew: body.lng,
      latOld: body.latOld,
      lngOld: body.lngOld,
      method: 'drag_marker',
    }, 'admin');
    return true;
  });
}

function api_adminZones(token) {
  return guard_(function () {
    requireAdmin_(token);
    return listZones_().map(function (z) {
      return {
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        colorHex: z.colorHex,
        priority: z.priority,
        polygonJson: z.polygonJson,
        active: z.active,
        broken: z.broken,
        updatedAt: z.updatedAt,
      };
    });
  });
}

function api_adminSaveZone(token, zone) {
  return guard_(function () {
    requireAdmin_(token);
    saveZone_(zone, 'admin');
    return true;
  });
}

function api_adminSetZoneActive(token, zoneId, active) {
  return guard_(function () {
    requireAdmin_(token);
    return setZoneActive_(safeText_(zoneId), !!active);
  });
}

function api_adminDrivers(token) {
  return guard_(function () {
    requireAdmin_(token);
    return listDrivers_().map(function (d) {
      return {
        driverId: d.driverId,
        displayName: d.displayName,
        phone: d.phone,
        zoneIds: d.zoneIds,
        colorHex: d.colorHex,
        active: d.active,
        hasPin: !!d.pinHash,
        createdAt: d.createdAt,
      };
    });
  });
}

function api_adminSaveDriver(token, driver) {
  return guard_(function () {
    requireAdmin_(token);
    return saveDriver_(driver);
  });
}

function api_adminDeactivateDriver(token, driverId) {
  return guard_(function () {
    requireAdmin_(token);
    return deactivateDriver_(safeText_(driverId));
  });
}

function api_adminPinFixes(token) {
  return guard_(function () {
    requireAdmin_(token);
    var active = activePinFixMap_();
    return listPinFixes_().map(function (p) {
      return {
        phone: p.phone,
        phoneRaw: p.phoneRaw,
        customerName: p.customerName,
        latNew: p.latNew,
        lngNew: p.lngNew,
        latOld: p.latOld,
        lngOld: p.lngOld,
        method: p.method,
        fixedBy: p.fixedBy,
        fixedAt: p.fixedAt,
        active: p.active,
        isCurrent: !!(active[p.phone] && active[p.phone]._row === p._row),
      };
    });
  });
}

function api_adminRevertPinFix(token, phone) {
  return guard_(function () {
    requireAdmin_(token);
    return revertPinFix_(phone);
  });
}

/** _CONFIG minus the two values that are credentials. AUTH_SECRET especially
 * must never reach a browser: with it, anyone could mint a token for any
 * driver. The diagnostics screen only needs to show the operational settings. */
function redactedConfig_() {
  var map = configMap_();
  var out = {};
  Object.keys(map).forEach(function (key) {
    out[key] = (key === 'AUTH_SECRET' || key === 'ADMIN_PIN_HASH') ? (map[key] ? '(ตั้งค่าแล้ว)' : '(ยังไม่ได้ตั้ง)') : map[key];
  });
  return out;
}

/** The "is the app reading the right columns" screen. Worth having in the UI
 * rather than only in the editor: when a header in the source tab gets
 * renamed, this is the first place that shows it. */
function api_adminDiagnostics(token) {
  return guard_(function () {
    requireAdmin_(token);
    var resolved = orderColumns_();
    return {
      routesFile: ss_().getName(),
      ordersFile: ordersMeta_().name,
      ordersTab: ordersSheet_().getName(),
      report: resolved.report,
      zones: listZones_().map(function (z) { return { zoneId: z.zoneId, active: z.active, broken: z.broken, points: z.rings ? z.rings[0].length : 0 }; }),
      config: redactedConfig_(),
      dataVersion: dataVersion_(),
      timezone: tz_(),
      localeIsUS: localeIsUS_(),
    };
  });
}
