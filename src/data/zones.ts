import { point } from '@turf/helpers';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';

// Delivery zones as real polygons drawn on a map, matched purely by
// coordinate — never by address text (Unii's free-text address/ตำบล data is
// unreliable; a road literally named "ถนนเชียงใหม่-ลำพูน" running through
// Lamphun was the whole reason the old text-matching system needed a
// hyphen-stripping workaround in the first place). Replaces the old
// areaTerms/provinceTerms rule system in what used to be this file.

export interface Zone {
  id: string;
  /** Display name, following the ops sheet's convention e.g. "D1 บ้านโฮ่ง ป่าซาง". */
  name: string;
  /** Marker/polygon colour on the map. */
  color: string;
  /** Vehicle this zone is normally covered by — a Vehicle.id, or '' if not
   * yet linked to one. Stored by id (not name) so renaming a vehicle never
   * silently breaks the link. */
  vehicleId: string;
  /** Zones can be defined but temporarily switched off without deleting
   * them (e.g. seasonal coverage, a zone still being drawn). */
  active: boolean;
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export const UNASSIGNED_COLOR = '#9397ab';

/** Result of resolving a coordinate against the zone list — mirrors the old
 * ZoneMatch shape closely enough that downstream badge/legend code barely
 * has to change, but zoneId is null (never a guessed reason string) whenever
 * nothing actually contains the point. */
export interface ZoneMatch {
  zoneId: string | null;
  zoneName: string;
  color: string;
  vehicleId: string;
}

const NO_MATCH: ZoneMatch = { zoneId: null, zoneName: '—', color: UNASSIGNED_COLOR, vehicleId: '' };

/**
 * Resolves a coordinate to the first active zone (in list order — order IS
 * priority, same "first match wins, put the most specific on top" rule the
 * old text-based system used) whose polygon contains it. Returns the
 * explicit "ยังไม่ได้จัด" (unassigned) result — never a guess — when the
 * coordinate is missing or falls outside every active polygon, so a stop
 * with no zone is always visibly flagged rather than silently mis-routed.
 */
export function pointZone(zones: Zone[], lat: number | null, lng: number | null): ZoneMatch {
  if (lat == null || lng == null) return NO_MATCH;
  const pt = point([lng, lat]);
  for (const z of zones) {
    if (!z.active) continue;
    try {
      if (booleanPointInPolygon(pt, z.polygon)) {
        return { zoneId: z.id, zoneName: z.name, color: z.color, vehicleId: z.vehicleId };
      }
    } catch {
      // A malformed polygon (e.g. mid-edit with < 3 vertices) shouldn't
      // crash zone resolution for every other order on the page — just
      // treat it as not containing anything yet.
    }
  }
  return NO_MATCH;
}

/**
 * Migration seed — rough, hand-placed quadrilaterals approximating the
 * team's original four zones, NOT sourced from any real GIS boundary.
 * Deliberately coarse: the point of drawing zones on a map is that staff can
 * drag the actual edges into shape afterward, which is exactly the plan here
 * (only ever used to seed the brand-new Zones sheet tab the first time it's
 * created — never re-applied over real edits).
 */
export const MIGRATION_SEED_ZONES: Zone[] = [
  {
    id: 'd3',
    name: 'D3 บ้านธิ สันกำแพง',
    color: '#f2b0d8',
    vehicleId: '',
    active: true,
    // Ban Thi (Lamphun) / San Kamphaeng (Chiang Mai) corridor, east of the
    // Chiang Mai–Lamphun urban core.
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [99.05, 18.80],
        [99.22, 18.80],
        [99.22, 18.65],
        [99.05, 18.65],
        [99.05, 18.80],
      ]],
    },
  },
  {
    id: 'd2',
    name: 'D2 ในชม. สันทราย',
    color: '#8fb2ef',
    vehicleId: '',
    active: true,
    // San Sai district, north of Chiang Mai city.
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [98.93, 18.92],
        [99.12, 18.92],
        [99.12, 18.75],
        [98.93, 18.75],
        [98.93, 18.92],
      ]],
    },
  },
  {
    id: 'd1',
    name: 'D1 บ้านโฮ่ง ป่าซาง',
    color: '#78e3ac',
    vehicleId: '',
    active: true,
    // South Lamphun — Pa Sang / Ban Hong.
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [98.73, 18.46],
        [98.97, 18.46],
        [98.97, 18.28],
        [98.73, 18.28],
        [98.73, 18.46],
      ]],
    },
  },
  {
    id: 'biglot',
    name: 'BigLot',
    color: '#daaa53',
    vehicleId: '',
    // Overflow/supplementary route, not a fixed geographic area — seeded
    // inactive with a tiny placeholder polygon so it exists in the list
    // without silently swallowing pins that belong to a real zone below it.
    active: false,
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [98.98, 18.79],
        [98.99, 18.79],
        [98.99, 18.78],
        [98.98, 18.78],
        [98.98, 18.79],
      ]],
    },
  },
];
