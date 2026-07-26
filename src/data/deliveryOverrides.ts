// The "คำสั่งซื้อ" sheet is read-only, so a case that gets dropped or needs its
// delivery date pushed back can't be corrected in the source data. This is a
// local-only override layer: orderNo -> ISO delivery date (YYYY-MM-DD),
// applied on top of the sheet's own "วันที่จะจัดส่ง" wherever an effective
// delivery date is needed (route filters, planner day selection, dashboard
// forecast).

const STORAGE_KEY = 'warehouse-ops.deliveryOverrides.v1';

/** orderNo -> overridden delivery date, ISO YYYY-MM-DD. */
export type DeliveryOverrides = Record<string, string>;

export function loadDeliveryOverrides(): DeliveryOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as DeliveryOverrides) : {};
  } catch {
    return {};
  }
}

export function saveDeliveryOverrides(overrides: DeliveryOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable — keep in memory for this session */
  }
}
