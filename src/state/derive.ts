import type { CSSProperties } from 'react';
import { orders } from '../data/mockData';
import type { PickLot } from '../data/pickLots';
import { PROMO_UNITS, type Order, type PromoStatus, type PromoUnit, type RouteOrder } from '../data/types';
import { lineDiff, lineNetTotal, receivingFolderKey, recordHasDiscrepancy, recordTotal, type ReceivingLine, type ReceivingRecord } from '../data/receiving';
import { loadCode } from '../data/vehicles';
import { matchZone, UNASSIGNED_COLOR } from '../data/zoneConfig';
import { addDays, dayKey, dayKeyToDate, daysBetweenKeys, formatOrderedAt, formatThaiShortDate, formatThaiWeekdayDate, sheetDateTimeToMs, sheetDateToDayKey, suggestedDeliveryDayKey, todayDayKey } from '../data/dateUtils';
import { badgeStyle, DELIVERY_DONE_STATUSES, fmt, sheetStatusStyle } from './helpers';
import type { AppActions, AppState } from './store';

/** Delivery date, straight off the "คำสั่งซื้อ" sheet — edits go through
 * saveOrderEdit and only land in state.routeOrders once the sheet write
 * actually succeeds, so this value is always the real, current one. */
function effectiveDeliveryDayKey(o: RouteOrder): string | null {
  return sheetDateToDayKey(o.plannedDeliveryDate);
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
  route: ['จัดการออเดอร์', 'ข้อมูลจริงจาก Google Sheet (คำสั่งซื้อ) · แก้ไขวันที่จัดส่ง/หมายเหตุ/ใบกำกับภาษีแล้วบันทึกกลับชีทได้'],
  planner: ['วางแผนจัดรูท', 'จัดออเดอร์ลงรถ · เรียงลำดับส่งจากไกลไปใกล้คลัง · ออกลำดับโหลด'],
  // App.tsx renders DriverPage full-screen before this map is ever read for
  // 'driver' — this entry only exists to satisfy the Record type.
  driver: ['มุมมองคนขับ', 'ใบจัดรูทมือถือรายคัน'],
  pick: ['Batch picking / จัดล็อตหยิบสินค้า', 'รวมหลายออเดอร์เป็นล็อตเดียว หยิบสินค้าตามตำแหน่งเก็บ'],
  cod: ['เคลียร์เงินปลายทาง (COD)', 'เทียบยอดที่ควรเก็บกับยอดคืนจริงต่อ driver'],
  promo: ['โปรโมชั่น / ส่วนลด', 'โปรโมชั่นที่ Active จาก Google Sheet · สร้างโปรโมชั่นใหม่ได้ในเครื่องนี้'],
  grn: ['รับสินค้าเข้าคลัง (Goods Receiving)', 'บันทึกของเข้าจากซัพพลายเออร์ · เทียบจำนวนกับบิล · แนบไฟล์บิลขึ้น Drive'],
  sku: ['ฐานข้อมูลสินค้า (SKU master)', 'ทะเบียนสินค้าทั้งหมดในระบบ'],
  customer: ['ฐานข้อมูลลูกค้า (CS Master)', 'แก้ไขพิกัด lat/long แล้วบันทึกกลับเข้า Google Sheet จริง'],
  settings: ['ตั้งค่า / API Key', 'จัดการการเชื่อมต่อระบบออเดอร์ภายนอก'],
};

// ---------- DASHBOARD ("API Import" tab) ----------
const dashboardStatusOrder = ['รอยืนยันออเดอร์', 'กำลังดำเนินการ', 'รอชำระเงิน', 'ได้รับแล้ว', 'ยกเลิก'];

