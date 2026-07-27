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
import { loadBatchRoutes, saveBatchRoutes, type BatchRoute } from '../data/batchRoutes';
import { PICK_CLOSED_STATUS } from './helpers';
import type { AttachmentScope } from '../config/drive';
import type { ApiImportOrder, CsMasterCustomer, OrderLineItem, Promo, PromoTier, PromoUnit, RouteKey, RouteOrder, Sku } from '../data/types';
import { csvExportUrl, SHEET_TABS } from '../config/sheets';
import { loadLastSyncAt, saveLastSyncAt } from '../data/syncMeta';
import { appendNotificationEvents, loadNotificationEvents, loadNotificationReadIds, saveNotificationReadIds, type NotificationEvent } from '../data/notifications';
import { appendActivityLog, loadActivityLog, type ActivityLogEntry } from '../data/activityLog';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '../data/sidebarState';
import { clearSession, loadSession, saveSession, type Session } from '../data/session';
import { createUser as apiCreateUser, fetchUsers as apiFetchUsers, login as apiLogin, updateUser as apiUpdateUser, type UserListRow } from '../data/sources/authApi';
import { createBookings as apiCreateBookings, decideBookingRequest as apiDecideBooking, fetchBookings as apiFetchBookings, type BookingRow } from '../data/sources/bookingsApi';
import { defaultRouteFor, type Role } from '../config/permissions';

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
  /** Snapshot of orderEditDraft taken the moment the modal opened — diffed
   * against the current draft on save so the activity log can record what
   * actually changed, without the memoized actions needing to read live state. */
  orderEditOriginal: OrderEditDraft;
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
  /** false (default) = normal view, hides archived orders; true = show only
   * archived orders (the "แสดงออเดอร์ที่จัดเก็บแล้ว" toggle). */
  routeArchivedFilter: boolean;
  /** Multi-select on the Order Management table, for bulk archive/unarchive. */
  routeSelectedOrderNos: string[];
  archiveDialogOpen: boolean;
  /** Which action the confirm dialog is about — decided by routeArchivedFilter
   * at the moment the dialog opens, so it stays consistent even if the toggle
   * changes while the dialog is up. */
  archiveDialogMode: 'archive' | 'unarchive';
  archiveSubmitting: boolean;
  archiveError: string | null;

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
  /** Multi-select on the planner's unassigned-orders pool, for bulk
   * "จัดลงรถ" assignment. */
  plannerSelectedOrderNos: string[];

  // batch routes — permanent per-vehicle "confirmed run" records created by
  // the Planner's "Assign" step (see src/data/batchRoutes.ts)
  batchRoutes: BatchRoute[];
  /** batchId -> true while that batch's locked sequence/membership is
   * temporarily unlocked for editing. Deliberately not persisted — a reload
   * re-locks everything, which is the safer default. */
  batchRouteUnlocked: Record<string, boolean>;
  batchRouteQ: string;
  /** Sub-tab on the Planner page: the live plan, or the Batch Route history. */
  plannerTab: 'plan' | 'history' | 'calendar';
  assignDialogOpen: boolean;
  assignSelectedVehicleIds: string[];
  /** orderNo whose "ตรวจสอบ/แก้ไขโลเคชั่น" modal is open; null = closed. */
  orderLocationOrderNo: string | null;
  orderLocationLat: string;
  orderLocationLng: string;
  orderLocationSaving: boolean;
  orderLocationError: string | null;

  // mobile driver view — reuses routeOrders/routePlan/vehicles, only adds its
  // own navigation + offline-sync state
  /** null = vehicle picker screen. */
  driverVehicleId: string | null;
  /** orderNos marked delivered locally but not yet confirmed synced to the sheet. */
  driverSyncQueue: string[];
  driverOnline: boolean;

  // driver stop bookings ("จองคิว") — a driver "reserves" an unassigned stop
  // as a request; manager/admin then confirms (adding it to that driver's
  // vehicle, same as a normal Assign) or rejects it. Backed by a Google
  // Sheets tab (Bookings) via the same Service-Account backend as the Users
  // tab — this is the one piece of planner state that genuinely has to be
  // server-side, since routePlan/batchRoutes (localStorage) can never be
  // seen across a driver's phone and an office admin's desktop.
  bookings: BookingRow[];
  bookingsLoading: boolean;
  bookingsError: string | null;
  /** Multi-select on the driver's own booking picker. */
  bookingSelectedOrderNos: string[];
  bookingSubmitting: boolean;
  bookingSubmitError: string | null;
  /** orderNos the driver just lost the booking race for (first-write-wins) —
   * surfaced once, then cleared by the UI once shown. */
  bookingConflictOrderNos: string[];
  /** Error from the manager/admin confirm/reject action, if the last one failed. */
  bookingActionError: string | null;

  // batch picking ("คำสั่งซื้อ" tab, status = "กำลังดำเนินการ")
  pickOrderQ: string;
  pickSelectedOrderNos: string[];
  pickCreating: boolean;
  pickCreateError: string | null;
  pickLots: PickLot[];
  /** null = order-selection / open-lots screen. */
  activePickLotId: string | null;

  // COD clearing — scoped by Batch Route (one batch = one clearing round),
  // reusing the same routeCodCollected/routeCodMethod state the Planner page
  // and DriverPage already read/write per order; this page just groups that
  // same data by which batch each order belongs to.
  /** Selected batch tab; null = auto-pick the newest one in view. */
  codBatchId: string | null;
  /** vehicleId, or 'all' — narrows which batches' tabs are shown. */
  codVehicleFilter: string;
  codMobile: boolean;

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

  // sync status — every Google Sheet source this app reads, refreshed
  // together by the header's "Sync" button (see actions.syncNow)
  /** ms epoch of the last time every source refreshed successfully; null = never yet. */
  lastSyncAt: number | null;
  lastSyncErrorAt: number | null;
  syncError: string | null;
  /** true only while the manual "Sync" button's batch refresh is in flight. */
  syncing: boolean;

  // notifications (header bell) — persisted one-time events (new order
  // arrived, sync failed); standing-condition items (stuck/overdue orders)
  // are recomputed fresh from current data in computeNotifications instead
  notificationEvents: NotificationEvent[];
  notificationReadIds: string[];
  notificationsOpen: boolean;

  // activity log — user-action audit trail, kept in this browser only
  activityLog: ActivityLogEntry[];
  activityLogQ: string;

  // sidebar collapse (mobile-friendly + optional on desktop)
  sidebarCollapsed: boolean;

  // authentication — null session = show the login page instead of the app
  session: Session | null;
  authLoading: boolean;
  authError: string | null;

  // user management (Administrator: full CRUD; Manager: read-only roster)
  users: UserListRow[];
  usersLoading: boolean;
  usersError: string | null;
}

