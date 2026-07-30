import type { CSSProperties } from 'react';
import { orders } from '../data/mockData';
import type { PickLot } from '../data/pickLots';
import { PROMO_UNITS, type ApiImportOrder, type Order, type OrderLineItem, type Promo, type PromoPackUnit, type PromoUnit, type RouteOrder } from '../data/types';
import { lineDiff, lineNetTotal, receivingFolderKey, recordHasDiscrepancy, recordTotal, type ReceivingLine, type ReceivingRecord } from '../data/receiving';
import { loadCode } from '../data/vehicles';
import { nextBatchId, type BatchRoute } from '../data/batchRoutes';
import { resolveZone, UNASSIGNED_COLOR } from '../data/zoneConfig';
import { coordKey, type GeocodeCache } from '../data/geocodeCache';
import { resolveRouteOrderLocations } from '../data/customerLocation';
import { avgPricePerPiece, detectUnit } from '../data/sources/promotionsSheet';
import { addDays, dayKey, dayKeyToDate, daysBetweenKeys, formatOrderedAt, formatThaiShortDate, formatThaiWeekdayDate, sheetDateTimeToMs, sheetDateToDayKey, suggestedDeliveryDayKey, todayDayKey } from '../data/dateUtils';
import { badgeStyle, DELIVERED_STATUSES, DELIVERY_DONE_STATUSES, fmt, ORDER_RESOLVED_FOR_BATCH_STATUSES, sheetStatusStyle } from './helpers';
import { canBookStop, canCancelBatchRoute, canCancelPickLot, canClosePickLot, canDecideBooking, canEditOrder, canEditPlan, canManageUsers, canPickWork, ROLES, ROLE_LABELS, seesAllActivityLog } from '../config/permissions';
import type { BookingRow } from '../data/sources/bookingsApi';
import type { AppActions, AppState } from './store';

/** Delivery date, straight off the "คำสั่งซื้อ" sheet — edits go through
 * saveOrderEdit and only land in state.routeOrders once the sheet write
 * actually succeeds, so this value is always the real, current one. Exported
 * so store.ts can apply the same no-delivery-date gate defensively inside
 * createPickLot, without duplicating the date-parsing logic. */
export function effectiveDeliveryDayKey(o: RouteOrder): string | null {
  return sheetDateToDayKey(o.plannedDeliveryDate);
}

/** Orders already permanently owned by some Batch Route (any vehicle, any
 * delivery date) must never simultaneously reappear as a vehicle's own live,
 * unassigned routePlan draft on a different date — that's exactly how a
 * just-assigned batch's stops used to leak into every other date once its
 * vehicle's routePlan entry was left stale after Assign. Exported so the
 * self-healing filter can be unit-tested without deriving full app state. */
export function filterOutBatchedOrderNos(orderNos: string[], batchRoutes: BatchRoute[]): string[] {
  if (batchRoutes.length === 0 || orderNos.length === 0) return orderNos;
  const batched = new Set<string>();
  for (const b of batchRoutes) {
    if (b.cancelled) continue;
    for (const no of b.orderNos) batched.add(no);
  }
  return orderNos.filter((no) => !batched.has(no));
}

/** Per-vehicle distinguishing colour (route lines, name swatch) — separate
 * from zone colour, since one vehicle's stops can span several zones. */
const VEHICLE_PALETTE = ['#5b8ff9', '#61ddaa', '#f6bd16', '#e8684a', '#6dc8ec', '#9270ca', '#ff9d4d', '#269a99', '#ff99c3', '#daaa53'];

/** Per-order quantity broken down into the three units warehouse staff
 * actually load by (ชิ้น/แพ็ค/ลัง) — หีบ and คู่ fold into ลัง/ชิ้น
 * respectively since they're the same real-world unit under a different
 * sheet spelling (see detectUnit's own regexes for why). */
function buildOrderUnitQtyMap(orderLineItems: OrderLineItem[]): Map<string, Partial<Record<'ชิ้น' | 'แพ็ค' | 'ลัง', number>>> {
  const map = new Map<string, Partial<Record<'ชิ้น' | 'แพ็ค' | 'ลัง', number>>>();
  for (const li of orderLineItems) {
    const detected = detectUnit(li.unit);
    const bucket = detected === 'หีบ' ? 'ลัง' : detected === 'คู่' ? 'ชิ้น' : detected;
    const m = map.get(li.orderNo) ?? {};
    m[bucket] = (m[bucket] ?? 0) + li.qty;
    map.set(li.orderNo, m);
  }
  return map;
}

