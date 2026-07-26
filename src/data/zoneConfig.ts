import { coordKey, type GeocodeCache, type GeocodeResult } from './geocodeCache';

// Editable delivery-zone rules.
//
// Rules are evaluated top-down and the first match wins, so put the most
// specific zone first. When a coordinate has been reverse-geocoded (see
// src/data/geocodeCache.ts), province/area terms are matched against the
// geocoded ตำบล/อำเภอ/จังหวัด — accurate regardless of how the sheet's
// free-text address was typed. Only orders with no coordinate yet (or whose
// geocode lookup hasn't completed/failed) fall back to the older method:
// province matched against the structured "อำเภอ, จังหวัด" column (never the
// free-text address: real Lamphun customers sit on roads named
// "ถนนเชียงใหม่-ลำพูน" / "Chiang Mai-Lamphun Road", and a naive text match
// sends them to the wrong zone), with area terms (ตำบล/อำเภอ names) searched
// in the free text since they're absent from the district column.

export interface ZoneRule {
  id: string;
  /** Display name, following the ops sheet's convention e.g. "D1 บ้านโฮ่ง ป่าซาง". */
  name: string;
  /** Marker colour on the map. */
  color: string;
  /** Which vehicle/route this zone normally goes out on. */
  route: string;
  /** Sub-district / area terms, any of which matches. Empty = match any area. */
  areaTerms: string[];
  /** Province terms, any of which matches. Empty = match any province. */
  provinceTerms: string[];
}

export interface ZoneMatch {
  zoneId: string | null;
  zoneName: string;
  color: string;
  route: string;
  reason: string;
  /** 'geocoded' when this came from a real reverse-geocoded coordinate,
   * 'text' when it fell back to guessing from the free-text address (no
   * coordinate yet, or the geocode lookup hasn't completed/failed). Shown in
   * the UI so staff know how much to trust a given row's zone. */
  source: 'geocoded' | 'text';
}

const STORAGE_KEY = 'warehouse-ops.zoneRules.v1';

// Seeded from the team's own zoning in the route-planning sheet, encoding the
// rules currently in use: the four listed sub-districts (plus Lamphun) and all
// of Chiang Mai go out on B; the rest of Lamphun goes on A.
export const DEFAULT_ZONE_RULES: ZoneRule[] = [
  {
    id: 'd3',
    name: 'D3 บ้านธิ สันกำแพง',
    color: '#f2b0d8',
    route: 'B',
    areaTerms: ['บ้านธิ', 'ban thi', 'มะเขือแจ้', 'makhuea chae', 'อุโมงค์', 'umong', 'บ้านกลาง', 'ban klang'],
    provinceTerms: ['ลำพูน', 'lamphun'],
  },
  {
    id: 'd2',
    name: 'D2 ในชม. สันทราย',
    color: '#8fb2ef',
    route: 'B',
    areaTerms: [],
    provinceTerms: ['เชียงใหม่', 'chiang mai'],
  },
  {
    id: 'd1',
    name: 'D1 บ้านโฮ่ง ป่าซาง',
    color: '#78e3ac',
    route: 'A',
    areaTerms: [],
    provinceTerms: ['ลำพูน', 'lamphun'],
  },
];

export const UNASSIGNED_COLOR = '#9397ab';

export function loadZoneRules(): ZoneRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ZONE_RULES;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ZONE_RULES;
    return parsed as ZoneRule[];
  } catch {
    return DEFAULT_ZONE_RULES;
  }
}

export function saveZoneRules(rules: ZoneRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* storage unavailable (private mode) — rules stay in memory for this session */
  }
}

function matchesAny(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const lower = haystack.toLowerCase();
  return terms.some((t) => {
    const term = t.trim();
    if (!term) return false;
    return haystack.includes(term) || lower.includes(term.toLowerCase());
  });
}

function matchRule(rules: ZoneRule[], areaHaystack: string, provinceHaystack: string): ZoneRule | null {
  for (const rule of rules) {
    if (!matchesAny(provinceHaystack, rule.provinceTerms)) continue;
    if (!matchesAny(areaHaystack, rule.areaTerms)) continue;
    return rule;
  }
  return null;
}

/** Legacy method: guesses the zone by searching the free-text address for
 * area terms and the structured district/province column for province terms.
 * Used only when a coordinate is missing or not yet (or never) geocoded. */
export function matchZone(rules: ZoneRule[], districtProvince: string, freeTextAddress: string): ZoneMatch {
  const structured = districtProvince ?? '';
  const areaHaystack = `${structured} ${freeTextAddress ?? ''}`;
  const rule = matchRule(rules, areaHaystack, structured);
  if (rule) return { zoneId: rule.id, zoneName: rule.name, color: rule.color, route: rule.route, reason: rule.name, source: 'text' };

  const province = structured.split(',').pop()?.trim();
  return {
    zoneId: null,
    zoneName: '—',
    color: UNASSIGNED_COLOR,
    route: '—',
    reason: province ? `นอกพื้นที่ (${province})` : 'ไม่มีข้อมูลพื้นที่',
    source: 'text',
  };
}

/** Preferred method: matches against a coordinate's real reverse-geocoded
 * ตำบล/อำเภอ/จังหวัด instead of guessing from free-text address wording. */
export function matchZoneGeocoded(rules: ZoneRule[], geocode: GeocodeResult): ZoneMatch {
  const areaHaystack = `${geocode.subdistrict} ${geocode.district}`;
  const rule = matchRule(rules, areaHaystack, geocode.province);
  if (rule) return { zoneId: rule.id, zoneName: rule.name, color: rule.color, route: rule.route, reason: rule.name, source: 'geocoded' };

  return {
    zoneId: null,
    zoneName: '—',
    color: UNASSIGNED_COLOR,
    route: '—',
    reason: geocode.province ? `นอกพื้นที่ (${geocode.province})` : 'ไม่มีข้อมูลพื้นที่',
    source: 'geocoded',
  };
}

/** Resolves an order's zone: uses its coordinate's geocode result when one
 * is already cached, otherwise falls back to the free-text guess — covers
 * orders with no coordinate at all, and ones whose geocode lookup hasn't
 * completed yet (or failed) while the rest of the batch is still running. */
export function resolveZone(
  rules: ZoneRule[],
  order: { lat: number | null; lng: number | null; districtProvince: string; addressFromUnii: string },
  geocodeCache: GeocodeCache,
): ZoneMatch {
  if (order.lat != null && order.lng != null) {
    const entry = geocodeCache[coordKey(order.lat, order.lng)];
    if (entry) return matchZoneGeocoded(rules, entry);
  }
  return matchZone(rules, order.districtProvince, order.addressFromUnii);
}
