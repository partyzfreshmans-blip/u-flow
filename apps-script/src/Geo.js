/**
 * Geo.js — the geometry the zoning depends on. Pure functions, no sheet
 * access, so Tests.js can exercise every branch without touching data.
 */

/**
 * Ray casting point-in-polygon.
 *
 * `ring` is a GeoJSON linear ring: an array of [lng, lat] pairs (GeoJSON is
 * x,y — longitude first — which is the opposite of how everything else in
 * this project passes coordinates, hence the explicit naming below).
 *
 * A ray is cast along +longitude and crossings of each edge are counted; odd
 * means inside. The `(yi > lat) !== (yj > lat)` test treats each edge as
 * half-open at its upper vertex, which is what stops a ray passing exactly
 * through a shared vertex from being counted twice.
 */
function pointInRing_(lat, lng, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1];
    var xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat)) {
      var xIntersect = (xj - xi) * (lat - yi) / (yj - yi) + xi;
      if (lng < xIntersect) inside = !inside;
    }
  }
  return inside;
}

/**
 * Point-in-polygon for a GeoJSON Polygon's coordinate array: ring 0 is the
 * outer boundary, any further rings are holes. A point inside a hole is
 * outside the polygon.
 */
function pointInPolygon_(lat, lng, rings) {
  if (!rings || !rings.length || !rings[0] || rings[0].length < 3) return false;
  if (!pointInRing_(lat, lng, rings[0])) return false;
  for (var i = 1; i < rings.length; i++) {
    if (rings[i] && rings[i].length >= 3 && pointInRing_(lat, lng, rings[i])) return false;
  }
  return true;
}

var EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres. */
function haversineMeters_(lat1, lng1, lat2, lng2) {
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function inBounds_(lat, lng, bounds) {
  return lat >= bounds.latMin && lat <= bounds.latMax && lng >= bounds.lngMin && lng <= bounds.lngMax;
}

/** Parses the polygon_geojson cell. Accepts a bare coordinate array, a
 * Polygon geometry, or a Feature wrapping one — whichever shape the admin
 * drawing tool (or a hand edit) produced. Returns null when unusable, and the
 * caller treats that zone as unusable rather than crashing the whole day. */
function parsePolygonRings_(cellValue) {
  var text = safeText_(cellValue);
  if (!text) return null;
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return null;
  }
  var geometry = parsed;
  if (parsed && parsed.type === 'Feature') geometry = parsed.geometry;
  var coords = geometry && geometry.coordinates ? geometry.coordinates : geometry;
  if (!Array.isArray(coords) || !coords.length) return null;

  // MultiPolygon: [[ring, hole…], [ring…]] — flatten to the first polygon's
  // rings, which is all the zone editor can produce.
  if (Array.isArray(coords[0]) && Array.isArray(coords[0][0]) && Array.isArray(coords[0][0][0])) {
    coords = coords[0];
  }
  // Bare ring: [[lng,lat], …] -> wrap as a single-ring polygon.
  if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') coords = [coords];

  var rings = [];
  for (var i = 0; i < coords.length; i++) {
    var ring = coords[i];
    if (!Array.isArray(ring) || ring.length < 3) continue;
    var clean = [];
    for (var j = 0; j < ring.length; j++) {
      var pt = ring[j];
      if (!Array.isArray(pt) || pt.length < 2) continue;
      var x = Number(pt[0]);
      var y = Number(pt[1]);
      if (!isFinite(x) || !isFinite(y)) continue;
      clean.push([x, y]);
    }
    if (clean.length >= 3) rings.push(clean);
  }
  return rings.length ? rings : null;
}