export function computeDashboard(state: AppState, actions: AppActions) {
  const q = state.q.trim().toLowerCase();
  const list = state.apiOrders.filter((o) => {
    if (state.statusFilter !== 'all' && o.status !== state.statusFilter) return false;
    if (q && !(o.customer.toLowerCase().includes(q) || o.orderUid.toLowerCase().includes(q) || o.phone.includes(q))) return false;
    return true;
  });

  const rows = list.map((o) => ({
    orderUid: o.orderUid,
    cust: o.customer,
    phone: o.phone,
    addr: [o.address, o.district, o.province].filter(Boolean).join(' · '),
    items: o.itemCount,
    amtText: fmt(o.totalAmount),
    paymentType: o.paymentType,
    paid: o.paid,
    orderedAt: o.orderedAt,
    stLabel: o.status || '—',
    stStyle: sheetStatusStyle(o.status),
    wantsTax: o.wantsTaxInvoice,
    viewItems: () => actions.openOrderDetail(o.orderUid, o.customer, state.routeOrders.find((r) => r.orderNo === o.orderUid)),
  }));

  const cnt = (s: string) => state.apiOrders.filter((o) => s === 'all' || o.status === s).length;
  const presentStatuses = dashboardStatusOrder.filter((s) => state.apiOrders.some((o) => o.status === s));
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

  const totalValue = state.apiOrders.reduce((a, o) => a + o.totalAmount, 0);
  const stats = [
    { label: 'ออเดอร์ใหม่ทั้งหมด', value: String(state.apiOrders.length), sub: 'ยังไม่ได้จัดเส้นทาง', icon: 'ph ph-package', iconColor: 'var(--color-accent-300)' },
    { label: 'รอยืนยันออเดอร์', value: String(cnt('รอยืนยันออเดอร์')), sub: 'ต้องยืนยัน', icon: 'ph ph-hourglass-medium', iconColor: 'var(--st-warn-fg)' },
    { label: 'กำลังดำเนินการ', value: String(cnt('กำลังดำเนินการ')), sub: 'อยู่ระหว่างจัดของ', icon: 'ph ph-truck', iconColor: 'var(--st-info-fg)' },
    { label: 'มูลค่ารวม', value: fmt(totalValue), sub: 'ออเดอร์ที่แสดงทั้งหมด', icon: 'ph ph-wallet', iconColor: 'var(--st-ok-fg)' },
  ];

  // ---- 7-day delivery forecast (from routeOrders — the tab with delivery dates) ----
  const today = todayDayKey();
  const assignedOrderNos = new Set(Object.values(state.routePlan).flat());
  const forecastStatusOptions = Array.from(new Set(state.routeOrders.map((o) => o.status).filter(Boolean))).sort();

  const forecastDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(dayKeyToDate(today)!, i);
    const key = dayKey(d);
    const ordersOnDay = state.routeOrders.filter((o) => {
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

  // ---- stuck orders: delivery date already passed, but never reached a done status ----
  const stuckOrders = state.routeOrders
    .filter((o) => {
      const key = effectiveDeliveryDayKey(o);
      if (!key || key >= today) return false;
      return !DELIVERY_DONE_STATUSES.includes(o.status);
    })
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
      };
    })
    .sort((a, b) => b.daysLate - a.daysLate);

  return {
    apiOrdersLoading: state.apiOrdersLoading,
    apiOrdersError: state.apiOrdersError,
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
    onForecastStatusFilter: (v: string) => actions.patch({ forecastStatusFilter: v }),
    stuckOrders,
    stuckCount: stuckOrders.length,
  };
}

// ---------- ORDER DETAIL (line items — "SKU Detail" tab) ----------
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
    lines: state.orderDetailLines.map((l) => ({ ...l, unitPriceText: fmt(l.unitPrice), lineTotalText: fmt(l.lineTotal) })),
    isEmpty: !state.orderDetailLoading && !state.orderDetailError && state.orderDetailLines.length === 0,
    totalText: fmt(total),

    // edit fields — write back to the real "คำสั่งซื้อ" sheet
    canEdit: state.orderEditAvailable,
    plannedDeliveryDate: draft.plannedDeliveryDate,
    onPlannedDeliveryDate: (v: string) => actions.setOrderEditDraft({ ...draft, plannedDeliveryDate: v }),
    note: draft.note,
    onNote: (v: string) => actions.setOrderEditDraft({ ...draft, note: v }),
    wantsTaxInvoice: draft.wantsTaxInvoice,
    onWantsTaxInvoice: (v: boolean) => actions.setOrderEditDraft({ ...draft, wantsTaxInvoice: v }),
    saving: saveStatus?.state === 'saving',
    saved: saveStatus?.state === 'saved',
    saveError: saveStatus?.state === 'error' ? (saveStatus.message ?? 'บันทึกไม่สำเร็จ') : null,
    save: () => actions.saveOrderEdit(orderNo, draft),
  };
}

