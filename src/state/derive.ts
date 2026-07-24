import type { CSSProperties } from 'react';
import { laneDriver, orders, pickBatch, suppliers } from '../data/mockData';
import type { Order, PromoStatus } from '../data/types';
import { badgeStyle, fmt, statusMeta, syncMeta } from './helpers';
import type { AppActions, AppState } from './store';

export const orderById: Record<string, Order> = {};
orders.forEach((o) => (orderById[o.id] = o));

export const pageTitles: Record<AppState['route'], [string, string]> = {
  dashboard: ['แดชบอร์ด / รายการออเดอร์', 'ภาพรวมออเดอร์ทั้งหมด · ดึงข้อมูลสดจาก API'],
  route: ['จัดเส้นทางส่งของ', 'จัดลำดับการส่งของแต่ละเส้นทางประจำวัน'],
  pick: ['Batch picking / จัดล็อตหยิบสินค้า', 'รวมหลายออเดอร์เป็นล็อตเดียว หยิบสินค้าตามตำแหน่งเก็บ'],
  cod: ['เคลียร์เงินปลายทาง (COD)', 'เทียบยอดที่ควรเก็บกับยอดคืนจริงต่อ driver'],
  promo: ['โปรโมชั่น / ส่วนลด', 'จัดการโปรโมชั่นที่ผูกกับสินค้า'],
  grn: ['บันทึกรับของเข้าคลัง (GRN)', 'บันทึกสินค้าเข้าใหม่จากซัพพลายเออร์'],
  sku: ['ฐานข้อมูลสินค้า (SKU master)', 'ทะเบียนสินค้าทั้งหมดในระบบ'],
  customer: ['ฐานข้อมูลลูกค้า', 'ทะเบียนร้านค้าและเงื่อนไข/ข้อจำกัดการขายของแต่ละร้าน'],
  settings: ['ตั้งค่า / API Key', 'จัดการการเชื่อมต่อระบบออเดอร์ภายนอก'],
};

// ---------- DASHBOARD ----------
export function computeDashboard(state: AppState, actions: AppActions) {
  const q = state.q.trim().toLowerCase();
  const list = orders.filter((o) => {
    if (state.statusFilter !== 'all' && o.status !== state.statusFilter) return false;
    if (state.routeFilter !== 'all' && o.route !== state.routeFilter) return false;
    if (q && !(o.cust.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))) return false;
    return true;
  });

  const rows = list.map((o) => {
    const m = statusMeta(o.status);
    const sy = syncMeta(o.sync || 'synced');
    return {
      id: o.id,
      cust: o.cust,
      addr: o.addr,
      items: o.items,
      date: o.date,
      routeLabel: 'Route ' + o.route,
      amtText: o.cod ? fmt(o.amt) : 'เครดิต',
      amtColor: o.cod ? '' : 'var(--color-neutral-500)',
      stLabel: m.label,
      stStyle: m.style,
      syncLabel: sy.label,
      syncStyle: sy.style,
      syncIcon: sy.icon,
      syncSub: sy.kind === 'synced' ? '#UNII-' + o.id.replace('OD-', '') : sy.kind === 'error' ? 'เชื่อมต่อ API ไม่สำเร็จ' : 'อยู่ในคิวซิงค์',
    };
  });

  const scnt = (k: string) => orders.filter((o) => (o.sync || 'synced') === k).length;
  const cnt = (s: string) => orders.filter((o) => s === 'all' || o.status === s).length;

  const chipBase: CSSProperties = { border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: '6px 13px', borderRadius: 20, fontWeight: 500 };
  const statusChips = ([
    ['all', 'ทั้งหมด'],
    ['pending', 'รอจัด'],
    ['delivering', 'กำลังส่ง'],
    ['delivered', 'ส่งสำเร็จ'],
    ['cleared', 'เคลียร์แล้ว'],
  ] as const).map(([k, label]) => ({
    key: k,
    label,
    count: cnt(k),
    active: k === state.statusFilter,
    style: k === state.statusFilter
      ? { ...chipBase, background: 'var(--color-accent)', color: '#fff' }
      : { ...chipBase, background: 'var(--color-surface)', color: 'var(--color-neutral-300)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' },
    go: () => actions.patch({ statusFilter: k }),
  }));

  const todayCount = orders.filter((o) => o.date === '23 ก.ค.').length;
  const codOutstanding = orders.filter((o) => o.cod && o.status === 'delivered').reduce((a, o) => a + o.amt, 0);

  const stats = [
    { label: 'ออเดอร์วันนี้', value: String(todayCount), sub: 'ทุกเส้นทาง', icon: 'ph ph-package', iconColor: 'var(--color-accent-300)' },
    { label: 'รอจัด', value: String(cnt('pending')), sub: 'ต้องจัดของ', icon: 'ph ph-hourglass-medium', iconColor: 'var(--st-warn-fg)' },
    { label: 'กำลังส่ง', value: String(cnt('delivering')), sub: 'อยู่ระหว่างทาง', icon: 'ph ph-truck', iconColor: 'var(--st-info-fg)' },
    { label: 'ยอด COD ค้างเคลียร์', value: fmt(codOutstanding), sub: 'รอ driver ส่งคืน', icon: 'ph ph-wallet', iconColor: 'var(--st-ok-fg)' },
  ];

  const syncCountSynced = scnt('synced');
  const syncCountPending = scnt('pending');
  const syncCountError = scnt('error');
  const sbBase: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 9px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap' };

  return {
    q: state.q,
    routeFilter: state.routeFilter,
    dateFilter: state.dateFilter,
    onSearch: (v: string) => actions.patch({ q: v }),
    onRouteFilter: (v: string) => actions.patch({ routeFilter: v }),
    onDateFilter: (v: string) => actions.patch({ dateFilter: v }),
    resultCount: list.length,
    noOrders: list.length === 0,
    orders: rows,
    stats,
    statusChips,
    syncCountSynced,
    syncCountPending,
    syncCountError,
    syncBadgeSynced: { ...sbBase, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)' } as CSSProperties,
    syncBadgePending: { ...sbBase, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)' } as CSSProperties,
    syncBadgeError: { ...sbBase, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)' } as CSSProperties,
  };
}

