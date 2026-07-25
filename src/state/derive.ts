import type { CSSProperties } from 'react';
import { orders, pickBatch, suppliers } from '../data/mockData';
import type { Order, PromoStatus } from '../data/types';
import { badgeStyle, fmt, sheetStatusStyle } from './helpers';
import type { AppActions, AppState } from './store';

// COD clearing is still local/mock (out of scope for the sheets migration).
export const orderById: Record<string, Order> = {};
orders.forEach((o) => (orderById[o.id] = o));

export const pageTitles: Record<AppState['route'], [string, string]> = {
  dashboard: ['แดชบอร์ด / ออเดอร์ใหม่', 'ออเดอร์ล่าสุดที่ยังไม่ได้จัดเส้นทาง · จาก Google Sheet (API Import)'],
  route: ['จัดเส้นทางส่ง / ประวัติการจัดส่ง', 'ข้อมูลจริงจาก Google Sheet (คำสั่งซื้อ) · อ่านอย่างเดียว'],
  pick: ['Batch picking / จัดล็อตหยิบสินค้า', 'รวมหลายออเดอร์เป็นล็อตเดียว หยิบสินค้าตามตำแหน่งเก็บ'],
  cod: ['เคลียร์เงินปลายทาง (COD)', 'เทียบยอดที่ควรเก็บกับยอดคืนจริงต่อ driver'],
  promo: ['โปรโมชั่น / ส่วนลด', 'โปรโมชั่นที่ Active จาก Google Sheet · สร้างโปรโมชั่นใหม่ได้ในเครื่องนี้'],
  grn: ['บันทึกรับของเข้าคลัง (GRN)', 'บันทึกสินค้าเข้าใหม่จากซัพพลายเออร์'],
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
    viewItems: () => actions.openOrderDetail(o.orderUid, o.customer),
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
  };
}

// ---------- ORDER DETAIL (line items — "SKU Detail" tab) ----------
export function computeOrderDetail(state: AppState) {
  const total = state.orderDetailLines.reduce((a, l) => a + l.lineTotal, 0);
  return {
    open: state.orderDetailOpen,
    orderNo: state.orderDetailOrderNo,
    customer: state.orderDetailCustomer,
    loading: state.orderDetailLoading,
    error: state.orderDetailError,
    lines: state.orderDetailLines.map((l) => ({ ...l, unitPriceText: fmt(l.unitPrice), lineTotalText: fmt(l.lineTotal) })),
    isEmpty: !state.orderDetailLoading && !state.orderDetailError && state.orderDetailLines.length === 0,
    totalText: fmt(total),
  };
}

// ---------- ROUTE PLANNING / DELIVERY HISTORY ("คำสั่งซื้อ" tab) ----------
export function computeRoute(state: AppState, actions: AppActions) {
  const rq = state.routeQ.trim().toLowerCase();
  const routeValues = Array.from(new Set(state.routeOrders.map((o) => o.route))).sort();
  const statusValues = Array.from(new Set(state.routeOrders.map((o) => o.status).filter(Boolean))).sort();

  const filtered = state.routeOrders.filter((o) => {
    if (state.routeFilterValue !== 'all' && o.route !== state.routeFilterValue) return false;
    if (state.routeStatusFilter !== 'all' && o.status !== state.routeStatusFilter) return false;
    if (rq && !(o.customer.toLowerCase().includes(rq) || o.orderNo.toLowerCase().includes(rq))) return false;
    return true;
  });

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

  // The Route column is high-cardinality real-world data (trip numbers,
  // letter lanes, and ad-hoc values like "รับเอง/1020"), so it gets a
  // dropdown; status is a small fixed set and stays as chips.
  const routeOptions = [
    { value: 'all', label: `ทุกเส้นทาง (${state.routeOrders.length})` },
    ...routeValues.map((v) => ({ value: v, label: `${v} (${state.routeOrders.filter((o) => o.route === v).length})` })),
  ];

  const rows = filtered.map((o) => ({
    route: o.route,
    orderNo: o.orderNo,
    customer: o.customer,
    stLabel: o.status || '—',
    stStyle: sheetStatusStyle(o.status),
    amtText: fmt(o.totalAmount),
    itemCount: o.itemCount,
    paymentType: o.paymentType,
    plannedDeliveryDate: o.plannedDeliveryDate,
    completedDate: o.completedDate || '—',
    distanceText: o.distanceFromWhKm != null ? `${o.distanceFromWhKm.toFixed(1)} กม.` : '—',
    address: o.addressFromUnii || o.districtProvince,
    mapLink: o.mapLink,
    isNewCustomer: o.isNewCustomer,
    note: o.note,
    viewItems: () => actions.openOrderDetail(o.orderNo, o.customer),
  }));

  const wh = state.routeOrders.find((o) => o.whLat != null && o.whLng != null);
  const warehouse = wh && wh.whLat != null && wh.whLng != null ? { lat: wh.whLat, lng: wh.whLng } : null;

  const geocoded = filtered
    .filter((o) => o.lat != null && o.lng != null)
    .map((o) => ({ id: o.orderNo, lat: o.lat as number, lng: o.lng as number, label: o.customer, status: o.status }));

  // Coordinates coming out of Unii are unreliable (0,0 placeholders, points in
  // the wrong province or country). Left in, a single bad point stretches the
  // map bounds until every real stop collapses into one dot — so drop the
  // implausible ones and tell the user how many were dropped rather than
  // silently hiding data.
  const { kept: mapStops, excluded: excludedStopCount } = rejectOutlierStops(geocoded, warehouse);

  return {
    routeOrdersLoading: state.routeOrdersLoading,
    routeOrdersError: state.routeOrdersError,
    routeQ: state.routeQ,
    onRouteSearch: (v: string) => actions.patch({ routeQ: v }),
    routeOptions,
    routeFilterValue: state.routeFilterValue,
    onRouteFilter: (v: string) => actions.patch({ routeFilterValue: v }),
    statusTabs: makeTabs(statusValues, state.routeStatusFilter, (v) => actions.patch({ routeStatusFilter: v })),
    rows,
    resultCount: filtered.length,
    isEmpty: filtered.length === 0,
    mapStops,
    excludedStopCount,
    warehouse,
  };
}

