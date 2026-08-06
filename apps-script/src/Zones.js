/**
 * Zones.js — polygon zones, and the rule that turns a coordinate into a zone.
 *
 * Zones are geometry only. Nothing here ever looks at an address string: the
 * address text in the source data is known to be wrong (Lamphun customers
 * carrying an Ubon Ratchathani address), which is the whole reason zoning is
 * done from coordinates.
 */

function listZones_() {
  var rows = readObjects_(TAB.zones);
  var zones = rows.map(function (row) {
    var rings = parsePolygonRings_(row.polygon_geojson);
    return {
      _row: row._row,
      zoneId: safeText_(row.zone_id),
      zoneName: safeText_(row.zone_name) || safeText_(row.zone_id),
      colorHex: safeText_(row.color_hex) || '#2f6fed',
      priority: toNumber_(row.priority),
      polygonJson: safeText_(row.polygon_geojson),
      rings: rings,
      /** A zone whose polygon cell won't parse is kept and surfaced instead of
       * being skipped silently — otherwise its stops become UNASSIGNED with no
       * hint as to why. */
      broken: !rings,
      active: toBool_(row.active),
      updatedAt: safeText_(row.updated_at),
    };
  }).filter(function (z) { return z.zoneId; });

  zones.sort(function (a, b) { return a.priority - b.priority; });
  return zones;
}

/** Lowest priority number wins where polygons overlap. */
function zoneForPoint_(lat, lng, zones) {
  for (var i = 0; i < zones.length; i++) {
    var zone = zones[i];
    if (!zone.active || !zone.rings) continue;
    if (pointInPolygon_(lat, lng, zone.rings)) return zone;
  }
  return null;
}

function saveZone_(input, editor) {
  var zoneId = safeText_(input.zoneId);
  if (!zoneId) throw new Error('ต้องมีรหัสโซน (zone_id)');
  if (zoneId === ZONE_UNASSIGNED) throw new Error('ใช้ชื่อ ' + ZONE_UNASSIGNED + ' เป็นรหัสโซนไม่ได้');
  if (!/^[A-Za-z0-9_-]+$/.test(zoneId)) throw new Error('รหัสโซนใช้ได้เฉพาะ A-Z a-z 0-9 _ - เท่านั้น');

  var polygonJson = safeText_(input.polygonJson);
  var rings = parsePolygonRings_(polygonJson);
  if (!rings) throw new Error('รูปโซนไม่ถูกต้อง — วาดบนแผนที่ให้ครบอย่างน้อย 3 จุด');
  // Store a canonical GeoJSON Polygon regardless of what shape came in, so
  // every consumer (including a human reading the cell) sees one format.
  var canonical = JSON.stringify({ type: 'Polygon', coordinates: rings });

  var existing = null;
  var zones = listZones_();
  for (var i = 0; i < zones.length; i++) {
    if (zones[i].zoneId === zoneId) existing = zones[i];
  }

  var record = {
    zone_id: zoneId,
    zone_name: safeText_(input.zoneName) || zoneId,
    color_hex: safeText_(input.colorHex) || '#2f6fed',
    priority: input.priority === undefined || input.priority === '' ? (existing ? existing.priority : 100) : toNumber_(input.priority),
    polygon_geojson: canonical,
    active: input.active === false ? false : true,
    updated_at: nowStamp_(tz_()) + ' · ' + safeText_(editor),
  };

  if (existing) updateObjectRow_(TAB.zones, existing._row, record);
  else appendObjects_(TAB.zones, [record]);

  // Redrawing a zone changes what every unclaimed stop resolves to, so every
  // cached day must be recomputed on the next request.
  bumpDataVersion_();
  return true;
}

function setZoneActive_(zoneId, active) {
  var zones = listZones_();
  for (var i = 0; i < zones.length; i++) {
    if (zones[i].zoneId !== zoneId) continue;
    updateObjectRow_(TAB.zones, zones[i]._row, {
      zone_id: zones[i].zoneId,
      zone_name: zones[i].zoneName,
      color_hex: zones[i].colorHex,
      priority: zones[i].priority,
      polygon_geojson: zones[i].polygonJson,
      active: !!active,
      updated_at: nowStamp_(tz_()),
    });
    bumpDataVersion_();
    return true;
  }
  throw new Error('ไม่พบโซน ' + zoneId);
}
