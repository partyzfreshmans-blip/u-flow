// Per-order COD tracking for the route planner: how much of each COD order's
// expected amount has actually been collected, and whether it was settled in
// cash (owed back at clearing) or by transfer (already in the account). Kept
// separate from the mock COD-clearing page's own state, since this tracks the
// real routeOrders data route-by-route as vehicles go out.

const STORAGE_KEY = 'warehouse-ops.routeCod.v1';

/** How a COD order was settled at the door.
 *  - cash: driver is holding the money and owes it back at clearing.
 *  - transfer: already in the company account, nothing to hand back.
 *  - credit: the customer took the goods without paying yet, so there is no
 *    money in play now and none is owed back by the driver — it must not be
 *    counted into the cash reconciliation the way an unpaid cash row would.
 */
export type CodMethod = 'cash' | 'transfer' | 'credit';

export interface RouteCodState {
  /** orderNo -> amount actually collected, as typed (digits only). */
  collected: Record<string, string>;
  /** orderNo -> how it was settled. Defaults to cash when absent. */
  method: Record<string, CodMethod>;
}

const EMPTY: RouteCodState = { collected: {}, method: {} };

export function loadRouteCodState(): RouteCodState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    const p = parsed as Partial<RouteCodState>;
    return { collected: p.collected ?? {}, method: p.method ?? {} };
  } catch {
    return EMPTY;
  }
}

export function saveRouteCodState(state: RouteCodState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — keep in memory for this session */
  }
}