function qtyTextForOrder(map: Map<string, Partial<Record<'ชิ้น' | 'แพ็ค' | 'ลัง', number>>>, orderNo: string): string {
  const m = map.get(orderNo);
  if (!m) return '—';
  const parts = (['ชิ้น', 'แพ็ค', 'ลัง'] as const).map((u) => (m[u] ? `${m[u]!.toLocaleString('en-US')} ${u}` : null)).filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** "อำเภอ, จังหวัด" display value for the Order Management table — prefers a
 * real reverse-geocoded result (see src/data/geocodeCache.ts) off the same
 * coordinate/cache the zone matcher already reads, since that's more
 * accurate than whatever the sheet's own column carries; falls back to that
 * sheet column when no geocode is cached yet, then "-" if that's blank too. */
function districtProvinceLabel(order: { lat: number | null; lng: number | null; districtProvince: string }, geocodeCache: GeocodeCache): string {
  if (order.lat != null && order.lng != null) {
    const entry = geocodeCache[coordKey(order.lat, order.lng)];
    if (entry && (entry.district.trim() || entry.province.trim())) {
      return [entry.district.trim(), entry.province.trim()].filter(Boolean).join(', ');
    }
  }
  return order.districtProvince.trim() || '-';
}

/** Orders whose delivery date has already passed without reaching a done
 * status — shared by the dashboard's own "ออเดอร์ตกหล่น" panel and the
 * notification bell's standing-condition items. */
function stuckRouteOrders(state: AppState, today: string): RouteOrder[] {
  return state.routeOrders.filter((o) => {
    if (o.archived) return false;
    const key = effectiveDeliveryDayKey(o);
    if (!key || key >= today) return false;
    return !DELIVERY_DONE_STATUSES.includes(o.status);
  });
}

/** Stuck orders (see stuckRouteOrders above, narrowed to
 * ORDER_RESOLVED_FOR_BATCH_STATUSES — see that constant's comment for why
 * "ส่งไม่สำเร็จ" is excluded here but not from the general stuck-order
 * view) that are STILL sitting in some live Batch Route's manifest — the
 * "driver never touched this stop before their delivery day ended" case
 * store.ts's autoDetachStuckOrder acts on. An order that was simply never
 * assigned to any vehicle at all doesn't need this — it's already just
 * "unassigned," nothing to detach. */
export function ordersNeedingStuckBatchDetach(state: AppState, today: string): { orderNo: string; batch: BatchRoute }[] {
  const batchByOrderNo = new Map<string, BatchRoute>();
  for (const b of state.batchRoutes) {
    if (b.cancelled) continue;
    for (const no of b.orderNos) batchByOrderNo.set(no, b);
  }
  const out: { orderNo: string; batch: BatchRoute }[] = [];
  for (const o of stuckRouteOrders(state, today)) {
    if (ORDER_RESOLVED_FOR_BATCH_STATUSES.includes(o.status)) continue;
    const batch = batchByOrderNo.get(o.orderNo);
    if (batch) out.push({ orderNo: o.orderNo, batch });
  }
  return out;
}

/** How many days an order can sit at "รอชำระเงิน" before the bell flags it —
 * measured from its last update (or order date if that's blank). */
const PAYMENT_OVERDUE_DAYS = 2;
function overduePaymentOrders(state: AppState, today: string): ApiImportOrder[] {
  return state.apiOrders.filter((o) => {
    if (o.status !== 'รอชำระเงิน') return false;
    const key = sheetDateToDayKey(o.updatedAt || o.orderedAt);
    if (!key) return false;
    return daysBetweenKeys(key, today) >= PAYMENT_OVERDUE_DAYS;
  });
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatThaiShortDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** True when the sheet's payment-type text indicates a cash-on-delivery order. */
function isCodPayment(paymentType: string): boolean {
  const p = paymentType.toLowerCase();
  return p.includes('cash on delivery') || p.includes('cod') || paymentType.includes('เก็บเงินปลายทาง') || paymentType.includes('ปลายทาง');
}

// COD clearing is still local/mock (out of scope for the sheets migration).
export const orderById: Record<string, Order> = {};
orders.forEach((o) => (orderById[o.id] = o));

export const pageTitles: Record<AppState['route'], [string, string]> = {
  dashboard: ['แดชบอร์ด / ออเดอร์ใหม่', 'ออเดอร์ล่าสุดที่ยังไม่ได้จัดเส้นทาง · จาก Google Sheet (API Import)'],
  route: ['จัดการออเดอร์', 'ข้อมูลจริงจาก Google Sheet (คำสั่งซื้อ VS) · แก้ไขวันที่จัดส่ง/หมายเหตุ/ใบกำกับภาษีแล้วบันทึกกลับชีทได้'],
  planner: ['วางแผนจัดรูท', 'จัดออเดอร์ลงรถ · เรียงลำดับส่งจากไกลไปใกล้คลัง · ออกลำดับโหลด'],
  // App.tsx renders DriverPage full-screen before this map is ever read for
  // 'driver' — this entry only exists to satisfy the Record type.
  driver: ['มุมมองคนขับ', 'ใบจัดรูทมือถือรายคัน'],
  pick: ['Batch picking / จัดล็อตหยิบสินค้า', 'รวมหลายออเดอร์เป็นล็อตเดียว หยิบสินค้าตามตำแหน่งเก็บ'],
  cod: ['เคลียร์เงินปลายทาง (COD)', 'เทียบยอดที่ควรเก็บกับยอดคืนจริงต่อ driver'],
  promo: ['โปรโมชั่น / ส่วนลด', 'โปรโมชั่นที่ Active จาก Google Sheet · สร้าง/แก้ไขแล้วบันทึกกลับชีทได้'],
  grn: ['รับสินค้าเข้าคลัง (Goods Receiving)', 'บันทึกของเข้าจากซัพพลายเออร์ · เทียบจำนวนกับบิล · แนบไฟล์บิลขึ้น Drive'],
  sku: ['ฐานข้อมูลสินค้า (SKU master)', 'ทะเบียนสินค้าทั้งหมดในระบบ'],
  customer: ['ฐานข้อมูลลูกค้า (CS Master)', 'แก้ไขพิกัด lat/long แล้วบันทึกกลับเข้า Google Sheet จริง'],
  activity: ['บันทึกการเปลี่ยนแปลง (Activity Log)', 'ประวัติการแก้ไขทั้งหมดในระบบ · เก็บไว้ในเครื่องนี้'],
  settings: ['ตั้งค่า / API Key', 'จัดการการเชื่อมต่อระบบออเดอร์ภายนอก'],
  users: ['จัดการผู้ใช้', 'สร้าง แก้ไข role และปิดใช้งานบัญชีผู้ใช้'],
};

// ---------- DASHBOARD ("API Import" tab) ----------
const dashboardStatusOrder = ['รอยืนยันออเดอร์', 'กำลังดำเนินการ', 'รอชำระเงิน', 'ได้รับแล้ว', 'ยกเลิก'];

export function computeDashboard(state: AppState, actions: AppActions) {
  const q = state.q.trim().toLowerCase();
  // apiOrders (the "API Import" tab) has no archive flag of its own — cross
  // reference against routeOrders (the "คำสั่งซื้อ" tab) by orderUid/orderNo,
  // the same join every other cross-tab lookup on this page already uses.
  const archivedOrderNos = new Set(state.routeOrders.filter((o) => o.archived).map((o) => o.orderNo));
  const list = state.apiOrders.filter((o) => {
    if (archivedOrderNos.has(o.orderUid)) return false;
    if (state.statusFilter !== 'all' && o.status !== state.statusFilter) return false;
    if (q && !(o.customer.toLowerCase().includes(q) || o.orderUid.toLowerCase().includes(q) || o.phone.includes(q))) return false;
    return true;
  });

  const orderUnitQty = buildOrderUnitQtyMap(state.orderLineItems);

  // Cash/transfer collection status, entered by the driver on the mobile
  // Driver View page (or by an admin from the Planner's own COD panel) — see
  // routeCodCollected/routeCodMethod. Transfers are already in the company
  // account so they're never checked against the order total; cash is
  // flagged short/over/exact by comparing what was actually collected.
  const codInfoFor = (o: (typeof list)[number]) => {
    if (!isCodPayment(o.paymentType)) return null;
    const method = state.routeCodMethod[o.orderUid];
    const collected = state.routeCodCollected[o.orderUid];
    if (!method) return { label: 'ยังไม่บันทึก', style: badgeStyle('neutral') };
    if (method === 'transfer') return { label: 'โอนแล้ว', style: badgeStyle('info') };
    const collectedNum = Number(collected || 0);
    if (!collected) return { label: 'เก็บสด · ยังไม่ระบุยอด', style: badgeStyle('warn') };
    if (collectedNum === o.totalAmount) return { label: 'เก็บสดครบ', style: badgeStyle('ok') };
    if (collectedNum < o.totalAmount) return { label: `เก็บสดขาด ${fmt(o.totalAmount - collectedNum)}`, style: badgeStyle('bad') };
    return { label: `เก็บสดเกิน +${fmt(collectedNum - o.totalAmount)}`, style: badgeStyle('warn') };
  };

  const rows = list.map((o) => ({
    orderUid: o.orderUid,
    cust: o.customer,
    phone: o.phone,
    addr: [o.address, o.district, o.province].filter(Boolean).join(' · '),
    items: o.itemCount,
    qtyText: qtyTextForOrder(orderUnitQty, o.orderUid),
    amtText: fmt(o.totalAmount),
    paymentType: o.paymentType,
    paid: o.paid,
    orderedAt: formatOrderedAt(o.orderedAt),
    // Stage timeline: only the stages that actually have a timestamp show up,
    // so an order still mid-pipeline doesn't display a row of blank dashes.
    stages: [
      { label: 'สั่งซื้อ', text: o.orderedAt ? formatOrderedAt(o.orderedAt) : '' },
      { label: 'จัดส่ง', text: o.deliveredAt ? formatOrderedAt(o.deliveredAt) : '' },
      { label: 'สำเร็จ', text: o.completedAt ? formatOrderedAt(o.completedAt) : '' },
      { label: 'อัปเดตล่าสุด', text: o.updatedAt ? formatOrderedAt(o.updatedAt) : '' },
    ].filter((s) => s.text !== ''),
    stLabel: o.status || '—',
    stStyle: sheetStatusStyle(o.status),
    wantsTax: o.wantsTaxInvoice,
    codInfo: codInfoFor(o),
    viewItems: () => actions.openOrderDetail(o.orderUid, o.customer, state.routeOrders.find((r) => r.orderNo === o.orderUid)),
  }));

  const visibleApiOrders = state.apiOrders.filter((o) => !archivedOrderNos.has(o.orderUid));
  const cnt = (s: string) => visibleApiOrders.filter((o) => s === 'all' || o.status === s).length;
  const presentStatuses = dashboardStatusOrder.filter((s) => visibleApiOrders.some((o) => o.status === s));
  const chipBase: CSSProperties = { border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: '6px 13px', borderRadius: 20, fontWeight: 500 };
  const statusChips = ['all', ...presentStatuses].map((k) => ({
    key: k,
    label: k === 'all' ? 'ทั้งหมด' : k,
    count: cnt(k),
    style:
      k === state.statusFilter
        ? { ...chipBase, background: 'var(--color-accent)', color: '#fff' }
        : { ...chipBase, background: 'var(--color-surface)', color: 'var(--color-neutral-300)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' },
    go: () => actions.patch({ statusFilter: k }),
  }));

  // Tiles 1 & 4 track whatever's currently filtered/searched (matching tile
  // 4's own subtitle, which already promised "orders currently shown" even
  // though the number behind it used to ignore the filter entirely); tiles 2
  // & 3 stay fixed per-status reference counts regardless of the active tab.
  const isFiltered = state.statusFilter !== 'all' || q !== '';
  const filteredValue = list.reduce((a, o) => a + o.totalAmount, 0);
  const stats = [
    {
      label: isFiltered ? `ออเดอร์ · ${state.statusFilter === 'all' ? 'ตามคำค้นหา' : state.statusFilter}` : 'ออเดอร์ใหม่ทั้งหมด',
      value: String(list.length),
      sub: isFiltered ? 'ตามตัวกรองที่เลือก' : 'ยังไม่ได้จัดเส้นทาง',
      icon: 'ph ph-package',
      iconColor: 'var(--color-accent-300)',
    },
    { label: 'รอยืนยันออเดอร์', value: String(cnt('รอยืนยันออเดอร์')), sub: 'ต้องยืนยัน', icon: 'ph ph-hourglass-medium', iconColor: 'var(--st-warn-fg)' },
    { label: 'กำลังดำเนินการ', value: String(cnt('กำลังดำเนินการ')), sub: 'อยู่ระหว่างจัดของ', icon: 'ph ph-truck', iconColor: 'var(--st-info-fg)' },
    { label: 'มูลค่ารวม', value: fmt(filteredValue), sub: isFiltered ? 'ตามตัวกรองที่เลือก' : 'ออเดอร์ที่แสดงทั้งหมด', icon: 'ph ph-wallet', iconColor: 'var(--st-ok-fg)' },
  ];

  // ---- 7-day delivery forecast (from routeOrders — the tab with delivery dates) ----
  const today = todayDayKey();
  const assignedOrderNos = new Set(Object.values(state.routePlan).flat());
  const forecastStatusOptions = Array.from(new Set(state.routeOrders.map((o) => o.status).filter(Boolean))).sort();

  // ---- Daily Performance: today's sales vs yesterday's, from the same
  // "คำสั่งซื้อ" tab's own วันที่สั่ง (orderedDate) column every date filter
  // elsewhere on this page already reads. ----
  const yesterdayKey = dayKey(addDays(dayKeyToDate(today)!, -1));
  const salesTotalFor = (dayK: string) =>
    state.routeOrders.filter((o) => !o.archived && sheetDateToDayKey(o.orderedDate) === dayK).reduce((sum, o) => sum + o.totalAmount, 0);
  const todaySalesTotal = salesTotalFor(today);
  const yesterdaySalesTotal = salesTotalFor(yesterdayKey);
  const salesChangePct = yesterdaySalesTotal > 0 ? ((todaySalesTotal - yesterdaySalesTotal) / yesterdaySalesTotal) * 100 : null;
  const dailyPerformance = {
    totalSalesText: fmt(todaySalesTotal),
    // null (no valid yesterday base to compare against) reads as "ใหม่" — a
    // literal 0% would misleadingly claim "no change" when there's simply
    // nothing to divide by.
    salesChangeText: salesChangePct == null ? (todaySalesTotal > 0 ? 'ใหม่' : '—') : `${salesChangePct >= 0 ? '+' : ''}${salesChangePct.toFixed(1)}%`,
    salesChangeColor: salesChangePct == null ? 'var(--color-neutral-500)' : salesChangePct >= 0 ? 'var(--st-ok-fg)' : 'var(--st-bad-fg)',
    incompleteCount: stuckRouteOrders(state, today).length,
  };

  // ---- Operational Status: fleet availability from the same vehicles/batch
  // data the Planner and Batch Route history already read. Warehouse
  // Capacity has no backing data anywhere in this system (no stock/space
  // field on any sheet) — skipped rather than shown with a made-up number;
  // see the summary for what a real implementation would need. ----
  const resolvedForBatches = resolveRouteOrderLocations(state.routeOrders, state.customers);
  const byOrderNoForBatches = new Map(resolvedForBatches.map((o) => [o.orderNo, o]));
  // A batch is "active" while it isn't closed out on COD and still has at
  // least one order that hasn't reached a done status — the same two facts
  // the COD Clearing and Batch Route History pages already track per batch.
  const activeBatches = state.batchRoutes.filter((b) => {
    if (b.codClosed || b.cancelled) return false;
    const deliveredCount = b.orderNos.filter((no) => DELIVERY_DONE_STATUSES.includes(byOrderNoForBatches.get(no)?.status ?? '')).length;
    return deliveredCount < b.orderNos.length;
  });
  const busyVehicleIds = new Set(activeBatches.map((b) => b.vehicleId));
  const operationalStatus = {
    fleetTotal: state.vehicles.length,
    fleetAvailable: Math.max(0, state.vehicles.length - busyVehicleIds.size),
  };

  // ---- Active Delivery Batches: one card per batch still in progress,
  // plus their combined pins on the same Leaflet map the Planner uses. ----
  const activeBatchCards = activeBatches
    .map((b) => {
      const orders = b.orderNos.map((no) => byOrderNoForBatches.get(no)).filter((o): o is NonNullable<typeof o> => o != null);
      return {
        id: b.id,
        vehicleName: b.vehicleName,
        orderCount: b.orderNos.length,
        totalText: fmt(orders.reduce((sum, o) => sum + o.totalAmount, 0)),
        // No separate "left the warehouse" timestamp exists anywhere in this
        // system — the batch's own createdAt (when it was Assigned) is the
        // closest real fact and doubles as that fallback per spec.
        departedAtText: formatDateTime(new Date(b.createdAt).getTime()),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const whForBatches = resolvedForBatches.find((o) => o.whLat != null && o.whLng != null);
  const warehouseForBatches = whForBatches && whForBatches.whLat != null && whForBatches.whLng != null ? { lat: whForBatches.whLat, lng: whForBatches.whLng } : null;
  const rawActiveBatchStops = activeBatches.flatMap((b) => {
    const vehicleIdx = state.vehicles.findIndex((v) => v.id === b.vehicleId);
    const color = VEHICLE_PALETTE[(vehicleIdx < 0 ? 0 : vehicleIdx) % VEHICLE_PALETTE.length];
    return b.orderNos
      .map((no) => byOrderNoForBatches.get(no))
      .filter((o): o is NonNullable<typeof o> => o != null && o.lat != null && o.lng != null)
      .map((o) => ({
        id: o.orderNo,
        lat: o.lat as number,
        lng: o.lng as number,
        label: o.customer,
        status: '',
        color,
        zoneName: `${b.vehicleName} · ${b.id}`,
        pinLabel: null as string | null,
        vehicleId: b.vehicleId as string | null,
      }));
  });
  const { kept: activeBatchMapStops } = rejectOutlierStops(rawActiveBatchStops, warehouseForBatches);

  // ---- Incomplete Orders: same stuck-order set the Order Management page's
  // own "ออเดอร์ตกหล่น" table already shows, just reused here for a
  // dashboard-level glance + a link to the full list. ----
  const incompleteOrders = stuckRouteOrders(state, today)
    .map((o) => {
      const key = effectiveDeliveryDayKey(o)!;
      return {
        orderNo: o.orderNo,
        customer: o.customer,
        daysLate: Math.abs(daysBetweenKeys(key, today)),
        stLabel: o.status || '—',
        stStyle: sheetStatusStyle(o.status),
        viewItems: () => actions.openOrderDetail(o.orderNo, o.customer, o),
      };
    })
    .sort((a, b) => b.daysLate - a.daysLate);

  const forecastDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(dayKeyToDate(today)!, i);
    const key = dayKey(d);
    const ordersOnDay = state.routeOrders.filter((o) => {
      if (o.archived) return false;
      if (state.forecastStatusFilter !== 'all' && o.status !== state.forecastStatusFilter) return false;
      return effectiveDeliveryDayKey(o) === key;
    });
    const routedCount = ordersOnDay.filter((o) => assignedOrderNos.has(o.orderNo)).length;
    const notRoutedCount = ordersOnDay.length - routedCount;
    return {
      dayKey: key,
      label: formatThaiWeekdayDate(d),
      isToday: key === today,
      count: ordersOnDay.length,
      routedCount,
      notRoutedCount,
      fullyRouted: ordersOnDay.length > 0 && notRoutedCount === 0,
    };
  });

  return {
    apiOrdersLoading: state.apiOrdersLoading,
    apiOrdersError: state.apiOrdersError,
    dashboardTab: state.dashboardTab,
    setDashboardTab: (tab: 'overview' | 'calendar') => actions.patch({ dashboardTab: tab }),
    q: state.q,
    onSearch: (v: string) => actions.patch({ q: v }),
    resultCount: list.length,
    noOrders: list.length === 0,
    orders: rows,
    stats,
    statusChips,
    forecastDays,
    forecastStatusFilter: state.forecastStatusFilter,
    forecastStatusOptions,
    dailyPerformance,
    operationalStatus,
    activeBatchCards,
    activeBatchMapStops,
    warehouseForBatches,
    incompleteOrders,
    incompleteCount: incompleteOrders.length,
    goToIncompleteOrders: () => actions.patch({ route: 'route' }),
    onForecastStatusFilter: (v: string) => actions.patch({ forecastStatusFilter: v }),
  };
}

// ---------- NOTIFICATIONS (header bell) ----------
export function computeNotifications(state: AppState, actions: AppActions) {
  const today = todayDayKey();
  const role = state.session?.role;

  // A stuck-detach alert stays "active" only while its order hasn't been
  // picked back up into some batch yet — once reassigned, it's off the
  // truck-manifest problem this alert exists for, so it clears itself
  // rather than nagging forever. Targeted at Picker/Checker/Admin Staff
  // specifically, per the "who needs to physically pull it off the truck"
  // reasoning — everyone else already sees the underlying order via the
  // general stuck-order item above.
  const stillBatchedOrderNos = new Set(state.batchRoutes.filter((b) => !b.cancelled).flatMap((b) => b.orderNos));
  const seesStuckDetachAlerts = role === 'picker' || role === 'checker' || role === 'admin_staff';

  // Standing-condition items recompute fresh from current data every render
  // (no persisted "it happened" record needed — they're just currently-true
  // facts) — but get a stable id so read/unread state survives recomputation.
  const liveItems = [
    ...stuckRouteOrders(state, today).map((o) => {
      const key = effectiveDeliveryDayKey(o)!;
      return {
        id: `stuck-${o.orderNo}`,
        kind: 'stuck-order' as const,
        message: `ออเดอร์ ${o.orderNo} (${o.customer}) เลยวันจัดส่งแล้ว ${Math.abs(daysBetweenKeys(key, today))} วัน แต่ยังไม่สำเร็จ`,
        createdAt: dayKeyToDate(key)?.getTime() ?? Date.now(),
        orderNo: o.orderNo as string | undefined,
      };
    }),
    ...overduePaymentOrders(state, today).map((o) => {
      const dateKey = sheetDateToDayKey(o.updatedAt || o.orderedAt);
      return {
        id: `overdue-payment-${o.orderUid}`,
        kind: 'overdue-payment' as const,
        message: `ออเดอร์ ${o.orderUid} (${o.customer}) รอชำระเงินนานเกิน ${PAYMENT_OVERDUE_DAYS} วัน`,
        createdAt: dateKey ? (dayKeyToDate(dateKey)?.getTime() ?? Date.now()) : Date.now(),
        orderNo: o.orderUid as string | undefined,
      };
    }),
    ...(seesStuckDetachAlerts
      ? Object.values(state.stuckDetachments)
          .filter((d) => !stillBatchedOrderNos.has(d.orderNo))
          .map((d) => ({
            id: `stuck-detach-${d.orderNo}`,
            kind: 'stuck-detach' as const,
            message: `เอาสินค้าออเดอร์ ${d.orderNo} ลงจากรถ ${d.fromVehicleName} (batch ${d.fromBatchId}) — ตกหล่นจากวันก่อนหน้า ต้องนำไปจัดใหม่`,
            createdAt: new Date(d.detectedAt).getTime(),
            orderNo: d.orderNo as string | undefined,
          }))
      : []),
  ];

  const combined = [
    ...state.notificationEvents.map((e) => ({ id: e.id, kind: e.kind, message: e.message, createdAt: e.createdAt, orderNo: e.orderNo })),
    ...liveItems,
  ].sort((a, b) => b.createdAt - a.createdAt);

  const readSet = new Set(state.notificationReadIds);
  const iconFor = (kind: string) =>
    kind === 'new-order' ? 'ph ph-package' :
    kind === 'sync-error' ? 'ph ph-warning-fill' :
    kind === 'stuck-order' ? 'ph ph-clock-countdown' :
    kind === 'stuck-detach' ? 'ph ph-truck' :
    'ph ph-currency-circle-dollar';
  const colorFor = (kind: string) => (kind === 'sync-error' || kind === 'stuck-detach' ? 'var(--st-bad-fg)' : kind === 'new-order' ? 'var(--st-info-fg)' : 'var(--st-warn-fg)');

  const items = combined.map((n) => ({
    id: n.id,
    message: n.message,
    timeText: formatDateTime(n.createdAt),
    orderNo: n.orderNo,
    icon: iconFor(n.kind),
    iconColor: colorFor(n.kind),
    read: readSet.has(n.id),
    markRead: () => actions.markNotificationRead(n.id, state.notificationReadIds),
  }));
  const unreadCount = items.filter((n) => !n.read).length;

  return {
    isOpen: state.notificationsOpen,
    toggle: () => actions.toggleNotifications(state.notificationsOpen),
    close: () => (state.notificationsOpen ? actions.toggleNotifications(state.notificationsOpen) : undefined),
    items,
    unreadCount,
    isEmpty: items.length === 0,
    markAllRead: () => actions.markAllNotificationsRead(
      items.map((n) => n.id),
      state.notificationReadIds,
    ),
  };
}

// ---------- ACTIVITY LOG (user-action audit trail — kept in-browser only) ----------
export function computeActivityLog(state: AppState, actions: AppActions) {
  const q = state.activityLogQ.trim().toLowerCase();
  const role = state.session?.role;
  const seesAll = role ? seesAllActivityLog(role) : false;
  const scoped = seesAll ? state.activityLog : state.activityLog.filter((e) => e.user === state.session?.username);
  const rows = scoped
    .filter((e) => !q || (e.orderNo ?? '').toLowerCase().includes(q) || e.action.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q))
    .map((e) => ({
      id: e.id,
      timeText: formatDateTime(e.at),
      user: e.user,
      action: e.action,
      detail: e.detail,
      orderNo: e.orderNo ?? '—',
    }));

  return {
    q: state.activityLogQ,
    onSearch: (v: string) => actions.setActivityLogQ(v),
    rows,
    isEmpty: rows.length === 0,
    totalCount: scoped.length,
    seesAll,
  };
}

// ---------- USER MANAGEMENT ----------
export function computeUserManagement(state: AppState, actions: AppActions) {
  const role = state.session?.role;
  const canEdit = role ? canManageUsers(role) : false;

  const rows = state.users.map((u) => ({
    username: u.username,
    roleLabel: ROLE_LABELS[u.role] ?? u.role,
    active: u.active,
    driverVehicleId: u.driverVehicleId,
    vehicleName: u.driverVehicleId ? (state.vehicles.find((v) => v.id === u.driverVehicleId)?.name ?? u.driverVehicleId) : '—',
    createdAt: u.createdAt,
  }));

  return {
    canEdit,
    loading: state.usersLoading,
    error: state.usersError,
    rows,
    isEmpty: !state.usersLoading && rows.length === 0,
    roleOptions: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
    vehicleOptions: state.vehicles.map((v) => ({ value: v.id, label: v.name })),
    reload: () => actions.loadUsers(),
  };
}

// ---------- ORDER DETAIL (line items — "SKU Detail" tab) ----------
/** Whether `price` matches one of this promo's known price points (any tier
 * or packaging-unit price), within a cent of rounding slack — the signal
 * used to decide whether to offer "confirm this line used this promo" at
 * all. Never the sole basis for recording usage; staff still have to
 * explicitly confirm it per line. */
function promoPriceMatches(promo: Promo, price: number): boolean {
  const points = promo.packUnits.length > 0 ? promo.packUnits.map((u) => u.price) : promo.tiers.map((t) => t.price);
  return points.some((p) => Math.abs(p - price) < 0.01);
}

export function computeOrderDetail(state: AppState, actions: AppActions) {
  const total = state.orderDetailLines.reduce((a, l) => a + l.lineTotal, 0);
  const orderNo = state.orderDetailOrderNo;
  const draft = state.orderEditDraft;
  const saveStatus = state.orderSaveStatus[orderNo];

  return {
    open: state.orderDetailOpen,
    orderNo,
    customer: state.orderDetailCustomer,
    loading: state.orderDetailLoading,
    error: state.orderDetailError,
    lines: state.orderDetailLines.map((l) => {
      const unitPriceText = fmt(l.unitPrice);
      const lineTotalText = fmt(l.lineTotal);
      const key = `${orderNo}|${l.no || l.sku}`;
      const linkStatus = state.lineItemPromoStatus[key];
      // Only Active promos, and only when the price actually charged matches
      // one of that promo's real price points — never a guess from SKU alone.
      const matchedPromo = state.promos.find((p) => p.sku === l.sku && p.st === 'Active' && promoPriceMatches(p, l.unitPrice));
      const isConfirmed = l.promoSku !== '' && l.promoSku === matchedPromo?.sku;
      return {
        ...l,
        unitPriceText,
        lineTotalText,
        matchedPromoSku: matchedPromo?.sku ?? null,
        isConfirmed,
        linkedPromoSku: l.promoSku || null,
        linkSaving: linkStatus?.state === 'saving',
        linkError: linkStatus?.state === 'error' ? (linkStatus.message ?? 'บันทึกไม่สำเร็จ') : null,
        confirmPromo: () => actions.linkLineItemPromo(orderNo, l.sku, l.no, matchedPromo!.sku),
        unconfirmPromo: () => actions.linkLineItemPromo(orderNo, l.sku, l.no, ''),
      };
    }),
    isEmpty: !state.orderDetailLoading && !state.orderDetailError && state.orderDetailLines.length === 0,
    totalText: fmt(total),

    // edit fields — write back to the real "คำสั่งซื้อ" sheet
    canEdit: state.orderEditAvailable,
    canEditRole: state.session ? canEditOrder(state.session.role) : false,
    plannedDeliveryDate: draft.plannedDeliveryDate,
    onPlannedDeliveryDate: (v: string) => actions.setOrderEditDraft({ ...draft, plannedDeliveryDate: v }),
    note: draft.note,
    onNote: (v: string) => actions.setOrderEditDraft({ ...draft, note: v }),
    wantsTaxInvoice: draft.wantsTaxInvoice,
    onWantsTaxInvoice: (v: boolean) => actions.setOrderEditDraft({ ...draft, wantsTaxInvoice: v }),
    saving: saveStatus?.state === 'saving',
    saved: saveStatus?.state === 'saved',
    saveError: saveStatus?.state === 'error' ? (saveStatus.message ?? 'บันทึกไม่สำเร็จ') : null,
    save: () => actions.saveOrderEdit(orderNo, draft, state.orderEditOriginal),
    viewHistory: () => {
      actions.closeOrderDetail();
      actions.patch({ route: 'activity', activityLogQ: orderNo });
    },
  };
}

// ---------- ROUTE PLANNING / DELIVERY HISTORY ("คำสั่งซื้อ" tab) ----------

export function computeRoute(state: AppState, actions: AppActions) {
  const rq = state.routeQ.trim().toLowerCase();
  // Customer-corrected coordinates (see src/data/customerLocation.ts) always
  // win over the raw CS_Lat/CS_Long from Unii — resolved once here so every
  // downstream use (reverse-geocode input for the district/province column
  // below) sees the corrected pin, not the stale one.
  const routeOrders = resolveRouteOrderLocations(state.routeOrders, state.customers);
  // "แสดงออเดอร์ที่จัดเก็บแล้ว" is a binary view switch, not just another
  // filter chip — OFF (default) shows the normal working set, ON shows only
  // the archived pile, so the two never mix in one table and every other
  // filter/option below only ever reflects whichever side is currently shown.
  const visibleOrders = routeOrders.filter((o) => (state.routeArchivedFilter ? o.archived : !o.archived));
  const archivedCount = routeOrders.filter((o) => o.archived).length;
  const canArchive = state.session ? canEditOrder(state.session.role) : false;

  // Cancelled orders clutter the default view (most of what staff need to
  // act on is never "ยกเลิก"), so the "ทั้งหมด" status tab excludes them —
  // only picking the "ยกเลิก" tab itself reveals them. statusValues (which
  // decides which tabs even exist) is still built off visibleOrders, not
  // workingOrders, so the "ยกเลิก" tab keeps showing up as a choice; every
  // count/filter-option/table below this point, though, runs off
  // workingOrders so nothing quietly still counts hidden cancelled rows into
  // a "total" figure.
  const CANCELLED_STATUS = 'ยกเลิก';
  const workingOrders = visibleOrders.filter((o) => (state.routeStatusFilter === CANCELLED_STATUS ? o.status === CANCELLED_STATUS : o.status !== CANCELLED_STATUS));

  const statusValues = Array.from(new Set(visibleOrders.map((o) => o.status).filter(Boolean))).sort();
  // อำเภอ,จังหวัด has far more distinct values than the old route-letter
  // filter did — a dropdown, not a chip row, is what keeps that many options
  // usable (chips only make sense for a handful of values).
  const districtProvinceValues = Array.from(new Set(workingOrders.map((o) => o.districtProvince.trim()).filter(Boolean))).sort();

  const filtered = workingOrders.filter((o) => {
    if (state.routeFilterValue !== 'all') {
      const dp = o.districtProvince.trim();
      if (state.routeFilterValue === 'other' ? dp !== '' : dp !== state.routeFilterValue) return false;
    }
    if (state.routeStatusFilter !== 'all' && o.status !== state.routeStatusFilter) return false;
    if (state.routeOrderDateFilter && sheetDateToDayKey(o.orderedDate) !== state.routeOrderDateFilter) return false;
    if (state.routeDeliveryDateFilter && effectiveDeliveryDayKey(o) !== state.routeDeliveryDateFilter) return false;
    if (rq && !(o.customer.toLowerCase().includes(rq) || o.orderNo.toLowerCase().includes(rq))) return false;
    return true;
  });
  // Newest order first — ties (same order pushed within the same minute)
  // fall back to their original sheet order since Array#sort is stable.
  filtered.sort((a, b) => (sheetDateTimeToMs(b.orderedAtText) ?? 0) - (sheetDateTimeToMs(a.orderedAtText) ?? 0));

  const chipBase: CSSProperties = { border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: '6px 13px', borderRadius: 20, fontWeight: 500 };
  const makeTabs = (values: string[], selected: string, onSelect: (v: string) => void) =>
    ['all', ...values].map((v) => ({
      key: v,
      label: v === 'all' ? 'ทั้งหมด (ไม่รวมยกเลิก)' : v,
      style:
        v === selected
          ? { ...chipBase, background: 'var(--color-accent)', color: '#fff' }
          : { ...chipBase, background: 'var(--color-surface)', color: 'var(--color-neutral-300)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' },
      go: () => onSelect(v),
    }));

  const countForDistrict = (dp: string) => workingOrders.filter((o) => o.districtProvince.trim() === dp).length;
  const noDistrictCount = workingOrders.filter((o) => o.districtProvince.trim() === '').length;
  const districtProvinceOptions = [
    { value: 'all', label: `ทั้งหมด (${workingOrders.length})` },
    ...districtProvinceValues.map((dp) => ({ value: dp, label: `${dp} (${countForDistrict(dp)})` })),
    ...(noDistrictCount > 0 ? [{ value: 'other', label: `ไม่ระบุ (${noDistrictCount})` }] : []),
  ];

  // Active promo SKUs — state.promos now holds every status (see computePromo's
  // status filter), so this explicitly narrows to Active before cross
  // referencing against each order's line items, so staff can see at a
  // glance which orders include a promoted product without opening every one.
  const activePromoSkus = new Set(state.promos.filter((p) => p.st === 'Active').map((p) => p.sku));
  const orderSkus = new Map<string, Set<string>>();
  for (const li of state.orderLineItems) {
    let set = orderSkus.get(li.orderNo);
    if (!set) {
      set = new Set();
      orderSkus.set(li.orderNo, set);
    }
    set.add(li.sku);
  }

  // Batch Route "stamp" — read live off state.batchRoutes rather than
  // written onto the order itself, so it can never drift: once an order
  // leaves a batch's current orderNos (via "แก้ไข batch"), the stamp just
  // disappears next render, and a move to another vehicle's batch picks up
  // that batch's info automatically. If an orderNo happens to still be
  // listed in more than one batch snapshot, the most recently created batch
  // wins, since that reflects the order's real current assignment.
  const batchStampByOrderNo = new Map<string, { vehicleName: string; batchId: string; createdAt: string }>();
  for (const b of state.batchRoutes) {
    if (b.cancelled) continue;
    for (const orderNo of b.orderNos) {
      const cur = batchStampByOrderNo.get(orderNo);
      if (!cur || b.createdAt > cur.createdAt) batchStampByOrderNo.set(orderNo, { vehicleName: b.vehicleName, batchId: b.id, createdAt: b.createdAt });
    }
  }

  // ---- "รอจัด Batch" (Waiting for Batching) — active orders never confirmed
  // into any Batch Route yet, independent of this table's own search/date
  // filters (same reasoning as stuckOrders below). "พร้อม batch" means the
  // order already sits in some vehicle's routePlan, queued for that
  // vehicle's next "ยืนยันรูท (Assign)"; "รอ batch" means it hasn't even
  // been put on a vehicle yet.
  const routePlanVehicleByOrderNo = new Map<string, string>();
  for (const [vehicleId, orderNos] of Object.entries(state.routePlan)) {
    for (const no of orderNos) routePlanVehicleByOrderNo.set(no, vehicleId);
  }
  const pendingBatchOrders = state.routeOrders
    .filter((o) => !o.archived && !DELIVERY_DONE_STATUSES.includes(o.status) && !batchStampByOrderNo.has(o.orderNo))
    .sort((a, b) => (sheetDateTimeToMs(b.orderedAtText) ?? 0) - (sheetDateTimeToMs(a.orderedAtText) ?? 0))
    .map((o) => ({
      orderNo: o.orderNo,
      customer: o.customer,
      route: resolveZone(state.zoneRules, o, state.geocodeCache).route,
      amtText: fmt(o.totalAmount),
      itemCountText: o.itemCount.toLocaleString('en-US'),
      orderedAtText: formatOrderedAt(o.orderedAtText),
      stLabel: o.status || '—',
      stStyle: sheetStatusStyle(o.status),
      batchReady: routePlanVehicleByOrderNo.has(o.orderNo),
      // Gate: an order with no delivery date can't be batched at all yet —
      // shown here (not hidden) so staff sees it needs a date, but excluded
      // from "จัด Batch ทั้งหมดที่รอ" (see pendingBatchReadyOrderNos below)
      // and from the Planner's own assign controls (computePlanner's
      // noDeliveryDate/assignTo).
      noDeliveryDate: effectiveDeliveryDayKey(o) === null,
      viewItems: () => actions.openOrderDetail(o.orderNo, o.customer, o),
    }));
  const pendingBatchReadyOrderNos = pendingBatchOrders.filter((o) => !o.noDeliveryDate).map((o) => o.orderNo);
  const pendingBatchNoDateCount = pendingBatchOrders.length - pendingBatchReadyOrderNos.length;

  const rows = filtered.map((o) => {
    const batchStamp = batchStampByOrderNo.get(o.orderNo) ?? null;
    const skusForOrder = orderSkus.get(o.orderNo);
    const hasPromoItem = skusForOrder ? Array.from(skusForOrder).some((sku) => activePromoSkus.has(sku)) : false;
    const deliveryFailure = state.deliveryFailures[o.orderNo] ?? null;
    const saveStatus = state.orderSaveStatus[o.orderNo];
    const hasDeliveryDate = sheetDateToDayKey(o.plannedDeliveryDate) != null;
    // Warehouse cutoff rule: ordered before 16:00 -> ship the next day;
    // 16:00 or later -> ship the day after that. Only offered while there's
    // no delivery date yet — once one exists, editing goes through "แก้ไข".
    const suggestedIso = hasDeliveryDate ? null : suggestedDeliveryDayKey(o.orderedAtText);
    const suggestedDate = suggestedIso ? dayKeyToDate(suggestedIso) : null;
    const setDeliveryDate = (iso: string) =>
      actions.saveOrderEdit(
        o.orderNo,
        { plannedDeliveryDate: iso, note: o.note, wantsTaxInvoice: o.wantsTaxInvoice },
        { plannedDeliveryDate: sheetDateToDayKey(o.plannedDeliveryDate) ?? '', note: o.note, wantsTaxInvoice: o.wantsTaxInvoice },
      );
    return {
      route: resolveZone(state.zoneRules, o, state.geocodeCache).route,
      districtProvince: districtProvinceLabel(o, state.geocodeCache),
      orderNo: o.orderNo,
      archived: o.archived,
      selected: state.routeSelectedOrderNos.includes(o.orderNo),
      toggleSelect: () => actions.toggleRouteSelect(o.orderNo, state.routeSelectedOrderNos),
      customer: o.customer,
      stLabel: o.status || '—',
      stStyle: sheetStatusStyle(o.status),
      amtText: fmt(o.totalAmount),
      itemCountText: o.itemCount.toLocaleString('en-US'),
      hasPromoItem,
      deliveryFailure,
      paymentType: o.paymentType,
      orderedAtText: formatOrderedAt(o.orderedAtText),
      plannedDeliveryDate: o.plannedDeliveryDate || '—',
      hasDeliveryDate,
      suggestedDeliveryDateText: suggestedDate ? formatThaiShortDate(suggestedDate) : null,
      suggestedDeliveryDateIso: suggestedIso,
      setDeliveryDate,
      wantsTaxInvoice: o.wantsTaxInvoice,
      noteText: o.note,
      saving: saveStatus?.state === 'saving',
      saved: saveStatus?.state === 'saved',
      saveError: saveStatus?.state === 'error' ? (saveStatus.message ?? 'บันทึกไม่สำเร็จ') : null,
      completedDate: o.completedDate || '—',
      distanceText: o.distanceFromWhKm != null ? `${o.distanceFromWhKm.toFixed(1)} กม.` : '—',
      address: o.addressFromUnii || o.districtProvince,
      mapLink: o.mapLink,
      isNewCustomer: o.isNewCustomer,
      note: o.note,
      viewItems: () => actions.openOrderDetail(o.orderNo, o.customer, o),
      edit: () => actions.openOrderDetail(o.orderNo, o.customer, o),
      batchVehicleName: batchStamp?.vehicleName ?? null,
      batchId: batchStamp?.batchId ?? null,
      batchAssignedAtText: batchStamp ? formatThaiShortDate(new Date(batchStamp.createdAt)) : null,
    };
  });

  // Split into two groups so warehouse staff can see at a glance which
  // orders still need a delivery date scheduled, separate from ones already
  // scheduled.
  const rowsNoDate = rows.filter((r) => r.plannedDeliveryDate === '—');
  const rowsWithDate = rows.filter((r) => r.plannedDeliveryDate !== '—');

  // ---- stuck orders: delivery date already passed, but never reached a done status ----
  const today = todayDayKey();
  const stuckOrders = stuckRouteOrders(state, today)
    .map((o) => {
      const key = effectiveDeliveryDayKey(o)!;
      return {
        orderNo: o.orderNo,
        customer: o.customer,
        plannedDeliveryDate: o.plannedDeliveryDate,
        daysLate: Math.abs(daysBetweenKeys(key, today)),
        stLabel: o.status || '—',
        stStyle: sheetStatusStyle(o.status),
        viewItems: () => actions.openOrderDetail(o.orderNo, o.customer, o),
        // Same shared selection pool the main table's rows use (see below) —
        // the archive feature is one selection set / one toolbar / one
        // confirm dialog regardless of which table a checkbox was ticked in.
        selected: state.routeSelectedOrderNos.includes(o.orderNo),
        toggleSelect: () => actions.toggleRouteSelect(o.orderNo, state.routeSelectedOrderNos),
      };
    })
    .sort((a, b) => b.daysLate - a.daysLate);

  return {
    routeOrdersLoading: state.routeOrdersLoading,
    routeOrdersError: state.routeOrdersError,
    geocodeProgress: state.geocodeProgress,
    routeQ: state.routeQ,
    onRouteSearch: (v: string) => actions.patch({ routeQ: v }),
    orderDateFilter: state.routeOrderDateFilter,
    onOrderDateFilter: (v: string) => actions.patch({ routeOrderDateFilter: v }),
    deliveryDateFilter: state.routeDeliveryDateFilter,
    onDeliveryDateFilter: (v: string) => actions.patch({ routeDeliveryDateFilter: v }),
    hasDateFilters: state.routeOrderDateFilter !== '' || state.routeDeliveryDateFilter !== '',
    clearDateFilters: () => actions.patch({ routeOrderDateFilter: '', routeDeliveryDateFilter: '' }),
    districtProvinceOptions,
    districtProvinceFilter: state.routeFilterValue,
    onDistrictProvinceFilter: (v: string) => actions.patch({ routeFilterValue: v }),
    statusTabs: makeTabs(statusValues, state.routeStatusFilter, (v) => actions.patch({ routeStatusFilter: v })),
    rowsNoDate,
    rowsWithDate,
    resultCount: filtered.length,
    isEmpty: filtered.length === 0,
    stuckOrders,
    stuckCount: stuckOrders.length,
    pendingBatchOrders,
    pendingBatchCount: pendingBatchOrders.length,
    pendingBatchReadyOrderNos,
    pendingBatchNoDateCount,

    // ---- archive feature ----
    archivedFilter: state.routeArchivedFilter,
    toggleArchivedFilter: () => actions.patch({ routeArchivedFilter: !state.routeArchivedFilter, routeSelectedOrderNos: [] }),
    archivedCount,
    canArchive,
    selectedOrderNos: state.routeSelectedOrderNos,
    selectedCount: state.routeSelectedOrderNos.length,
    setSelection: actions.setRouteSelection,
    clearSelection: actions.clearRouteSelection,
    archiveDialogOpen: state.archiveDialogOpen,
    archiveDialogMode: state.archiveDialogMode,
    archiveSubmitting: state.archiveSubmitting,
    archiveError: state.archiveError,
    openArchiveDialog: () => actions.openArchiveDialog(state.routeArchivedFilter ? 'unarchive' : 'archive'),
    closeArchiveDialog: actions.closeArchiveDialog,
    confirmArchive: () => actions.confirmArchiveSelected(state.routeSelectedOrderNos, !state.routeArchivedFilter),
  };
}

/** Radius (km) around the bulk of the delivery area beyond which a coordinate
 * is treated as bad data rather than a genuinely distant customer. Generous
 * enough to keep real cross-province drops, tight enough to exclude
 * wrong-country and (0,0) values. */
const MAX_PLAUSIBLE_RADIUS_KM = 200;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function rejectOutlierStops<T extends { lat: number; lng: number }>(stops: T[], warehouse: { lat: number; lng: number } | null): { kept: T[]; excluded: number } {
  if (stops.length === 0) return { kept: [], excluded: 0 };

  // Anchor on the warehouse when known, else on the median point — either way
  // a minority of bad coordinates can't drag the reference off the real area.
  const anchor = warehouse ?? { lat: median(stops.map((s) => s.lat)), lng: median(stops.map((s) => s.lng)) };

  const kept = stops.filter((s) => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return false;
    if (s.lat === 0 && s.lng === 0) return false; // classic "no coordinate" placeholder
    if (s.lat < -90 || s.lat > 90 || s.lng < -180 || s.lng > 180) return false;
    return haversineKm(anchor.lat, anchor.lng, s.lat, s.lng) <= MAX_PLAUSIBLE_RADIUS_KM;
  });

  return { kept, excluded: stops.length - kept.length };
}

// ---------- ROUTE PLANNER ----------
export function computePlanner(state: AppState, actions: AppActions) {
  const role = state.session?.role;
  const canEdit = role ? canEditPlan(role) : false;
  const isDriverView = role === 'driver';
  // A driver only ever sees the route(s) on their own assigned vehicle — not
  // the fleet, not the unassigned pool waiting to be routed.
  const vehicleSource = isDriverView ? state.vehicles.filter((v) => v.id === state.session?.driverVehicleId) : state.vehicles;
  const username = state.session?.username ?? '';

  // A distinct colour per vehicle (independent of zone colour) for the map's
  // route lines and the small swatch next to each vehicle's name — indexed
  // against the full fleet list so a vehicle keeps the same colour
  // regardless of any driver-view filtering applied to vehicleSource.
  const vehicleColorFor = (vehicleId: string) => {
    const idx = state.vehicles.findIndex((x) => x.id === vehicleId);
    return VEHICLE_PALETTE[(idx < 0 ? 0 : idx) % VEHICLE_PALETTE.length];
  };

  // Batch Route locking — a vehicle with a locked, not-currently-unlocked
  // batch for the day being planned can't have its sequence/membership
  // touched until someone explicitly unlocks it (see unlockBatch below).
  // "Active" batch per vehicle = the most recently created one for this
  // exact delivery date (a vehicle can accumulate more than one batch across
  // a day — e.g. a second trip — each keeping its own frozen order list).
  const batchesForDate = state.plannerDate ? state.batchRoutes.filter((b) => b.deliveryDate === state.plannerDate && !b.cancelled) : [];
  const activeBatchByVehicle = new Map<string, BatchRoute>();
  for (const b of batchesForDate) {
    const cur = activeBatchByVehicle.get(b.vehicleId);
    if (!cur || b.createdAt > cur.createdAt) activeBatchByVehicle.set(b.vehicleId, b);
  }
  const isVehicleLocked = (vehicleId: string) => {
    const b = activeBatchByVehicle.get(vehicleId);
    return !!b && b.locked && !state.batchRouteUnlocked[b.id];
  };
  /** Mirrors a routePlan edit into that vehicle's active (unlocked) batch, if
   * any, and records it in the Activity Log — this is what "แก้ไข batch
   * ทีหลังได้ ... ต้องบันทึกลง Activity Log" actually wires up to. A no-op
   * when the vehicle has no active batch (ordinary pre-assign editing). */
  const syncBatchAfterEdit = (vehicleId: string, newOrderNos: string[], desc: string) => {
    const b = activeBatchByVehicle.get(vehicleId);
    if (!b) return;
    const now = new Date().toISOString();
    const updated: BatchRoute = { ...b, orderNos: newOrderNos, updatedAt: now, updatedBy: username };
    // setBatchRoutes's backend push now ALSO reconciles orders.batch_route_id/
    // route/assigned_driver/stop_sequence for every added/removed order in one
    // transaction (see server/lib.ts's handleUpsertBatchRoutes) — no separate
    // "คนส่ง" write needed here anymore.
    actions.setBatchRoutes(state.batchRoutes.map((x) => (x.id === b.id ? updated : x)));
    actions.logActivity('แก้ไข Batch Route', `${b.id} · ${desc}`);
  };

  /** A vehicle's true current stop list for the selected date: the active
   * batch's own frozen orderNos when one exists (authoritative even if
   * routePlan has since gone stale), otherwise routePlan's live draft with
   * anything already promoted into some other batch filtered back out — see
   * filterOutBatchedOrderNos. This is the one place "what does this vehicle
   * show right now" gets decided; every read/write site below goes through
   * it so a batch's stops can never leak into a different date again. */
  const currentOrderNos = (vehicleId: string): string[] => {
    const b = activeBatchByVehicle.get(vehicleId);
    if (b) return b.orderNos;
    return filterOutBatchedOrderNos(state.routePlan[vehicleId] ?? [], state.batchRoutes);
  };
  /** Writes a single vehicle's new order list to whichever store currently
   * owns it: routePlan for a vehicle with no active batch on this date (the
   * ordinary pre-assign draft), or nothing at all when a batch already owns
   * it — syncBatchAfterEdit (called separately by every caller) is what
   * updates the batch itself in that case, and writing routePlan too would
   * just recreate the stale-leftover-entry leak this exists to prevent. */
  const applyVehicleOrderNos = (vehicleId: string, next: string[]) => {
    if (!activeBatchByVehicle.get(vehicleId)) actions.setRoutePlan({ ...state.routePlan, [vehicleId]: next });
  };

  // Customer-corrected coordinates always win over the raw CS_Lat/CS_Long
  // from Unii (see src/data/customerLocation.ts) — resolved once here so map
  // pins, distance, and Google Maps links all use the same corrected pin.
  const routeOrders = resolveRouteOrderLocations(state.routeOrders, state.customers);

  const wh = routeOrders.find((o) => o.whLat != null && o.whLng != null);
  const warehouse = wh && wh.whLat != null && wh.whLng != null ? { lat: wh.whLat, lng: wh.whLng } : null;

  // Plan the selected day's outstanding work: anything not yet delivered or
  // cancelled, scoped to the chosen delivery date when one is picked.
  // Archived orders are excluded so staff can't accidentally route stale/bad
  // data that was deliberately hidden via the Order Management archive action.
  const candidates = routeOrders.filter((o) => {
    if (o.archived) return false;
    if (DELIVERY_DONE_STATUSES.includes(o.status)) return false;
    if (state.plannerDate && effectiveDeliveryDayKey(o) !== state.plannerDate) return false;
    return true;
  });

  // Includes both the live routePlan draft AND anything already frozen into
  // a Batch Route (any date) — once an order is locked into a batch it must
  // stay out of every date's unassigned pool even after confirmAssign clears
  // its vehicle's routePlan entry (see applyVehicleOrderNos/confirmAssign).
  const assignedTo = new Map<string, string>();
  for (const [vehicleId, orderNos] of Object.entries(state.routePlan)) {
    for (const no of orderNos) assignedTo.set(no, vehicleId);
  }
  for (const b of state.batchRoutes) {
    if (b.cancelled) continue;
    for (const no of b.orderNos) if (!assignedTo.has(no)) assignedTo.set(no, b.vehicleId);
  }

  // "ออเดอร์ค้าง/เลยกำหนด" banner — deliberately scoped to the same
  // not-yet-assigned pool as the unassigned table below (not every
  // routeOrder), and deliberately NOT scoped to state.plannerDate, so the
  // count always matches exactly what clicking the banner reveals: clearing
  // plannerDate surfaces every date's unassigned orders, and the per-row
  // noDeliveryDate/isOverdue flags below (set the same way here) narrow
  // that down to precisely the flagged subset.
  const today = todayDayKey();
  const unassignedAnyDate = routeOrders.filter((o) => !o.archived && !DELIVERY_DONE_STATUSES.includes(o.status) && !assignedTo.has(o.orderNo));
  const noDeliveryDateCount = unassignedAnyDate.filter((o) => effectiveDeliveryDayKey(o) === null).length;
  const overdueUnassignedCount = unassignedAnyDate.filter((o) => {
    const key = effectiveDeliveryDayKey(o);
    return key !== null && key < today;
  }).length;

  // distanceFromWhKm ("far_from_wh") is a static figure Unii computed once
  // from its own raw coordinate — trustworthy only for customers who were
  // never corrected. Once a customer has a corrected pin, that stale figure
  // could be wrong, so recompute live from the corrected coordinate instead
  // of trusting the sheet's number.
  const distanceOf = (o: (typeof candidates)[number]) =>
    o.locationSource === 'override'
      ? warehouse && o.lat != null && o.lng != null
        ? haversineKm(warehouse.lat, warehouse.lng, o.lat, o.lng)
        : 0
      : (o.distanceFromWhKm ?? (warehouse && o.lat != null && o.lng != null ? haversineKm(warehouse.lat, warehouse.lng, o.lat, o.lng) : 0));

  const byOrderNo = new Map(routeOrders.map((o) => [o.orderNo, o]));
  const vehicleNameById = new Map(vehicleSource.map((v) => [v.id, v.name]));

  /** Moves an order between vehicles (or reorders within one), splicing it
   * out of its source list and into the target at `toIndex` (end of list
   * when null). Powers both drag-and-drop and the "ย้ายไปรถคันอื่น" dropdown —
   * stop sequence/load-code numbers fall out for free since they're derived
   * directly from routePlan's array order. */
  const moveOrderToVehicle = (orderNo: string, fromVehicleId: string, toVehicleId: string, toIndex: number | null) => {
    if (isVehicleLocked(fromVehicleId) || isVehicleLocked(toVehicleId)) return;
    const fromList = [...currentOrderNos(fromVehicleId)];
    const srcIdx = fromList.indexOf(orderNo);
    if (srcIdx === -1) return;
    fromList.splice(srcIdx, 1);

    const toList = [...(fromVehicleId === toVehicleId ? fromList : currentOrderNos(toVehicleId))];
    const insertAt = toIndex === null ? toList.length : Math.max(0, Math.min(toIndex, toList.length));
    toList.splice(insertAt, 0, orderNo);

    // Single merged routePlan patch (skipping any side a batch already owns
    // for this date) so a same-tick double-write can never clobber itself.
    const planPatch: RoutePlanShape = {};
    if (!activeBatchByVehicle.get(fromVehicleId)) planPatch[fromVehicleId] = fromVehicleId === toVehicleId ? toList : fromList;
    if (fromVehicleId !== toVehicleId && !activeBatchByVehicle.get(toVehicleId)) planPatch[toVehicleId] = toList;
    if (Object.keys(planPatch).length > 0) actions.setRoutePlan({ ...state.routePlan, ...planPatch });

    if (fromVehicleId === toVehicleId) {
      syncBatchAfterEdit(fromVehicleId, toList, `เรียงลำดับใหม่ (${orderNo})`);
      return;
    }
    // Only a genuine cross-vehicle move is worth a log entry — reordering
    // stops within the same vehicle's own list happens too often (every
    // drag) to be a meaningful audit event.
    actions.logActivity('ย้ายออเดอร์ (วางแผนจัดรูท)', `จาก ${vehicleNameById.get(fromVehicleId) ?? fromVehicleId} → ${vehicleNameById.get(toVehicleId) ?? toVehicleId}`, orderNo);
    syncBatchAfterEdit(fromVehicleId, fromList, `ย้าย ${orderNo} ออกไป ${vehicleNameById.get(toVehicleId) ?? toVehicleId}`);
    syncBatchAfterEdit(toVehicleId, toList, `ย้าย ${orderNo} เข้าจาก ${vehicleNameById.get(fromVehicleId) ?? fromVehicleId}`);
  };

  const orderUnitQty = buildOrderUnitQtyMap(state.orderLineItems);
  const qtyTextFor = (orderNo: string) => qtyTextForOrder(orderUnitQty, orderNo);

  // "ผู้จัด" — who closed the pick lot that packed this order, if any. Reuses
  // the pick-lot/user data already wired up (no separate packer system) —
  // when an order was ever included in more than one closed lot, the most
  // recently closed one wins.
  const packedByOrderNo = new Map<string, { name: string; closedAt: string }>();
  for (const lot of state.pickLots) {
    if (!lot.closed || !lot.closedBy) continue;
    for (const orderNo of lot.orderNos) {
      const cur = packedByOrderNo.get(orderNo);
      if (!cur || lot.createdAt > cur.closedAt) packedByOrderNo.set(orderNo, { name: lot.closedBy, closedAt: lot.createdAt });
    }
  }

  const unassignedCandidates = (isDriverView ? [] : candidates).filter((o) => !assignedTo.has(o.orderNo));
  // Same customer placing several separate orders isn't rare (case in point:
  // the screenshot that prompted this) — flagging repeats saves someone
  // routing manually from having to notice it themselves row by row.
  const unassignedCustomerCounts = new Map<string, number>();
  for (const o of unassignedCandidates) {
    const key = o.phone.trim();
    if (!key) continue;
    unassignedCustomerCounts.set(key, (unassignedCustomerCounts.get(key) ?? 0) + 1);
  }

  // Driver "จองคิว" bookings — pending requests against currently-unassigned
  // stops, read off state.bookings (the one backend-shared piece of planner
  // state) so every manager/admin session sees the same lock a driver just
  // placed from their own phone, not just whichever browser placed it.
  const canDecide = role ? canDecideBooking(role) : false;
  const activeBookingByOrderNo = new Map<string, BookingRow>();
  for (const b of state.bookings) {
    if (b.status !== 'pending') continue;
    const cur = activeBookingByOrderNo.get(b.orderNo);
    if (!cur || b.bookedAt > cur.bookedAt) activeBookingByOrderNo.set(b.orderNo, b);
  }
  /** Confirming a booking only ever flips the Bookings sheet row server-side
   * — this still performs the exact same "add to routePlan" step a normal
   * dropdown-assign does (batch-lock-aware, logged, synced into an active
   * batch), just targeted at the requesting driver's own vehicle instead of
   * whichever one was picked from a dropdown. */
  const confirmBookingFor = (orderNo: string, driverUsername: string, fallbackVehicleId: string) => {
    if (!canDecide) return;
    actions.decideBooking(orderNo, 'confirm', driverUsername).then((result) => {
      const vehicleId = result?.driverVehicleId || fallbackVehicleId;
      if (!vehicleId || isVehicleLocked(vehicleId)) return;
      const next = [...currentOrderNos(vehicleId), orderNo];
      applyVehicleOrderNos(vehicleId, next);
      syncBatchAfterEdit(vehicleId, next, `ยืนยันคำขอจองคิวจาก ${driverUsername} (${orderNo})`);
    });
  };
  const rejectBookingFor = (orderNo: string, driverUsername: string, note?: string) => {
    if (!canDecide) return;
    actions.decideBooking(orderNo, 'reject', driverUsername, note);
  };

  const unassigned = unassignedCandidates
    .map((o) => {
      const zone = resolveZone(state.zoneRules, o, state.geocodeCache);
      const booking = activeBookingByOrderNo.get(o.orderNo) ?? null;
      // Gate: no delivery date yet — never assignable to a vehicle. Kept
      // visible in this table (with a badge) rather than hidden, so staff
      // sees exactly which orders are blocked and why; assignTo becomes
      // undefined (same pattern as confirmBooking/rejectBooking below) so
      // the row's "จัดลงรถ" dropdown has nothing to call even if some other
      // code path tried to render it enabled.
      const noDeliveryDate = effectiveDeliveryDayKey(o) === null;
      const stuckDetachment = state.stuckDetachments[o.orderNo] ?? null;
      return {
        orderNo: o.orderNo,
        customer: o.customer,
        duplicateCustomer: (unassignedCustomerCounts.get(o.phone.trim()) ?? 0) > 1,
        // Cross-day stuck-order detector's own badge — see
        // ordersNeedingStuckBatchDetach/autoDetachStuckOrders. Shows here
        // because this row exists at all (order is currently unassigned);
        // once reassigned to a batch it leaves this table entirely, so no
        // separate "resolved" flag is needed.
        stuckDetached: stuckDetachment != null,
        stuckDetachedFromText: stuckDetachment ? `${stuckDetachment.fromBatchId} · ${stuckDetachment.fromVehicleName}` : '',
        address: o.addressFromUnii || o.districtProvince,
        districtProvince: o.districtProvince || '—',
        phone: o.phone || '—',
        packedBy: packedByOrderNo.get(o.orderNo)?.name || 'ยังไม่จัด',
        plannedDeliveryDateText: o.plannedDeliveryDate || '—',
        amtText: fmt(o.totalAmount),
        itemCount: o.itemCount,
        qtyText: qtyTextFor(o.orderNo),
        zoneName: zone.zoneName,
        zoneColor: zone.color,
        suggestedRoute: zone.route,
        distanceKm: distanceOf(o),
        distanceText: `${distanceOf(o).toFixed(1)} กม.`,
        wantsTaxInvoice: o.wantsTaxInvoice,
        note: o.note,
        hasNote: o.note.trim() !== '',
        noteText: o.note.trim() || '—',
        lat: o.lat,
        lng: o.lng,
        locationSource: o.locationSource,
        selected: state.plannerSelectedOrderNos.includes(o.orderNo),
        toggleSelect: () => actions.togglePlannerSelect(o.orderNo, state.plannerSelectedOrderNos),
        editLocation: () => actions.openEditOrderLocation(o),
        assignTo: noDeliveryDate
          ? undefined
          : (vehicleId: string) => {
              if (isVehicleLocked(vehicleId)) return;
              const next = [...currentOrderNos(vehicleId), o.orderNo];
              applyVehicleOrderNos(vehicleId, next);
              actions.logActivity('จัดออเดอร์ลงรถ (วางแผนจัดรูท)', `${vehicleNameById.get(vehicleId) ?? vehicleId}`, o.orderNo);
              syncBatchAfterEdit(vehicleId, next, `เพิ่ม ${o.orderNo}`);
            },
        bookedByDriver: booking?.driverUsername ?? null,
        canDecideBooking: canDecide,
        confirmBooking: booking ? () => confirmBookingFor(o.orderNo, booking.driverUsername, booking.driverVehicleId) : undefined,
        rejectBooking: booking ? (note?: string) => rejectBookingFor(o.orderNo, booking.driverUsername, note) : undefined,
        noDeliveryDate,
        isOverdue: (() => {
          const key = effectiveDeliveryDayKey(o);
          return key !== null && key < today;
        })(),
      };
    })
    .sort((a, b) => b.distanceKm - a.distanceKm);

  const unassignedOrderNos = unassigned.map((u) => u.orderNo);
  const selectedInUnassigned = state.plannerSelectedOrderNos.filter((no) => unassignedOrderNos.includes(no));
  const allUnassignedSelected = unassignedOrderNos.length > 0 && selectedInUnassigned.length === unassignedOrderNos.length;
  const toggleSelectAllUnassigned = () => actions.setPlannerSelection(allUnassignedSelected ? [] : unassignedOrderNos);
  // Gate: same no-delivery-date rule as the single-row assignTo above,
  // applied to the bulk "จัดลงรถ" dropdown — silently dropping a selected
  // no-date order would look like a bug, so this rejects with an explicit
  // dismissible message instead (plannerAssignSkippedMessage).
  const noDateByOrderNo = new Map(unassigned.map((u) => [u.orderNo, u.noDeliveryDate]));
  const assignSelectedTo = (vehicleId: string) => {
    if (selectedInUnassigned.length === 0 || isVehicleLocked(vehicleId)) return;
    const blocked = selectedInUnassigned.filter((no) => noDateByOrderNo.get(no));
    const eligible = selectedInUnassigned.filter((no) => !noDateByOrderNo.get(no));
    if (blocked.length > 0) {
      actions.patch({
        plannerAssignSkippedMessage: `ข้าม ${blocked.length} ออเดอร์ที่ยังไม่มีวันที่จัดส่ง (${blocked.join(', ')}) — ต้องระบุวันที่จัดส่งก่อนจึงจะจัดลงรถได้`,
      });
    }
    if (eligible.length === 0) return;
    const next = [...currentOrderNos(vehicleId), ...eligible];
    applyVehicleOrderNos(vehicleId, next);
    actions.setPlannerSelection([]);
    actions.logActivity(
      'จัดออเดอร์ลงรถ (วางแผนจัดรูท, เลือกหลายรายการ)',
      `${vehicleNameById.get(vehicleId) ?? vehicleId} · ${eligible.length} ออเดอร์ (${eligible.join(', ')})`,
    );
    syncBatchAfterEdit(vehicleId, next, `เพิ่ม ${eligible.length} ออเดอร์ (${eligible.join(', ')})`);
  };
  const clearSelection = () => actions.setPlannerSelection([]);

  const locationEditing = state.orderLocationOrderNo ? (byOrderNo.get(state.orderLocationOrderNo) ?? null) : null;
  const locationLatNum = Number(state.orderLocationLat);
  const locationLngNum = Number(state.orderLocationLng);
  const locationPreviewValid = state.orderLocationLat.trim() !== '' && state.orderLocationLng.trim() !== '' && !Number.isNaN(locationLatNum) && !Number.isNaN(locationLngNum);

  const vehicles = vehicleSource.map((v) => {
    const orderNos = currentOrderNos(v.id);
    const sortDirection = state.routeSortDirection[v.id] ?? 'far';
    const stops = orderNos
      .map((no) => byOrderNo.get(no))
      .filter((o): o is NonNullable<typeof o> => o != null)
      .map((o, i, arr) => {
        const zone = resolveZone(state.zoneRules, o, state.geocodeCache);
        return {
          seq: i + 1,
          // Load codes count down so the first drop is loaded last.
          loadCode: loadCode(v.loadPrefix, i, arr.length),
          orderNo: o.orderNo,
          customer: o.customer,
          address: o.addressFromUnii || o.districtProvince,
          phone: o.phone,
          amtText: fmt(o.totalAmount),
          amount: o.totalAmount,
          itemCount: o.itemCount,
          paymentType: o.paymentType,
          zoneName: zone.zoneName,
          zoneColor: zone.color,
          distanceText: `${distanceOf(o).toFixed(1)} กม.`,
          mapLink: o.mapLink,
          locationSource: o.locationSource,
          // A corrected coordinate always wins the navigate link too — the
          // sheet's own mapLink was generated by Unii from the same stale
          // coordinate this override fixes, so trusting it here would send
          // the driver right back to the wrong spot. Only customers who were
          // never corrected fall back to mapLink, then a plain Google Maps
          // search link built from lat/lng, so the button always has
          // somewhere to go.
          googleMapsUrl:
            o.locationSource === 'override' && o.lat != null && o.lng != null
              ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`
              : o.mapLink || (o.lat != null && o.lng != null ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}` : ''),
          isCod: isCodPayment(o.paymentType),
          codMethod: state.routeCodMethod[o.orderNo] ?? 'cash',
          codCollected: state.routeCodCollected[o.orderNo] ?? '',
          setCodCash: () => actions.saveRouteCod(state.routeCodCollected, { ...state.routeCodMethod, [o.orderNo]: 'cash' }),
          setCodTransfer: () => actions.saveRouteCod(state.routeCodCollected, { ...state.routeCodMethod, [o.orderNo]: 'transfer' }),
          onCodCollected: (val: string) => actions.saveRouteCod({ ...state.routeCodCollected, [o.orderNo]: val.replace(/[^0-9]/g, '') }, state.routeCodMethod),
          status: o.status,
          stStyle: sheetStatusStyle(o.status),
          isDelivered: DELIVERY_DONE_STATUSES.includes(o.status),
          markDelivered: () => actions.markDelivered(o.orderNo),
          moveUp: () => {
            if (i === 0 || isVehicleLocked(v.id)) return;
            const arr2 = [...orderNos];
            [arr2[i - 1], arr2[i]] = [arr2[i], arr2[i - 1]];
            applyVehicleOrderNos(v.id, arr2);
            syncBatchAfterEdit(v.id, arr2, `เลื่อนลำดับ ${o.orderNo} ขึ้น`);
          },
          moveDown: () => {
            if (i === orderNos.length - 1 || isVehicleLocked(v.id)) return;
            const arr2 = [...orderNos];
            [arr2[i + 1], arr2[i]] = [arr2[i], arr2[i + 1]];
            applyVehicleOrderNos(v.id, arr2);
            syncBatchAfterEdit(v.id, arr2, `เลื่อนลำดับ ${o.orderNo} ลง`);
          },
          remove: () => {
            if (isVehicleLocked(v.id)) return;
            const next = orderNos.filter((n) => n !== o.orderNo);
            applyVehicleOrderNos(v.id, next);
            syncBatchAfterEdit(v.id, next, `เอาออก ${o.orderNo}`);
          },
          moveToVehicle: (toVehicleId: string) => moveOrderToVehicle(o.orderNo, v.id, toVehicleId, null),
        };
      });

    // COD tracking for this route: cash owed back at clearing excludes
    // transfers, which are already settled — same split as the COD page.
    const codStops = stops.filter((s) => s.isCod);
    let codCashExpected = 0;
    let codCashCollected = 0;
    let codTransferTotal = 0;
    for (const s of codStops) {
      if (s.codMethod === 'transfer') {
        codTransferTotal += s.amount;
      } else {
        codCashExpected += s.amount;
        codCashCollected += Number(s.codCollected || 0);
      }
    }
    const codDiff = codCashCollected - codCashExpected;

    return {
      id: v.id,
      name: v.name,
      loadPrefix: v.loadPrefix,
      crew: v.crew,
      zoneNote: v.zoneNote,
      vehicleColor: vehicleColorFor(v.id),
      stops,
      stopCount: stops.length,
      totalText: fmt(stops.reduce((a, s) => a + s.amount, 0)),
      codCount: codStops.length,
      codCashExpected,
      codCashCollected,
      codCashExpectedText: fmt(codCashExpected),
      codCashCollectedText: fmt(codCashCollected),
      codTransferTotal,
      codTransferText: fmt(codTransferTotal),
      hasCodTransfer: codTransferTotal > 0,
      codDiffText: codDiff === 0 ? 'ยอดตรง' : (codDiff > 0 ? 'เกิน +' : 'ขาด −') + fmt(Math.abs(codDiff)),
      codDiffStyle: codDiff === 0 ? badgeStyle('ok') : badgeStyle('bad'),
      codMismatch: codCashExpected > 0 && codDiff !== 0,
      // Toggles each click: applies the direction currently offered, then
      // flips it for next time — so one button alternates between
      // farthest-first (the ops sheet's usual order) and nearest-first.
      autoSequenceDirection: sortDirection,
      autoSequenceLabel: sortDirection === 'far' ? 'เรียงไกล→ใกล้' : 'เรียงใกล้→ไกล',
      autoSequenceIcon: sortDirection === 'far' ? 'ph ph-sort-descending' : 'ph ph-sort-ascending',
      autoSequenceTitle: sortDirection === 'far' ? 'เรียงจากจุดไกลคลังที่สุดไปใกล้ที่สุด' : 'เรียงจากจุดใกล้คลังที่สุดไปไกลที่สุด',
      autoSequence: () => {
        if (isVehicleLocked(v.id)) return;
        const sorted = [...orderNos].sort((a, b) => {
          const oa = byOrderNo.get(a);
          const ob = byOrderNo.get(b);
          const da = oa ? distanceOf(oa) : 0;
          const db = ob ? distanceOf(ob) : 0;
          return sortDirection === 'far' ? db - da : da - db;
        });
        applyVehicleOrderNos(v.id, sorted);
        actions.patch({ routeSortDirection: { ...state.routeSortDirection, [v.id]: sortDirection === 'far' ? 'near' : 'far' } });
        syncBatchAfterEdit(v.id, sorted, 'เรียงลำดับอัตโนมัติ');
      },
      clear: () => {
        if (isVehicleLocked(v.id)) return;
        applyVehicleOrderNos(v.id, []);
        syncBatchAfterEdit(v.id, [], `ล้างแผน (ลบ ${orderNos.length} ออเดอร์)`);
      },
      batchId: activeBatchByVehicle.get(v.id)?.id ?? null,
      batchLocked: isVehicleLocked(v.id),
      batchUnlocked: !!activeBatchByVehicle.get(v.id) && !!state.batchRouteUnlocked[activeBatchByVehicle.get(v.id)!.id],
      unlockBatch: () => {
        const b = activeBatchByVehicle.get(v.id);
        if (!b) return;
        actions.patch({ batchRouteUnlocked: { ...state.batchRouteUnlocked, [b.id]: true } });
      },
      relockBatch: () => {
        const b = activeBatchByVehicle.get(v.id);
        if (!b) return;
        const next = { ...state.batchRouteUnlocked };
        delete next[b.id];
        actions.patch({ batchRouteUnlocked: next });
      },
      mapStops: stops
        .filter((s) => {
          const o = byOrderNo.get(s.orderNo);
          return o?.lat != null && o?.lng != null;
        })
        .map((s) => {
          const o = byOrderNo.get(s.orderNo)!;
          return {
            id: s.orderNo,
            lat: o.lat as number,
            lng: o.lng as number,
            label: s.customer,
            status: '',
            color: s.zoneColor,
            zoneName: s.zoneName,
            vehicleId: v.id,
            // Short on-pin text: vehicle code + delivery sequence, e.g. "A-3".
            pinLabel: `${v.loadPrefix}-${s.seq}`,
            // Reuses the same moveUp/moveDown closures the table's own
            // "เลื่อนขึ้น/ลง" buttons call — already batch-lock-aware and
            // already logs to Activity Log, so the map's popup needs no
            // separate reorder logic of its own. `locked` mirrors the
            // table's own behavior of hiding (not just disabling) every
            // reorder/move control once a vehicle's batch is locked.
            locked: isVehicleLocked(v.id),
            canMoveUp: s.seq > 1,
            canMoveDown: s.seq < stops.length,
            moveUp: s.moveUp,
            moveDown: s.moveDown,
          };
        }),
    };
  });

  const plannedStops = vehicles.reduce((a, v) => a + v.stopCount, 0);
  const totalCrew = vehicleSource.reduce((a, v) => a + (Number.isFinite(v.crew) ? v.crew : 0), 0);
  const activeCrew = vehicles.filter((v) => v.stopCount > 0).reduce((a, v) => a + v.crew, 0);

  // Unassigned orders are plotted too, as plain gray unlabeled dots, so the
  // map still shows where the remaining work is before it's routed.
  const unassignedMapStops = unassigned
    .filter((o) => o.lat != null && o.lng != null)
    .map((o) => ({
      id: o.orderNo,
      lat: o.lat as number,
      lng: o.lng as number,
      label: o.customer,
      status: '',
      color: UNASSIGNED_COLOR,
      zoneName: 'ยังไม่จัดลงรถ',
      pinLabel: null as string | null,
      vehicleId: null as string | null,
    }));

  const allStops = [...vehicles.flatMap((v) => v.mapStops), ...unassignedMapStops];
  const { kept: mapStops, excluded: excludedStopCount } = rejectOutlierStops(allStops, warehouse);

  // Per-vehicle delivery-sequence polyline (WH -> stop 1 -> stop 2 -> ...),
  // one per vehicle with at least one plotted stop — the map draws these
  // under the pins in each vehicle's own colour.
  const vehicleRoutes = vehicles
    .filter((v) => v.mapStops.length > 0)
    .map((v) => ({ vehicleId: v.id, color: v.vehicleColor, points: v.mapStops.map((s) => ({ lat: s.lat, lng: s.lng })) }));

  // Move-target list for the map's click-to-move popup — same "not locked"
  // rule as the table's own "ย้ายไปรถคันอื่น" dropdowns.
  const vehicleOptions = vehicles.filter((v) => !v.batchLocked).map((v) => ({ id: v.id, name: v.name }));
  const onMapMoveToVehicle = (orderNo: string, fromVehicleId: string | null, toVehicleId: string) => {
    if (fromVehicleId) {
      moveOrderToVehicle(orderNo, fromVehicleId, toVehicleId, null);
    } else {
      unassigned.find((u) => u.orderNo === orderNo)?.assignTo?.(toVehicleId);
    }
  };

  const codCashExpectedTotal = vehicles.reduce((a, v) => a + v.codCashExpected, 0);
  const codCashCollectedTotal = vehicles.reduce((a, v) => a + v.codCashCollected, 0);
  const codTransferGrandTotal = vehicles.reduce((a, v) => a + v.codTransferTotal, 0);
  const codRouteCount = vehicles.filter((v) => v.codCount > 0).length;
  const codGrandDiff = codCashCollectedTotal - codCashExpectedTotal;

  const suggestByZone = () => {
    const plan: RoutePlanShape = { ...state.routePlan };
    let assignedCount = 0;
    const touchedVehicleIds = new Set<string>();
    for (const o of candidates.filter((x) => !assignedTo.has(x.orderNo))) {
      const zone = resolveZone(state.zoneRules, o, state.geocodeCache);
      if (zone.route === '—') continue;
      // Prefer the vehicle explicitly assigned this zone; only fall back to
      // matching the load prefix against the zone's route letter, since two
      // zones can share a route letter and would otherwise pile onto one truck.
      const target =
        state.vehicles.find((v) => v.zoneNote.trim() !== '' && zone.zoneName.includes(v.zoneNote.trim())) ??
        state.vehicles.find((v) => v.zoneNote.trim() !== '' && v.zoneNote.includes(zone.zoneName)) ??
        state.vehicles.find((v) => v.loadPrefix.toUpperCase() === zone.route.toUpperCase());
      if (!target || isVehicleLocked(target.id)) continue;
      plan[target.id] = [...(plan[target.id] ?? []), o.orderNo];
      assignedCount++;
      touchedVehicleIds.add(target.id);
    }
    // Keep each touched vehicle in farthest-first order after bulk
    // assignment — locked vehicles are left untouched entirely, batch or not.
    for (const id of touchedVehicleIds) {
      plan[id] = [...plan[id]].sort((a, b) => {
        const oa = byOrderNo.get(a);
        const ob = byOrderNo.get(b);
        return (ob ? distanceOf(ob) : 0) - (oa ? distanceOf(oa) : 0);
      });
    }
    actions.setRoutePlan(plan);
    if (assignedCount > 0) actions.logActivity('จัดอัตโนมัติตามโซน (วางแผนจัดรูท)', `จัดลงรถอัตโนมัติ ${assignedCount} ออเดอร์`);
    for (const id of touchedVehicleIds) {
      syncBatchAfterEdit(id, plan[id], 'จัดอัตโนมัติตามโซน');
    }
  };

  // "Assign" / "ยืนยันรูท" — turns a vehicle's current (unlocked) stop list
  // into a permanent Batch Route. Requires a concrete plannerDate since the
  // batch code is date-based and a vehicle's stops shown with no date filter
  // can span multiple delivery days.
  const assignableVehicles = vehicles.filter((v) => v.stopCount > 0 && !v.batchLocked);
  const confirmAssign = (vehicleIds: string[]) => {
    if (!canEdit || !state.plannerDate || vehicleIds.length === 0) return;
    let nextBatches = [...state.batchRoutes];
    const planPatch: RoutePlanShape = {};
    const now = new Date().toISOString();
    for (const vehicleId of vehicleIds) {
      if (isVehicleLocked(vehicleId)) continue;
      const veh = state.vehicles.find((x) => x.id === vehicleId);
      const vehicleOrderNos = currentOrderNos(vehicleId);
      if (!veh || vehicleOrderNos.length === 0) continue;
      const id = nextBatchId(nextBatches, state.plannerDate, veh.loadPrefix);
      const batch: BatchRoute = {
        id,
        vehicleId,
        vehicleName: veh.name,
        deliveryDate: state.plannerDate,
        orderNos: [...vehicleOrderNos],
        createdAt: now,
        createdBy: username,
        updatedAt: now,
        updatedBy: username,
        locked: true,
        codClosed: false,
        codClosedAt: '',
        codClosedBy: '',
        cancelled: false,
        cancelledAt: '',
        cancelledBy: '',
      };
      nextBatches = [...nextBatches, batch];
      // The batch now owns these orderNos permanently — clear the vehicle's
      // routePlan draft so it can never resurface under this vehicle on a
      // different plannerDate (the original cross-date leak: an Assign that
      // left routePlan holding the same orders forever).
      planPatch[vehicleId] = [];
      actions.logActivity('ยืนยันรูท (สร้าง Batch Route)', `${id} · ${veh.name} · ${vehicleOrderNos.length} ออเดอร์ (${vehicleOrderNos.join(', ')})`);
    }
    // setBatchRoutes's backend push now ALSO stamps every order in each new
    // batch (batch_route_id/route/assigned_driver/stop_sequence) in the same
    // transaction — see server/lib.ts's handleUpsertBatchRoutes.
    actions.setBatchRoutes(nextBatches);
    if (Object.keys(planPatch).length > 0) actions.setRoutePlan({ ...state.routePlan, ...planPatch });
    actions.patch({ assignDialogOpen: false, assignSelectedVehicleIds: [] });
  };

  return {
    loading: state.routeOrdersLoading,
    error: state.routeOrdersError,
    canEdit,
    plannerAssignSkippedMessage: state.plannerAssignSkippedMessage,
    dismissPlannerAssignSkippedMessage: () => actions.dismissPlannerAssignSkippedMessage(),
    vehicles,
    unassigned,
    unassignedCount: unassigned.length,
    allUnassignedSelected,
    toggleSelectAllUnassigned,
    selectedCount: selectedInUnassigned.length,
    assignSelectedTo,
    clearSelection,
    locationModalOpen: locationEditing !== null,
    locationOrderNo: locationEditing?.orderNo ?? '',
    locationCustomer: locationEditing?.customer ?? '',
    locationAddress: locationEditing ? locationEditing.addressFromUnii || locationEditing.districtProvince : '',
    locationOriginalText: locationEditing && locationEditing.lat != null && locationEditing.lng != null ? `${locationEditing.lat.toFixed(5)}, ${locationEditing.lng.toFixed(5)}` : 'ไม่มีข้อมูล',
    locationLat: state.orderLocationLat,
    locationLng: state.orderLocationLng,
    locationSaving: state.orderLocationSaving,
    locationError: state.orderLocationError,
    onLocationLat: (v: string) => actions.patch({ orderLocationLat: v.replace(/[^0-9.\-]/g, '') }),
    onLocationLng: (v: string) => actions.patch({ orderLocationLng: v.replace(/[^0-9.\-]/g, '') }),
    closeLocationModal: () => actions.closeEditOrderLocation(),
    locationPreviewLat: locationPreviewValid ? locationLatNum : (locationEditing?.lat ?? null),
    locationPreviewLng: locationPreviewValid ? locationLngNum : (locationEditing?.lng ?? null),
    saveLocation: () => {
      if (!locationEditing) return;
      if (!locationPreviewValid) {
        actions.patch({ orderLocationError: 'กรุณากรอกพิกัดให้ถูกต้อง (ตัวเลขเท่านั้น)' });
        return;
      }
      actions.saveOrderLocation(locationEditing.orderNo, locationEditing.customer, locationEditing.phone, locationLatNum, locationLngNum, locationEditing.lat, locationEditing.lng);
    },
    plannedStops,
    totalCrew,
    activeCrew,
    mapStops,
    excludedStopCount,
    vehicleRoutes,
    vehicleOptions,
    onMapMoveToVehicle,
    warehouse,
    plannerDate: state.plannerDate,
    onPlannerDate: (v: string) => actions.patch({ plannerDate: v }),
    clearPlannerDate: () => actions.patch({ plannerDate: '' }),
    codRouteCount,
    codCashExpectedText: fmt(codCashExpectedTotal),
    codCashCollectedText: fmt(codCashCollectedTotal),
    codTransferText: fmt(codTransferGrandTotal),
    hasCodTransfer: codTransferGrandTotal > 0,
    codGrandDiffText: codGrandDiff === 0 ? 'ยอดตรง' : (codGrandDiff > 0 ? 'เกิน +' : 'ขาด −') + fmt(Math.abs(codGrandDiff)),
    codGrandDiffStyle: codGrandDiff === 0 ? badgeStyle('ok') : badgeStyle('bad'),
    suggestByZone,
    clearAll: () => {
      const plan: RoutePlanShape = { ...state.routePlan };
      for (const v of state.vehicles) {
        if (isVehicleLocked(v.id)) continue;
        const cleared = currentOrderNos(v.id);
        if (cleared.length === 0) continue;
        if (!activeBatchByVehicle.get(v.id)) plan[v.id] = [];
        syncBatchAfterEdit(v.id, [], `ล้างแผนทั้งหมด (ลบ ${cleared.length} ออเดอร์)`);
      }
      actions.setRoutePlan(plan);
    },
    zoneLegend: state.zoneRules.map((z) => ({ id: z.id, name: z.name, color: z.color })),
    unassignedColor: UNASSIGNED_COLOR,
    configTab: state.plannerConfigTab,
    openZones: () => actions.patch({ plannerConfigTab: state.plannerConfigTab === 'zones' ? null : 'zones' }),
    openVehicles: () => actions.patch({ plannerConfigTab: state.plannerConfigTab === 'vehicles' ? null : 'vehicles' }),
    moveOrderToVehicle,

    // Batch Route — "Assign"/"ยืนยันรูท" confirmation step
    plannerTab: state.plannerTab,
    setPlannerTab: (tab: 'plan' | 'history') => actions.patch({ plannerTab: tab }),
    canAssign: canEdit && !!state.plannerDate,
    assignDialogOpen: state.assignDialogOpen,
    assignableVehicles: assignableVehicles.map((v) => ({ id: v.id, name: v.name, stopCount: v.stopCount, totalText: v.totalText })),
    assignSelectedVehicleIds: state.assignSelectedVehicleIds,
    // Opened from a specific vehicle's header button — pre-selects just that
    // vehicle, but the dialog's own checkboxes still allow adding others
    // (e.g. to assign the whole day's fleet at once from one click).
    openAssignDialog: (vehicleId: string) => actions.patch({ assignDialogOpen: true, assignSelectedVehicleIds: [vehicleId] }),
    closeAssignDialog: () => actions.patch({ assignDialogOpen: false }),
    toggleAssignVehicle: (vehicleId: string) => {
      const cur = state.assignSelectedVehicleIds;
      actions.patch({ assignSelectedVehicleIds: cur.includes(vehicleId) ? cur.filter((id) => id !== vehicleId) : [...cur, vehicleId] });
    },
    toggleAssignAll: () => {
      const allIds = assignableVehicles.map((v) => v.id);
      const allSelected = allIds.length > 0 && allIds.every((id) => state.assignSelectedVehicleIds.includes(id));
      actions.patch({ assignSelectedVehicleIds: allSelected ? [] : allIds });
    },
    confirmAssign,

    // Driver "จองคิว" — booking-request badges/confirm-reject wired into the
    // unassigned rows above; this is just the shared error surface for that.
    bookingActionError: state.bookingActionError,

    // "ออเดอร์ค้าง/เลยกำหนด" banner — see the noDeliveryDateCount/
    // overdueUnassignedCount computation above for the exact scope (still
    // unassigned, any planner date). Clicking either count clears
    // plannerDate (revealing every date's unassigned pool) and applies a
    // local highlight/filter in PlannerPage.tsx over the noDeliveryDate/
    // isOverdue flags each unassigned row already carries.
    noDeliveryDateCount,
    overdueUnassignedCount,
  };
}

