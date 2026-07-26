import { useEffect, useMemo, useReducer, useRef } from 'react';
import { fetchApiImportOrders } from '../data/sources/apiImportOrders';
import { CS_MASTER_CSV_URL, fetchCsMasterCustomers } from '../data/sources/csMaster';
import { updateCsMasterLatLng } from '../data/sources/csMasterWrite';
import { fetchActivePromotions } from '../data/sources/promotionsSheet';
import { fetchRouteOrders } from '../data/sources/routeOrders';
import { invalidateSheetCache } from '../data/sources/sheetCsv';
import { fetchAllOrderLineItems, fetchOrderLineItems, fetchOrderLineItemsForOrders } from '../data/sources/skuDetail';
import { fetchSkusFromSheet } from '../data/sources/skuSheet';
import { attachmentKey, loadAttachments, saveAttachments, uploadToDrive, type AttachmentIndex } from '../data/sources/attachments';
import { emptyLine, loadReceivingLog, receivingFolderKey, saveReceivingLog, type ReceivingLine, type ReceivingRecord } from '../data/receiving';
import { DEFAULT_VEHICLES, loadRoutePlan, loadVehicles, saveRoutePlan, saveVehicles, type RoutePlan, type Vehicle } from '../data/vehicles';
import { DEFAULT_ZONE_RULES, loadZoneRules, saveZoneRules, type ZoneRule } from '../data/zoneConfig';
import { coordKey, loadGeocodeCache, saveGeocodeCache, type GeocodeCache } from '../data/geocodeCache';
import { reverseGeocode } from '../data/sources/geocoding';
import { GEOCODE_MIN_INTERVAL_MS } from '../config/geocoding';
import { loadRouteCodState, saveRouteCodState } from '../data/routeCod';
import { isoToSheetDateText, sheetDateToDayKey, todayDayKey } from '../data/dateUtils';
import { updateRouteOrder } from '../data/sources/routeOrdersWrite';
import { loadDriverQueue, saveDriverQueue } from '../data/driverQueue';
import { loadPickLots, savePickLots, type PickLot, type PickLotLine } from '../data/pickLots';
import { PICK_CLOSED_STATUS } from './helpers';
import type { AttachmentScope } from '../config/drive';
import type { ApiImportOrder, CsMasterCustomer, OrderLineItem, Promo, PromoTier, PromoUnit, RouteKey, RouteOrder, Sku } from '../data/types';

export interface OrderEditDraft {
  /** ISO YYYY-MM-DD, '' = not set. */
  plannedDeliveryDate: string;
  note: string;
  wantsTaxInvoice: boolean;
}

export interface OrderSaveStatus {
  state: 'saving' | 'saved' | 'error';
  message?: string;
}

export interface SkuForm {
  /** Hidden unique key of the row being edited; empty when adding a new SKU. */
  key: string;
  /** User-facing SKU ID shown/edited in the form. */
  id: string;
  barcode: string;
  name: string;
  unit: string;
  stock: string;
  status: 'active' | 'inactive';
}

export interface AppState {
  route: RouteKey;

  // dashboard ("API Import" tab — newest, not-yet-routed orders)
  apiOrders: ApiImportOrder[];
  apiOrdersLoading: boolean;
  apiOrdersError: string | null;
  q: string;
  statusFilter: string;

  // 7-day delivery forecast (built from routeOrders, shown on the dashboard)
  forecastStatusFilter: string;

  // order line-items modal (shared by dashboard's "ดู" button — "SKU Detail" tab)
  orderDetailOpen: boolean;
  orderDetailOrderNo: string;
  orderDetailCustomer: string;
  orderDetailLines: { sku: string; name: string; unit: string; qty: number; unitPrice: number; discount: number; lineTotal: number }[];
  orderDetailLoading: boolean;
  orderDetailError: string | null;
  /** true when the opened order has a matching "คำสั่งซื้อ" row to edit/save against. */
  orderEditAvailable: boolean;
  orderEditDraft: OrderEditDraft;
  /** Per orderNo, so the table can also show a save indicator after the modal closes. */
  orderSaveStatus: Record<string, OrderSaveStatus>;

  // route planning / delivery history ("คำสั่งซื้อ" tab)
  routeOrders: RouteOrder[];
  routeOrdersLoading: boolean;
  routeOrdersError: string | null;
  routeFilterValue: string;
  routeStatusFilter: string;
  routeQ: string;
  /** ISO date (YYYY-MM-DD) filters; '' = no filter. */
  routeOrderDateFilter: string;
  routeDeliveryDateFilter: string;

