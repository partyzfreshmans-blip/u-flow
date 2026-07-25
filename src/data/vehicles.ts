// Delivery vehicles used when planning a day's routes. Editable in the UI and
// persisted locally — the ops sheet names its trucks A / B / C / S, and the
// load-code prefix is tracked separately because in the real sheet a truck's
// load codes do not always use its own letter (truck B loads as C01…C13).

export interface Vehicle {
  id: string;
  /** Display name, e.g. "รถ A". */
  name: string;
  /** Prefix for ลำดับโหลด codes, e.g. "A" → A01, A02… */
  loadPrefix: string;
  /** How many people go out on this vehicle (driver included). */
  crew: number;
  /** Zone this vehicle usually covers; free text, matched to a zone's route. */
  zoneNote: string;
}

const STORAGE_KEY = 'warehouse-ops.vehicles.v1';

export const DEFAULT_VEHICLES: Vehicle[] = [
  { id: 'veh-a', name: 'รถ A', loadPrefix: 'A', crew: 2, zoneNote: 'D1 บ้านโฮ่ง ป่าซาง' },
  { id: 'veh-b', name: 'รถ B', loadPrefix: 'B', crew: 2, zoneNote: 'D2 ในชม. สันทราย' },
  { id: 'veh-c', name: 'รถ C', loadPrefix: 'C', crew: 2, zoneNote: 'D3 บ้านธิ สันกำแพง' },
  { id: 'veh-s', name: 'รถ S', loadPrefix: 'S', crew: 1, zoneNote: 'เสริม / Big Lot' },
];

export function loadVehicles(): Vehicle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VEHICLES;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VEHICLES;
    return parsed as Vehicle[];
  } catch {
    return DEFAULT_VEHICLES;
  }
}

export function saveVehicles(vehicles: Vehicle[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles));
  } catch {
    /* storage unavailable — keep in memory for this session */
  }
}

const PLAN_KEY = 'warehouse-ops.routePlan.v1';

/** vehicleId -> ordered list of order numbers (delivery sequence). */
export type RoutePlan = Record<string, string[]>;

export function loadRoutePlan(): RoutePlan {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as RoutePlan) : {};
  } catch {
    return {};
  }
}

export function saveRoutePlan(plan: RoutePlan): void {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Load codes run opposite to the delivery sequence: the first drop is loaded
 * last so it comes off the tailgate first. Matches the ops sheet, where a
 * 9-stop run reads A09 for stop 1 down to A01 for stop 9.
 */
export function loadCode(prefix: string, indexZeroBased: number, totalStops: number): string {
  const n = totalStops - indexZeroBased;
  return `${prefix}${String(n).padStart(2, '0')}`;
}