// ---------- ROUTE PLANNING / DELIVERY HISTORY ("คำสั่งซื้อ" tab) ----------

/** The sheet's Route/AutoR column mixes zone letters with trip numbers
 * ("A", "B1523", "a1908", "2345", "รับเอง/1020"). Only the leading letter is
 * the delivery zone, so that is what the UI filters on — otherwise the filter
 * lists well over a thousand one-off trip codes. */
export function routeZoneLetter(route: string): string {
  const m = (route ?? '').trim().match(/^([A-Za-z])/);
  return m ? m[1].toUpperCase() : '';
}

export function computeRoute(state: AppState, actions: AppActions) {
  const rq = state.routeQ.trim().toLowerCase();
  const zoneLetters = Array.from(new Set(state.routeOrders.map((o) => routeZoneLetter(o.route)).filter(Boolean))).sort();
  const statusValues = Array.from(new Set(state.routeOrders.map((o) => o.status).filter(Boolean))).sort();

  const filtered = state.routeOrders.filter((o) => {
    if (state.routeFilterValue !== 'all') {
      const letter = routeZoneLetter(o.route);
      if (state.routeFilterValue === 'other' ? letter !== '' : letter !== state.routeFilterValue) return false;
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
      label: v === 'all' ? 'ทั้งหมด' : v,
      style:
        v === selected
          ? { ...chipBase, background: 'var(--color-accent)', color: '#fff' }
          : { ...chipBase, background: 'var(--color-surface)', color: 'var(--color-neutral-300)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' },
      go: () => onSelect(v),
    }));

  const countForLetter = (l: string) => state.routeOrders.filter((o) => routeZoneLetter(o.route) === l).length;
  const noLetterCount = state.routeOrders.filter((o) => routeZoneLetter(o.route) === '').length;
  const routeTabs = [
    { key: 'all', label: `ทั้งหมด (${state.routeOrders.length})`, active: state.routeFilterValue === 'all' },
    ...zoneLetters.map((l) => ({ key: l, label: `${l} (${countForLetter(l)})`, active: state.routeFilterValue === l })),
    ...(noLetterCount > 0 ? [{ key: 'other', label: `ไม่ระบุโซน (${noLetterCount})`, active: state.routeFilterValue === 'other' }] : []),
  ].map((t) => ({
    ...t,
    style: t.active
      ? { ...chipBase, background: 'var(--color-accent)', color: '#fff' }
      : { ...chipBase, background: 'var(--color-surface)', color: 'var(--color-neutral-300)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' },
    go: () => actions.patch({ routeFilterValue: t.key }),
  }));

  // Active promo SKUs (state.promos is already filtered to Active-only) cross
  // referenced against each order's line items, so staff can see at a glance
  // which orders include a promoted product without opening every one.
  const activePromoSkus = new Set(state.promos.map((p) => p.sku));
  const orderSkus = new Map<string, Set<string>>();
  for (const li of state.orderLineItems) {
    let set = orderSkus.get(li.orderNo);
    if (!set) {
      set = new Set();
      orderSkus.set(li.orderNo, set);
    }
    set.add(li.sku);
  }

  const rows = filtered.map((o) => {
    const zone = matchZone(state.zoneRules, o.districtProvince, o.addressFromUnii);
    const skusForOrder = orderSkus.get(o.orderNo);
    const hasPromoItem = skusForOrder ? Array.from(skusForOrder).some((sku) => activePromoSkus.has(sku)) : false;
    const saveStatus = state.orderSaveStatus[o.orderNo];
    const hasDeliveryDate = sheetDateToDayKey(o.plannedDeliveryDate) != null;
    // Warehouse cutoff rule: ordered before 16:00 -> ship the next day;
    // 16:00 or later -> ship the day after that. Only offered while there's
    // no delivery date yet — once one exists, editing goes through "แก้ไข".
    const suggestedIso = hasDeliveryDate ? null : suggestedDeliveryDayKey(o.orderedAtText);
    const suggestedDate = suggestedIso ? dayKeyToDate(suggestedIso) : null;
    const setDeliveryDate = (iso: string) => actions.saveOrderEdit(o.orderNo, { plannedDeliveryDate: iso, note: o.note, wantsTaxInvoice: o.wantsTaxInvoice });
    return {
      route: routeZoneLetter(o.route) || '—',
      zoneName: zone.zoneName,
      zoneColor: zone.color,
      zoneReason: zone.reason,
      zoneMismatch: zone.route !== '—' && routeZoneLetter(o.route) !== '' && routeZoneLetter(o.route) !== zone.route,
      orderNo: o.orderNo,
      customer: o.customer,
      stLabel: o.status || '—',
      stStyle: sheetStatusStyle(o.status),
      amtText: fmt(o.totalAmount),
      itemCountText: o.itemCount.toLocaleString('en-US'),
      hasPromoItem,
      paymentType: o.paymentType,
      orderedAtText: formatOrderedAt(o.orderedAtText),
      plannedDeliveryDate: o.plannedDeliveryDate || '—',
      hasDeliveryDate,
      suggestedDeliveryDateText: suggestedDate ? formatThaiShortDate(suggestedDate) : null,
      confirmSuggestedDeliveryDate: suggestedIso ? () => setDeliveryDate(suggestedIso) : null,
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
    };
  });

  const zoneLegend = state.zoneRules.map((z) => ({
    id: z.id,
    name: z.name,
    color: z.color,
    count: filtered.filter((o) => matchZone(state.zoneRules, o.districtProvince, o.addressFromUnii).zoneId === z.id).length,
  }));
  const unzonedCount = filtered.filter((o) => matchZone(state.zoneRules, o.districtProvince, o.addressFromUnii).zoneId === null).length;
  const mismatchCount = rows.filter((r) => r.zoneMismatch).length;

  // Split into two groups so warehouse staff can see at a glance which
  // orders still need a delivery date scheduled, separate from ones already
  // scheduled.
  const rowsNoDate = rows.filter((r) => r.plannedDeliveryDate === '—');
  const rowsWithDate = rows.filter((r) => r.plannedDeliveryDate !== '—');

  return {
    routeOrdersLoading: state.routeOrdersLoading,
    routeOrdersError: state.routeOrdersError,
    routeQ: state.routeQ,
    onRouteSearch: (v: string) => actions.patch({ routeQ: v }),
    orderDateFilter: state.routeOrderDateFilter,
    onOrderDateFilter: (v: string) => actions.patch({ routeOrderDateFilter: v }),
    deliveryDateFilter: state.routeDeliveryDateFilter,
    onDeliveryDateFilter: (v: string) => actions.patch({ routeDeliveryDateFilter: v }),
    hasDateFilters: state.routeOrderDateFilter !== '' || state.routeDeliveryDateFilter !== '',
    clearDateFilters: () => actions.patch({ routeOrderDateFilter: '', routeDeliveryDateFilter: '' }),
    routeTabs,
    statusTabs: makeTabs(statusValues, state.routeStatusFilter, (v) => actions.patch({ routeStatusFilter: v })),
    rowsNoDate,
    rowsWithDate,
    resultCount: filtered.length,
    isEmpty: filtered.length === 0,
    zoneLegend,
    unzonedCount,
    unassignedColor: UNASSIGNED_COLOR,
    mismatchCount,
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
  const wh = state.routeOrders.find((o) => o.whLat != null && o.whLng != null);
  const warehouse = wh && wh.whLat != null && wh.whLng != null ? { lat: wh.whLat, lng: wh.whLng } : null;

  // Plan the selected day's outstanding work: anything not yet delivered or
  // cancelled, scoped to the chosen delivery date when one is picked.
  const candidates = state.routeOrders.filter((o) => {
    if (DELIVERY_DONE_STATUSES.includes(o.status)) return false;
    if (state.plannerDate && effectiveDeliveryDayKey(o) !== state.plannerDate) return false;
    return true;
  });

  const assignedTo = new Map<string, string>();
  for (const [vehicleId, orderNos] of Object.entries(state.routePlan)) {
    for (const no of orderNos) assignedTo.set(no, vehicleId);
  }

  const distanceOf = (o: (typeof candidates)[number]) =>
    o.distanceFromWhKm ?? (warehouse && o.lat != null && o.lng != null ? haversineKm(warehouse.lat, warehouse.lng, o.lat, o.lng) : 0);

  const byOrderNo = new Map(state.routeOrders.map((o) => [o.orderNo, o]));

  /** Moves an order between vehicles (or reorders within one), splicing it
   * out of its source list and into the target at `toIndex` (end of list
   * when null). Powers both drag-and-drop and the "ย้ายไปรถคันอื่น" dropdown —
   * stop sequence/load-code numbers fall out for free since they're derived
   * directly from routePlan's array order. */
  const moveOrderToVehicle = (orderNo: string, fromVehicleId: string, toVehicleId: string, toIndex: number | null) => {
    const plan = { ...state.routePlan };
    const fromList = [...(plan[fromVehicleId] ?? [])];
    const srcIdx = fromList.indexOf(orderNo);
    if (srcIdx === -1) return;
    fromList.splice(srcIdx, 1);
    plan[fromVehicleId] = fromList;

    const toList = [...(fromVehicleId === toVehicleId ? fromList : (plan[toVehicleId] ?? []))];
    const insertAt = toIndex === null ? toList.length : Math.max(0, Math.min(toIndex, toList.length));
    toList.splice(insertAt, 0, orderNo);
    plan[toVehicleId] = toList;

    actions.setRoutePlan(plan);
  };

  const unassigned = candidates
    .filter((o) => !assignedTo.has(o.orderNo))
    .map((o) => {
      const zone = matchZone(state.zoneRules, o.districtProvince, o.addressFromUnii);
      return {
        orderNo: o.orderNo,
        customer: o.customer,
        address: o.addressFromUnii || o.districtProvince,
        districtProvince: o.districtProvince || '—',
        phone: o.phone || '—',
        amtText: fmt(o.totalAmount),
        itemCount: o.itemCount,
        zoneName: zone.zoneName,
        zoneColor: zone.color,
        suggestedRoute: zone.route,
        distanceKm: distanceOf(o),
        distanceText: `${distanceOf(o).toFixed(1)} กม.`,
        wantsTaxInvoice: o.wantsTaxInvoice,
        note: o.note,
        hasNote: o.note.trim() !== '',
        lat: o.lat,
        lng: o.lng,
        assignTo: (vehicleId: string) => {
          const plan = { ...state.routePlan };
          plan[vehicleId] = [...(plan[vehicleId] ?? []), o.orderNo];
          actions.setRoutePlan(plan);
        },
      };
    })
    .sort((a, b) => b.distanceKm - a.distanceKm);

  const vehicles = state.vehicles.map((v) => {
    const orderNos = state.routePlan[v.id] ?? [];
    const sortDirection = state.routeSortDirection[v.id] ?? 'far';
    const stops = orderNos
      .map((no) => byOrderNo.get(no))
      .filter((o): o is NonNullable<typeof o> => o != null)
      .map((o, i, arr) => {
        const zone = matchZone(state.zoneRules, o.districtProvince, o.addressFromUnii);
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
          // Falls back to a plain Google Maps search link built from lat/lng
          // when the sheet's own mapLink is blank, so the driver-view
          // navigate button always has somewhere to go.
          googleMapsUrl: o.mapLink || (o.lat != null && o.lng != null ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}` : ''),
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
            if (i === 0) return;
            const arr2 = [...orderNos];
            [arr2[i - 1], arr2[i]] = [arr2[i], arr2[i - 1]];
            actions.setRoutePlan({ ...state.routePlan, [v.id]: arr2 });
          },
          moveDown: () => {
            if (i === orderNos.length - 1) return;
            const arr2 = [...orderNos];
            [arr2[i + 1], arr2[i]] = [arr2[i], arr2[i + 1]];
            actions.setRoutePlan({ ...state.routePlan, [v.id]: arr2 });
          },
          remove: () => {
            actions.setRoutePlan({ ...state.routePlan, [v.id]: orderNos.filter((n) => n !== o.orderNo) });
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
        const sorted = [...orderNos].sort((a, b) => {
          const oa = byOrderNo.get(a);
          const ob = byOrderNo.get(b);
          const da = oa ? distanceOf(oa) : 0;
          const db = ob ? distanceOf(ob) : 0;
          return sortDirection === 'far' ? db - da : da - db;
        });
        actions.setRoutePlan({ ...state.routePlan, [v.id]: sorted });
        actions.patch({ routeSortDirection: { ...state.routeSortDirection, [v.id]: sortDirection === 'far' ? 'near' : 'far' } });
      },
      clear: () => actions.setRoutePlan({ ...state.routePlan, [v.id]: [] }),
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
            // Short on-pin text: vehicle code + delivery sequence, e.g. "A-3".
            pinLabel: `${v.loadPrefix}-${s.seq}`,
          };
        }),
    };
  });

  const plannedStops = vehicles.reduce((a, v) => a + v.stopCount, 0);
  const totalCrew = state.vehicles.reduce((a, v) => a + (Number.isFinite(v.crew) ? v.crew : 0), 0);
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
    }));

  const allStops = [...vehicles.flatMap((v) => v.mapStops), ...unassignedMapStops];
  const { kept: mapStops, excluded: excludedStopCount } = rejectOutlierStops(allStops, warehouse);

  const codCashExpectedTotal = vehicles.reduce((a, v) => a + v.codCashExpected, 0);
  const codCashCollectedTotal = vehicles.reduce((a, v) => a + v.codCashCollected, 0);
  const codTransferGrandTotal = vehicles.reduce((a, v) => a + v.codTransferTotal, 0);
  const codRouteCount = vehicles.filter((v) => v.codCount > 0).length;
  const codGrandDiff = codCashCollectedTotal - codCashExpectedTotal;

  const suggestByZone = () => {
    const plan: RoutePlanShape = { ...state.routePlan };
    for (const o of candidates.filter((x) => !assignedTo.has(x.orderNo))) {
      const zone = matchZone(state.zoneRules, o.districtProvince, o.addressFromUnii);
      if (zone.route === '—') continue;
      // Prefer the vehicle explicitly assigned this zone; only fall back to
      // matching the load prefix against the zone's route letter, since two
      // zones can share a route letter and would otherwise pile onto one truck.
      const target =
        state.vehicles.find((v) => v.zoneNote.trim() !== '' && zone.zoneName.includes(v.zoneNote.trim())) ??
        state.vehicles.find((v) => v.zoneNote.trim() !== '' && v.zoneNote.includes(zone.zoneName)) ??
        state.vehicles.find((v) => v.loadPrefix.toUpperCase() === zone.route.toUpperCase());
      if (!target) continue;
      plan[target.id] = [...(plan[target.id] ?? []), o.orderNo];
    }
    // Keep each vehicle in farthest-first order after bulk assignment.
    for (const id of Object.keys(plan)) {
      plan[id] = [...plan[id]].sort((a, b) => {
        const oa = byOrderNo.get(a);
        const ob = byOrderNo.get(b);
        return (ob ? distanceOf(ob) : 0) - (oa ? distanceOf(oa) : 0);
      });
    }
    actions.setRoutePlan(plan);
  };

  return {
    loading: state.routeOrdersLoading,
    error: state.routeOrdersError,
    vehicles,
    unassigned,
    unassignedCount: unassigned.length,
    plannedStops,
    totalCrew,
    activeCrew,
    mapStops,
    excludedStopCount,
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
    clearAll: () => actions.setRoutePlan({}),
    zoneLegend: state.zoneRules.map((z) => ({ id: z.id, name: z.name, color: z.color })),
    unassignedColor: UNASSIGNED_COLOR,
    configTab: state.plannerConfigTab,
    openZones: () => actions.patch({ plannerConfigTab: state.plannerConfigTab === 'zones' ? null : 'zones' }),
    openVehicles: () => actions.patch({ plannerConfigTab: state.plannerConfigTab === 'vehicles' ? null : 'vehicles' }),
    moveOrderToVehicle,
  };
}

type RoutePlanShape = Record<string, string[]>;

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
    if (o.status !== 'กำลังดำเนินการ') return false;
    if (alreadyInALot.has(o.orderNo)) return false;
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

  return {
    mode: 'lot' as const,
    lotId: lot.id,
    orderNos: lot.orderNos,
    orderSummaries: lot.orderSummaries,
    pickTotal: total,
    pickedCount: pk,
    pickPct,
    pickItems,
    isEmpty: total === 0,
    pickClosed: lot.closed,
    pickCloseDisabled: !complete || lot.closed,
    pickBtnLabel: lot.closed ? 'ปิดล็อตแล้ว' : complete ? 'ปิดล็อต — อัปเดตสถานะออเดอร์' : 'หยิบให้ครบก่อนปิดล็อต',
    closePick: () => actions.closePickLot(lot.id, state.pickLots),
    back: () => actions.backToPickerHome(),
    hasNoLineOrders: lot.ordersWithNoLines.length > 0,
    noLineOrdersText: lot.ordersWithNoLines.join(', '),
    hasPendingSync: lot.statusSyncPending.length > 0,
    pendingSyncText: lot.statusSyncPending.join(', '),
    retrySync: () => actions.retryPickLotStatusSync(lot.statusSyncPending),
  };
}

export function computePick(state: AppState, actions: AppActions) {
  const activeLot = state.pickLots.find((l) => l.id === state.activePickLotId) ?? null;
  if (activeLot) return computePickLotDetail(state, actions, activeLot);
  return computePickOrderSelection(state, actions);
}

// ---------- COD ----------
export function computeCod(state: AppState, actions: AppActions) {
  const codClosed = !!state.codClosed[state.codDriver];
  const codList = orders.filter((o) => o.cod && o.status === 'delivered' && o.driver === state.codDriver);

  let expSum = 0; // everything the driver had to collect, cash + transfer
  let cashExpected = 0; // the cash portion — the only part handed back
  let transferSum = 0;
  let cashReturned = 0;

  const codRows = codList.map((o) => {
    const method = state.codMethod[o.id] ?? 'cash';
    const isTransfer = method === 'transfer';
    const ret = state.cod[o.id] ?? '';
    const retN = ret === '' ? null : Number(ret);

    expSum += o.amt;
    if (isTransfer) {
      transferSum += o.amt;
    } else {
      cashExpected += o.amt;
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
      const diff = retN - o.amt;
      if (diff === 0) {
        diffText = 'ตรง';
        diffStyle = badgeStyle('ok');
      } else {
        diffText = (diff > 0 ? '+' : '−') + fmt(Math.abs(diff));
        diffStyle = badgeStyle('bad');
      }
    }

    return {
      id: o.id,
      cust: o.cust,
      expectedText: fmt(o.amt),
      returned: ret,
      isTransfer,
      isCash: !isTransfer,
      methodLabel: isTransfer ? 'โอน' : 'เงินสด',
      setCash: () => actions.patch({ codMethod: { ...state.codMethod, [o.id]: 'cash' } }),
      setTransfer: () => actions.patch({ codMethod: { ...state.codMethod, [o.id]: 'transfer' } }),
      diffText,
      diffStyle,
      onInput: (v: string) => actions.patch({ cod: { ...state.cod, [o.id]: v.replace(/[^0-9]/g, '') } }),
    };
  });

  // Reconciliation is cash-only; transfers are settled by definition.
  const totalDiff = cashReturned - cashExpected;
  const codMismatch = totalDiff !== 0 && !codClosed;
  const codDiffText = totalDiff === 0 ? 'ยอดตรง' : (totalDiff > 0 ? 'เกิน +' : 'ขาด −') + fmt(Math.abs(totalDiff));
  const codDiffStyle = totalDiff === 0 ? badgeStyle('ok') : badgeStyle('bad');
  const transferCount = codRows.filter((r) => r.isTransfer).length;

  return {
    codMobile: state.codMobile,
    codDesktop: !state.codMobile,
    setCodMobile: () => actions.patch({ codMobile: true }),
    setCodDesktop: () => actions.patch({ codMobile: false }),
    codDriver: state.codDriver,
    driverTabs: ['สมชาย ป.', 'วิรัช ต.'].map((name) => ({ name, active: state.codDriver === name, go: () => actions.patch({ codDriver: name }) })),
    codClosed,
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
    closeBatch: () => actions.patch({ codClosed: { ...state.codClosed, [state.codDriver]: true } }),
  };
}

// ---------- PROMO ----------
const promoMeta: Record<PromoStatus, [string, Parameters<typeof badgeStyle>[0]]> = {
  active: ['Active', 'ok'],
  upcoming: ['Upcoming', 'info'],
  expired: ['Expired', 'neutral'],
};

export function computePromo(state: AppState, actions: AppActions) {
  const pq = state.promoQ.trim().toLowerCase();
  const rows = state.promos
    .filter((p) => !pq || p.sku.toLowerCase().includes(pq) || p.skuName.toLowerCase().includes(pq) || p.name.toLowerCase().includes(pq))
    .map((p) => ({
      ...p,
      stLabel: promoMeta[p.st][0],
      stStyle: badgeStyle(promoMeta[p.st][1]),
      typeStyle: badgeStyle(p.tiers.length > 1 ? 'info' : 'accent'),
      isStepped: p.tiers.length > 1,
      tierRows: p.tiers.map((t) => ({
        label: t.minQty > 1 ? `${t.minQty}${p.unit}ขึ้นไป` : `1 ${p.unit}`,
        priceText: `฿${t.price.toLocaleString('en-US')}`,
      })),
    }));

  return {
    promosLoading: state.promosLoading,
    promosError: state.promosError,
    promoQ: state.promoQ,
    onPromoSearch: (v: string) => actions.patch({ promoQ: v }),
    promos: rows,
    promoModalOpen: state.promoModal,
    promoForm: state.promoForm,
    openPromo: () => actions.patch({ promoModal: true }),
    closePromo: () => actions.patch({ promoModal: false }),
    onPromoName: (v: string) => actions.patch({ promoForm: { ...state.promoForm, name: v } }),
    onPromoSku: (v: string) => actions.patch({ promoForm: { ...state.promoForm, sku: v } }),
    onPromoType: (v: string) => actions.patch({ promoForm: { ...state.promoForm, type: v } }),
    onPromoStart: (v: string) => actions.patch({ promoForm: { ...state.promoForm, start: v } }),
    onPromoEnd: (v: string) => actions.patch({ promoForm: { ...state.promoForm, end: v } }),
    onPromoUnit: (v: PromoUnit) => actions.patch({ promoForm: { ...state.promoForm, unit: v } }),
    promoUnits: PROMO_UNITS,
    tierRows: state.promoForm.tiers.map((t, i) => ({
      minQty: t.minQty === 0 ? '' : String(t.minQty),
      price: t.price === 0 ? '' : String(t.price),
      isFirst: i === 0,
      onMinQty: (val: string) => {
        const tiers = state.promoForm.tiers.map((x, j) => (j === i ? { ...x, minQty: Number(val.replace(/[^0-9]/g, '') || 0) } : x));
        actions.patch({ promoForm: { ...state.promoForm, tiers } });
      },
      onPrice: (val: string) => {
        const tiers = state.promoForm.tiers.map((x, j) => (j === i ? { ...x, price: Number(val.replace(/[^0-9.]/g, '') || 0) } : x));
        actions.patch({ promoForm: { ...state.promoForm, tiers } });
      },
      remove: () => actions.patch({ promoForm: { ...state.promoForm, tiers: state.promoForm.tiers.filter((_, j) => j !== i) } }),
    })),
    addTier: () => {
      const last = state.promoForm.tiers[state.promoForm.tiers.length - 1];
      const nextQty = last ? Math.max(last.minQty + 1, 2) : 1;
      actions.patch({ promoForm: { ...state.promoForm, tiers: [...state.promoForm.tiers, { minQty: nextQty, price: 0 }] } });
    },
    canSavePromo: state.promoForm.name.trim() !== '' && state.promoForm.tiers.some((t) => t.price > 0),
    addPromo: () => actions.addPromo(),
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
      actions.saveCustomerLatLng(editing.rowIndex, editing.name, editing.phone, lat, lng);
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