type RoutePlanShape = Record<string, string[]>;

// ---------- DRIVER: date selection + route detail for a picked Batch Route ----------
/** One vehicle's Batch Route dates, nearest-to-today first (today itself
 * ranks first, then the closest date on either side) — computePlanner's own
 * per-vehicle stops are scoped to whatever state.plannerDate the admin
 * currently has the desktop Planner set to, which is a single global value
 * with no way for a driver to pick a different day; this reads the
 * permanent Batch Route records directly instead; scoped to the driver's
 * own vehicle whenever the account is actually a driver. */
export function computeDriverBatches(state: AppState, vehicleId: string) {
  const byOrderNo = new Map(state.routeOrders.map((o) => [o.orderNo, o]));
  const today = todayDayKey();

  const rows = state.batchRoutes
    .filter((b) => b.vehicleId === vehicleId && !b.cancelled)
    .map((b) => {
      const orders = b.orderNos.map((no) => byOrderNo.get(no)).filter((o): o is RouteOrder => o != null);
      const deliveredCount = orders.filter((o) => DELIVERY_DONE_STATUSES.includes(o.status)).length;
      const statusLabel = deliveredCount === 0 ? 'ยังไม่เริ่ม' : deliveredCount < b.orderNos.length ? 'กำลังส่ง' : 'ส่งครบแล้ว';
      const statusStyle = deliveredCount === 0 ? badgeStyle('neutral') : deliveredCount < b.orderNos.length ? badgeStyle('warn') : badgeStyle('ok');
      const d = dayKeyToDate(b.deliveryDate);
      return {
        id: b.id,
        dateIso: b.deliveryDate,
        dateText: d ? formatThaiWeekdayDate(d) : b.deliveryDate || '—',
        isToday: b.deliveryDate === today,
        stopCount: b.orderNos.length,
        totalText: fmt(orders.reduce((sum, o) => sum + o.totalAmount, 0)),
        statusLabel,
        statusStyle,
        deliveredCount,
        codClosed: b.codClosed,
        distanceFromToday: b.deliveryDate ? Math.abs(daysBetweenKeys(b.deliveryDate, today)) : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.distanceFromToday - b.distanceFromToday || (a.dateIso < b.dateIso ? 1 : -1));

  return { rows, isEmpty: rows.length === 0 };
}

/** Route detail for one already-picked Batch Route — reads stops from the
 * batch's own frozen orderNos (the durable, historically-accurate record for
 * that date) rather than state.routePlan (the live, currently-being-edited
 * plan, which has already moved on by the time a driver looks back at
 * yesterday's run). No reorder/remove/move-to-vehicle controls here — those
 * only make sense for the admin's live, unlocked plan, not a driver's
 * read-mostly view of a locked historical batch. */
export function computeDriverRouteDetail(state: AppState, actions: AppActions, batch: BatchRoute) {
  const resolved = resolveRouteOrderLocations(state.routeOrders, state.customers);
  const byOrderNo = new Map(resolved.map((o) => [o.orderNo, o]));
  const wh = resolved.find((o) => o.whLat != null && o.whLng != null);
  const warehouse = wh && wh.whLat != null && wh.whLng != null ? { lat: wh.whLat, lng: wh.whLng } : null;
  const vehicle = state.vehicles.find((v) => v.id === batch.vehicleId) ?? null;

  const stops = batch.orderNos
    .map((no) => byOrderNo.get(no))
    .filter((o): o is NonNullable<typeof o> => o != null)
    .map((o, i, arr) => {
      const zone = resolveZone(state.zoneRules, o, state.geocodeCache);
      const distanceKm =
        o.locationSource === 'override'
          ? warehouse && o.lat != null && o.lng != null
            ? haversineKm(warehouse.lat, warehouse.lng, o.lat, o.lng)
            : 0
          : (o.distanceFromWhKm ?? (warehouse && o.lat != null && o.lng != null ? haversineKm(warehouse.lat, warehouse.lng, o.lat, o.lng) : 0));
      const deliveryFailure = state.deliveryFailures[o.orderNo] ?? null;
      return {
        seq: i + 1,
        loadCode: vehicle ? loadCode(vehicle.loadPrefix, i, arr.length) : '',
        orderNo: o.orderNo,
        customer: o.customer,
        address: o.addressFromUnii || o.districtProvince,
        phone: o.phone,
        amtText: fmt(o.totalAmount),
        itemCount: o.itemCount,
        zoneColor: zone.color,
        distanceText: `${distanceKm.toFixed(1)} กม.`,
        googleMapsUrl:
          o.locationSource === 'override' && o.lat != null && o.lng != null
            ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`
            : o.mapLink || (o.lat != null && o.lng != null ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}` : ''),
        isCod: isCodPayment(o.paymentType),
        codMethod: state.routeCodMethod[o.orderNo] ?? 'cash',
        codCollected: state.routeCodCollected[o.orderNo] ?? '',
        setCodCash: () => actions.saveRouteCod(state.routeCodCollected, { ...state.routeCodMethod, [o.orderNo]: 'cash' }),
        setCodTransfer: () => actions.saveRouteCod(state.routeCodCollected, { ...state.routeCodMethod, [o.orderNo]: 'transfer' }),
        onCodCollected: (val: string) => actions.saveRouteCod({ ...state.routeCodCollected, [o.orderNo]: val.replace(/[^0-9]/g, '') }, state.routeCodMethod),
        status: o.status,
        stStyle: sheetStatusStyle(o.status),
        isDelivered: DELIVERY_DONE_STATUSES.includes(o.status),
        markDelivered: () => actions.markDelivered(o.orderNo),
        deliveryFailure,
        openDeliveryFailureDialog: () => actions.openDeliveryFailureDialog(o.orderNo),
      };
    });

  const codStops = stops.filter((s) => s.isCod);
  let codCashExpected = 0;
  let codCashCollected = 0;
  for (const s of codStops) {
    if (s.codMethod === 'transfer') continue;
    codCashExpected += Number(byOrderNo.get(s.orderNo)?.totalAmount ?? 0);
    codCashCollected += Number(s.codCollected || 0);
  }
  const codDiff = codCashCollected - codCashExpected;

  const d = dayKeyToDate(batch.deliveryDate);
  return {
    batchId: batch.id,
    dateText: d ? formatThaiWeekdayDate(d) : batch.deliveryDate || '—',
    stops,
    stopCount: stops.length,
    totalText: fmt(stops.reduce((sum, s) => sum + (byOrderNo.get(s.orderNo)?.totalAmount ?? 0), 0)),
    codCount: codStops.length,
    codCashExpectedText: fmt(codCashExpected),
    codCashCollectedText: fmt(codCashCollected),
    codDiffText: codDiff === 0 ? 'ยอดตรง' : (codDiff > 0 ? 'เกิน +' : 'ขาด −') + fmt(Math.abs(codDiff)),
    codDiffStyle: codDiff === 0 ? badgeStyle('ok') : badgeStyle('bad'),
  };
}

/** Pre-departure SKU checklist for one batch — every SKU across every order
 * in it, quantities summed, same merge-by-sku pattern as the batch-picking
 * lot builder (see createPickLot in store.ts): one line per SKU regardless
 * of how many orders it's split across, not one line per order-line-item. */
export function computeDriverChecklist(state: AppState, actions: AppActions, batch: BatchRoute) {
  const merged = new Map<string, { sku: string; name: string; unit: string; totalQty: number }>();
  for (const li of state.orderLineItems) {
    if (!batch.orderNos.includes(li.orderNo)) continue;
    const existing = merged.get(li.sku);
    if (existing) {
      existing.totalQty += li.qty;
    } else {
      merged.set(li.sku, { sku: li.sku, name: li.productName, unit: li.unit, totalQty: li.qty });
    }
  }

  const checklist = state.preDepartureChecklists[batch.id] ?? { checkedSkus: [], confirmedAt: null, confirmedBy: '' };
  const items = Array.from(merged.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((line) => ({
      ...line,
      checked: checklist.checkedSkus.includes(line.sku),
      toggle: () => actions.toggleChecklistSku(batch.id, line.sku, state.preDepartureChecklists),
    }));

  const checkedCount = items.filter((i) => i.checked).length;
  return {
    items,
    totalCount: items.length,
    checkedCount,
    allChecked: items.length > 0 && checkedCount === items.length,
    isEmpty: items.length === 0,
    confirmed: checklist.confirmedAt != null,
    confirmedAtText: checklist.confirmedAt ? formatDateTime(new Date(checklist.confirmedAt).getTime()) : null,
    confirm: () => actions.confirmChecklist(batch.id, `${batch.id} · ${batch.vehicleName}`, checkedCount, items.length, state.preDepartureChecklists),
  };
}

// ---------- DRIVER "จองคิว" (stop booking) ----------
/** Full unassigned-stops pool for the Driver's own booking picker — same
 * underlying candidate pool as computePlanner's own "unassigned" table
 * (deliberately NOT scoped to isDriverView the way that one is, since a
 * driver booking a stop needs to see every unclaimed stop across the whole
 * fleet, not just whatever their own vehicle already has). */
export function computeDriverBooking(state: AppState, actions: AppActions) {
  const role = state.session?.role;
  const canBook = role ? canBookStop(role) : false;
  const username = state.session?.username ?? '';

  // Customer-corrected coordinates always win over the raw Unii ones — see
  // src/data/customerLocation.ts.
  const routeOrders = resolveRouteOrderLocations(state.routeOrders, state.customers);

  const candidates = routeOrders.filter((o) => {
    if (o.archived) return false;
    if (DELIVERY_DONE_STATUSES.includes(o.status)) return false;
    if (state.plannerDate && effectiveDeliveryDayKey(o) !== state.plannerDate) return false;
    return true;
  });
  const assignedOrderNos = new Set(Object.values(state.routePlan).flat());
  const unassigned = candidates.filter((o) => !assignedOrderNos.has(o.orderNo));

  const wh = routeOrders.find((o) => o.whLat != null && o.whLng != null);
  const warehouse = wh && wh.whLat != null && wh.whLng != null ? { lat: wh.whLat, lng: wh.whLng } : null;
  const distanceOf = (o: (typeof candidates)[number]) =>
    o.locationSource === 'override'
      ? warehouse && o.lat != null && o.lng != null
        ? haversineKm(warehouse.lat, warehouse.lng, o.lat, o.lng)
        : 0
      : (o.distanceFromWhKm ?? (warehouse && o.lat != null && o.lng != null ? haversineKm(warehouse.lat, warehouse.lng, o.lat, o.lng) : 0));

  // Both pending and already-confirmed requests lock a stop from this view —
  // once confirmed it's about to become part of a real routePlan/batch
  // anyway, so it shouldn't be re-offered to other drivers in the meantime.
  const activeBookingByOrderNo = new Map<string, BookingRow>();
  for (const b of state.bookings) {
    if (b.status !== 'pending' && b.status !== 'confirmed') continue;
    const cur = activeBookingByOrderNo.get(b.orderNo);
    if (!cur || b.bookedAt > cur.bookedAt) activeBookingByOrderNo.set(b.orderNo, b);
  }

  const rows = unassigned
    .map((o) => {
      const booking = activeBookingByOrderNo.get(o.orderNo) ?? null;
      const bookedByMe = booking?.driverUsername === username;
      const bookedByOther = booking != null && !bookedByMe;
      return {
        orderNo: o.orderNo,
        customer: o.customer,
        address: o.addressFromUnii || o.districtProvince,
        districtProvince: o.districtProvince || '—',
        phone: o.phone || '—',
        amtText: fmt(o.totalAmount),
        itemCount: o.itemCount,
        distanceKm: distanceOf(o),
        distanceText: `${distanceOf(o).toFixed(1)} กม.`,
        plannedDeliveryDateText: o.plannedDeliveryDate || '—',
        note: o.note,
        hasNote: o.note.trim() !== '',
        bookedByOther,
        bookedByMe,
        bookedByLabel: booking ? (bookedByMe ? (booking.status === 'confirmed' ? 'ยืนยันแล้ว (คุณ)' : 'จองแล้ว (คุณ)') : `จองแล้วโดย ${booking.driverUsername}`) : null,
        selected: !bookedByOther && state.bookingSelectedOrderNos.includes(o.orderNo),
        toggleSelect: () => {
          if (bookedByOther) return;
          actions.toggleBookingSelect(o.orderNo, state.bookingSelectedOrderNos);
        },
      };
    })
    .sort((a, b) => b.distanceKm - a.distanceKm);

  const rowOrderNos = new Set(rows.map((r) => r.orderNo));
  const selectedCount = state.bookingSelectedOrderNos.filter((no) => rowOrderNos.has(no)).length;

  return {
    canBook,
    loading: state.routeOrdersLoading,
    error: state.routeOrdersError,
    rows,
    isEmpty: rows.length === 0,
    selectedCount,
    submitting: state.bookingSubmitting,
    submitError: state.bookingSubmitError,
    conflictOrderNos: state.bookingConflictOrderNos,
    clearConflicts: () => actions.clearBookingConflicts(),
    clearSelection: () => actions.clearBookingSelection(),
    submit: () => actions.submitBookingRequests(state.bookingSelectedOrderNos),
  };
}

// ---------- BATCH ROUTE HISTORY ----------
/** Read-only audit view of every Batch Route ever assigned — reuses the same
 * routeOrders/routeCod state the Planner and COD pages already read, rather
 * than tracking its own copy of sales/COD figures (so it can never drift
 * from what "เคลียร์เงิน COD" shows for the same orders). */
export function computeBatchRouteHistory(state: AppState, actions: AppActions) {
  const byOrderNo = new Map(state.routeOrders.map((o) => [o.orderNo, o]));
  const q = state.batchRouteQ.trim().toLowerCase();
  const role = state.session?.role;
  const canCancel = role ? canCancelBatchRoute(role) : false;

  const rows = state.batchRoutes
    .filter((b) => !q || b.id.toLowerCase().includes(q) || b.deliveryDate.includes(q) || b.vehicleName.toLowerCase().includes(q))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((b) => {
      const orders = b.orderNos.map((no) => byOrderNo.get(no)).filter((o): o is RouteOrder => o != null);
      const totalAmount = orders.reduce((a, o) => a + o.totalAmount, 0);
      let codCashExpected = 0;
      let codCashCollected = 0;
      let codTransferTotal = 0;
      for (const o of orders) {
        if (!isCodPayment(o.paymentType)) continue;
        const method = state.routeCodMethod[o.orderNo] ?? 'cash';
        if (method === 'transfer') {
          codTransferTotal += o.totalAmount;
        } else {
          codCashExpected += o.totalAmount;
          codCashCollected += Number(state.routeCodCollected[o.orderNo] || 0);
        }
      }
      const deliveredCount = orders.filter((o) => DELIVERY_DONE_STATUSES.includes(o.status)).length;
      const missingOrderNos = b.orderNos.filter((no) => !byOrderNo.has(no));
      // Actually-delivered count only (excludes an order Unii itself
      // cancelled upstream) — the one thing that permanently blocks
      // "ยกเลิก Batch Route", see cancelBatchRoute in store.ts.
      const actuallyDeliveredCount = orders.filter((o) => DELIVERED_STATUSES.includes(o.status)).length;
      const cancelBlockedReason =
        actuallyDeliveredCount > 0 ? `มี ${actuallyDeliveredCount} ออเดอร์ส่งสำเร็จแล้ว ไม่สามารถยกเลิก batch นี้ได้` : '';

      return {
        id: b.id,
        vehicleName: b.vehicleName,
        deliveryDate: b.deliveryDate,
        deliveryDateText: (() => {
          const d = dayKeyToDate(b.deliveryDate);
          return d ? formatThaiShortDate(d) : b.deliveryDate;
        })(),
        orderCount: b.orderNos.length,
        totalText: fmt(totalAmount),
        codCashExpectedText: fmt(codCashExpected),
        codCashCollectedText: fmt(codCashCollected),
        codDiffText: codCashCollected - codCashExpected === 0 ? 'ยอดตรง' : fmt(codCashCollected - codCashExpected),
        codTransferText: fmt(codTransferTotal),
        hasCodTransfer: codTransferTotal > 0,
        deliveredCount,
        deliveredText: `${deliveredCount}/${orders.length}`,
        locked: b.locked,
        createdBy: b.createdBy,
        createdAtText: formatDateTime(new Date(b.createdAt).getTime()),
        updatedBy: b.updatedBy,
        updatedAtText: formatDateTime(new Date(b.updatedAt).getTime()),
        edited: b.updatedAt !== b.createdAt,
        missingCount: missingOrderNos.length,
        // COD-clearing status — the same codClosed/codClosedAt/codClosedBy
        // fields the COD Clearing page's own "ปิดยอดรอบนี้ (batch)" button
        // writes, so both pages read one shared source of truth.
        codClosed: b.codClosed,
        codClosedBy: b.codClosedBy,
        codClosedAtText: b.codClosedAt ? formatDateTime(new Date(b.codClosedAt).getTime()) : '',
        // Edited (membership changed) after its COD round was already
        // closed — same "needs re-checking" signal the COD page itself shows.
        codEditedAfterClose: b.codClosed && b.updatedAt > b.codClosedAt,
        // "ยกเลิก Batch Route" — never allowed once any order in it has
        // actually delivered, and never offered twice.
        cancelled: b.cancelled,
        cancelledBy: b.cancelledBy,
        cancelledAtText: b.cancelledAt ? formatDateTime(new Date(b.cancelledAt).getTime()) : '',
        canCancelRole: canCancel,
        canCancel: canCancel && !b.cancelled && actuallyDeliveredCount === 0,
        cancelBlockedReason,
        cancelOrderCount: b.orderNos.length,
        cancel: () => actions.cancelBatchRoute(b.id, state.batchRoutes, state.routeOrders),
        stops: orders.map((o) => ({
          orderNo: o.orderNo,
          customer: o.customer,
          amtText: fmt(o.totalAmount),
          status: o.status,
          stStyle: sheetStatusStyle(o.status),
        })),
      };
    });

  return {
    q: state.batchRouteQ,
    onSearch: (v: string) => actions.patch({ batchRouteQ: v }),
    rows,
    isEmpty: rows.length === 0,
    totalCount: state.batchRoutes.length,
  };
}

// ---------- ROUTE CALENDAR (Planner's third tab — month view) ----------
const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const CALENDAR_WEEKDAY_HEADERS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export interface RouteCalendarDay {
  dayKey: string;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
  orderCount: number;
  batchCount: number;
  hasData: boolean;
  totalText: string;
  cashText: string;
  transferText: string;
  /** Prepaid (non-COD, already settled via Unii before delivery) total —
   * distinct from the COD "โอน" figure above, which is COD money the driver
   * collects by transfer at the door. */
  prepaidText: string;
  /** Distinct vehicles with a confirmed batch for this day (0 if none assigned yet). */
  vehicleCount: number;
  /** Top 2-3 statuses by order count, formatted for the small calendar cell
   * (e.g. "ส่งสำเร็จ 12 · กำลังจัดส่ง 3") — the popup shows every status. */
  statusSummaryText: string;
}

/** Month grid + per-day summary (order count, batch count, cash/transfer
 * split) for the Planner's "Route Calendar" tab — year/month are passed in
 * explicitly rather than read off global state, since which month is being
 * viewed is transient UI navigation local to RouteCalendarPanel, the same
 * way BatchRouteHistoryPanel keeps its own accordion-open state locally. */
export function computeRouteCalendar(state: AppState, year: number, month: number) {
  const today = todayDayKey();

  const ordersByDay = new Map<string, RouteOrder[]>();
  for (const o of state.routeOrders) {
    const key = effectiveDeliveryDayKey(o);
    if (!key) continue;
    const arr = ordersByDay.get(key);
    if (arr) arr.push(o);
    else ordersByDay.set(key, [o]);
  }
  const batchesByDay = new Map<string, BatchRoute[]>();
  for (const b of state.batchRoutes) {
    const arr = batchesByDay.get(b.deliveryDate);
    if (arr) arr.push(b);
    else batchesByDay.set(b.deliveryDate, [b]);
  }
  const assignedOrderNos = new Set(Object.values(state.routePlan).flat());
  const byOrderNo = new Map(state.routeOrders.map((o) => [o.orderNo, o]));

  const daySummary = (key: string) => {
    const dayOrders = ordersByDay.get(key) ?? [];
    const dayBatches = batchesByDay.get(key) ?? [];
    let totalSales = 0;
    let cashExpected = 0;
    let transferTotal = 0;
    // Prepaid = anything NOT flagged COD. This app's only payment-type
    // signal is the sheet's "การจ่ายเงิน" column (see isCodPayment) — it
    // already reads as a binary "collect at the door" vs "already settled"
    // split, so no separate sheet field is needed to know this figure; a
    // dedicated prepaid/paid-status column would only be worth adding if a
    // future paymentType value stops mapping cleanly to one side or the other.
    let prepaidTotal = 0;
    const statusCounts = new Map<string, number>();
    for (const o of dayOrders) {
      totalSales += o.totalAmount;
      const statusLabel = o.status || 'ไม่ระบุสถานะ';
      statusCounts.set(statusLabel, (statusCounts.get(statusLabel) ?? 0) + 1);
      if (isCodPayment(o.paymentType)) {
        const method = state.routeCodMethod[o.orderNo] ?? 'cash';
        if (method === 'transfer') transferTotal += o.totalAmount;
        else cashExpected += o.totalAmount;
      } else {
        prepaidTotal += o.totalAmount;
      }
    }
    const vehicleCount = new Set(dayBatches.map((b) => b.vehicleId)).size;
    const statusBreakdown = Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
    return { dayOrders, dayBatches, totalSales, cashExpected, transferTotal, prepaidTotal, vehicleCount, statusBreakdown };
  };

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const allDays: RouteCalendarDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, month, 1 - firstWeekday + i);
    const key = dayKey(d);
    const { dayOrders, dayBatches, totalSales, cashExpected, transferTotal, prepaidTotal, vehicleCount, statusBreakdown } = daySummary(key);
    allDays.push({
      dayKey: key,
      dayNum: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: key === today,
      orderCount: dayOrders.length,
      batchCount: dayBatches.length,
      hasData: dayOrders.length > 0 || dayBatches.length > 0,
      totalText: fmt(totalSales),
      cashText: fmt(cashExpected),
      transferText: fmt(transferTotal),
      prepaidText: fmt(prepaidTotal),
      vehicleCount,
      statusSummaryText: statusBreakdown
        .slice(0, 3)
        .map((s) => `${s.status} ${s.count}`)
        .join(' · '),
    });
  }

  const weeks: RouteCalendarDay[][] = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  /** Full popup detail for one day, computed on demand (only when a day is
   * actually clicked) rather than for all ~35 cells up front. */
  const dayDetail = (key: string) => {
    const { dayOrders, dayBatches, totalSales, cashExpected, transferTotal, prepaidTotal, vehicleCount, statusBreakdown } = daySummary(key);
    const unassignedCount = dayOrders.filter((o) => !assignedOrderNos.has(o.orderNo)).length;
    const d = dayKeyToDate(key);
    return {
      dayKey: key,
      dateText: d ? formatThaiWeekdayDate(d) : key,
      orderCount: dayOrders.length,
      unassignedCount,
      totalText: fmt(totalSales),
      cashText: fmt(cashExpected),
      transferText: fmt(transferTotal),
      hasCod: cashExpected > 0 || transferTotal > 0,
      prepaidText: fmt(prepaidTotal),
      hasPrepaid: prepaidTotal > 0,
      vehicleCount,
      statusBreakdown,
      batches: dayBatches
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((b) => ({
          id: b.id,
          vehicleName: b.vehicleName,
          orderCount: b.orderNos.length,
          totalText: fmt(b.orderNos.reduce((sum, no) => sum + (byOrderNo.get(no)?.totalAmount ?? 0), 0)),
          locked: b.locked,
          codClosed: b.codClosed,
        })),
    };
  };

  return {
    year,
    month,
    monthLabel: `${THAI_MONTHS_FULL[month]} ${year}`,
    weekdayHeaders: CALENDAR_WEEKDAY_HEADERS,
    weeks,
    dayDetail,
  };
}

