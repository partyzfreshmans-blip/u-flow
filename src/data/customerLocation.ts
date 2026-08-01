import type { CsMasterCustomer, RouteOrder } from './types';

// Single source of truth for "which coordinate is actually correct for this
// customer" — a manually-corrected pin (saved via the Customer Master page's
// own "แก้พิกัด" editor, or the Planner's per-order "แก้ไขโลเคชั่น" dialog,
// both of which write straight back to the CS Master sheet's own lat/lng
// columns, keyed by phone — see csMasterWrite.ts) always wins over the
// CS_Lat/CS_Long the คำสั่งซื้อ sheet carries, which is raw, unverified data
// straight from the order source and never gets corrected in place. Every
// page that plots a pin, computes a distance, links out to Google Maps
// navigation, or feeds a coordinate into reverse-geocoding should resolve
// through here instead of reading RouteOrder.lat/lng directly, so a fix made
// once shows up everywhere at once.
//
// Matched by phone alone, not name+phone — a customer's shop name can be
// renamed at any time (this actually happens), and phone is the sheet's
// real, stable identity. Keying on name as well used to silently break this
// lookup whenever a renamed customer's order carried the new name but the
// saved override was still indexed under the old one.

export type CustomerLocationSource = 'override' | 'unii';

export interface ResolvedCustomerLocation {
  lat: number | null;
  lng: number | null;
  source: CustomerLocationSource;
}

/** Same normalization the CS Master write-back backend uses to match a
 * customer by phone (see server/lib.ts's own phoneKey) — last 9 digits,
 * ignoring formatting, so "081-234-5678" and "0812345678" match. Keeping
 * this identical to the write-side match means a coordinate saved through
 * either edit flow is always found by the same key it was saved under. */
function phoneKey(v: string): string {
  return v.replace(/\D/g, '').slice(-9);
}

/** Indexes every CS Master row that actually has a coordinate saved, keyed by
 * phone — built once per resolve pass rather than scanning the whole
 * customers array per order. */
export function buildCustomerLocationOverrideIndex(customers: CsMasterCustomer[]): Map<string, { lat: number; lng: number }> {
  const map = new Map<string, { lat: number; lng: number }>();
  for (const c of customers) {
    if (c.lat == null || c.lng == null) continue;
    map.set(phoneKey(c.phone), { lat: c.lat, lng: c.lng });
  }
  return map;
}

/** Resolves one customer's real, current coordinate given an already-built
 * override index (see buildCustomerLocationOverrideIndex) — falls back to
 * the raw Unii coordinate only when this customer has never been corrected. */
export function resolveCustomerLocation(
  customer: { customer: string; phone: string; lat: number | null; lng: number | null },
  overrideIndex: Map<string, { lat: number; lng: number }>,
): ResolvedCustomerLocation {
  const override = overrideIndex.get(phoneKey(customer.phone));
  if (override) return { lat: override.lat, lng: override.lng, source: 'override' };
  return { lat: customer.lat, lng: customer.lng, source: 'unii' };
}

/** Applies resolveCustomerLocation across a whole routeOrders array, returning
 * a new array with lat/lng replaced by the resolved coordinate (plus a
 * locationSource flag alongside, for any UI that wants to show an "edited"
 * badge) — every other field is passed through unchanged. Everything
 * downstream (zone matching, distance-from-warehouse, map pins, Google Maps
 * links, reverse-geocode input) reads this resolved array instead of
 * state.routeOrders directly, so the override applies in one place rather
 * than at every individual call site. */
export function resolveRouteOrderLocations(
  routeOrders: RouteOrder[],
  customers: CsMasterCustomer[],
): (RouteOrder & { locationSource: CustomerLocationSource })[] {
  const overrideIndex = buildCustomerLocationOverrideIndex(customers);
  return routeOrders.map((o) => {
    const resolved = resolveCustomerLocation(o, overrideIndex);
    return { ...o, lat: resolved.lat, lng: resolved.lng, locationSource: resolved.source };
  });
}
