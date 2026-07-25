// Editable delivery-zone rules.
//
// Rules are evaluated top-down and the first match wins, so put the most
// specific zone first. Province is matched against the structured
// "อำเภอ, จังหวัด" value, never the free-text address: real Lamphun customers
// sit on roads named "ถนนเชียงใหม่-ลำพูน" / "Chiang Mai-Lamphun Road", and a
// naive text match sends them to the wrong zone. Area terms (ตำบล/อำเภอ names)
// do search the free text, since they are absent from the district column.

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

export function matchZone(rules: ZoneRule[], districtProvince: string, freeTextAddress: string): ZoneMatch {
  const structured = districtProvince ?? '';
  const areaHaystack = `${structured} ${freeTextAddress ?? ''}`;

  for (const rule of rules) {
    const provinceOk = matchesAny(structured, rule.provinceTerms);
    if (!provinceOk) continue;
    if (!matchesAny(areaHaystack, rule.areaTerms)) continue;
    const why = rule.areaTerms.length > 0 ? `${rule.name}` : `${rule.name}`;
    return { zoneId: rule.id, zoneName: rule.name, color: rule.color, route: rule.route, reason: why };
  }

  const province = structured.split(',').pop()?.trim();
  return {
    zoneId: null,
    zoneName: '—',
    color: UNASSIGNED_COLOR,
    route: '—',
    reason: province ? `นอกพื้นที่ (${province})` : 'ไม่มีข้อมูลพื้นที่',
  };
}