// ---------- BATCH PICKING ("คำสั่งซื้อ" tab — status = "กำลังดำเนินการ") ----------
const PICK_ROW_BASE: CSSProperties = { display: 'flex', alignItems: 'center', gap: 13, width: '100%', padding: '12px 14px', border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', borderRadius: 12, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', transition: 'box-shadow .12s' };
const PICK_BOX_BASE: CSSProperties = { width: 30, height: 30, flex: 'none', borderRadius: 8, display: 'grid', placeItems: 'center' };

function computePickOrderSelection(state: AppState, actions: AppActions) {
  // An order already sitting in some lot (open or closed) shouldn't be
  // offered again — it's either mid-pick or already past this stage,
  // regardless of whether its sheet status write has confirmed yet.
  const alreadyInALot = new Set(state.pickLots.flatMap((l) => l.orderNos));
  const q = state.pickOrderQ.trim().toLowerCase();

  const candidates = state.routeOrders.filter((o) => {
    if (o.archived) return false;
    if (o.status !== 'กำลังดำเนินการ') return false;
    if (alreadyInALot.has(o.orderNo)) return false;
    // Gate: no delivery date yet — can't be lotted for picking. Hidden
    // outright here (unlike Order Management's "รอจัด Batch", which shows
    // these with a badge) since the spec for this page is "must not appear
    // in the list that can be picked at all."
    if (effectiveDeliveryDayKey(o) === null) return false;
    if (q && !(o.customer.toLowerCase().includes(q) || o.orderNo.toLowerCase().includes(q))) return false;
    return true;
  });

  const rows = candidates.map((o) => ({
    orderNo: o.orderNo,
    customer: o.customer,
    itemCountText: o.itemCount.toLocaleString('en-US'),
    amtText: fmt(o.totalAmount),
    orderedDate: o.orderedDate || '—',
    plannedDeliveryDate: o.plannedDeliveryDate || '—',
    checked: state.pickSelectedOrderNos.includes(o.orderNo),
    toggle: () => actions.togglePickOrderSelection(o.orderNo, state.pickSelectedOrderNos),
    viewItems: () => actions.openOrderDetail(o.orderNo, o.customer, o),
  }));

  const lotProgress = (l: PickLot) => {
    const total = l.lines.length;
    const done = l.lines.filter((line) => l.picked[line.sku]).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  };

  const role = state.session?.role;
  const canCancelLot = role ? canCancelPickLot(role) : false;

  const openLots = state.pickLots
    .filter((l) => !l.closed)
    .map((l) => {
      const p = lotProgress(l);
      return {
        id: l.id,
        orderCount: l.orderNos.length,
        skuCount: p.total,
        doneCount: p.done,
        pct: p.pct,
        createdAtText: formatThaiShortDate(new Date(l.createdAt)),
        resume: () => actions.openPickLot(l.id),
        canCancel: canCancelLot,
        cancel: () => actions.cancelPickLot(l.id, state.pickLots, state.activePickLotId),
      };
    });

  const recentClosedLots = state.pickLots
    .filter((l) => l.closed)
    .slice(0, 5)
    .map((l) => ({
      id: l.id,
      orderCount: l.orderNos.length,
      skuCount: l.lines.length,
      createdAtText: formatThaiShortDate(new Date(l.createdAt)),
      pendingSyncCount: l.statusSyncPending.length,
      view: () => actions.openPickLot(l.id),
    }));

  return {
    mode: 'select' as const,
    canWork: role ? canPickWork(role) : false,
    loading: state.routeOrdersLoading,
    error: state.routeOrdersError,
    q: state.pickOrderQ,
    onSearch: (v: string) => actions.patch({ pickOrderQ: v }),
    rows,
    resultCount: rows.length,
    isEmpty: rows.length === 0,
    selectedCount: state.pickSelectedOrderNos.length,
    creating: state.pickCreating,
    createError: state.pickCreateError,
    createLot: () => actions.createPickLot(state.pickSelectedOrderNos, state.routeOrders, state.skus, state.pickLots),
    clearSelection: () => actions.clearPickOrderSelection(),
    openLots,
    hasOpenLots: openLots.length > 0,
    recentClosedLots,
    hasRecentClosedLots: recentClosedLots.length > 0,
  };
}