export interface MapStop {
  id: string;
  lat: number;
  lng: number;
  label: string;
  status: string;
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

export function rejectOutlierStops(stops: MapStop[], warehouse: { lat: number; lng: number } | null): { kept: MapStop[]; excluded: number } {
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

// ---------- BATCH PICKING ----------
export function computePick(state: AppState, actions: AppActions) {
  const items = [...pickBatch.items].sort((a, b) => a.loc.localeCompare(b.loc));
  const rowBase: CSSProperties = { display: 'flex', alignItems: 'center', gap: 13, width: '100%', padding: '12px 14px', border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', borderRadius: 12, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', transition: 'box-shadow .12s' };
  const boxBase: CSSProperties = { width: 30, height: 30, flex: 'none', borderRadius: 8, display: 'grid', placeItems: 'center' };

  let pk = 0;
  const pickItems = items.map((it) => {
    const on = !!state.picked[it.sku];
    if (on) pk++;
    return {
      sku: it.sku,
      name: it.name,
      qty: it.qty,
      unit: it.unit,
      loc: it.loc,
      toggle: () => actions.patch({ picked: { ...state.picked, [it.sku]: !state.picked[it.sku] } }),
      rowStyle: on ? { ...rowBase, boxShadow: 'inset 0 0 0 1.5px var(--color-accent-700)' } : rowBase,
      boxStyle: on ? { ...boxBase, background: 'var(--color-accent)', color: '#fff' } : { ...boxBase, boxShadow: 'inset 0 0 0 2px var(--color-neutral-600)', color: 'transparent' },
      checkVis: on ? {} : { opacity: 0 },
      textStyle: on ? ({ textDecoration: 'line-through', color: 'var(--color-neutral-500)' } as CSSProperties) : {},
    };
  });

  const total = items.length;
  const pickPct = total ? Math.round((pk / total) * 100) : 0;
  const complete = pk === total && total > 0;

  return {
    pickBatch,
    pickTotal: total,
    pickedCount: pk,
    pickPct,
    pickItems,
    pickClosed: state.pickClosed,
    pickCloseDisabled: !complete || state.pickClosed,
    pickBtnLabel: state.pickClosed ? 'ปิดล็อตแล้ว' : complete ? 'ปิดล็อต — ส่งต่อ Checker' : 'หยิบให้ครบก่อนปิดล็อต',
    closePick: () => {
      if (Object.values(state.picked).filter(Boolean).length === pickBatch.items.length) actions.patch({ pickClosed: true });
    },
  };
}

// ---------- COD ----------
export function computeCod(state: AppState, actions: AppActions) {
  const codClosed = !!state.codClosed[state.codDriver];
  const codList = orders.filter((o) => o.cod && o.status === 'delivered' && o.driver === state.codDriver);
  let expSum = 0;
  let retSum = 0;

  const codRows = codList.map((o) => {
    const ret = state.cod[o.id] ?? '';
    const retN = ret === '' ? null : Number(ret);
    const diff = retN == null ? null : retN - o.amt;
    expSum += o.amt;
    retSum += retN || 0;
    let diffText = '—';
    let diffStyle = badgeStyle('neutral');
    if (diff != null) {
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
      diffText,
      diffStyle,
      onInput: (v: string) => actions.patch({ cod: { ...state.cod, [o.id]: v.replace(/[^0-9]/g, '') } }),
    };
  });

  const totalDiff = retSum - expSum;
  const codMismatch = totalDiff !== 0 && !codClosed;
  const codDiffText = totalDiff === 0 ? 'ยอดตรง' : (totalDiff > 0 ? 'เกิน +' : 'ขาด −') + fmt(Math.abs(totalDiff));
  const codDiffStyle = totalDiff === 0 ? badgeStyle('ok') : badgeStyle('bad');

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
    codReturnedText: fmt(retSum),
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
    .map((p) => ({ ...p, stLabel: promoMeta[p.st][0], stStyle: badgeStyle(promoMeta[p.st][1]), typeStyle: badgeStyle('accent') }));

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
    addPromo: () => actions.addPromo(),
  };
}

// ---------- GRN ----------
export function computeGrn(state: AppState, actions: AppActions) {
  const lk = state.grnLookup;
  const lookupFound = !!(lk && !('notFound' in lk));
  const lookupMissing = !!(lk && 'notFound' in lk);
  const found = lk && !('notFound' in lk) ? { name: lk.name, id: lk.displayId, unit: lk.unit } : { name: '', id: '', unit: '' };

  const grnLines = state.grnLines.map((l, i) => ({
    ...l,
    priceText: fmt(l.price),
    qtyText: [l.piece ? l.piece + ' ชิ้น' : null, l.pack ? l.pack + ' แพค' : null, l.cs ? l.cs + ' ลัง' : null].filter(Boolean).join(' · ') || '—',
    remove: () => {
      const a = [...state.grnLines];
      a.splice(i, 1);
      actions.patch({ grnLines: a });
    },
  }));

  return {
    grnSupplier: state.grnSupplier,
    grnDoc: state.grnDoc,
    grnDate: state.grnDate,
    grnBarcode: state.grnBarcode,
    suppliers,
    grnLog: state.grnLog,
    onSupplier: (v: string) => actions.patch({ grnSupplier: v }),
    onGrnDoc: (v: string) => actions.patch({ grnDoc: v }),
    onGrnDate: (v: string) => actions.patch({ grnDate: v }),
    onBarcode: (v: string) => actions.patch({ grnBarcode: v, grnLookup: null, grnNewOpen: false }),
    onBarcodeKey: (key: string) => {
      if (key === 'Enter') actions.doLookup();
    },
    lookup: () => actions.doLookup(),
    lookupFound,
    lookupMissing,
    found,
    grnPrice: state.grnPrice,
    grnQtyPiece: state.grnQtyPiece,
    grnQtyPack: state.grnQtyPack,
    grnQtyCase: state.grnQtyCase,
    onPrice: (v: string) => actions.patch({ grnPrice: v.replace(/[^0-9.]/g, '') }),
    onQtyPiece: (v: string) => actions.patch({ grnQtyPiece: v.replace(/[^0-9]/g, '') }),
    onQtyPack: (v: string) => actions.patch({ grnQtyPack: v.replace(/[^0-9]/g, '') }),
    onQtyCase: (v: string) => actions.patch({ grnQtyCase: v.replace(/[^0-9]/g, '') }),
    newSkuOpen: state.grnNewOpen,
    newSkuClosed: !state.grnNewOpen,
    grnNewName: state.grnNewName,
    grnNewUnit: state.grnNewUnit,
    openNewSku: () => actions.patch({ grnNewOpen: true }),
    onNewName: (v: string) => actions.patch({ grnNewName: v }),
    onNewUnit: (v: string) => actions.patch({ grnNewUnit: v }),
    createSku: () => actions.createSkuFromGrn(),
    addLine: () => actions.addGrnLine(),
    grnLines,
    grnLineCount: state.grnLines.length,
    grnEmpty: state.grnLines.length === 0,
    saveGrn: () => actions.saveGrn(),
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