  // route planner (zones + vehicles are user-editable and persisted locally)
  zoneRules: ZoneRule[];
  /** Reverse-geocoded ตำบล/อำเภอ/จังหวัด per unique coordinate — see
   * src/data/geocodeCache.ts. Persisted so a coordinate is only ever looked
   * up once, across reloads. */
  geocodeCache: GeocodeCache;
  /** Progress of the background batch geocoding not-yet-cached coordinates
   * found in routeOrders; null when nothing is currently running. */
  geocodeProgress: { done: number; total: number } | null;
  vehicles: Vehicle[];
  routePlan: RoutePlan;
  plannerConfigTab: 'zones' | 'vehicles' | null;
  /** Which day's deliveries the planner pool is scoped to (ISO date); '' = all. */
  plannerDate: string;
  /** COD tracking per order, route-by-route (which vehicle is implied by routePlan). */
  routeCodCollected: Record<string, string>;
  routeCodMethod: Record<string, 'cash' | 'transfer'>;
  /** Direction the "เรียงไกล→ใกล้" button will apply next, per vehicle —
   * toggles each click. Missing = 'far' (the original default). */
  routeSortDirection: Record<string, 'far' | 'near'>;

  // mobile driver view — reuses routeOrders/routePlan/vehicles, only adds its
  // own navigation + offline-sync state
  /** null = vehicle picker screen. */
  driverVehicleId: string | null;
  /** orderNos marked delivered locally but not yet confirmed synced to the sheet. */
  driverSyncQueue: string[];
  driverOnline: boolean;

  // batch picking ("คำสั่งซื้อ" tab, status = "กำลังดำเนินการ")
  pickOrderQ: string;
  pickSelectedOrderNos: string[];
  pickCreating: boolean;
  pickCreateError: string | null;
  pickLots: PickLot[];
  /** null = order-selection / open-lots screen. */
  activePickLotId: string | null;

  // COD
  codDriver: string;
  codMobile: boolean;
  cod: Record<string, string>;
  /** How each order's COD was actually settled. Cash has to be physically
   * handed back at clearing; a transfer is already in the company account,
   * so it is reconciled but never counted as cash owed. Defaults to cash. */
  codMethod: Record<string, 'cash' | 'transfer'>;
  codClosed: Record<string, boolean>;

  // promo ("โปรโมชั่น" tab, Active rows only; "create promotion" flow is local)
  promos: Promo[];
  promosLoading: boolean;
  promosError: string | null;
  promoQ: string;
  promoModal: boolean;
  promoForm: { name: string; sku: string; type: string; start: string; end: string; unit: PromoUnit; tiers: PromoTier[] };

  // all order line items ("SKU Detail" tab, unfiltered) — used to flag which
  // orders on the Order Management page contain an actively-promoted SKU.
  orderLineItems: OrderLineItem[];
  orderLineItemsLoading: boolean;
  orderLineItemsError: string | null;

  // attachments (Drive-backed, metadata kept locally)
  attachments: AttachmentIndex;
  uploadingKey: string | null;
  uploadError: string | null;

  // goods receiving from suppliers
  receivingLog: ReceivingRecord[];
  recvSupplier: string;
  recvBillNo: string;
  recvDate: string;
  recvNote: string;
  recvLines: ReceivingLine[];
  recvSaved: string | null;
  recvFilterSupplier: string;
  recvFilterDate: string;
  recvFilterSku: string;


  // SKU master (Google Sheet)
  skus: Sku[];
  skusLoading: boolean;
  skusError: string | null;
  skuQ: string;
  skuModal: 'add' | 'edit' | null;
  skuF: SkuForm;

  // customer master ("CS Master" tab — read via CSV, lat/lng written back
  // through the local backend in server/, which holds the Service Account
  // credential; see src/data/sources/csMasterWrite.ts)
  customers: CsMasterCustomer[];
  customersLoading: boolean;
  customersError: string | null;
  custQ: string;
  custEditRowIndex: number | null;
  custEditLat: string;
  custEditLng: string;
  custEditSaving: boolean;
  custEditError: string | null;

  // settings
  apiKey: string;
  apiTesting: boolean;
  apiOk: boolean;
  keySaved: boolean;
}

/** ?driver=<vehicleId> jumps straight into the mobile driver view for that
 * vehicle — the one bit of real browser-URL-based deep-linking this app
 * has, since the driver page is meant to be a link a driver can open
 * directly rather than something they navigate the whole admin app to find. */
function initialRouteFromUrl(): Pick<AppState, 'route' | 'driverVehicleId'> {
  if (typeof window === 'undefined') return { route: 'dashboard', driverVehicleId: null };
  const vehicleId = new URLSearchParams(window.location.search).get('driver');
  return vehicleId ? { route: 'driver', driverVehicleId: vehicleId } : { route: 'dashboard', driverVehicleId: null };
}