function computePickLotDetail(state: AppState, actions: AppActions, lot: PickLot) {
  let pk = 0;
  const pickItems = lot.lines.map((line) => {
    const on = !!lot.picked[line.sku];
    if (on) pk++;
    return {
      sku: line.sku,
      name: line.name,
      qty: line.totalQty,
      unit: line.unit,
      loc: line.location || '—',
      perOrderText: line.perOrder.map((p) => `${p.customer} (${p.orderNo}) ×${p.qty}`).join(', '),
      toggle: () => actions.togglePickItem(lot.id, line.sku, state.pickLots),
      rowStyle: on ? { ...PICK_ROW_BASE, boxShadow: 'inset 0 0 0 1.5px var(--color-accent-700)' } : PICK_ROW_BASE,
      boxStyle: on ? { ...PICK_BOX_BASE, background: 'var(--color-accent)', color: '#fff' } : { ...PICK_BOX_BASE, boxShadow: 'inset 0 0 0 2px var(--color-neutral-600)', color: 'transparent' },
      checkVis: on ? {} : { opacity: 0 },
      textStyle: on ? ({ textDecoration: 'line-through', color: 'var(--color-neutral-500)' } as CSSProperties) : {},
    };
  });

  const total = lot.lines.length;
  const pickPct = total ? Math.round((pk / total) * 100) : 0;
  const complete = pk === total && total > 0;

  const role = state.session?.role;
  return {
    mode: 'lot' as const,
    canWork: role ? canPickWork(role) : false,
    canClose: role ? canClosePickLot(role) : false,
    lotId: lot.id,
    orderNos: lot.orderNos,
    orderSummaries: lot.orderSummaries,
    pickTotal: total,
    pickedCount: pk,
    pickPct,
    pickItems,
    isEmpty: total === 0,
    pickClosed: lot.closed,
    pickCloseDisabled: !complete || lot.closed || !(role ? canClosePickLot(role) : false),
    pickBtnLabel: lot.closed ? 'ปิดล็อตแล้ว' : complete ? 'ปิดล็อต — อัปเดตสถานะออเดอร์' : 'หยิบให้ครบก่อนปิดล็อต',
    closePick: () => actions.closePickLot(lot.id, state.pickLots),
    back: () => actions.backToPickerHome(),
    hasNoLineOrders: lot.ordersWithNoLines.length > 0,
    noLineOrdersText: lot.ordersWithNoLines.join(', '),
    hasPendingSync: lot.statusSyncPending.length > 0,
    pendingSyncText: lot.statusSyncPending.join(', '),
    retrySync: () => actions.retryPickLotStatusSync(lot.statusSyncPending),
    canCancel: !lot.closed && (role ? canCancelPickLot(role) : false),
    cancelOrderCount: lot.orderNos.length,
    cancel: () => actions.cancelPickLot(lot.id, state.pickLots, state.activePickLotId),
  };
}

