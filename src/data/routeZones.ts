// Zone rules for auto-assigning a delivery route from the customer address.
//
// Province must come from the structured "อำเภอ, จังหวัด" column, never from
// the free-text address: several real customers in Lamphun have street names
// like "ถนนเชียงใหม่-ลำพูน" / "Chiang Mai-Lamphun Road", which would otherwise
// be misread as Chiang Mai and routed to B.
//
// The zone sub-districts below are ตำบล inside อำเภอเมืองลำพูน (except บ้านธิ,
// which is a full อำเภอ), so they usually appear only in the free-text address
// and have to be matched there.

export type ZoneRoute = 'A' | 'B';

export interface ZoneResult {
  route: ZoneRoute | null;
  /** Why this route was chosen — shown in the UI so a dispatcher can audit it. */
  reason: string;
}

interface Term {
  th: string;
  en: string;
}

const LAMPHUN: Term = { th: 'ลำพูน', en: 'lamphun' };
const CHIANG_MAI: Term = { th: 'เชียงใหม่', en: 'chiang mai' };

const ZONE_B_AREAS: Term[] = [
  { th: 'บ้านธิ', en: 'ban thi' },
  { th: 'มะเขือแจ้', en: 'makhuea chae' },
  { th: 'อุโมงค์', en: 'umong' },
  { th: 'บ้านกลาง', en: 'ban klang' },
];

function contains(haystack: string, term: Term): boolean {
  if (!haystack) return false;
  if (term.th && haystack.includes(term.th)) return true;
  return term.en ? haystack.toLowerCase().includes(term.en) : false;
}

/**
 * @param districtProvince the structured "อำเภอ, จังหวัด" value (authoritative)
 * @param freeTextAddress  the raw address, used only for sub-district matching
 */
export function resolveZoneRoute(districtProvince: string, freeTextAddress: string): ZoneResult {
  const structured = districtProvince ?? '';
  const full = `${structured} ${freeTextAddress ?? ''}`;

  const inLamphun = contains(structured, LAMPHUN);
  const inChiangMai = contains(structured, CHIANG_MAI);

  // Sub-district check may look at the free text, since ตำบล names are not in
  // the district column.
  const zoneHit = ZONE_B_AREAS.find((a) => contains(full, a));

  if (inLamphun && zoneHit) return { route: 'B', reason: `${zoneHit.th} + ลำพูน` };
  if (inChiangMai) return { route: 'B', reason: 'เชียงใหม่' };
  if (inLamphun) return { route: 'A', reason: 'ลำพูน' };

  // Provinces the rules do not cover (e.g. ลำปาง, อุบลราชธานี) are left
  // unassigned rather than guessed — a wrong route is worse than a blank one.
  const province = structured.split(',').pop()?.trim();
  return { route: null, reason: province ? `นอกพื้นที่ (${province})` : 'ไม่มีข้อมูลพื้นที่' };
}