export const initialState: AppState = {
  ...initialRouteFromUrl(),

  apiOrders: [],
  apiOrdersLoading: true,
  apiOrdersError: null,
  q: '',
  statusFilter: 'all',

  forecastStatusFilter: 'all',

  orderDetailOpen: false,
  orderDetailOrderNo: '',
  orderDetailCustomer: '',
  orderDetailLines: [],
  orderDetailLoading: false,
  orderDetailError: null,
  orderEditAvailable: false,
  orderEditDraft: { plannedDeliveryDate: '', note: '', wantsTaxInvoice: false },
  orderSaveStatus: {},

  routeOrders: [],
  routeOrdersLoading: true,
  routeOrdersError: null,
  routeFilterValue: 'all',
  routeStatusFilter: 'all',
  routeQ: '',
  routeOrderDateFilter: '',
  routeDeliveryDateFilter: '',

  zoneRules: DEFAULT_ZONE_RULES,
  geocodeCache: {},
  geocodeProgress: null,
  vehicles: DEFAULT_VEHICLES,
  routePlan: {},
  plannerConfigTab: null,
  plannerDate: todayDayKey(),
  routeCodCollected: {},
  routeCodMethod: {},
  routeSortDirection: {},

  driverSyncQueue: [],
  driverOnline: typeof navigator === 'undefined' || navigator.onLine,

  pickOrderQ: '',
  pickSelectedOrderNos: [],
  pickCreating: false,
  pickCreateError: null,
  pickLots: [],
  activePickLotId: null,
  codDriver: 'สมชาย ป.',
  codMobile: false,
  cod: { 'OD-6004': '3380', 'OD-6009': '3900', 'OD-6006': '1980', 'OD-6007': '7450' },
  codMethod: {},
  codClosed: {},

  promos: [],
  promosLoading: true,
  promosError: null,
  promoQ: '',
  promoModal: false,
  promoForm: { name: '', sku: '', type: 'ลดราคา', start: '2026-07-24', end: '2026-08-24', unit: 'ลัง', tiers: [{ minQty: 1, price: 0 }] },

  orderLineItems: [],
  orderLineItemsLoading: true,
  orderLineItemsError: null,

  attachments: {},
  uploadingKey: null,
  uploadError: null,

  receivingLog: [],
  recvSupplier: '',
  recvBillNo: '',
  recvDate: new Date().toISOString().slice(0, 10),
  recvNote: '',
  recvLines: [],
  recvSaved: null,
  recvFilterSupplier: 'all',
  recvFilterDate: '',
  recvFilterSku: '',


  skus: [],
  skusLoading: true,
  skusError: null,
  skuQ: '',
  skuModal: null,
  skuF: { key: '', id: '', barcode: '', name: '', unit: 'ชิ้น', stock: '', status: 'active' },

  customers: [],
  customersLoading: true,
  customersError: null,
  custQ: '',
  custEditRowIndex: null,
  custEditLat: '',
  custEditLng: '',
  custEditSaving: false,
  custEditError: null,

  apiKey: '',
  apiTesting: false,
  apiOk: false,
  keySaved: false,
};