export function computePick(state: AppState, actions: AppActions) {
  const activeLot = state.pickLots.find((l) => l.id === state.activePickLotId) ?? null;
  if (activeLot) return computePickLotDetail(state, actions, activeLot);
  return computePickOrderSelection(state, actions);
}

// ---------- COD ----------
/** Groups the same per-order COD tracking the Planner page and DriverPage
 * already read/write (state.routeCodCollected/routeCodMethod) by Batch
 * Route instead of by driver name — one batch route is exactly one
 * clearing round, so "closing" here just stamps that batch's own
 * codClosed/codClosedAt/codClosedBy fields (src/data/batchRoutes.ts), the
 * same record the Batch Route History page reads for its own status badge. */
export function computeCod(state: AppState, actions: AppActions) {
  const role = state.session?.role;
  const isDriverView = role === 'driver';
  // A driver only ever sees their own vehicle's batches; everyone else can
  // optionally narrow the tab list by vehicle via the filter dropdown.
  const effectiveVehicleFilter = isDriverView ? state.session?.driverVehicleId || 'all' : state.codVehicleFilter;

  const byOrderNo = new Map(state.routeOrders.map((o) => [o.orderNo, o]));

  const vehicleFilterOptions = Array.from(new Map(state.batchRoutes.map((b) => [b.vehicleId, b.vehicleName])).entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const visibleBatches = state.batchRoutes
    .filter((b) => !b.cancelled && (effectiveVehicleFilter === 'all' || b.vehicleId === effectiveVehicleFilter))
    // Newest first — same ordering as the Batch Route History page.
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const selectedBatch = visibleBatches.find((b) => b.id === state.codBatchId) ?? visibleBatches[0] ?? null;

  const batchTabs = visibleBatches.map((b) => ({
    id: b.id,
    label: `${b.id} · ${b.vehicleName}`,
    codClosed: b.codClosed,
    active: b.id === selectedBatch?.id,
    go: () => actions.patch({ codBatchId: b.id }),
  }));

  const batchOrders = selectedBatch
    ? selectedBatch.orderNos.map((no) => byOrderNo.get(no)).filter((o): o is RouteOrder => o != null)
    : [];
  const codOrders = batchOrders.filter((o) => isCodPayment(o.paymentType));
  const isClosed = selectedBatch?.codClosed ?? false;

  let expSum = 0; // everything this batch had to collect, cash + transfer
  let cashExpected = 0; // the cash portion — the only part handed back
  let transferSum = 0;
  let cashReturned = 0;

  const codRows = codOrders.map((o) => {
    const method = state.routeCodMethod[o.orderNo] ?? 'cash';
    const isTransfer = method === 'transfer';
    const ret = state.routeCodCollected[o.orderNo] ?? '';
    const retN = ret === '' ? null : Number(ret);

    expSum += o.totalAmount;
    if (isTransfer) {
      transferSum += o.totalAmount;
    } else {
      cashExpected += o.totalAmount;
      cashReturned += retN || 0;
    }

    // A transfer is already in the company account, so there is no cash to
    // reconcile — only cash rows can be short or over.
    let diffText = '—';
    let diffStyle = badgeStyle('neutral');
    if (isTransfer) {
      diffText = 'โอนแล้ว';
      diffStyle = badgeStyle('info');
    } else if (retN != null) {
      const diff = retN - o.totalAmount;
      if (diff === 0) {
        diffText = 'ตรง';
        diffStyle = badgeStyle('ok');
      } else {
        diffText = (diff > 0 ? '+' : '−') + fmt(Math.abs(diff));
        diffStyle = badgeStyle('bad');
      }
    }

    return {
      id: o.orderNo,
      cust: o.customer,
      expectedText: fmt(o.totalAmount),
      returned: ret,
      isTransfer,
      isCash: !isTransfer,
      methodLabel: isTransfer ? 'โอน' : 'เงินสด',
      setCash: () => actions.saveRouteCod(state.routeCodCollected, { ...state.routeCodMethod, [o.orderNo]: 'cash' }),
      setTransfer: () => actions.saveRouteCod(state.routeCodCollected, { ...state.routeCodMethod, [o.orderNo]: 'transfer' }),
      diffText,
      diffStyle,
      onInput: (v: string) => actions.saveRouteCod({ ...state.routeCodCollected, [o.orderNo]: v.replace(/[^0-9]/g, '') }, state.routeCodMethod),
    };
  });

  // Reconciliation is cash-only; transfers are settled by definition.
  const totalDiff = cashReturned - cashExpected;
  const codMismatch = totalDiff !== 0 && !isClosed;
  const codDiffText = totalDiff === 0 ? 'ยอดตรง' : (totalDiff > 0 ? 'เกิน +' : 'ขาด −') + fmt(Math.abs(totalDiff));
  const codDiffStyle = totalDiff === 0 ? badgeStyle('ok') : badgeStyle('bad');
  const transferCount = codRows.filter((r) => r.isTransfer).length;

  // A batch edited (orders added/removed via "แก้ไข batch") after its COD
  // round was already closed — updatedAt only moves forward on a genuine
  // membership edit (see syncBatchAfterEdit), so this can't false-positive
  // on an already-closed batch that was simply reopened for viewing.
  const editedAfterClose = !!selectedBatch && selectedBatch.codClosed && selectedBatch.updatedAt > selectedBatch.codClosedAt;

  const selectedBatchDate = selectedBatch ? dayKeyToDate(selectedBatch.deliveryDate) : null;

  return {
    codMobile: state.codMobile,
    codDesktop: !state.codMobile,
    setCodMobile: () => actions.patch({ codMobile: true }),
    setCodDesktop: () => actions.patch({ codMobile: false }),

    isDriverView,
    vehicleFilterOptions,
    vehicleFilter: state.codVehicleFilter,
    setVehicleFilter: (id: string) => actions.patch({ codVehicleFilter: id, codBatchId: null }),

    batchTabs,
    hasBatches: state.batchRoutes.length > 0,
    hasVisibleBatches: visibleBatches.length > 0,

    selectedBatchId: selectedBatch?.id ?? null,
    selectedBatchLabel: selectedBatch ? `${selectedBatch.id} · ${selectedBatch.vehicleName}` : '',
    selectedBatchDateText: selectedBatch ? (selectedBatchDate ? formatThaiShortDate(selectedBatchDate) : selectedBatch.deliveryDate) : '',
    hasCodOrders: codOrders.length > 0,

    codClosed: isClosed,
    editedAfterClose,
    codRows,
    codExpectedText: fmt(expSum),
    cashExpectedText: fmt(cashExpected),
    transferText: fmt(transferSum),
    transferCount,
    hasTransfer: transferCount > 0,
    codReturnedText: fmt(cashReturned),
    codMismatch,
    codDiffText,
    codDiffStyle,
    closeBatch: () => {
      if (!selectedBatch || selectedBatch.codClosed) return;
      const detail = `${selectedBatch.vehicleName} · เก็บสด ${fmt(cashReturned)}/${fmt(cashExpected)}${transferCount > 0 ? ` · โอน ${fmt(transferSum)}` : ''}`;
      actions.closeBatchCod(selectedBatch.id, state.batchRoutes, detail);
    },
  };
}

// ---------- PROMO ----------
// Raw "Status" column text from the sheet, e.g. "Active"/"Inactive" — kept
// verbatim (see Promo.st) rather than normalized, so this only styles the
// values actually observed and falls back to neutral for anything else.
const promoStatusKind: Record<string, Parameters<typeof badgeStyle>[0]> = {
  Active: 'ok',
  Inactive: 'neutral',
};
function promoStatusStyle(status: string) {
  return badgeStyle(promoStatusKind[status] ?? 'warn');
}

export function computePromo(state: AppState, actions: AppActions) {
  const pq = state.promoQ.trim().toLowerCase();

  // Status filter chips, counts computed against the full unfiltered set
  // (mirroring computeDashboard's statusChips) so the numbers next to each
  // chip stay stable while searching — only the table rows narrow.
  const presentStatuses = Array.from(new Set(state.promos.map((p) => p.st).filter(Boolean))).sort();
  const countForStatus = (s: string) => (s === 'all' ? state.promos.length : state.promos.filter((p) => p.st === s).length);
  const chipBase: CSSProperties = { border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: '6px 13px', borderRadius: 20, fontWeight: 500 };
  const statusChips = ['all', ...presentStatuses].map((k) => ({
    key: k,
    label: k === 'all' ? 'ทั้งหมด' : k,
    count: countForStatus(k),
    style:
      k === state.promoStatusFilter
        ? { ...chipBase, background: 'var(--color-accent)', color: '#fff' }
        : { ...chipBase, background: 'var(--color-surface)', color: 'var(--color-neutral-300)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' },
    go: () => actions.patch({ promoStatusFilter: k }),
  }));

  const rows = state.promos
    .filter((p) => state.promoStatusFilter === 'all' || p.st === state.promoStatusFilter)
    .filter((p) => !pq || p.sku.toLowerCase().includes(pq) || p.skuName.toLowerCase().includes(pq) || p.name.toLowerCase().includes(pq))
    .map((p) => ({
      ...p,
      stLabel: p.st,
      stStyle: promoStatusStyle(p.st),
      typeStyle: badgeStyle(p.packUnits.length > 0 ? 'info' : p.tiers.length > 1 ? 'info' : 'accent'),
      isStepped: p.tiers.length > 1,
      isPackUnits: p.packUnits.length > 0,
      tierRows: p.tiers.map((t) => ({
        label: t.minQty > 1 ? `${t.minQty}${p.unit}ขึ้นไป` : `1 ${p.unit}`,
        priceText: `฿${t.price.toLocaleString('en-US')}`,
      })),
      packUnitRows: p.packUnits.map((u) => ({
        label: u.label,
        qtyPerUnit: u.qtyPerUnit,
        priceText: `฿${u.price.toLocaleString('en-US')}`,
        avgText: `฿${avgPricePerPiece(u).toFixed(2)}/ชิ้น`,
      })),
      edit: () => actions.openEditPromo(p),
      viewUsage: () => actions.openPromoUsage(p.sku),
    }));

  const f = state.promoForm;
  const isEditing = state.promoEditingOriginal !== null;

  const canSavePromo =
    (isEditing ? state.promoEditingOriginal!.sku.trim() !== '' : f.sku.trim() !== '') &&
    f.name.trim() !== '' &&
    (f.mode === 'packUnits' ? f.packUnits.some((u) => u.price > 0 && u.qtyPerUnit >= 1) : f.tiers.some((t) => t.price > 0));

  return {
    promosLoading: state.promosLoading,
    promosError: state.promosError,
    promoQ: state.promoQ,
    onPromoSearch: (v: string) => actions.patch({ promoQ: v }),
    statusChips,
    promos: rows,
    isEmpty: rows.length === 0,
    promoModalOpen: state.promoModal,
    promoForm: f,
    isEditingPromo: isEditing,
    editingPromoSku: state.promoEditingOriginal?.sku ?? null,
    openPromo: () => actions.openCreatePromo(),
    closePromo: () => actions.closePromo(),
    onPromoName: (v: string) => actions.patch({ promoForm: { ...f, name: v } }),
    onPromoSku: (v: string) => actions.patch({ promoForm: { ...f, sku: v } }),
    onPromoType: (v: string) => actions.patch({ promoForm: { ...f, type: v } }),
    onPromoStart: (v: string) => actions.patch({ promoForm: { ...f, start: v } }),
    onPromoEnd: (v: string) => actions.patch({ promoForm: { ...f, end: v } }),
    onPromoUnit: (v: PromoUnit) => actions.patch({ promoForm: { ...f, unit: v } }),
    onPromoMode: (v: 'tiers' | 'packUnits') => actions.patch({ promoForm: { ...f, mode: v } }),
    promoUnits: PROMO_UNITS,
    tierRows: f.tiers.map((t, i) => ({
      minQty: t.minQty === 0 ? '' : String(t.minQty),
      price: t.price === 0 ? '' : String(t.price),
      isFirst: i === 0,
      onMinQty: (val: string) => {
        const tiers = f.tiers.map((x, j) => (j === i ? { ...x, minQty: Number(val.replace(/[^0-9]/g, '') || 0) } : x));
        actions.patch({ promoForm: { ...f, tiers } });
      },
      onPrice: (val: string) => {
        const tiers = f.tiers.map((x, j) => (j === i ? { ...x, price: Number(val.replace(/[^0-9.]/g, '') || 0) } : x));
        actions.patch({ promoForm: { ...f, tiers } });
      },
      remove: () => actions.patch({ promoForm: { ...f, tiers: f.tiers.filter((_, j) => j !== i) } }),
    })),
    addTier: () => {
      const last = f.tiers[f.tiers.length - 1];
      const nextQty = last ? Math.max(last.minQty + 1, 2) : 1;
      actions.patch({ promoForm: { ...f, tiers: [...f.tiers, { minQty: nextQty, price: 0 }] } });
    },
    // Packaging-unit rows — same shape of per-row edit callbacks as tierRows
    // above, plus a live-computed "avg price per piece" (price ÷ qtyPerUnit)
    // so staff can see at a glance which packaging size is the better deal
    // while they're still typing.
    packUnitRows: f.packUnits.map((u, i) => ({
      label: u.label,
      qtyPerUnit: u.qtyPerUnit === 0 ? '' : String(u.qtyPerUnit),
      price: u.price === 0 ? '' : String(u.price),
      avgText: u.price > 0 && u.qtyPerUnit > 0 ? `฿${avgPricePerPiece(u).toFixed(2)}/ชิ้น` : '—',
      onLabel: (val: PromoUnit) => {
        const packUnits = f.packUnits.map((x, j) => (j === i ? { ...x, label: val } : x));
        actions.patch({ promoForm: { ...f, packUnits } });
      },
      onQtyPerUnit: (val: string) => {
        const packUnits = f.packUnits.map((x, j) => (j === i ? { ...x, qtyPerUnit: Number(val.replace(/[^0-9]/g, '') || 0) } : x));
        actions.patch({ promoForm: { ...f, packUnits } });
      },
      onPrice: (val: string) => {
        const packUnits = f.packUnits.map((x, j) => (j === i ? { ...x, price: Number(val.replace(/[^0-9.]/g, '') || 0) } : x));
        actions.patch({ promoForm: { ...f, packUnits } });
      },
      remove: () => actions.patch({ promoForm: { ...f, packUnits: f.packUnits.filter((_, j) => j !== i) } }),
    })),
    addPackUnit: () => {
      // Next unused label from PROMO_UNITS, smallest-to-largest, so a second
      // add naturally suggests แพ็ค after ชิ้น, then หีบ, rather than repeating
      // the same label the user would just have to change anyway.
      const used = new Set(f.packUnits.map((u) => u.label));
      const nextLabel = PROMO_UNITS.find((u) => !used.has(u)) ?? PROMO_UNITS[0];
      const last = f.packUnits[f.packUnits.length - 1];
      const suggestedQty: PromoPackUnit = { label: nextLabel, price: 0, qtyPerUnit: last ? Math.max(last.qtyPerUnit, 2) : 1 };
      actions.patch({ promoForm: { ...f, packUnits: [...f.packUnits, suggestedQty] } });
    },
    canSavePromo,
    promoSaveStatus: state.promoSaveStatus,
    savePromo: () => actions.savePromo(f, state.promoEditingOriginal),
  };
}

/** Usage stats for one promo, sourced entirely from orderLineItems.promoSku —
 * lines explicitly confirmed by staff (see computeOrderDetail's
 * confirmPromo), never inferred from matching price/date alone. */
export function computePromoUsage(state: AppState, actions: AppActions) {
  const sku = state.promoUsageSku;
  if (!sku) return { open: false as const };

  const promo = state.promos.find((p) => p.sku === sku) ?? null;
  const usedLines = state.orderLineItems.filter((l) => l.promoSku === sku);

  // One row per order even if the SKU appears on more than one line within
  // it (rare, but sum rather than duplicate rows for the same order).
  const byOrder = new Map<string, { orderNo: string; customer: string; qty: number; total: number; orderedAt: string }>();
  for (const l of usedLines) {
    const cur = byOrder.get(l.orderNo);
    if (cur) {
      cur.qty += l.qty;
      cur.total += l.lineTotal;
    } else {
      byOrder.set(l.orderNo, { orderNo: l.orderNo, customer: l.customer, qty: l.qty, total: l.lineTotal, orderedAt: l.orderedAt });
    }
  }
  const orders = Array.from(byOrder.values()).sort((a, b) => (a.orderedAt < b.orderedAt ? 1 : -1));

  // Grouped by phone, not customer name — a shop can rename between orders,
  // and phone is the stable identity (customers.phone is the Postgres
  // primary key). Falls back to the name itself only for the rare order with
  // no phone on file, so it doesn't silently disappear from the count.
  const phoneByOrderNo = new Map(state.routeOrders.map((r) => [r.orderNo, r.phone.trim()]));
  const byCustomer = new Map<string, { name: string; count: number }>();
  for (const o of orders) {
    const key = phoneByOrderNo.get(o.orderNo) || `name:${o.customer}`;
    const cur = byCustomer.get(key);
    if (cur) cur.count += 1;
    else byCustomer.set(key, { name: o.customer, count: 1 });
  }

  const totalRevenue = orders.reduce((a, o) => a + o.total, 0);

  return {
    open: true as const,
    sku,
    promoName: promo?.skuName || promo?.name || sku,
    close: () => actions.closePromoUsage(),
    totalUses: orders.length,
    totalRevenueText: fmt(totalRevenue),
    isEmpty: orders.length === 0,
    orderRows: orders.map((o) => ({
      orderNo: o.orderNo,
      customer: o.customer,
      qtyText: o.qty.toLocaleString('en-US'),
      totalText: fmt(o.total),
      orderedAtText: o.orderedAt ? formatOrderedAt(o.orderedAt) : '—',
      viewOrder: () => {
        actions.closePromoUsage();
        actions.openOrderDetail(o.orderNo, o.customer, state.routeOrders.find((r) => r.orderNo === o.orderNo));
      },
    })),
    customerRows: Array.from(byCustomer.values())
      .sort((a, b) => b.count - a.count)
      .map(({ name, count }) => ({ customer: name, count })),
  };
}

// ---------- SKU MASTER ----------
const skuStatusMeta: Record<string, [string, Parameters<typeof badgeStyle>[0]]> = {
  active: ['มีสินค้า', 'ok'],
  inactive: ['หมด', 'neutral'],
};

export function computeSku(state: AppState, actions: AppActions) {
  const sq = state.skuQ.trim().toLowerCase();
  const skuRows = state.skus
    .filter((s) => !sq || s.displayId.toLowerCase().includes(sq) || s.barcode.includes(sq) || s.name.toLowerCase().includes(sq))
    .map((s) => ({
      key: s.id,
      id: s.displayId,
      barcode: s.barcode,
      name: s.name,
      unit: s.unit,
      stockText: s.stock.toLocaleString('en-US'),
      stockStyle: s.stock <= 100 ? ({ color: 'var(--st-warn-fg)', fontWeight: 600 } as CSSProperties) : ({} as CSSProperties),
      stLabel: skuStatusMeta[s.status][0],
      stStyle: badgeStyle(skuStatusMeta[s.status][1]),
      edit: () => actions.openEditSku(s),
    }));

  return {
    skusLoading: state.skusLoading,
    skusError: state.skusError,
    skuCount: state.skus.length,
    skuQ: state.skuQ,
    onSkuSearch: (v: string) => actions.patch({ skuQ: v }),
    skuRows,
    skuModalOpen: !!state.skuModal,
    skuIsEdit: state.skuModal === 'edit',
    skuModalTitle: state.skuModal === 'edit' ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่',
    skuF: state.skuF,
    openAddSku: () => actions.patch({ skuModal: 'add', skuF: { key: '', id: nextSkuIdLocal(state), barcode: '', name: '', unit: 'ชิ้น', stock: '', status: 'active' } }),
    closeSku: () => actions.patch({ skuModal: null }),
    onFormId: (v: string) => actions.patch({ skuF: { ...state.skuF, id: v } }),
    onFormBarcode: (v: string) => actions.patch({ skuF: { ...state.skuF, barcode: v.replace(/[^0-9]/g, '') } }),
    onFormName: (v: string) => actions.patch({ skuF: { ...state.skuF, name: v } }),
    onFormUnit: (v: string) => actions.patch({ skuF: { ...state.skuF, unit: v } }),
    onFormStock: (v: string) => actions.patch({ skuF: { ...state.skuF, stock: v.replace(/[^0-9]/g, '') } }),
    onFormStatus: (v: 'active' | 'inactive') => actions.patch({ skuF: { ...state.skuF, status: v } }),
    saveSku: () => actions.saveSku(),
  };
}

function nextSkuIdLocal(state: AppState): string {
  const nums = state.skus.map((s) => parseInt(s.id.replace('SKU', ''), 10)).filter((n) => !isNaN(n));
  return 'SKU' + String(Math.max(0, ...nums) + 1).padStart(5, '0');
}

// ---------- CUSTOMER MASTER ("CS Master" tab) ----------
export function computeCustomer(state: AppState, actions: AppActions) {
  const cq = state.custQ.trim().toLowerCase();
  const custRows = state.customers
    .filter((c) => !cq || c.name.toLowerCase().includes(cq) || c.phone.includes(cq))
    .map((c) => ({
      rowIndex: c.rowIndex,
      name: c.name,
      phone: c.phone,
      address: c.address,
      locText: c.lat != null && c.lng != null ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}` : 'ไม่มีพิกัด',
      mapLink: c.mapLink,
      wantsTaxInvoice: c.wantsTaxInvoice,
      note: c.note,
      edit: () => actions.openEditCustomerLatLng(c),
    }));

  const editing = state.customers.find((c) => c.rowIndex === state.custEditRowIndex) ?? null;

  return {
    customersLoading: state.customersLoading,
    customersError: state.customersError,
    customerCount: state.customers.length,
    custQ: state.custQ,
    onCustSearch: (v: string) => actions.patch({ custQ: v }),
    custRows,
    editModalOpen: editing !== null,
    editingName: editing?.name ?? '',
    editingPhone: editing?.phone ?? '',
    editingAddress: editing?.address ?? '',
    editingOriginalLatLngText: editing && editing.lat != null && editing.lng != null ? `${editing.lat.toFixed(5)}, ${editing.lng.toFixed(5)}` : 'ไม่มีข้อมูล',
    custEditLat: state.custEditLat,
    custEditLng: state.custEditLng,
    custEditSaving: state.custEditSaving,
    custEditError: state.custEditError,
    onEditLat: (v: string) => actions.patch({ custEditLat: v.replace(/[^0-9.\-]/g, '') }),
    onEditLng: (v: string) => actions.patch({ custEditLng: v.replace(/[^0-9.\-]/g, '') }),
    closeEdit: () => actions.closeEditCustomerLatLng(),
    saveEdit: () => {
      if (!editing) return;
      const lat = Number(state.custEditLat);
      const lng = Number(state.custEditLng);
      if (state.custEditLat.trim() === '' || state.custEditLng.trim() === '' || Number.isNaN(lat) || Number.isNaN(lng)) {
        actions.patch({ custEditError: 'กรุณากรอกพิกัดให้ถูกต้อง (ตัวเลขเท่านั้น)' });
        return;
      }
      actions.saveCustomerLatLng(editing.rowIndex, editing.name, editing.phone, lat, lng, editing.lat, editing.lng);
    },
  };
}

// ---------- SETTINGS ----------
export function computeSettings(state: AppState, actions: AppActions) {
  return {
    apiKey: state.apiKey,
    apiTesting: state.apiTesting,
    apiIdle: !state.apiTesting,
    apiOk: state.apiOk,
    keySaved: state.keySaved,
    saveDisabled: !state.apiOk || state.apiKey.trim() === '',
    onApiKey: (v: string) => actions.patch({ apiKey: v, apiOk: false, keySaved: false }),
    testConn: () => {
      if (state.apiKey.trim() === '') return;
      actions.patch({ apiTesting: true, apiOk: false });
      setTimeout(() => actions.patch({ apiTesting: false, apiOk: true }), 1200);
    },
    saveKey: () => actions.patch({ keySaved: true }),
    expiryLabel: 'เหลือ 2 วัน · ใกล้หมดอายุ',
    expiryStyle: badgeStyle('bad'),
  };
}

// ---------- GOODS RECEIVING (supplier bills) ----------
export function computeReceiving(state: AppState, actions: AppActions) {
  const skuOptions = state.skus.map((s) => ({ value: s.id, label: `${s.displayId} · ${s.name}`, name: s.name, unit: s.unit, barcode: s.barcode }));

  const updateLine = (id: string, patch: Partial<ReceivingLine>) =>
    actions.setReceivingLines(state.recvLines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const lines = state.recvLines.map((l) => {
    const diff = lineDiff(l);
    return {
      ...l,
      diff,
      diffText: diff === 0 ? 'ตรง' : diff > 0 ? `เกิน +${diff}` : `ขาด ${diff}`,
      diffStyle: badgeStyle(diff === 0 ? 'ok' : diff > 0 ? 'warn' : 'bad'),
      hasDiff: diff !== 0,
      netTotal: lineNetTotal(l),
      netTotalText: fmt(lineNetTotal(l)),
      onSku: (skuId: string) => {
        const sku = state.skus.find((s) => s.id === skuId);
        // Prefill from the catalogue but leave the bill-side fields alone —
        // the supplier's own naming is what the operator is transcribing.
        updateLine(l.id, sku ? { skuId, uniiName: sku.name, unit: sku.unit || l.unit } : { skuId: '', uniiName: '' });
      },
      set: (patch: Partial<ReceivingLine>) => updateLine(l.id, patch),
      remove: () => actions.setReceivingLines(state.recvLines.filter((x) => x.id !== l.id)),
    };
  });

  const discrepancyCount = lines.filter((l) => l.hasDiff).length;
  const grandTotal = lines.reduce((a, l) => a + l.netTotal, 0);
  const canSave = state.recvSupplier.trim() !== '' && state.recvBillNo.trim() !== '' && lines.length > 0 && lines.every((l) => l.uniiName.trim() !== '' || l.billName.trim() !== '');

  const folderKey = receivingFolderKey(state.recvDate, state.recvSupplier);

  // history + filters
  const suppliers = Array.from(new Set(state.receivingLog.map((r) => r.supplier).filter(Boolean))).sort();
  const skuFilter = state.recvFilterSku.trim().toLowerCase();
  const history = state.receivingLog
    .filter((r) => {
      if (state.recvFilterSupplier !== 'all' && r.supplier !== state.recvFilterSupplier) return false;
      if (state.recvFilterDate && r.receivedDate !== state.recvFilterDate) return false;
      if (skuFilter) {
        const hit = r.lines.some((l) =>
          l.skuId.toLowerCase().includes(skuFilter) ||
          l.uniiName.toLowerCase().includes(skuFilter) ||
          l.billName.toLowerCase().includes(skuFilter) ||
          l.billBarcode.includes(skuFilter));
        if (!hit) return false;
      }
      return true;
    })
    .map((r) => ({
      id: r.id,
      supplier: r.supplier,
      billNo: r.billNo,
      receivedDate: r.receivedDate,
      note: r.note,
      lineCount: r.lines.length,
      totalText: fmt(recordTotal(r)),
      hasDiscrepancy: recordHasDiscrepancy(r),
      discrepancyCount: r.lines.filter((l) => lineDiff(l) !== 0).length,
      folderKey: receivingFolderKey(r.receivedDate, r.supplier),
      lines: r.lines.map((l) => {
        const d = lineDiff(l);
        return {
          ...l,
          diff: d,
          diffText: d === 0 ? 'ตรง' : d > 0 ? `เกิน +${d}` : `ขาด ${d}`,
          diffStyle: badgeStyle(d === 0 ? 'ok' : d > 0 ? 'warn' : 'bad'),
          netTotalText: fmt(lineNetTotal(l)),
        };
      }),
      remove: () => actions.deleteReceiving(r.id, state.receivingLog),
    }));

  return {
    supplier: state.recvSupplier,
    billNo: state.recvBillNo,
    date: state.recvDate,
    note: state.recvNote,
    onSupplier: (v: string) => actions.patch({ recvSupplier: v, recvSaved: null }),
    onBillNo: (v: string) => actions.patch({ recvBillNo: v }),
    onDate: (v: string) => actions.patch({ recvDate: v, recvSaved: null }),
    onNote: (v: string) => actions.patch({ recvNote: v }),
    knownSuppliers: Array.from(new Set([...suppliers, ...suppliers])),
    skuOptions,
    skusLoading: state.skusLoading,
    lines,
    lineCount: lines.length,
    isEmpty: lines.length === 0,
    addLine: () => actions.addReceivingLine(state.recvLines),
    discrepancyCount,
    hasDiscrepancy: discrepancyCount > 0,
    grandTotalText: fmt(grandTotal),
    canSave,
    folderKey,
    savedKey: state.recvSaved,
    save: () => {
      if (!canSave) return;
      const record: ReceivingRecord = {
        id: `recv-${Date.now()}`,
        supplier: state.recvSupplier.trim(),
        billNo: state.recvBillNo.trim(),
        receivedDate: state.recvDate,
        recordedBy: 'admin.warehouse',
        note: state.recvNote.trim(),
        lines: state.recvLines,
        createdAt: new Date().toISOString(),
      };
      actions.saveReceiving(record, state.receivingLog);
    },
    // history
    historySuppliers: suppliers,
    filterSupplier: state.recvFilterSupplier,
    filterDate: state.recvFilterDate,
    filterSku: state.recvFilterSku,
    onFilterSupplier: (v: string) => actions.patch({ recvFilterSupplier: v }),
    onFilterDate: (v: string) => actions.patch({ recvFilterDate: v }),
    onFilterSku: (v: string) => actions.patch({ recvFilterSku: v }),
    clearFilters: () => actions.patch({ recvFilterSupplier: 'all', recvFilterDate: '', recvFilterSku: '' }),
    history,
    historyCount: history.length,
    totalRecords: state.receivingLog.length,
  };
}