/** ?driver=<vehicleId> jumps straight into the mobile driver view for that
 * vehicle — the one bit of real browser-URL-based deep-linking this app
 * has, since the driver page is meant to be a link a driver can open
 * directly rather than something they navigate the whole admin app to find.
 * Only takes effect for a signed-out visitor or a non-driver account — an
 * authenticated driver always lands on their OWN assigned vehicle (see
 * initialSession below), never whatever vehicleId a URL happens to name, so
 * this link can't be reused to peek at someone else's route. */
function initialRouteFromUrl(): Pick<AppState, 'route' | 'driverVehicleId'> {
  if (typeof window === 'undefined') return { route: 'dashboard', driverVehicleId: null };
  const vehicleId = new URLSearchParams(window.location.search).get('driver');
  return vehicleId ? { route: 'driver', driverVehicleId: vehicleId } : { route: 'dashboard', driverVehicleId: null };
}

/** Restores a still-valid session from localStorage synchronously at module
 * load (a plain localStorage read, no need for an effect+flash of the login
 * page) and, when one exists, routes straight to that role's default page —
 * this is what actually enforces "a driver session always opens the driver
 * view," overriding whatever the URL alone would have picked. */
function initialSession(): Pick<AppState, 'session' | 'route' | 'driverVehicleId'> {
  if (typeof window === 'undefined') return { session: null, route: 'dashboard', driverVehicleId: null };
  const session = loadSession();
  if (!session) return { session: null, route: 'dashboard', driverVehicleId: null };
  return { session, route: defaultRouteFor(session.role), driverVehicleId: session.role === 'driver' ? session.driverVehicleId : null };
}

export const initialState: AppState = {
  ...initialRouteFromUrl(),
  ...initialSession(),

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
  orderEditOriginal: { plannedDeliveryDate: '', note: '', wantsTaxInvoice: false },
  orderSaveStatus: {},

  routeOrders: [],
  routeOrdersLoading: true,
  routeOrdersError: null,
  routeFilterValue: 'all',
  routeStatusFilter: 'all',
  routeQ: '',
  routeOrderDateFilter: '',
  routeDeliveryDateFilter: '',
  routeArchivedFilter: false,
  routeSelectedOrderNos: [],
  archiveDialogOpen: false,
  archiveDialogMode: 'archive',
  archiveSubmitting: false,
  archiveError: null,

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
  plannerSelectedOrderNos: [],
  batchRoutes: [],
  batchRouteUnlocked: {},
  batchRouteQ: '',
  plannerTab: 'plan',
  assignDialogOpen: false,
  assignSelectedVehicleIds: [],
  orderLocationOrderNo: null,
  orderLocationLat: '',
  orderLocationLng: '',
  orderLocationSaving: false,
  orderLocationError: null,

  driverSyncQueue: [],
  driverOnline: typeof navigator === 'undefined' || navigator.onLine,

  bookings: [],
  bookingsLoading: false,
  bookingsError: null,
  bookingSelectedOrderNos: [],
  bookingSubmitting: false,
  bookingSubmitError: null,
  bookingConflictOrderNos: [],
  bookingActionError: null,

  pickOrderQ: '',
  pickSelectedOrderNos: [],
  pickCreating: false,
  pickCreateError: null,
  pickLots: [],
  activePickLotId: null,
  codBatchId: null,
  codVehicleFilter: 'all',
  codMobile: false,

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

  lastSyncAt: null,
  lastSyncErrorAt: null,
  syncError: null,
  syncing: false,

  notificationEvents: [],
  notificationReadIds: [],
  notificationsOpen: false,

  activityLog: [],
  activityLogQ: '',

  sidebarCollapsed: false,

  authLoading: false,
  authError: null,

  users: [],
  usersLoading: false,
  usersError: null,
};