export type Action =
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'openEditSku'; sku: Sku }
  | { type: 'saveSku' }
  | { type: 'addPromo' }
  | { type: 'updateCustomerLatLng'; rowIndex: number; lat: number; lng: number }
  | { type: 'setOrderSaveStatus'; orderNo: string; status: OrderSaveStatus | null }
  | { type: 'applyOrderEdit'; orderNo: string; plannedDeliveryDateSheetText: string | null; note: string | null; wantsTaxInvoice: boolean | null }
  | { type: 'applyDeliveryMark'; orderNo: string; statusText: string; completedDateText: string }
  | { type: 'applyPickLotStatus'; orderNo: string; statusText: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };

    case 'openEditSku':
      return {
        ...state,
        skuModal: 'edit',
        skuF: {
          key: action.sku.id,
          id: action.sku.displayId,
          barcode: action.sku.barcode,
          name: action.sku.name,
          unit: action.sku.unit,
          stock: String(action.sku.stock),
          status: action.sku.status,
        },
      };

    case 'saveSku': {
      const f = state.skuF;
      if (!f.id || !f.name) return state;
      const key = f.key || f.id;
      const arr = [...state.skus];
      const idx = arr.findIndex((x) => x.id === key);
      // No location field in the edit form yet (the sheet has no such column
      // today either) — carry over whatever an existing row already had.
      const rec: Sku = { id: key, displayId: f.id, barcode: f.barcode, name: f.name, unit: f.unit, stock: Number(f.stock || 0), status: f.status, location: idx >= 0 ? arr[idx].location : '' };
      if (idx >= 0) arr[idx] = rec;
      else arr.push(rec);
      return { ...state, skus: arr, skuModal: null };
    }

    case 'addPromo': {
      const f = state.promoForm;
      if (!f.name.trim()) return state;
      const match = state.skus.find((s) => s.id === f.sku || s.name === f.sku);
      const tiers = f.tiers.filter((t) => t.price > 0).sort((a, b) => a.minQty - b.minQty);
      const base = tiers[0];
      const promo: Promo = {
        name: f.name.trim(),
        value: base ? `฿${base.price}/${f.unit}` : f.type,
        sku: match ? match.displayId : f.sku.trim() || '—',
        skuName: match ? match.name : f.sku.trim() || '—',
        type: tiers.length > 1 ? 'ลดขั้นบันได' : f.type,
        period: `${f.start} – ${f.end}`,
        st: 'active',
        unit: f.unit,
        tiers,
        termText: tiers.map((t) => (t.minQty > 1 ? `${t.minQty}${f.unit}ขึ้นไป ${t.price}บาท` : `${f.unit}ละ ${t.price}บาท`)).join(', '),
      };
      return {
        ...state,
        promos: [promo, ...state.promos],
        promoModal: false,
        promoForm: { name: '', sku: '', type: 'ลดราคา', start: '2026-07-24', end: '2026-08-24', unit: 'ลัง', tiers: [{ minQty: 1, price: 0 }] },
      };
    }

    case 'updateCustomerLatLng': {
      const arr = state.customers.map((c) => (c.rowIndex === action.rowIndex ? { ...c, lat: action.lat, lng: action.lng } : c));
      return { ...state, customers: arr };
    }

    case 'setOrderSaveStatus': {
      const next = { ...state.orderSaveStatus };
      if (action.status === null) delete next[action.orderNo];
      else next[action.orderNo] = action.status;
      return { ...state, orderSaveStatus: next };
    }

    case 'applyOrderEdit': {
      // Written back to the real sheet successfully, so state.routeOrders
      // becomes the authoritative copy again — no separate local override
      // layer needed. Mirrors wantsTaxInvoice onto the matching API Import
      // row too (by orderUid), since that's the one field both tabs share.
      const routeOrders = state.routeOrders.map((o) =>
        o.orderNo === action.orderNo
          ? {
              ...o,
              ...(action.plannedDeliveryDateSheetText !== null ? { plannedDeliveryDate: action.plannedDeliveryDateSheetText } : {}),
              ...(action.note !== null ? { note: action.note } : {}),
              ...(action.wantsTaxInvoice !== null ? { wantsTaxInvoice: action.wantsTaxInvoice } : {}),
            }
          : o,
      );
      const apiOrders =
        action.wantsTaxInvoice !== null
          ? state.apiOrders.map((o) => (o.orderUid === action.orderNo ? { ...o, wantsTaxInvoice: action.wantsTaxInvoice ? 'ใช่' : '' } : o))
          : state.apiOrders;
      return { ...state, routeOrders, apiOrders };
    }

    case 'applyDeliveryMark': {
      // Optimistic — set immediately on tap, regardless of whether the sheet
      // write has confirmed yet, so the driver's own screen and every other
      // page sharing this same state (Order Management, Dashboard) reflect
      // it instantly. Sync state is tracked separately in driverSyncQueue.
      const routeOrders = state.routeOrders.map((o) => (o.orderNo === action.orderNo ? { ...o, status: action.statusText, completedDate: action.completedDateText } : o));
      const apiOrders = state.apiOrders.map((o) => (o.orderUid === action.orderNo ? { ...o, status: action.statusText } : o));
      return { ...state, routeOrders, apiOrders };
    }

    case 'applyPickLotStatus': {
      // Confirms one order's post-close status write actually landed in the
      // sheet — patches the same shared routeOrders/apiOrders every other
      // page reads, same as applyDeliveryMark above.
      const routeOrders = state.routeOrders.map((o) => (o.orderNo === action.orderNo ? { ...o, status: action.statusText } : o));
      const apiOrders = state.apiOrders.map((o) => (o.orderUid === action.orderNo ? { ...o, status: action.statusText } : o));
      return { ...state, routeOrders, apiOrders };
    }

    default:
      return state;
  }
}