// ---------- ROUTE PLANNING ----------
function buildLane(state: AppState, actions: AppActions, key: 'A' | 'B') {
  const ids = state.lanes[key];
  const total = ids.reduce((a, id) => a + (orderById[id].cod ? orderById[id].amt : 0), 0);
  const stops = ids.map((id, i) => {
    const o = orderById[id];
    const m = statusMeta(o.status);
    return {
      id,
      seq: i + 1,
      cust: o.cust,
      addr: o.addr,
      amtText: o.cod ? fmt(o.amt) : 'เครดิต',
      stLabel: m.label,
      stStyle: m.style,
      up: () => actions.moveStop(key, i, -1),
      down: () => actions.moveStop(key, i, 1),
      onDragStart: () => actions.patch({ dragFrom: { key, i } }),
      onDrop: () => actions.dropStop(key, i),
    };
  });
  return { key, driver: laneDriver[key], total: fmt(total), stops, stopsText: ids.length + ' จุดส่ง' };
}

export function computeRoute(state: AppState, actions: AppActions) {
  return {
    routeMobile: state.routeMobile,
    routeDesktop: !state.routeMobile,
    setRouteMobile: () => actions.patch({ routeMobile: true }),
    setRouteDesktop: () => actions.patch({ routeMobile: false }),
    lanes: (['A', 'B'] as const).map((k) => buildLane(state, actions, k)),
    selLane: buildLane(state, actions, state.routeSel),
    driverLane: buildLane(state, actions, state.routeSel),
    routeTabs: (['A', 'B'] as const).map((k) => ({ key: k, active: state.routeSel === k, go: () => actions.patch({ routeSel: k }) })),
  };
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
      textStyle: on ? { textDecoration: 'line-through', color: 'var(--color-neutral-500)' } as CSSProperties : {},
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

function nextCustIdLocal(state: AppState): string {
  const nums = state.customers.map((c) => parseInt(c.id.replace('CUST-', ''), 10)).filter((n) => !isNaN(n));
  return 'CUST-' + String(Math.max(100, ...nums) + 1);
}

// ---------- CUSTOMER MASTER ----------
const custStatusMeta: Record<string, [string, Parameters<typeof badgeStyle>[0]]> = {
  active: ['ปกติ', 'ok'],
  hold: ['ระงับ / ตรวจสอบ', 'bad'],
};

const condTag: CSSProperties = { display: 'inline-flex', fontSize: 10.5, padding: '2px 7px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)', whiteSpace: 'nowrap' };
const condTagWarn: CSSProperties = { display: 'inline-flex', fontSize: 10.5, padding: '2px 7px', borderRadius: 5, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', whiteSpace: 'nowrap' };

export function computeCustomer(state: AppState, actions: AppActions) {
  const cq = state.custQ.trim().toLowerCase();
  const custRows = state.customers
    .filter((c) => !cq || c.id.toLowerCase().includes(cq) || c.name.toLowerCase().includes(cq))
    .map((c) => {
      const isCredit = c.pay === 'credit';
      const pct = isCredit && c.limit > 0 ? Math.min(100, Math.round((c.balance / c.limit) * 100)) : 0;
      const over = isCredit && c.balance > c.limit;
      const near = isCredit && pct >= 90;
      const bar = over ? 'var(--st-bad-fg)' : near ? 'var(--st-warn-fg)' : 'var(--color-accent)';
      const override = state.customerOverrides[c.id];
      const lat = override?.lat ?? c.lat;
      const lng = override?.lng ?? c.lng;
      return {
        id: c.id,
        name: c.name,
        addr: c.addr,
        route: c.route,
        payLabel: isCredit ? 'เครดิต' : 'เงินสดปลายทาง',
        payStyle: badgeStyle(isCredit ? 'accent' : 'info'),
        hasCredit: isCredit,
        noCredit: !isCredit,
        balanceText: fmt(c.balance),
        limitText: fmt(c.limit),
        balanceStyle: over ? ({ color: 'var(--st-bad-fg)', fontWeight: 600 } as CSSProperties) : near ? ({ color: 'var(--st-warn-fg)', fontWeight: 600 } as CSSProperties) : ({} as CSSProperties),
        usagePct: pct,
        barFill: bar,
        termText: isCredit ? c.term + ' วัน' : '—',
        conds: (c.conds || []).map((t) => ({ text: t, style: t.includes('เกิน') || t.includes('ระงับ') || t.includes('ใกล้เต็ม') ? condTagWarn : condTag })),
        noConds: (c.conds || []).length === 0,
        stLabel: custStatusMeta[c.status][0],
        stStyle: badgeStyle(custStatusMeta[c.status][1]),
        locText: lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'ไม่มีพิกัด',
        hasOverride: !!override,
        edit: () => actions.openEditCust(c),
      };
    });

  const saveCust = () => {
    actions.saveCust();
    const lat = Number(state.custF.lat);
    const lng = Number(state.custF.lng);
    if (state.custF.lat.trim() !== '' && state.custF.lng.trim() !== '' && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      actions.setCustomerOverride(state.custF.id, lat, lng);
    }
  };

  const editingCustomer = state.customers.find((c) => c.id === state.custF.id) ?? null;

  return {
    customersLoading: state.customersLoading,
    customersError: state.customersError,
    custQ: state.custQ,
    onCustSearch: (v: string) => actions.patch({ custQ: v }),
    custRows,
    custModalOpen: !!state.custModal,
    custIsEdit: state.custModal === 'edit',
    custModalTitle: state.custModal === 'edit' ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่',
    custF: state.custF,
    custPayCod: state.custF.pay === 'cod',
    custPayCredit: state.custF.pay === 'credit',
    custOriginalLatLngText:
      state.custModal === 'edit' && editingCustomer && editingCustomer.lat != null && editingCustomer.lng != null
        ? `พิกัดจาก Unii: ${editingCustomer.lat.toFixed(5)}, ${editingCustomer.lng.toFixed(5)}`
        : state.custModal === 'edit'
          ? 'พิกัดจาก Unii: ไม่มีข้อมูล'
          : '',
    openAddCust: () =>
      actions.patch({
        custModal: 'add',
        custF: { id: nextCustIdLocal(state), name: '', addr: '', route: 'A', pay: 'cod', limit: '', balance: '', term: '', status: 'active', conds: '', lat: '', lng: '' },
      }),
    closeCust: () => actions.patch({ custModal: null }),
    onCFId: (v: string) => actions.patch({ custF: { ...state.custF, id: v } }),
    onCFName: (v: string) => actions.patch({ custF: { ...state.custF, name: v } }),
    onCFAddr: (v: string) => actions.patch({ custF: { ...state.custF, addr: v } }),
    onCFRoute: (v: 'A' | 'B') => actions.patch({ custF: { ...state.custF, route: v } }),
    onCFStatus: (v: 'active' | 'hold') => actions.patch({ custF: { ...state.custF, status: v } }),
    onCFConds: (v: string) => actions.patch({ custF: { ...state.custF, conds: v } }),
    onCFLimit: (v: string) => actions.patch({ custF: { ...state.custF, limit: v.replace(/[^0-9]/g, '') } }),
    onCFBalance: (v: string) => actions.patch({ custF: { ...state.custF, balance: v.replace(/[^0-9]/g, '') } }),
    onCFTerm: (v: string) => actions.patch({ custF: { ...state.custF, term: v.replace(/[^0-9]/g, '') } }),
    onCFLat: (v: string) => actions.patch({ custF: { ...state.custF, lat: v.replace(/[^0-9.\-]/g, '') } }),
    onCFLng: (v: string) => actions.patch({ custF: { ...state.custF, lng: v.replace(/[^0-9.\-]/g, '') } }),
    setPayCod: () => actions.patch({ custF: { ...state.custF, pay: 'cod' } }),
    setPayCredit: () => actions.patch({ custF: { ...state.custF, pay: 'credit' } }),
    saveCust,
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