export type Action =
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'openEditSku'; sku: Sku }
  | { type: 'saveSku' }
  | { type: 'addPromo' }
  | { type: 'updateCustomerLatLng'; rowIndex: number; lat: number; lng: number }
  | { type: 'updateOrderLocation'; orderNo: string; lat: number; lng: number }
  | { type: 'setOrderSaveStatus'; orderNo: string; status: OrderSaveStatus | null }
  | { type: 'applyOrderEdit'; orderNo: string; plannedDeliveryDateSheetText: string | null; note: string | null; wantsTaxInvoice: boolean | null }
  | { type: 'applyDeliveryMark'; orderNo: string; statusText: string; completedDateText: string }
  | { type: 'applyPickLotStatus'; orderNo: string; statusText: string }
  | { type: 'applyArchiveMark'; orderNos: string[]; archived: boolean };

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

    case 'updateOrderLocation': {
      const routeOrders = state.routeOrders.map((o) => (o.orderNo === action.orderNo ? { ...o, lat: action.lat, lng: action.lng } : o));
      return { ...state, routeOrders };
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

    case 'applyArchiveMark': {
      // Confirmed writes for a whole selected batch land in one patch, same
      // shared routeOrders every other page (Planner/Pick/Dashboard) reads —
      // this is what makes archived orders disappear from all of them at once.
      const set = new Set(action.orderNos);
      const routeOrders = state.routeOrders.map((o) => (set.has(o.orderNo) ? { ...o, archived: action.archived } : o));
      return { ...state, routeOrders };
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

  /** Appends one entry to the persisted activity log and reflects it in
   * state immediately. Called from every user action that changes something
   * meaningful (order edits, planner moves, pick-lot closes, lat/lng fixes,
   * receiving, attachments) — see each action below. */
  function logActivity(action: string, detail: string, orderNo?: string) {
    const username = loadSession()?.username ?? 'ไม่ทราบผู้ใช้';
    dispatch({
      type: 'patch',
      patch: { activityLog: appendActivityLog(loadActivityLog(), { user: username, action, detail, orderNo }) },
    });
  }

  /** Marks a successful refresh of any Google Sheet source — called from
   * every fetch-on-mount effect below and from the manual syncNow action, so
   * "อัปเดตล่าสุด" in the header reflects whichever happened most recently. */
  function recordSyncSuccess() {
    const now = Date.now();
    saveLastSyncAt(now);
    dispatch({ type: 'patch', patch: { lastSyncAt: now } });
  }

  function recordSyncFailure(sourceLabel: string, message: string) {
    const now = Date.now();
    dispatch({
      type: 'patch',
      patch: {
        lastSyncErrorAt: now,
        syncError: `${sourceLabel}: ${message}`,
        notificationEvents: appendNotificationEvents(loadNotificationEvents(), [
          { kind: 'sync-error', message: `Sync ล้มเหลว — ${sourceLabel}: ${message}` },
        ]),
      },
    });
  }

  // Seeds silently on the very first successful apiOrders load (so the
  // 1700+ existing orders don't all fire as "new order" notifications), then
  // diffs against it on every subsequent refresh to spot genuine new
  // arrivals. In-memory only — a fresh page load reseeds without notifying,
  // which is the safe default (never floods on reload).
  const seenOrderUidsRef = useRef<Set<string> | null>(null);
  function noteNewOrders(apiOrders: ApiImportOrder[]) {
    if (seenOrderUidsRef.current === null) {
      seenOrderUidsRef.current = new Set(apiOrders.map((o) => o.orderUid));
      return;
    }
    const seen = seenOrderUidsRef.current;
    const arrivals = apiOrders.filter((o) => !seen.has(o.orderUid) && o.status === 'รอยืนยันออเดอร์');
    seenOrderUidsRef.current = new Set(apiOrders.map((o) => o.orderUid));
    if (arrivals.length === 0) return;
    dispatch({
      type: 'patch',
      patch: {
        notificationEvents: appendNotificationEvents(
          loadNotificationEvents(),
          arrivals.map((o) => ({ kind: 'new-order' as const, message: `ออเดอร์ใหม่ ${o.orderUid} รอยืนยัน — ${o.customer}`, orderNo: o.orderUid })),
        ),
      },
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetchSkusFromSheet()
      .then((skus) => {
        if (!cancelled) {
          dispatch({ type: 'patch', patch: { skus, skusLoading: false, skusError: null } });
          recordSyncSuccess();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดข้อมูลสินค้าไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { skusLoading: false, skusError: message } });
          recordSyncFailure('ฐานข้อมูลสินค้า (SKU Master)', message);
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
        if (!cancelled) {
          dispatch({ type: 'patch', patch: { apiOrders, apiOrdersLoading: false, apiOrdersError: null } });
          noteNewOrders(apiOrders);
          recordSyncSuccess();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดออเดอร์ใหม่ไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { apiOrdersLoading: false, apiOrdersError: message } });
          recordSyncFailure('ออเดอร์ใหม่ (API Import)', message);
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
        if (!cancelled) {
          dispatch({ type: 'patch', patch: { routeOrders, routeOrdersLoading: false, routeOrdersError: null } });
          recordSyncSuccess();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดข้อมูลเส้นทาง/ประวัติการจัดส่งไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { routeOrdersLoading: false, routeOrdersError: message } });
          recordSyncFailure('ออเดอร์/คำสั่งซื้อ', message);
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
        if (!cancelled) {
          dispatch({ type: 'patch', patch: { promos, promosLoading: false, promosError: null } });
          recordSyncSuccess();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดโปรโมชั่นไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { promosLoading: false, promosError: message } });
          recordSyncFailure('โปรโมชั่น', message);
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
        if (!cancelled) {
          dispatch({ type: 'patch', patch: { orderLineItems, orderLineItemsLoading: false, orderLineItemsError: null } });
          recordSyncSuccess();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดรายการสินค้าต่อออเดอร์ไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { orderLineItemsLoading: false, orderLineItemsError: message } });
          recordSyncFailure('รายการสินค้าต่อออเดอร์ (SKU Detail)', message);
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
        if (!cancelled) {
          dispatch({ type: 'patch', patch: { customers, customersLoading: false, customersError: null } });
          recordSyncSuccess();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'โหลดรายชื่อลูกค้าไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { customersLoading: false, customersError: message } });
          recordSyncFailure('รายชื่อลูกค้า (CS Master)', message);
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
        batchRoutes: loadBatchRoutes(),
        lastSyncAt: loadLastSyncAt(),
        notificationEvents: loadNotificationEvents(),
        notificationReadIds: loadNotificationReadIds(),
        activityLog: loadActivityLog(),
        sidebarCollapsed: loadSidebarCollapsed() ?? window.innerWidth < 900,
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

  // Driver stop bookings ("จองคิว") — there's no push/websocket infra here,
  // so "real-time" locking is really "refetch the shared Bookings tab often
  // enough that a lock another driver just placed shows up within one tick."
  // Polls whenever someone's logged in (both the driver's own booking picker
  // and the Planner's booking badges/confirm-reject read off the same
  // state.bookings), same interval-based pattern as the driver sync queue above.
  useEffect(() => {
    if (!state.session) return;
    let cancelled = false;
    const load = () => {
      const session = loadSession();
      if (!session) return;
      apiFetchBookings(session)
        .then((bookings) => {
          if (!cancelled) dispatch({ type: 'patch', patch: { bookings, bookingsError: null } });
        })
        .catch((err: unknown) => {
          if (!cancelled) dispatch({ type: 'patch', patch: { bookingsError: err instanceof Error ? err.message : 'โหลดรายการจองคิวไม่สำเร็จ' } });
        });
    };
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.username]);

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
      setBatchRoutes: (list: BatchRoute[]) => {
        dispatch({ type: 'patch', patch: { batchRoutes: list } });
        saveBatchRoutes(list);
      },
      saveRouteCod: (collected: Record<string, string>, method: Record<string, 'cash' | 'transfer'>) => {
        saveRouteCodState({ collected, method });
        dispatch({ type: 'patch', patch: { routeCodCollected: collected, routeCodMethod: method } });
      },
      /** COD Clearing page's "ปิดยอดรอบนี้ (batch)" — one Batch Route is one
       * clearing round, so this just stamps that batch's own record (no
       * separate closed-status system) and logs it, same as every other
       * batch-route edit. Takes the current batchRoutes as a parameter (from
       * derive.ts, which always has fresh state) rather than reading it off
       * this memoized closure, same reasoning as every other action here. */
      closeBatchCod: (batchId: string, batchRoutes: BatchRoute[], detail: string) => {
        const batch = batchRoutes.find((b) => b.id === batchId);
        if (!batch || batch.codClosed) return;
        const now = new Date().toISOString();
        const username = loadSession()?.username ?? '';
        const next = batchRoutes.map((b) => (b.id === batchId ? { ...b, codClosed: true, codClosedAt: now, codClosedBy: username } : b));
        saveBatchRoutes(next);
        dispatch({ type: 'patch', patch: { batchRoutes: next } });
        logActivity('ปิดยอดเคลียร์เงิน COD (batch)', `${batchId} · ${detail}`);
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
          logActivity('แนบไฟล์', `${scope === 'order' ? 'ออเดอร์' : 'รับสินค้า'} ${key} · ${files.map((f) => f.name).join(', ')}`, scope === 'order' ? key : undefined);
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
        logActivity('บันทึกรับสินค้าเข้าคลัง', `${record.supplier} · บิล ${record.billNo || '—'} · ${record.receivedDate} · ${record.lines.length} รายการ`);
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
            orderEditOriginal: matchedOrder
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
       * the app showing something the sheet doesn't actually have. `original`
       * is the draft's value the moment the modal opened (state.orderEditOriginal),
       * passed in explicitly so the activity log can record what changed. */
      saveOrderEdit: (orderNo: string, draft: OrderEditDraft, original: OrderEditDraft) => {
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

            const changes: string[] = [];
            if (original.plannedDeliveryDate !== draft.plannedDeliveryDate) {
              changes.push(`วันที่จัดส่ง: ${original.plannedDeliveryDate || '—'} → ${draft.plannedDeliveryDate || '—'}`);
            }
            if (original.note !== draft.note) changes.push(`หมายเหตุ: "${original.note || '—'}" → "${draft.note || '—'}"`);
            if (original.wantsTaxInvoice !== draft.wantsTaxInvoice) {
              changes.push(`ใบกำกับภาษี: ${original.wantsTaxInvoice ? 'ต้องการ' : 'ไม่ต้องการ'} → ${draft.wantsTaxInvoice ? 'ต้องการ' : 'ไม่ต้องการ'}`);
            }
            if (changes.length > 0) logActivity('แก้ไขออเดอร์', changes.join(' · '), orderNo);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
            dispatch({ type: 'setOrderSaveStatus', orderNo, status: { state: 'error', message } });
          });
      },

      toggleRouteSelect: (orderNo: string, selected: string[]) => {
        const next = selected.includes(orderNo) ? selected.filter((n) => n !== orderNo) : [...selected, orderNo];
        dispatch({ type: 'patch', patch: { routeSelectedOrderNos: next } });
      },
      setRouteSelection: (orderNos: string[]) => dispatch({ type: 'patch', patch: { routeSelectedOrderNos: orderNos } }),
      clearRouteSelection: () => dispatch({ type: 'patch', patch: { routeSelectedOrderNos: [] } }),

      openArchiveDialog: (mode: 'archive' | 'unarchive') =>
        dispatch({ type: 'patch', patch: { archiveDialogOpen: true, archiveDialogMode: mode, archiveError: null } }),
      closeArchiveDialog: () => dispatch({ type: 'patch', patch: { archiveDialogOpen: false, archiveError: null } }),
      /** Bulk archive/unarchive over the single-order update endpoint — same
       * fire-per-item pattern as syncPickLotStatus above, via Promise.all so
       * the confirm dialog can await the whole batch before closing. One
       * logActivity call for the whole batch, not per order. */
      confirmArchiveSelected: (orderNos: string[], archived: boolean) => {
        dispatch({ type: 'patch', patch: { archiveSubmitting: true, archiveError: null } });
        Promise.all(orderNos.map((orderNo) => updateRouteOrder({ orderNo, archived })))
          .then(() => {
            dispatch({ type: 'applyArchiveMark', orderNos, archived });
            dispatch({ type: 'patch', patch: { archiveSubmitting: false, archiveDialogOpen: false, routeSelectedOrderNos: [] } });
            logActivity(archived ? 'จัดเก็บออเดอร์' : 'นำออเดอร์กลับมาใช้งาน', `${orderNos.length} ออเดอร์ (${orderNos.join(', ')})`);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { archiveSubmitting: false, archiveError: message } });
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
      saveCustomerLatLng: (rowIndex: number, name: string, phone: string, lat: number, lng: number, originalLat: number | null, originalLng: number | null) => {
        dispatch({ type: 'patch', patch: { custEditSaving: true, custEditError: null } });
        updateCsMasterLatLng(name, phone, lat, lng)
          .then(() => {
            invalidateSheetCache(CS_MASTER_CSV_URL);
            dispatch({ type: 'updateCustomerLatLng', rowIndex, lat, lng });
            dispatch({ type: 'patch', patch: { custEditSaving: false, custEditRowIndex: null } });
            const originalText = originalLat != null && originalLng != null ? `${originalLat.toFixed(5)}, ${originalLng.toFixed(5)}` : 'ไม่มีข้อมูล';
            logActivity('แก้ไขพิกัดลูกค้า', `${name} · จาก ${originalText} → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกพิกัดไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { custEditSaving: false, custEditError: message } });
          });
      },

      togglePlannerSelect: (orderNo: string, selected: string[]) => {
        const next = selected.includes(orderNo) ? selected.filter((n) => n !== orderNo) : [...selected, orderNo];
        dispatch({ type: 'patch', patch: { plannerSelectedOrderNos: next } });
      },
      setPlannerSelection: (orderNos: string[]) => dispatch({ type: 'patch', patch: { plannerSelectedOrderNos: orderNos } }),

      openEditOrderLocation: (o: RouteOrder) => {
        dispatch({
          type: 'patch',
          patch: {
            orderLocationOrderNo: o.orderNo,
            orderLocationLat: o.lat != null ? String(o.lat) : '',
            orderLocationLng: o.lng != null ? String(o.lng) : '',
            orderLocationError: null,
          },
        });
      },
      closeEditOrderLocation: () => dispatch({ type: 'patch', patch: { orderLocationOrderNo: null, orderLocationError: null } }),
      /** Writes the corrected coordinate to CS Master (matched by name+phone,
       * the same backend endpoint the Customer page's own lat/lng editor
       * uses) rather than inventing a new write to the คำสั่งซื้อ sheet's own
       * CS_Lat/CS_Long columns — those are populated by a lookup from CS
       * Master, so fixing the source there is the correct place to edit. */
      saveOrderLocation: (orderNo: string, name: string, phone: string, lat: number, lng: number, originalLat: number | null, originalLng: number | null) => {
        dispatch({ type: 'patch', patch: { orderLocationSaving: true, orderLocationError: null } });
        updateCsMasterLatLng(name, phone, lat, lng)
          .then(async () => {
            invalidateSheetCache(CS_MASTER_CSV_URL);
            dispatch({ type: 'updateOrderLocation', orderNo, lat, lng });
            dispatch({ type: 'patch', patch: { orderLocationSaving: false, orderLocationOrderNo: null } });
            const originalText = originalLat != null && originalLng != null ? `${originalLat.toFixed(5)}, ${originalLng.toFixed(5)}` : 'ไม่มีข้อมูล';
            logActivity('แก้ไขโลเคชั่น (จากหน้าวางแผนจัดรูท)', `${name} · จาก ${originalText} → ${lat.toFixed(5)}, ${lng.toFixed(5)}`, orderNo);
            // Eagerly geocode the corrected coordinate so the zone badge
            // reflects the fix immediately, instead of waiting for the next
            // full page load to pick it up via the background batch.
            const result = await reverseGeocode(lat, lng);
            if (result) {
              const cache: GeocodeCache = { ...loadGeocodeCache(), [coordKey(lat, lng)]: { ...result, fetchedAt: Date.now() } };
              saveGeocodeCache(cache);
              dispatch({ type: 'patch', patch: { geocodeCache: cache } });
            }
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกพิกัดไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { orderLocationSaving: false, orderLocationError: message } });
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

      toggleBookingSelect: (orderNo: string, selected: string[]) => {
        const next = selected.includes(orderNo) ? selected.filter((n) => n !== orderNo) : [...selected, orderNo];
        dispatch({ type: 'patch', patch: { bookingSelectedOrderNos: next } });
      },
      clearBookingSelection: () => dispatch({ type: 'patch', patch: { bookingSelectedOrderNos: [] } }),
      clearBookingConflicts: () => dispatch({ type: 'patch', patch: { bookingConflictOrderNos: [] } }),

      /** Driver "จองคิว" — requests to reserve one or more currently-unassigned
       * stops. Re-fetches the Bookings tab right after so a lock this driver
       * just won (or lost, per first-write-wins) shows up on their own screen
       * immediately rather than waiting for the next poll tick. */
      submitBookingRequests: async (orderNos: string[]) => {
        const session = loadSession();
        if (!session || orderNos.length === 0) return;
        dispatch({ type: 'patch', patch: { bookingSubmitting: true, bookingSubmitError: null, bookingConflictOrderNos: [] } });
        try {
          const { created, conflicts } = await apiCreateBookings(session, orderNos);
          const bookings = await apiFetchBookings(session);
          dispatch({
            type: 'patch',
            patch: { bookings, bookingSubmitting: false, bookingSelectedOrderNos: [], bookingConflictOrderNos: conflicts },
          });
          if (created.length > 0) logActivity('จองคิวจุดส่ง', `${created.length} ออเดอร์ (${created.join(', ')})`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'จองคิวไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { bookingSubmitting: false, bookingSubmitError: message } });
        }
      },

      /** Manager/admin confirm or reject of a driver's booking request — only
       * ever updates the Bookings tab's own status column server-side. On
       * confirm, the caller (derive.ts's computePlanner) is responsible for
       * the separate "add this order into that driver's vehicle" step, same
       * as any other routePlan edit — this action never touches routePlan
       * itself, so the normal batch-lock rules still apply unchanged. */
      decideBooking: async (orderNo: string, decision: 'confirm' | 'reject', driverUsername: string, note?: string) => {
        const session = loadSession();
        if (!session) return undefined;
        dispatch({ type: 'patch', patch: { bookingActionError: null } });
        try {
          const result = await apiDecideBooking(session, { orderNo, decision, note });
          const bookings = await apiFetchBookings(session);
          dispatch({ type: 'patch', patch: { bookings } });
          logActivity(
            decision === 'confirm' ? 'ยืนยันคำขอจองคิว' : 'ปฏิเสธคำขอจองคิว',
            decision === 'confirm' ? `คนขับ ${driverUsername}` : `คนขับ ${driverUsername}${note ? ` · เหตุผล: ${note}` : ''}`,
            orderNo,
          );
          return result;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'ยืนยัน/ปฏิเสธคำขอจองคิวไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { bookingActionError: message } });
          return undefined;
        }
      },

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
            closedBy: '',
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
        const closedBy = loadSession()?.username ?? '';
        const next = lots.map((l) => (l.id === lotId ? { ...l, closed: true, statusSyncPending: [...l.orderNos], closedBy } : l));
        savePickLots(next);
        dispatch({ type: 'patch', patch: { pickLots: next } });
        syncPickLotStatus(lot.orderNos);
        logActivity('ปิดล็อตหยิบสินค้า', `ล็อต ${lot.id} · ${lot.orderNos.length} ออเดอร์ (${lot.orderNos.join(', ')})`);
      },
      retryPickLotStatusSync: (orderNos: string[]) => syncPickLotStatus(orderNos),

      openPickLot: (lotId: string) => dispatch({ type: 'patch', patch: { activePickLotId: lotId } }),
      backToPickerHome: () => dispatch({ type: 'patch', patch: { activePickLotId: null } }),

      logActivity,

      /** Manual "Sync" button — force-refreshes every Google Sheet source at
       * once (bypassing fetchSheetRows' normal ~45s cache) instead of waiting
       * for the next page load. Uses allSettled so one failing source never
       * discards the others' fresh data; only the sources that actually
       * failed keep showing their last-known-good values. */
      // Returns a definite result (not just void) so a caller like the
      // Planner's "Assign" flow can react to THIS sync's outcome directly,
      // without reading back potentially-stale state right after the await.
      syncNow: async (): Promise<{ ok: boolean; routeOrdersOk: boolean; failures: string[] }> => {
        dispatch({ type: 'patch', patch: { syncing: true } });
        [
          csvExportUrl(SHEET_TABS.apiImport),
          csvExportUrl(SHEET_TABS.routeOrders),
          csvExportUrl(SHEET_TABS.skuDetail),
          csvExportUrl(SHEET_TABS.promotions),
          csvExportUrl(SHEET_TABS.csMaster),
          csvExportUrl(SHEET_TABS.skuMaster),
        ].forEach(invalidateSheetCache);

        const [apiOrdersR, routeOrdersR, lineItemsR, promosR, customersR, skusR] = await Promise.allSettled([
          fetchApiImportOrders(),
          fetchRouteOrders(),
          fetchAllOrderLineItems(),
          fetchActivePromotions(),
          fetchCsMasterCustomers(),
          fetchSkusFromSheet(),
        ]);

        const patch: Partial<AppState> = {};
        const failures: string[] = [];
        let anySucceeded = false;

        if (apiOrdersR.status === 'fulfilled') {
          patch.apiOrders = apiOrdersR.value;
          patch.apiOrdersError = null;
          noteNewOrders(apiOrdersR.value);
          anySucceeded = true;
        } else failures.push(`ออเดอร์ใหม่ (API Import): ${apiOrdersR.reason instanceof Error ? apiOrdersR.reason.message : 'ไม่สำเร็จ'}`);

        if (routeOrdersR.status === 'fulfilled') {
          patch.routeOrders = routeOrdersR.value;
          patch.routeOrdersError = null;
          anySucceeded = true;
        } else failures.push(`ออเดอร์/คำสั่งซื้อ: ${routeOrdersR.reason instanceof Error ? routeOrdersR.reason.message : 'ไม่สำเร็จ'}`);

        if (lineItemsR.status === 'fulfilled') {
          patch.orderLineItems = lineItemsR.value;
          patch.orderLineItemsError = null;
          anySucceeded = true;
        } else failures.push(`รายการสินค้าต่อออเดอร์ (SKU Detail): ${lineItemsR.reason instanceof Error ? lineItemsR.reason.message : 'ไม่สำเร็จ'}`);

        if (promosR.status === 'fulfilled') {
          patch.promos = promosR.value;
          patch.promosError = null;
          anySucceeded = true;
        } else failures.push(`โปรโมชั่น: ${promosR.reason instanceof Error ? promosR.reason.message : 'ไม่สำเร็จ'}`);

        if (customersR.status === 'fulfilled') {
          patch.customers = customersR.value;
          patch.customersError = null;
          anySucceeded = true;
        } else failures.push(`รายชื่อลูกค้า (CS Master): ${customersR.reason instanceof Error ? customersR.reason.message : 'ไม่สำเร็จ'}`);

        if (skusR.status === 'fulfilled') {
          patch.skus = skusR.value;
          patch.skusError = null;
          anySucceeded = true;
        } else failures.push(`ฐานข้อมูลสินค้า (SKU Master): ${skusR.reason instanceof Error ? skusR.reason.message : 'ไม่สำเร็จ'}`);

        patch.syncing = false;
        if (anySucceeded) {
          const now = Date.now();
          saveLastSyncAt(now);
          patch.lastSyncAt = now;
        }
        if (failures.length > 0) {
          patch.lastSyncErrorAt = Date.now();
          patch.syncError = `Sync ไม่สำเร็จบางส่วน: ${failures.join(' · ')}`;
          patch.notificationEvents = appendNotificationEvents(
            loadNotificationEvents(),
            failures.map((f) => ({ kind: 'sync-error' as const, message: `Sync ล้มเหลว — ${f}` })),
          );
        } else {
          patch.syncError = null;
        }
        dispatch({ type: 'patch', patch });
        return { ok: failures.length === 0, routeOrdersOk: routeOrdersR.status === 'fulfilled', failures };
      },

      // These take the current value as an explicit parameter (from
      // derive.ts, which always has fresh state) rather than reading
      // state.* directly — this actions object is memoized once with an
      // empty dependency array, so any closure that captured state.* here
      // would be permanently stuck with whatever it was at mount.
      toggleNotifications: (isOpen: boolean) => dispatch({ type: 'patch', patch: { notificationsOpen: !isOpen } }),
      markNotificationRead: (id: string, readIds: string[]) => {
        const ids = Array.from(new Set([...readIds, id]));
        saveNotificationReadIds(ids);
        dispatch({ type: 'patch', patch: { notificationReadIds: ids } });
      },
      markAllNotificationsRead: (idsToMark: string[], readIds: string[]) => {
        const ids = Array.from(new Set([...readIds, ...idsToMark]));
        saveNotificationReadIds(ids);
        dispatch({ type: 'patch', patch: { notificationReadIds: ids } });
      },

      setActivityLogQ: (v: string) => dispatch({ type: 'patch', patch: { activityLogQ: v } }),

      toggleSidebar: (collapsed: boolean) => {
        const next = !collapsed;
        saveSidebarCollapsed(next);
        dispatch({ type: 'patch', patch: { sidebarCollapsed: next } });
      },

      login: async (username: string, password: string) => {
        dispatch({ type: 'patch', patch: { authLoading: true, authError: null } });
        try {
          const session = await apiLogin(username, password);
          saveSession(session);
          dispatch({
            type: 'patch',
            patch: {
              authLoading: false,
              authError: null,
              session,
              route: defaultRouteFor(session.role),
              driverVehicleId: session.role === 'driver' ? session.driverVehicleId : null,
            },
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { authLoading: false, authError: message } });
        }
      },
      logout: () => {
        clearSession();
        // Full reload rather than just patching state to null — every page's
        // in-memory data (routeOrders, apiOrders, etc.) belonged to whoever
        // was logged in; a clean reload is the simplest way to guarantee none
        // of it lingers on screen for the next person who logs in on this device.
        window.location.href = window.location.pathname;
      },
      clearAuthError: () => dispatch({ type: 'patch', patch: { authError: null } }),

      loadUsers: async () => {
        const session = loadSession();
        if (!session) return;
        dispatch({ type: 'patch', patch: { usersLoading: true, usersError: null } });
        try {
          const users = await apiFetchUsers(session);
          dispatch({ type: 'patch', patch: { users, usersLoading: false } });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ';
          dispatch({ type: 'patch', patch: { usersLoading: false, usersError: message } });
        }
      },
      createUserAccount: async (input: { username: string; password: string; role: Role; driverVehicleId: string }) => {
        const session = loadSession();
        if (!session) throw new Error('ต้องเข้าสู่ระบบก่อน');
        await apiCreateUser(session, input);
        const users = await apiFetchUsers(session);
        dispatch({ type: 'patch', patch: { users } });
      },
      updateUserAccount: async (input: { username: string; role?: Role; active?: boolean; driverVehicleId?: string; newPassword?: string }) => {
        const session = loadSession();
        if (!session) throw new Error('ต้องเข้าสู่ระบบก่อน');
        await apiUpdateUser(session, input);
        const users = await apiFetchUsers(session);
        dispatch({ type: 'patch', patch: { users } });
      },
    }),
    [],
  );

  return { state, actions };
}

export type AppActions = ReturnType<typeof useAppStore>['actions'];