export function useAppStore() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // dispatch's identity is stable (useReducer guarantee), so this can be a
  // plain closure rather than useCallback — it's referenced both by the
  // online/retry effect below and by the markDelivered action.
  function syncDriverQueue() {
    const queue = loadDriverQueue();
    if (queue.length === 0) return;
    queue.forEach((orderNo) => {
      updateRouteOrder({ orderNo, markDelivered: true })
        .then(() => {
          const next = loadDriverQueue().filter((n) => n !== orderNo);
          saveDriverQueue(next);
          dispatch({ type: 'patch', patch: { driverSyncQueue: next } });
        })
        .catch(() => {
          /* leave it queued — the next online event, interval tick, or
           * markDelivered call will retry it */
        });
    });
  }

  /** Writes the post-pick status back for every order in a closed lot. Each
   * order is tracked in that lot's own statusSyncPending until its write
   * confirms, so a partial failure (some orders update, some don't) is
   * visible and retryable per-lot rather than all-or-nothing. */
  function syncPickLotStatus(orderNos: string[]) {
    orderNos.forEach((orderNo) => {
      updateRouteOrder({ orderNo, status: PICK_CLOSED_STATUS })
        .then(() => {
          const next = loadPickLots().map((l) =>
            l.orderNos.includes(orderNo) ? { ...l, statusSyncPending: l.statusSyncPending.filter((n) => n !== orderNo) } : l,
          );
          savePickLots(next);
          dispatch({ type: 'patch', patch: { pickLots: next } });
          dispatch({ type: 'applyPickLotStatus', orderNo, statusText: PICK_CLOSED_STATUS });
        })
        .catch(() => {
          /* stays in statusSyncPending — retryable via the lot's own button */
        });
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetchSkusFromSheet()
      .then((skus) => {
        if (!cancelled) dispatch({ type: 'patch', patch: { skus, skusLoading: false, skusError: null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดข้อมูลสินค้าไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { skusLoading: false, skusError: message } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchApiImportOrders()
      .then((apiOrders) => {
        if (!cancelled) dispatch({ type: 'patch', patch: { apiOrders, apiOrdersLoading: false, apiOrdersError: null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดออเดอร์ใหม่ไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { apiOrdersLoading: false, apiOrdersError: message } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRouteOrders()
      .then((routeOrders) => {
        if (!cancelled) dispatch({ type: 'patch', patch: { routeOrders, routeOrdersLoading: false, routeOrdersError: null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดข้อมูลเส้นทาง/ประวัติการจัดส่งไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { routeOrdersLoading: false, routeOrdersError: message } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchActivePromotions()
      .then((promos) => {
        if (!cancelled) dispatch({ type: 'patch', patch: { promos, promosLoading: false, promosError: null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดโปรโมชั่นไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { promosLoading: false, promosError: message } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAllOrderLineItems()
      .then((orderLineItems) => {
        if (!cancelled) dispatch({ type: 'patch', patch: { orderLineItems, orderLineItemsLoading: false, orderLineItemsError: null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดรายการสินค้าต่อออเดอร์ไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { orderLineItemsLoading: false, orderLineItemsError: message } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCsMasterCustomers()
      .then((customers) => {
        if (!cancelled) dispatch({ type: 'patch', patch: { customers, customersLoading: false, customersError: null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดรายชื่อลูกค้าไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { customersLoading: false, customersError: message } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Zones, vehicles and the current plan live in localStorage, so they survive
  // a reload without needing the sheet or a backend.
  useEffect(() => {
    const routeCod = loadRouteCodState();
    dispatch({
      type: 'patch',
      patch: {
        zoneRules: loadZoneRules(),
        geocodeCache: loadGeocodeCache(),
        vehicles: loadVehicles(),
        routePlan: loadRoutePlan(),
        attachments: loadAttachments(),
        receivingLog: loadReceivingLog(),
        routeCodCollected: routeCod.collected,
        routeCodMethod: routeCod.method,
        driverSyncQueue: loadDriverQueue(),
        pickLots: loadPickLots(),
      },
    });
  }, []);

  // Background batch-geocode: once routeOrders has loaded, reverse-geocode
  // every unique coordinate not already in the cache (paced at
  // GEOCODE_MIN_INTERVAL_MS so this never bursts past Nominatim's rate
  // limit), updating the cache — and every row using it — one coordinate at
  // a time rather than blocking the page until the whole batch finishes.
  // Guarded by a ref (not a state flag) so it only ever runs once even if
  // this effect re-fires for an unrelated reason.
  const geocodeBatchStarted = useRef(false);
  useEffect(() => {
    if (state.routeOrders.length === 0 || geocodeBatchStarted.current) return;

    const localCache: GeocodeCache = { ...state.geocodeCache };
    const seen = new Set<string>();
    const toFetch: { key: string; lat: number; lng: number }[] = [];
    for (const o of state.routeOrders) {
      if (o.lat == null || o.lng == null) continue;
      const key = coordKey(o.lat, o.lng);
      if (localCache[key] || seen.has(key)) continue;
      seen.add(key);
      toFetch.push({ key, lat: o.lat, lng: o.lng });
    }
    if (toFetch.length === 0) return;
    geocodeBatchStarted.current = true;

    let cancelled = false;
    (async () => {
      dispatch({ type: 'patch', patch: { geocodeProgress: { done: 0, total: toFetch.length } } });
      for (let i = 0; i < toFetch.length && !cancelled; i++) {
        const { key, lat, lng } = toFetch[i];
        const result = await reverseGeocode(lat, lng);
        if (cancelled) break;
        if (result) {
          localCache[key] = { ...result, fetchedAt: Date.now() };
          saveGeocodeCache(localCache);
          dispatch({ type: 'patch', patch: { geocodeCache: { ...localCache } } });
        }
        dispatch({ type: 'patch', patch: { geocodeProgress: { done: i + 1, total: toFetch.length } } });
        if (i < toFetch.length - 1) await new Promise((r) => setTimeout(r, GEOCODE_MIN_INTERVAL_MS));
      }
      if (!cancelled) dispatch({ type: 'patch', patch: { geocodeProgress: null } });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.routeOrders.length]);

  // Driver view offline support: retry any queued delivery marks whenever
  // connectivity returns, and keep trying periodically in case a request
  // failed for a reason other than being fully offline (e.g. a flaky signal).
  useEffect(() => {
    const goOnline = () => {
      dispatch({ type: 'patch', patch: { driverOnline: true } });
      syncDriverQueue();
    };
    const goOffline = () => dispatch({ type: 'patch', patch: { driverOnline: false } });
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const interval = setInterval(() => {
      if (loadDriverQueue().length > 0) syncDriverQueue();
    }, 20000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = useMemo(
    () => ({
      patch: (patch: Partial<AppState>) => dispatch({ type: 'patch', patch }),
      setZoneRules: (rules: ZoneRule[]) => {
        dispatch({ type: 'patch', patch: { zoneRules: rules } });
        saveZoneRules(rules);
      },
      setVehicles: (vehicles: Vehicle[]) => {
        dispatch({ type: 'patch', patch: { vehicles } });
        saveVehicles(vehicles);
      },
      setRoutePlan: (plan: RoutePlan) => {
        dispatch({ type: 'patch', patch: { routePlan: plan } });
        saveRoutePlan(plan);
      },
      saveRouteCod: (collected: Record<string, string>, method: Record<string, 'cash' | 'transfer'>) => {
        saveRouteCodState({ collected, method });
        dispatch({ type: 'patch', patch: { routeCodCollected: collected, routeCodMethod: method } });
      },

      /** Upload to Drive via the backend, then record the returned metadata.
       * A failure never throws into render — it surfaces as uploadError. */
      uploadAttachments: async (scope: AttachmentScope, key: string, files: File[], index: AttachmentIndex) => {
        const storeKey = attachmentKey(scope, key);
        dispatch({ type: 'patch', patch: { uploadingKey: storeKey, uploadError: null } });
        try {
          const uploaded = await uploadToDrive(scope, key, files);
          const next: AttachmentIndex = { ...index, [storeKey]: [...(index[storeKey] ?? []), ...uploaded] };
          saveAttachments(next);
          dispatch({ type: 'patch', patch: { attachments: next, uploadingKey: null } });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'อัปโหลดไฟล์ไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { uploadingKey: null, uploadError: message } });
        }
      },
      removeAttachment: (scope: AttachmentScope, key: string, fileId: string, index: AttachmentIndex) => {
        const storeKey = attachmentKey(scope, key);
        const next: AttachmentIndex = { ...index, [storeKey]: (index[storeKey] ?? []).filter((a) => a.fileId !== fileId) };
        saveAttachments(next);
        dispatch({ type: 'patch', patch: { attachments: next } });
      },
      clearUploadError: () => dispatch({ type: 'patch', patch: { uploadError: null } }),

      setReceivingLines: (lines: ReceivingLine[]) => dispatch({ type: 'patch', patch: { recvLines: lines } }),
      addReceivingLine: (lines: ReceivingLine[]) => dispatch({ type: 'patch', patch: { recvLines: [...lines, emptyLine()] } }),
      saveReceiving: (record: ReceivingRecord, log: ReceivingRecord[]) => {
        const next = [record, ...log];
        saveReceivingLog(next);
        dispatch({
          type: 'patch',
          patch: {
            receivingLog: next,
            recvLines: [],
            recvBillNo: '',
            recvNote: '',
            recvSaved: receivingFolderKey(record.receivedDate, record.supplier),
          },
        });
      },
      deleteReceiving: (id: string, log: ReceivingRecord[]) => {
        const next = log.filter((r) => r.id !== id);
        saveReceivingLog(next);
        dispatch({ type: 'patch', patch: { receivingLog: next } });
      },
      openEditSku: (sku: Sku) => dispatch({ type: 'openEditSku', sku }),
      saveSku: () => dispatch({ type: 'saveSku' }),
      addPromo: () => dispatch({ type: 'addPromo' }),

      openOrderDetail: (orderNo: string, customer: string, matchedOrder: RouteOrder | undefined) => {
        dispatch({
          type: 'patch',
          patch: {
            orderDetailOpen: true,
            orderDetailOrderNo: orderNo,
            orderDetailCustomer: customer,
            orderDetailLoading: true,
            orderDetailError: null,
            orderDetailLines: [],
            orderEditAvailable: matchedOrder != null,
            orderEditDraft: matchedOrder
              ? { plannedDeliveryDate: sheetDateToDayKey(matchedOrder.plannedDeliveryDate) ?? '', note: matchedOrder.note, wantsTaxInvoice: matchedOrder.wantsTaxInvoice }
              : { plannedDeliveryDate: '', note: '', wantsTaxInvoice: false },
          },
        });
        fetchOrderLineItems(orderNo)
          .then((lines) => {
            dispatch({
              type: 'patch',
              patch: {
                orderDetailLoading: false,
                orderDetailLines: lines.map((l) => ({ sku: l.sku, name: l.productName, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal })),
              },
            });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'โหลดรายการสินค้าไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { orderDetailLoading: false, orderDetailError: message } });
          });
      },
      closeOrderDetail: () => dispatch({ type: 'patch', patch: { orderDetailOpen: false } }),

      setOrderEditDraft: (draft: OrderEditDraft) => dispatch({ type: 'patch', patch: { orderEditDraft: draft } }),
      /** Writes to the real "คำสั่งซื้อ" sheet via the backend; local state is
       * only ever updated after that succeeds, so a failed save can't leave
       * the app showing something the sheet doesn't actually have. */
      saveOrderEdit: (orderNo: string, draft: OrderEditDraft) => {
        dispatch({ type: 'setOrderSaveStatus', orderNo, status: { state: 'saving' } });
        updateRouteOrder({
          orderNo,
          plannedDeliveryDate: draft.plannedDeliveryDate || undefined,
          note: draft.note,
          wantsTaxInvoice: draft.wantsTaxInvoice,
        })
          .then(() => {
            dispatch({
              type: 'applyOrderEdit',
              orderNo,
              plannedDeliveryDateSheetText: draft.plannedDeliveryDate ? isoToSheetDateText(draft.plannedDeliveryDate) : null,
              note: draft.note,
              wantsTaxInvoice: draft.wantsTaxInvoice,
            });
            dispatch({ type: 'setOrderSaveStatus', orderNo, status: { state: 'saved' } });
            setTimeout(() => dispatch({ type: 'setOrderSaveStatus', orderNo, status: null }), 2500);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
            dispatch({ type: 'setOrderSaveStatus', orderNo, status: { state: 'error', message } });
          });
      },

      openEditCustomerLatLng: (c: CsMasterCustomer) => {
        dispatch({
          type: 'patch',
          patch: {
            custEditRowIndex: c.rowIndex,
            custEditLat: c.lat != null ? String(c.lat) : '',
            custEditLng: c.lng != null ? String(c.lng) : '',
            custEditError: null,
          },
        });
      },
      closeEditCustomerLatLng: () => dispatch({ type: 'patch', patch: { custEditRowIndex: null, custEditError: null } }),
      saveCustomerLatLng: (rowIndex: number, name: string, phone: string, lat: number, lng: number) => {
        dispatch({ type: 'patch', patch: { custEditSaving: true, custEditError: null } });
        updateCsMasterLatLng(name, phone, lat, lng)
          .then(() => {
            invalidateSheetCache(CS_MASTER_CSV_URL);
            dispatch({ type: 'updateCustomerLatLng', rowIndex, lat, lng });
            dispatch({ type: 'patch', patch: { custEditSaving: false, custEditRowIndex: null } });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกพิกัดไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { custEditSaving: false, custEditError: message } });
          });
      },

      setDriverVehicle: (vehicleId: string | null) => dispatch({ type: 'patch', patch: { driverVehicleId: vehicleId } }),
      /** Marks a stop delivered immediately in shared state (so every page
       * sees it right away) and queues the sheet write — offline-safe: if
       * the write fails or there's no connection at all, the orderNo stays
       * in the persisted queue and is retried automatically, never dropped. */
      markDelivered: (orderNo: string) => {
        dispatch({
          type: 'applyDeliveryMark',
          orderNo,
          statusText: 'ส่งสำเร็จ',
          completedDateText: isoToSheetDateText(todayDayKey()),
        });
        const queue = loadDriverQueue();
        const nextQueue = queue.includes(orderNo) ? queue : [...queue, orderNo];
        saveDriverQueue(nextQueue);
        dispatch({ type: 'patch', patch: { driverSyncQueue: nextQueue } });
        syncDriverQueue();
      },
      retrySyncQueue: () => syncDriverQueue(),

      togglePickOrderSelection: (orderNo: string, selected: string[]) => {
        const next = selected.includes(orderNo) ? selected.filter((n) => n !== orderNo) : [...selected, orderNo];
        dispatch({ type: 'patch', patch: { pickSelectedOrderNos: next } });
      },
      clearPickOrderSelection: () => dispatch({ type: 'patch', patch: { pickSelectedOrderNos: [] } }),

      /** Fetches SKU Detail for every selected order (one request, filtered
       * client-side — see fetchOrderLineItemsForOrders), merges duplicate SKUs
       * across orders into one summed line each, and opens the new lot. An
       * order with zero rows in SKU Detail doesn't fail the whole thing — it's
       * just flagged in ordersWithNoLines so the picker sees it plainly. */
      createPickLot: async (orderNos: string[], routeOrders: RouteOrder[], skus: Sku[], lots: PickLot[]) => {
        if (orderNos.length === 0) return;
        dispatch({ type: 'patch', patch: { pickCreating: true, pickCreateError: null } });
        try {
          const lineItems = await fetchOrderLineItemsForOrders(orderNos);
          const byOrderNo = new Map(routeOrders.map((o) => [o.orderNo, o]));
          const locationBySku = new Map(skus.map((s) => [s.displayId, s.location]));

          const merged = new Map<string, PickLotLine>();
          for (const li of lineItems) {
            const existing = merged.get(li.sku);
            if (existing) {
              existing.totalQty += li.qty;
              existing.perOrder.push({ orderNo: li.orderNo, customer: li.customer, qty: li.qty });
            } else {
              merged.set(li.sku, {
                sku: li.sku,
                name: li.productName,
                unit: li.unit,
                totalQty: li.qty,
                location: locationBySku.get(li.sku) ?? '',
                perOrder: [{ orderNo: li.orderNo, customer: li.customer, qty: li.qty }],
              });
            }
          }

          const ordersWithLines = new Set(lineItems.map((li) => li.orderNo));
          const ordersWithNoLines = orderNos.filter((n) => !ordersWithLines.has(n));
          const orderSummaries = orderNos.map((orderNo) => {
            const o = byOrderNo.get(orderNo);
            return { orderNo, customer: o?.customer ?? '', itemCount: o?.itemCount ?? 0, amount: o?.totalAmount ?? 0 };
          });

          const lot: PickLot = {
            id: `PICK-${Date.now()}`,
            createdAt: new Date().toISOString(),
            orderNos,
            orderSummaries,
            lines: Array.from(merged.values()),
            picked: {},
            closed: false,
            ordersWithNoLines,
            statusSyncPending: [],
          };

          const nextLots = [lot, ...lots];
          savePickLots(nextLots);
          dispatch({ type: 'patch', patch: { pickLots: nextLots, activePickLotId: lot.id, pickCreating: false, pickSelectedOrderNos: [] } });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'สร้างล็อตหยิบสินค้าไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { pickCreating: false, pickCreateError: message } });
        }
      },

      togglePickItem: (lotId: string, sku: string, lots: PickLot[]) => {
        const next = lots.map((l) => (l.id === lotId ? { ...l, picked: { ...l.picked, [sku]: !l.picked[sku] } } : l));
        savePickLots(next);
        dispatch({ type: 'patch', patch: { pickLots: next } });
      },

      /** Closing is immediate/optimistic (the physical picking is already
       * done); the sheet status write happens after, tracked per-order in
       * the lot's own statusSyncPending so a partial failure is visible and
       * retryable without re-closing anything. */
      closePickLot: (lotId: string, lots: PickLot[]) => {
        const lot = lots.find((l) => l.id === lotId);
        if (!lot || lot.closed) return;
        const next = lots.map((l) => (l.id === lotId ? { ...l, closed: true, statusSyncPending: [...l.orderNos] } : l));
        savePickLots(next);
        dispatch({ type: 'patch', patch: { pickLots: next } });
        syncPickLotStatus(lot.orderNos);
      },
      retryPickLotStatusSync: (orderNos: string[]) => syncPickLotStatus(orderNos),

      openPickLot: (lotId: string) => dispatch({ type: 'patch', patch: { activePickLotId: lotId } }),
      backToPickerHome: () => dispatch({ type: 'patch', patch: { activePickLotId: null } }),
    }),
    [],
  );

  return { state, actions };
}

export type AppActions = ReturnType<typeof useAppStore>['actions'];
