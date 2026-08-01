import { useEffect, useMemo, useReducer, useRef } from 'react';
import { fetchApiImportOrders } from '../data/sources/apiImportOrders';
import { fetchCsMasterCustomers } from '../data/sources/csMaster';
import { updateCsMasterLatLng } from '../data/sources/csMasterWrite';
import { avgPricePerPiece, fetchPromotions, formatPackUnitsTerm, formatTiersTerm } from '../data/sources/promotionsSheet';
import { upsertPromotion } from '../data/sources/promotionsWrite';
import { fetchRouteOrders } from '../data/sources/routeOrders';
import { invalidateSheetCache } from '../data/sources/sheetCsv';
import { fetchAllOrderLineItems, fetchOrderLineItems, fetchOrderLineItemsForOrders } from '../data/sources/skuDetail';
import { linkLineItemPromo as apiLinkLineItemPromo } from '../data/sources/skuDetailWrite';
import { fetchSkusFromSheet } from '../data/sources/skuSheet';
import { attachmentKey, loadAttachments, saveAttachments, uploadToDrive, type AttachmentIndex } from '../data/sources/attachments';
import {
  emptyLine,
  loadReceivingLog,
  receivingFolderKey,
  saveReceivingLog,
  type ReceivingLine,
  type ReceivingRecord,
} from '../data/receiving';
import { DEFAULT_VEHICLES, loadRoutePlan, loadVehicles, saveRoutePlan, saveVehicles, type RoutePlan, type Vehicle } from '../data/vehicles';
import { DEFAULT_ZONE_RULES, loadZoneRules, saveZoneRules, type ZoneRule } from '../data/zoneConfig';
import { coordKey, loadGeocodeCache, saveGeocodeCache, type GeocodeCache } from '../data/geocodeCache';
import { reverseGeocode } from '../data/sources/geocoding';
import { resolveRouteOrderLocations } from '../data/customerLocation';
import { GEOCODE_MIN_INTERVAL_MS } from '../config/geocoding';
import { loadRouteCodState, saveRouteCodState } from '../data/routeCod';
import { addDays, dayKey, dayKeyToDate, isoToSheetDateText, sheetDateToDayKey, todayDayKey } from '../data/dateUtils';
import { updateRouteOrder } from '../data/sources/routeOrdersWrite';
import { loadDriverQueue, saveDriverQueue } from '../data/driverQueue';
import { loadPickLots, savePickLots, type PickLot, type PickLotLine } from '../data/pickLots';
import { loadBatchRoutes, saveBatchRoutes, type BatchRoute } from '../data/batchRoutes';
import { loadStuckDetachments, saveStuckDetachments, type StuckDetachmentIndex } from '../data/stuckDetachments';
import { loadDeliveryFailures, saveDeliveryFailures, type DeliveryFailureIndex, type DeliveryFailureRecord } from '../data/deliveryFailures';
import { loadPreDepartureChecklists, savePreDepartureChecklists, type PreDepartureChecklistIndex } from '../data/preDeparture';
import { loadFailedDeliveryQueue, removeFailedDeliveryQueueItem, saveFailedDeliveryQueueItem, type FailedDeliveryQueueItem } from '../data/failedDeliveryQueue';
import { fetchBatchRoutes as apiFetchBatchRoutes, upsertBatchRoutes as apiUpsertBatchRoutes } from '../data/sources/batchRoutesApi';
import { DELIVERED_STATUSES, DELIVERY_FAILED_STATUS, PICK_CLOSED_STATUS } from './helpers';
import { effectiveDeliveryDayKey, ordersNeedingStuckBatchDetach } from './derive';
import type { AttachmentScope } from '../config/drive';
import type { ApiImportOrder, CsMasterCustomer, OrderLineItem, Promo, PromoPackUnit, PromoTier, PromoUnit, RouteKey, RouteOrder, Sku } from '../data/types';
import { csvExportUrl, SHEET_TABS } from '../config/sheets';
import { loadLastSyncAt, saveLastSyncAt } from '../data/syncMeta';
import { appendNotificationEvents, loadNotificationEvents, loadNotificationReadIds, saveNotificationReadIds, type NotificationEvent } from '../data/notifications';
import { appendActivityLog, loadActivityLog, type ActivityLogEntry } from '../data/activityLog';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '../data/sidebarState';
import { clearSession, loadSession, saveSession, type Session } from '../data/session';
import { createUser as apiCreateUser, fetchUsers as apiFetchUsers, login as apiLogin, updateUser as apiUpdateUser, type UserListRow } from '../data/sources/authApi';
import { createBookings as apiCreateBookings, decideBookingRequest as apiDecideBooking, fetchBookings as apiFetchBookings, type BookingRow } from '../data/sources/bookingsApi';
import { canEditPlan, defaultRouteFor, type Role } from '../config/permissions';

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
  /** True when the backend's own live Sheets read just failed and it served
   * its last-known-good cache instead (see apiImportOrders.ts) — apiOrders
   * still has real data, just possibly a little old. Surfaced as a small
   * warning banner (not apiOrdersError, which reads as "nothing to show"). */
  apiOrdersStale: boolean;
  q: string;
  statusFilter: string;
  /** Sub-tab on the Dashboard page: the usual order list/stats view, or the
   * Route Calendar month view (moved here from the Planner page). */
  dashboardTab: 'overview' | 'calendar';

  // 7-day delivery forecast (built from routeOrders, shown on the dashboard)
  forecastStatusFilter: string;

  // order line-items modal (shared by dashboard's "ดู" button — "SKU Detail" tab)
  orderDetailOpen: boolean;
  orderDetailOrderNo: string;
  orderDetailCustomer: string;
  orderDetailLines: { no: string; sku: string; name: string; unit: string; qty: number; unitPrice: number; discount: number; lineTotal: number; promoSku: string }[];
  orderDetailLoading: boolean;
  orderDetailError: string | null;
  /** Keyed by `${orderNo}|${no || sku}` — save status for confirming/clearing
   * one line's promo-use link, shown inline next to that line. */
  lineItemPromoStatus: Record<string, OrderSaveStatus>;
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
  /** orderNo -> record of the cross-day stuck-order detector having pulled
   * it off a Batch Route (see ordersNeedingStuckBatchDetach in derive.ts and
   * autoDetachStuckOrders below) — drives the Planner's "ตกหล่นจากวันก่อนหน้า"
   * badge on that now-unassigned order. */
  stuckDetachments: StuckDetachmentIndex;
  /** batchId -> true while that batch's locked sequence/membership is
   * temporarily unlocked for editing. Deliberately not persisted — a reload
   * re-locks everything, which is the safer default. */
  batchRouteUnlocked: Record<string, boolean>;
  batchRouteQ: string;
  /** Sub-tab on the Planner page: the live plan, or the Batch Route history.
   * (Route Calendar used to live here too — it's now its own tab on the
   * Dashboard page, see dashboardTab above.) */
  plannerTab: 'plan' | 'history';
  assignDialogOpen: boolean;
  assignSelectedVehicleIds: string[];
  /** Set when the Planner's "จัดลงรถ" bulk-assign includes an order with no
   * delivery date — those get dropped from the assignment (see the gate in
   * computePlanner's assignSelectedTo) and this dismissible message names
   * them, so the rejection is explicit rather than a silent no-op. */
  plannerAssignSkippedMessage: string | null;
  /** Set when a background push of batchRoutes to the shared backend (see
   * src/data/sources/batchRoutesApi.ts) fails — the edit itself is never
   * rolled back (local state + localStorage already have it), this is only
   * a "some other device may not see this yet, retry" notice. */
  batchRoutesSyncWarning: string | null;
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
  /** Which of that vehicle's Batch Route dates the driver is currently
   * viewing — null = date-selection screen. Reset to null whenever the
   * vehicle changes (see setDriverVehicle). */
  driverSelectedBatchId: string | null;
  /** orderNos marked delivered locally but not yet confirmed synced to the sheet. */
  driverSyncQueue: string[];
  driverOnline: boolean;
  /** batchId -> which SKUs are ticked + whether "ยืนยันเริ่มเดินทาง" was
   * pressed for that batch's pre-departure checklist. */
  preDepartureChecklists: PreDepartureChecklistIndex;

  // "ส่งไม่สำเร็จ" (delivery failed) — the alternative to markDelivered on a
  // stop, with a required photo. detail (reason/note/photo links) keyed by
  // orderNo; see src/data/deliveryFailures.ts for why it's not on the order
  // record itself.
  deliveryFailures: DeliveryFailureIndex;
  /** orderNo whose "ส่งไม่สำเร็จ" dialog is open; null = closed. */
  deliveryFailureDialogOrderNo: string | null;
  deliveryFailureReason: string;
  deliveryFailureNote: string;
  deliveryFailurePhotos: File[];
  deliveryFailureSubmitting: boolean;
  deliveryFailureError: string | null;
  /** orderNos whose "ส่งไม่สำเร็จ" submission (status write + photo upload)
   * is queued for retry — mirrors driverSyncQueue's role for markDelivered,
   * but the actual pending payload (reason/note/photo blobs) lives in
   * IndexedDB (see src/data/failedDeliveryQueue.ts) since it can't fit in
   * localStorage's string-only quota. */
  deliveryFailureSyncQueue: string[];

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

  // promo ("โปรโมชั่น" tab — every row, filtered client-side by status)
  promos: Promo[];
  promosLoading: boolean;
  promosError: string | null;
  promoQ: string;
  /** 'all' or a raw Status value (e.g. 'Active'). Defaults to 'Active' so
   * the page's default view matches the old Active-only behavior. */
  promoStatusFilter: string;
  promoModal: boolean;
  /** null = creating a new promotion; a Promo = editing that existing row in
   * place (matched by its SKU — the SKU field is locked while editing).
   * Kept in full (not just the SKU) so an edit that doesn't touch the dates
   * can still redisplay the original period text right after saving. */
  promoEditingOriginal: Promo | null;
  promoForm: {
    name: string;
    sku: string;
    type: string;
    /** ISO YYYY-MM-DD; '' = leave the sheet's existing date untouched (only
     * meaningful while editing — a new promo always sends both). */
    start: string;
    end: string;
    unit: PromoUnit;
    /** Which pricing shape the form is currently editing — a promo is either
     * a stepped quantity discount (tiers) or priced per packaging unit
     * (packUnits), never both at once. */
    mode: 'tiers' | 'packUnits';
    tiers: PromoTier[];
    packUnits: PromoPackUnit[];
  };
  promoSaveStatus: OrderSaveStatus | null;
  /** SKU of the promo whose usage-stats panel is open; null = closed. */
  promoUsageSku: string | null;

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

/** Fresh create-promo form defaults — 90 days out is a reasonable long-run
 * promo window; every field resets to this both on initial load and every
 * time "สร้างโปรโมชั่น" is clicked (so a previous edit/create never leaks
 * into the next one). */
const DEFAULT_PROMO_FORM: AppState['promoForm'] = {
  name: '',
  sku: '',
  type: 'ลดราคา',
  start: todayDayKey(),
  end: dayKey(addDays(dayKeyToDate(todayDayKey())!, 90)),
  unit: 'ชิ้น',
  mode: 'packUnits',
  tiers: [{ minQty: 1, price: 0 }],
  packUnits: [{ label: 'ชิ้น', price: 0, qtyPerUnit: 1 }],
};

export const initialState: AppState = {
  ...initialRouteFromUrl(),
  ...initialSession(),

  apiOrders: [],
  apiOrdersLoading: true,
  apiOrdersError: null,
  apiOrdersStale: false,
  q: '',
  statusFilter: 'all',
  dashboardTab: 'overview',

  forecastStatusFilter: 'all',

  orderDetailOpen: false,
  orderDetailOrderNo: '',
  orderDetailCustomer: '',
  orderDetailLines: [],
  orderDetailLoading: false,
  orderDetailError: null,
  lineItemPromoStatus: {},
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
  stuckDetachments: {},
  batchRouteUnlocked: {},
  batchRouteQ: '',
  plannerTab: 'plan',
  assignDialogOpen: false,
  plannerAssignSkippedMessage: null,
  batchRoutesSyncWarning: null,
  assignSelectedVehicleIds: [],
  orderLocationOrderNo: null,
  orderLocationLat: '',
  orderLocationLng: '',
  orderLocationSaving: false,
  orderLocationError: null,

  driverSelectedBatchId: null,
  driverSyncQueue: [],
  driverOnline: typeof navigator === 'undefined' || navigator.onLine,
  preDepartureChecklists: {},

  deliveryFailures: {},
  deliveryFailureDialogOrderNo: null,
  deliveryFailureReason: '',
  deliveryFailureNote: '',
  deliveryFailurePhotos: [],
  deliveryFailureSubmitting: false,
  deliveryFailureError: null,
  deliveryFailureSyncQueue: [],

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
  promoStatusFilter: 'Active',
  promoModal: false,
  promoEditingOriginal: null,
  promoForm: DEFAULT_PROMO_FORM,
  promoSaveStatus: null,
  promoUsageSku: null,

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
  | { type: 'applyPromoSaved'; promo: Promo }
  | { type: 'applyLineItemPromoLink'; orderNo: string; sku: string; no: string; promoSku: string }
  | { type: 'updateCustomerLatLng'; rowIndex: number; lat: number; lng: number }
  | { type: 'updateOrderLocation'; orderNo: string; lat: number; lng: number }
  | { type: 'setOrderSaveStatus'; orderNo: string; status: OrderSaveStatus | null }
  | { type: 'setLineItemPromoStatus'; key: string; status: OrderSaveStatus | null }
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

    case 'applyPromoSaved': {
      // Written back to the real sheet successfully — patch (or insert) the
      // matching promo by SKU so the table reflects it immediately, without
      // waiting on the next cached CSV refetch.
      const idx = state.promos.findIndex((p) => p.sku === action.promo.sku);
      const promos = idx >= 0 ? state.promos.map((p, i) => (i === idx ? action.promo : p)) : [action.promo, ...state.promos];
      return { ...state, promos, promoModal: false, promoEditingOriginal: null, promoForm: DEFAULT_PROMO_FORM };
    }

    case 'applyLineItemPromoLink': {
      // Written back successfully — patch both the currently-open detail
      // modal's lines (if it's this same order) and the shared orderLineItems
      // collection every page's promo-usage lookups read from, so usage
      // stats reflect it immediately without a refetch.
      const matchLine = (no: string, sku: string) => (action.no ? no === action.no : sku === action.sku);
      const orderDetailLines =
        state.orderDetailOrderNo === action.orderNo
          ? state.orderDetailLines.map((l) => (matchLine(l.no, l.sku) ? { ...l, promoSku: action.promoSku } : l))
          : state.orderDetailLines;
      const orderLineItems = state.orderLineItems.map((l) =>
        l.orderNo === action.orderNo && matchLine(l.no, l.sku) ? { ...l, promoSku: action.promoSku } : l,
      );
      return { ...state, orderDetailLines, orderLineItems };
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

    case 'setLineItemPromoStatus': {
      const next = { ...state.lineItemPromoStatus };
      if (action.status === null) delete next[action.key];
      else next[action.key] = action.status;
      return { ...state, lineItemPromoStatus: next };
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

  /** Local-first batchRoutes write, shared by setBatchRoutes (ordinary
   * planner edits) and cancelBatchRoute — state + localStorage update
   * immediately, then push to the shared backend in the background; a push
   * failure never rolls back the local edit, it just surfaces as a
   * dismissible batchRoutesSyncWarning. The backend now ALSO reconciles
   * every affected order's batch_route_id/route/assigned_driver/
   * stop_sequence transactionally as part of this same push (see
   * server/lib.ts's handleUpsertBatchRoutes) — the old separate
   * "คนส่ง"-column write (clearOrStampCourier/stampCourierOrders) that used
   * to run alongside this is gone; this one call now does both. */
  function persistBatchRoutes(list: BatchRoute[]) {
    dispatch({ type: 'patch', patch: { batchRoutes: list } });
    saveBatchRoutes(list);
    const session = loadSession();
    if (!session) return;
    apiUpsertBatchRoutes(session, list).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'ซิงค์ Batch Route ขึ้นเซิร์ฟเวอร์ไม่สำเร็จ';
      dispatch({ type: 'patch', patch: { batchRoutesSyncWarning: message } });
    });
  }

  /** Uploads the photo(s) for one "ส่งไม่สำเร็จ" report and writes the Status
   * column, then reflects both in local shared state — the one place both
   * the immediate submit path and the offline-queue retry path converge, so
   * they can never drift on what "success" actually updates. Throws on any
   * failure (upload or write-back) so the caller decides what to do next
   * (submit queues it; retry just leaves it queued for the next attempt). */
  async function attemptFailedDelivery(item: FailedDeliveryQueueItem): Promise<void> {
    const uploaded = await uploadToDrive('deliveryFailure', item.orderNo, item.photos);
    await updateRouteOrder({ orderNo: item.orderNo, status: DELIVERY_FAILED_STATUS });

    const username = loadSession()?.username ?? 'ไม่ทราบผู้ใช้';
    const record: DeliveryFailureRecord = {
      orderNo: item.orderNo,
      reason: item.reason,
      note: item.note,
      photoLinks: uploaded.map((f) => ({ fileId: f.fileId, webViewLink: f.webViewLink, name: f.name })),
      failedAt: new Date().toISOString(),
      failedBy: username,
    };
    const nextFailures = { ...loadDeliveryFailures(), [item.orderNo]: record };
    saveDeliveryFailures(nextFailures);
    dispatch({ type: 'patch', patch: { deliveryFailures: nextFailures } });
    dispatch({ type: 'applyPickLotStatus', orderNo: item.orderNo, statusText: DELIVERY_FAILED_STATUS });
    logActivity('ส่งไม่สำเร็จ', `${item.reason}${item.note ? ` · ${item.note}` : ''} · แนบรูป ${uploaded.length} รูป`, item.orderNo);
  }

  /** Retries every queued "ส่งไม่สำเร็จ" report — same on-reconnect /
   * periodic-tick trigger as syncDriverQueue above. Re-reads the queue after
   * each removal (rather than filtering a captured state.deliveryFailureSyncQueue)
   * so this never depends on a stale closure over state, same reasoning as
   * syncDriverQueue's own loadDriverQueue().filter(...) pattern. */
  function syncFailedDeliveryQueue() {
    loadFailedDeliveryQueue().then((queue) => {
      queue.forEach((item) => {
        attemptFailedDelivery(item)
          .then(() =>
            removeFailedDeliveryQueueItem(item.orderNo).then(() =>
              loadFailedDeliveryQueue().then((remaining) => {
                dispatch({ type: 'patch', patch: { deliveryFailureSyncQueue: remaining.map((r) => r.orderNo) } });
              }),
            ),
          )
          .catch(() => {
            /* stays queued — next online event or interval tick retries */
          });
      });
    });
  }

  /** Appends one entry to the persisted activity log and reflects it in
   * state immediately. Called from every user action that changes something
   * meaningful (order edits, planner moves, pick-lot closes, lat/lng fixes,
   * receiving, attachments) — see each action below. */
  /** userOverride is for the rare system-triggered entry (see
   * autoDetachStuckOrders) that shouldn't be attributed to whichever
   * session happened to be open and polling when it fired. */
  function logActivity(action: string, detail: string, orderNo?: string, userOverride?: string) {
    const username = userOverride ?? loadSession()?.username ?? 'ไม่ทราบผู้ใช้';
    dispatch({
      type: 'patch',
      patch: { activityLog: appendActivityLog(loadActivityLog(), { user: username, action, detail, orderNo }) },
    });
  }
  const SYSTEM_USER_LABEL = 'ระบบ (ตรวจจับอัตโนมัติ)';

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

  // Order data comes from the "API Import" sheet tab via this app's own
  // backend (see src/data/sources/apiImportOrders.ts), which needs a
  // session to read. Gated on state.session like the staff-order-overlay
  // effect right below. Polls every 45s (a bit looser than the backend's
  // own ~60s Sheets-read cache, so most polls just hit that cache) so an
  // order edited directly in the sheet shows up here without anyone having
  // to hit the manual "Sync" button. A `stale: true` result means the
  // backend's live read failed and it served its last-known-good cache
  // instead — not an error, just a small warning banner.
  useEffect(() => {
    if (!state.session) return;
    let cancelled = false;
    const load = () => {
      const session = loadSession();
      if (!session) return;
      fetchApiImportOrders(session)
        .then(({ orders, stale, error }) => {
          if (!cancelled) {
            dispatch({ type: 'patch', patch: { apiOrders: orders, apiOrdersLoading: false, apiOrdersError: null, apiOrdersStale: stale } });
            noteNewOrders(orders);
            if (stale && error) recordSyncFailure('ออเดอร์ใหม่ (API Import)', error);
            else recordSyncSuccess();
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : 'โหลดออเดอร์ใหม่ไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { apiOrdersLoading: false, apiOrdersError: message } });
            recordSyncFailure('ออเดอร์ใหม่ (API Import)', message);
          }
        });
    };
    load();
    const interval = setInterval(load, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.username]);

  // Route orders: the runtime join of API Import (read through this app's
  // authenticated backend, see apiImportOrders.ts) + คำสั่งซื้อ VS (a public
  // CSV export) — see src/data/sources/routeOrders.ts. Gated on
  // state.session so it fires right after login, same as every other data
  // source here.
  useEffect(() => {
    if (!state.session) return;
    let cancelled = false;
    fetchRouteOrders(loadSession())
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.username]);

  // Promotions: also a public CSV export (see
  // src/data/sources/promotionsSheet.ts) — same session-gating reasoning.
  useEffect(() => {
    if (!state.session) return;
    let cancelled = false;
    fetchPromotions()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.username]);

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

  // Customer list (name/address/lat/lng/etc.) comes straight from the CS
  // Master Google Sheet — a corrected lat/lng is written back to that same
  // sheet by updateCsMasterLatLng, so there's nothing separate to fetch or
  // merge in here.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.username]);

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
        stuckDetachments: loadStuckDetachments(),
        deliveryFailures: loadDeliveryFailures(),
        preDepartureChecklists: loadPreDepartureChecklists(),
        lastSyncAt: loadLastSyncAt(),
        notificationEvents: loadNotificationEvents(),
        notificationReadIds: loadNotificationReadIds(),
        activityLog: loadActivityLog(),
        sidebarCollapsed: loadSidebarCollapsed() ?? window.innerWidth < 900,
      },
    });
  }, []);

  // The failed-delivery photo queue lives in IndexedDB (see
  // src/data/failedDeliveryQueue.ts), which is inherently async — can't join
  // the synchronous localStorage batch above — so it gets its own mount
  // effect, and also kicks off one retry attempt immediately in case
  // connectivity came back while the app was closed.
  useEffect(() => {
    loadFailedDeliveryQueue().then((queue) => {
      dispatch({ type: 'patch', patch: { deliveryFailureSyncQueue: queue.map((q) => q.orderNo) } });
      if (queue.length > 0) syncFailedDeliveryQueue();
    });
  }, []);

  // Background batch-geocode: once routeOrders (and customers, so any
  // corrected coordinate is already resolved — see resolveRouteOrderLocations)
  // has loaded, reverse-geocode every unique coordinate not already in the
  // cache (paced at GEOCODE_MIN_INTERVAL_MS so this never bursts past
  // Nominatim's rate limit), updating the cache — and every row using it —
  // one coordinate at a time rather than blocking the page until the whole
  // batch finishes. Guarded by a ref (not a state flag) so it only ever runs
  // once even if this effect re-fires for an unrelated reason.
  const geocodeBatchStarted = useRef(false);
  useEffect(() => {
    if (state.routeOrders.length === 0 || state.customersLoading || geocodeBatchStarted.current) return;

    const localCache: GeocodeCache = { ...state.geocodeCache };
    const seen = new Set<string>();
    const toFetch: { key: string; lat: number; lng: number }[] = [];
    for (const o of resolveRouteOrderLocations(state.routeOrders, state.customers)) {
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
  }, [state.routeOrders.length, state.customersLoading]);

  // Driver view offline support: retry any queued delivery marks whenever
  // connectivity returns, and keep trying periodically in case a request
  // failed for a reason other than being fully offline (e.g. a flaky signal).
  useEffect(() => {
    const goOnline = () => {
      dispatch({ type: 'patch', patch: { driverOnline: true } });
      syncDriverQueue();
      syncFailedDeliveryQueue();
    };
    const goOffline = () => dispatch({ type: 'patch', patch: { driverOnline: false } });
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const interval = setInterval(() => {
      if (loadDriverQueue().length > 0) syncDriverQueue();
      syncFailedDeliveryQueue();
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

  // Batch Routes — same polling reasoning as bookings above: this is what
  // lets a driver's own phone (a different device than whichever admin ran
  // "ยืนยันรูท (Assign)") see that vehicle's assigned dates at all, since the
  // localStorage cache alone would otherwise only ever hold whatever was
  // last assigned FROM this exact browser.
  useEffect(() => {
    if (!state.session) return;
    let cancelled = false;
    const load = () => {
      const session = loadSession();
      if (!session) return;
      apiFetchBatchRoutes(session)
        .then((list) => {
          if (cancelled) return;
          dispatch({ type: 'patch', patch: { batchRoutes: list } });
          saveBatchRoutes(list);
        })
        .catch(() => {
          /* keep showing whatever's cached locally — next poll tick retries */
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
      setBatchRoutes: (list: BatchRoute[]) => persistBatchRoutes(list),
      dismissBatchRoutesSyncWarning: () => dispatch({ type: 'patch', patch: { batchRoutesSyncWarning: null } }),
      /** "ยกเลิก Batch Route" — a data-correction action for a batch created
       * or assigned wrong, distinct from ordinary batch editing
       * (syncBatchAfterEdit in derive.ts) since it touches every order in the
       * batch at once and marks the batch record itself cancelled rather
       * than just changing membership. The UI only ever offers this once
       * canCancelBatchRoute(role) and a zero-delivered check both pass (see
       * computeBatchRouteHistory), but the same delivered-status check is
       * repeated here defensively so a stale button can never unwind a real
       * delivery. Cancelling never deletes the record — Batch Route History
       * keeps showing it, badged "ยกเลิกแล้ว". */
      cancelBatchRoute: (batchId: string, batchRoutes: BatchRoute[], routeOrders: RouteOrder[]) => {
        const batch = batchRoutes.find((b) => b.id === batchId);
        if (!batch || batch.cancelled) return;
        const statusByOrderNo = new Map(routeOrders.map((o) => [o.orderNo, o.status]));
        const hasDelivered = batch.orderNos.some((no) => DELIVERED_STATUSES.includes(statusByOrderNo.get(no) ?? ''));
        if (hasDelivered) return;

        const now = new Date().toISOString();
        const username = loadSession()?.username ?? '';
        const next = batchRoutes.map((b) => (b.id === batchId ? { ...b, cancelled: true, cancelledAt: now, cancelledBy: username } : b));
        persistBatchRoutes(next);
        logActivity('ยกเลิก Batch Route', `${batch.id} · ปลด ${batch.orderNos.length} ออเดอร์ (${batch.orderNos.join(', ')})`);
      },
      /** Cross-day stuck-order detector's write action (see
       * ordersNeedingStuckBatchDetach in derive.ts and the effect below that
       * calls this) — a driver never marked one or more stops delivered (or
       * failed) before their delivery day ended, so each gets pulled out of
       * its batch's manifest individually (unlike cancelBatchRoute, this
       * never touches the rest of that batch's — possibly already
       * delivered — orders) and freed up for reassignment. Attributed to a
       * system label, not whichever session happened to be polling when
       * this fired. Grouped by originating batch so two stuck orders from
       * the same batch remove cleanly in one state update instead of racing
       * each other. */
      autoDetachStuckOrders: (entries: { orderNo: string; batch: BatchRoute }[], batchRoutes: BatchRoute[]) => {
        if (entries.length === 0) return;
        const now = new Date().toISOString();
        const removeByBatchId = new Map<string, Set<string>>();
        for (const e of entries) {
          let set = removeByBatchId.get(e.batch.id);
          if (!set) {
            set = new Set();
            removeByBatchId.set(e.batch.id, set);
          }
          set.add(e.orderNo);
        }
        const next = batchRoutes.map((b) => {
          const removeSet = removeByBatchId.get(b.id);
          if (!removeSet) return b;
          return { ...b, orderNos: b.orderNos.filter((no) => !removeSet.has(no)), updatedAt: now, updatedBy: SYSTEM_USER_LABEL };
        });
        persistBatchRoutes(next);

        const detachments = { ...loadStuckDetachments() };
        for (const e of entries) {
          detachments[e.orderNo] = { orderNo: e.orderNo, fromBatchId: e.batch.id, fromVehicleName: e.batch.vehicleName, detectedAt: now };
        }
        saveStuckDetachments(detachments);
        dispatch({ type: 'patch', patch: { stuckDetachments: detachments } });

        for (const [batchId, orderNoSet] of removeByBatchId) {
          const batch = batchRoutes.find((b) => b.id === batchId);
          const orderNos = [...orderNoSet];
          logActivity(
            'ตรวจพบออเดอร์ตกหล่นข้ามวัน',
            `${batchId} · ${batch?.vehicleName ?? ''} · ${orderNos.length} ออเดอร์ (${orderNos.join(', ')}) — เลยกำหนดส่งแล้วแต่ยังไม่สำเร็จ ปลดออกจากรถแล้ว ต้องเอาสินค้าลงจากรถเพื่อจัดใหม่`,
            undefined,
            SYSTEM_USER_LABEL,
          );
        }
      },
      dismissPlannerAssignSkippedMessage: () => dispatch({ type: 'patch', patch: { plannerAssignSkippedMessage: null } }),
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

      openCreatePromo: () =>
        dispatch({ type: 'patch', patch: { promoModal: true, promoEditingOriginal: null, promoForm: DEFAULT_PROMO_FORM, promoSaveStatus: null } }),
      openEditPromo: (promo: Promo) =>
        dispatch({
          type: 'patch',
          patch: {
            promoModal: true,
            promoEditingOriginal: promo,
            promoSaveStatus: null,
            promoForm: {
              name: promo.skuName || promo.name,
              sku: promo.sku,
              type: promo.type,
              // Sheet dates aren't guaranteed to be ISO text, so they can't be
              // reliably parsed back into this YYYY-MM-DD field — left blank
              // means "keep the existing dates", exactly like leaving them
              // blank does for a new promo's optional fields server-side.
              start: '',
              end: '',
              unit: promo.unit,
              mode: promo.packUnits.length > 0 ? 'packUnits' : 'tiers',
              tiers: promo.tiers.length > 0 ? promo.tiers : [{ minQty: 1, price: 0 }],
              packUnits: promo.packUnits.length > 0 ? promo.packUnits : [{ label: 'ชิ้น', price: 0, qtyPerUnit: 1 }],
            },
          },
        }),
      closePromo: () => dispatch({ type: 'patch', patch: { promoModal: false, promoSaveStatus: null } }),
      openPromoUsage: (sku: string) => dispatch({ type: 'patch', patch: { promoUsageSku: sku } }),
      closePromoUsage: () => dispatch({ type: 'patch', patch: { promoUsageSku: null } }),
      /** Writes to the real "โปรโมชั่น" sheet; local state only updates after
       * that succeeds, same promise as saveOrderEdit above. `editingOriginal`
       * is passed in explicitly (rather than closed over) per this file's
       * stale-closure rule for the frozen actions object below. */
      savePromo: (form: AppState['promoForm'], editingOriginal: Promo | null) => {
        const packUnits = form.packUnits.filter((u) => u.price > 0 && u.qtyPerUnit >= 1);
        const tiers = form.tiers.filter((t) => t.price > 0).sort((a, b) => a.minQty - b.minQty);
        const usingPackUnits = form.mode === 'packUnits' && packUnits.length > 0;
        const sku = (editingOriginal?.sku ?? form.sku).trim();
        const name = form.name.trim();
        if (!sku || !name || (usingPackUnits ? packUnits.length === 0 : tiers.length === 0)) return;

        const termText = usingPackUnits ? formatPackUnitsTerm(packUnits) : formatTiersTerm(tiers, form.unit);
        const single = usingPackUnits ? packUnits.find((u) => u.label === 'ชิ้น') : form.unit === 'ชิ้น' ? tiers[0] : undefined;
        const box = usingPackUnits
          ? (packUnits.find((u) => u.label === 'หีบ') ?? packUnits.find((u) => u.label === 'ลัง'))
          : form.unit === 'หีบ' || form.unit === 'ลัง'
            ? tiers[tiers.length - 1]
            : undefined;
        const headlinePrice = usingPackUnits ? packUnits[0]?.price : tiers[0]?.price;

        dispatch({ type: 'patch', patch: { promoSaveStatus: { state: 'saving' } } });
        upsertPromotion({
          sku,
          productName: name,
          termText,
          start: form.start || undefined,
          end: form.end || undefined,
          promotionPrice: headlinePrice,
          boxPrice: box?.price,
          singlePrice: single?.price,
        })
          .then(() => {
            const bestPackUnit = usingPackUnits ? packUnits.reduce((a, b) => (avgPricePerPiece(b) < avgPricePerPiece(a) ? b : a)) : null;
            const period = form.start && form.end ? `${form.start} – ${form.end}` : (editingOriginal?.period ?? '');
            const promo: Promo = {
              name: termText,
              value: bestPackUnit
                ? `เฉลี่ยต่ำสุด ฿${avgPricePerPiece(bestPackUnit).toFixed(2)}/ชิ้น (${bestPackUnit.label} ฿${bestPackUnit.price})`
                : `฿${tiers[0]?.price ?? 0}/${form.unit}`,
              sku,
              skuName: name,
              type: usingPackUnits ? 'ราคาต่อหน่วยบรรจุ' : tiers.length > 1 ? 'ลดขั้นบันได' : form.type,
              period,
              // Matches what handleUpsertPromotion always writes to the
              // Status column server-side — must be this exact capitalization
              // to match the raw sheet value everywhere else compares against.
              st: 'Active',
              unit: usingPackUnits ? packUnits[0].label : form.unit,
              tiers: usingPackUnits ? [] : tiers,
              packUnits: usingPackUnits ? packUnits : [],
              termText,
            };
            dispatch({ type: 'applyPromoSaved', promo });
            dispatch({ type: 'patch', patch: { promoSaveStatus: { state: 'saved' } } });
            setTimeout(() => dispatch({ type: 'patch', patch: { promoSaveStatus: null } }), 2500);
            logActivity(editingOriginal ? 'แก้ไขโปรโมชั่น' : 'สร้างโปรโมชั่น', `${sku} · ${name} · ${termText}`);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { promoSaveStatus: { state: 'error', message } } });
          });
      },

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
                orderDetailLines: lines.map((l) => ({ no: l.no, sku: l.sku, name: l.productName, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal, promoSku: l.promoSku })),
              },
            });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'โหลดรายการสินค้าไม่สำเร็จ';
            dispatch({ type: 'patch', patch: { orderDetailLoading: false, orderDetailError: message } });
          });
      },
      closeOrderDetail: () => dispatch({ type: 'patch', patch: { orderDetailOpen: false } }),
      /** Confirms (promoSku set) or clears (promoSku '') that one order line
       * used a promotion, writing back to the real "SKU Detail" sheet first —
       * local state only updates after that succeeds, same promise as every
       * other write-back action here. `no` identifies the exact line when
       * known (falls back to matching by SKU within the order server-side). */
      linkLineItemPromo: (orderNo: string, sku: string, no: string, promoSku: string) => {
        const key = `${orderNo}|${no || sku}`;
        dispatch({ type: 'setLineItemPromoStatus', key, status: { state: 'saving' } });
        apiLinkLineItemPromo({ orderNo, sku, no: no || undefined, promoSku })
          .then(() => {
            dispatch({ type: 'applyLineItemPromoLink', orderNo, sku, no, promoSku });
            dispatch({ type: 'setLineItemPromoStatus', key, status: { state: 'saved' } });
            setTimeout(() => dispatch({ type: 'setLineItemPromoStatus', key, status: null }), 2500);
            logActivity(promoSku ? 'ยืนยันใช้โปรโมชั่น' : 'ยกเลิกใช้โปรโมชั่น', `${sku}${promoSku ? ` · โปร ${promoSku}` : ''}`, orderNo);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
            dispatch({ type: 'setLineItemPromoStatus', key, status: { state: 'error', message } });
          });
      },

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
          .then(async () => {
            dispatch({ type: 'updateCustomerLatLng', rowIndex, lat, lng });
            dispatch({ type: 'patch', patch: { custEditSaving: false, custEditRowIndex: null } });
            const originalText = originalLat != null && originalLng != null ? `${originalLat.toFixed(5)}, ${originalLng.toFixed(5)}` : 'ไม่มีข้อมูล';
            logActivity('แก้ไขพิกัดลูกค้า', `${name} · จาก ${originalText} → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
            // Eagerly geocode the corrected coordinate (same as the Planner's
            // own location editor) so every order for this customer picks up
            // the right อำเภอ/จังหวัด immediately — this coordinate now
            // overrides theirs everywhere via resolveRouteOrderLocations, so
            // there's no separate cache entry to invalidate, just a new one
            // to add for the corrected pin.
            const result = await reverseGeocode(lat, lng);
            if (result) {
              const cache: GeocodeCache = { ...loadGeocodeCache(), [coordKey(lat, lng)]: { ...result, fetchedAt: Date.now() } };
              saveGeocodeCache(cache);
              dispatch({ type: 'patch', patch: { geocodeCache: cache } });
            }
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

      setDriverVehicle: (vehicleId: string | null) => dispatch({ type: 'patch', patch: { driverVehicleId: vehicleId, driverSelectedBatchId: null } }),
      selectDriverBatch: (batchId: string | null) => dispatch({ type: 'patch', patch: { driverSelectedBatchId: batchId } }),

      openDeliveryFailureDialog: (orderNo: string) =>
        dispatch({ type: 'patch', patch: { deliveryFailureDialogOrderNo: orderNo, deliveryFailureReason: '', deliveryFailureNote: '', deliveryFailurePhotos: [], deliveryFailureError: null } }),
      closeDeliveryFailureDialog: () =>
        dispatch({ type: 'patch', patch: { deliveryFailureDialogOrderNo: null, deliveryFailurePhotos: [], deliveryFailureError: null } }),
      setDeliveryFailureReason: (reason: string) => dispatch({ type: 'patch', patch: { deliveryFailureReason: reason } }),
      setDeliveryFailureNote: (note: string) => dispatch({ type: 'patch', patch: { deliveryFailureNote: note } }),
      setDeliveryFailurePhotos: (files: File[]) => dispatch({ type: 'patch', patch: { deliveryFailurePhotos: files } }),
      /** Tries the upload + status write immediately; if that fails for any
       * reason (most commonly: no connection), the report is queued in
       * IndexedDB and retried automatically the same way a queued
       * markDelivered is (on 'online' and on the periodic interval tick —
       * see the effect below) — the driver isn't blocked waiting on it
       * either way, matching "ไม่บังคับห้ามออกจากหน้า" from the spec. */
      submitDeliveryFailure: (orderNo: string, reason: string, note: string, photos: File[]) => {
        if (photos.length === 0) {
          dispatch({ type: 'patch', patch: { deliveryFailureError: 'ต้องแนบรูปอย่างน้อย 1 รูป' } });
          return;
        }
        dispatch({ type: 'patch', patch: { deliveryFailureSubmitting: true, deliveryFailureError: null } });
        const item: FailedDeliveryQueueItem = { orderNo, reason, note, photos, queuedAt: new Date().toISOString() };
        attemptFailedDelivery(item)
          .then(() => {
            dispatch({
              type: 'patch',
              patch: { deliveryFailureSubmitting: false, deliveryFailureDialogOrderNo: null, deliveryFailurePhotos: [] },
            });
          })
          .catch(() => {
            saveFailedDeliveryQueueItem(item).then(() =>
              loadFailedDeliveryQueue().then((queue) => {
                dispatch({
                  type: 'patch',
                  patch: {
                    deliveryFailureSubmitting: false,
                    deliveryFailureDialogOrderNo: null,
                    deliveryFailurePhotos: [],
                    deliveryFailureSyncQueue: queue.map((q) => q.orderNo),
                  },
                });
              }),
            );
          });
      },
      retryDeliveryFailureQueue: () => syncFailedDeliveryQueue(),

      // toggleChecklistSku/confirmChecklist take the current checklist index
      // as a parameter (from computeDriverChecklist, itself called fresh
      // every render) rather than reading state.preDepartureChecklists
      // directly — this actions object is memoized once with an empty
      // dependency array (see the useMemo below), so any action body that
      // read state.X directly would always see whatever state was current
      // at the very first render, never a later one. Every other action in
      // this file that needs current state already follows this same
      // caller-supplies-it pattern (e.g. closeBatchCod's batchRoutes param).
      toggleChecklistSku: (batchId: string, sku: string, checklists: PreDepartureChecklistIndex) => {
        const cur = checklists[batchId] ?? { checkedSkus: [], confirmedAt: null, confirmedBy: '' };
        const nextSkus = cur.checkedSkus.includes(sku) ? cur.checkedSkus.filter((s) => s !== sku) : [...cur.checkedSkus, sku];
        const next = { ...checklists, [batchId]: { ...cur, checkedSkus: nextSkus } };
        savePreDepartureChecklists(next);
        dispatch({ type: 'patch', patch: { preDepartureChecklists: next } });
      },
      /** "ยืนยันเริ่มเดินทาง" — records the confirmation whether or not every
       * SKU was individually ticked first (see PreDepartureChecklistState),
       * and always logs it, noting exactly how many of the total were
       * checked so an incomplete confirmation is visible in the audit trail
       * too, not indistinguishable from a full one. */
      confirmChecklist: (batchId: string, batchLabel: string, checkedCount: number, totalCount: number, checklists: PreDepartureChecklistIndex) => {
        const cur = checklists[batchId] ?? { checkedSkus: [], confirmedAt: null, confirmedBy: '' };
        const username = loadSession()?.username ?? 'ไม่ทราบผู้ใช้';
        const next = { ...checklists, [batchId]: { ...cur, confirmedAt: new Date().toISOString(), confirmedBy: username } };
        savePreDepartureChecklists(next);
        dispatch({ type: 'patch', patch: { preDepartureChecklists: next } });
        logActivity(
          'ยืนยันเช็คลิสต์ก่อนออกเดินทาง',
          `${batchLabel} · ตรวจนับแล้ว ${checkedCount}/${totalCount} รายการ${checkedCount < totalCount ? ' (ยังไม่ครบ)' : ''}`,
        );
      },
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
      createPickLot: async (orderNosIn: string[], routeOrders: RouteOrder[], skus: Sku[], lots: PickLot[]) => {
        // Gate: no delivery date — same rule computePickOrderSelection's
        // candidates filter already enforces (so this can't normally be hit
        // via the UI), repeated here defensively in case a selection went
        // stale (e.g. the order's date was cleared after it was checked).
        const byOrderNoForGate = new Map(routeOrders.map((o) => [o.orderNo, o]));
        const orderNos = orderNosIn.filter((no) => {
          const o = byOrderNoForGate.get(no);
          return !o || effectiveDeliveryDayKey(o) !== null;
        });
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

      /** "ยกเลิกล็อตหยิบสินค้า" — for a lot grouped by mistake before it's
       * closed. Unlike closePickLot, this never writes anything back to the
       * sheet: an unclosed lot never wrote a status there to begin with (see
       * createPickLot/syncPickLotStatus), so simply dropping it from the
       * list is enough for every one of its orders to reappear as
       * "ยังไม่ได้จัดล็อต" — see alreadyInALot in computePickOrderSelection,
       * which only ever looks at state.pickLots. */
      cancelPickLot: (lotId: string, lots: PickLot[], activePickLotId: string | null) => {
        const lot = lots.find((l) => l.id === lotId);
        if (!lot || lot.closed) return;
        const next = lots.filter((l) => l.id !== lotId);
        savePickLots(next);
        dispatch({ type: 'patch', patch: { pickLots: next, activePickLotId: activePickLotId === lotId ? null : activePickLotId } });
        logActivity('ยกเลิกล็อตหยิบสินค้า', `ล็อต ${lot.id} · ${lot.orderNos.length} ออเดอร์ (${lot.orderNos.join(', ')})`);
      },

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

        // Force a fresh read from every public-CSV source instead of waiting
        // out fetchSheetRows' normal ~45s cache. API Import goes through
        // this app's own backend (its own separate ~60s cache — see
        // server/lib.ts) rather than this CSV cache, so it isn't included
        // here; asking for it below still gets whatever that backend's
        // cache currently holds.
        [
          csvExportUrl(SHEET_TABS.skuDetail),
          csvExportUrl(SHEET_TABS.csMaster),
          csvExportUrl(SHEET_TABS.skuMaster),
          csvExportUrl(SHEET_TABS.routeOrders),
          csvExportUrl(SHEET_TABS.promotions),
        ].forEach(invalidateSheetCache);

        const session = loadSession();
        const [apiOrdersR, routeOrdersR, lineItemsR, promosR, customersR, skusR] = await Promise.allSettled([
          fetchApiImportOrders(session),
          fetchRouteOrders(session),
          fetchAllOrderLineItems(),
          fetchPromotions(),
          fetchCsMasterCustomers(),
          fetchSkusFromSheet(),
        ]);

        const patch: Partial<AppState> = {};
        const failures: string[] = [];
        let anySucceeded = false;

        if (apiOrdersR.status === 'fulfilled') {
          patch.apiOrders = apiOrdersR.value.orders;
          patch.apiOrdersError = null;
          patch.apiOrdersStale = apiOrdersR.value.stale;
          noteNewOrders(apiOrdersR.value.orders);
          anySucceeded = true;
          if (apiOrdersR.value.stale && apiOrdersR.value.error) failures.push(`ออเดอร์ใหม่ (API Import): ${apiOrdersR.value.error}`);
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

  // Cross-day stuck-order auto-detach: recomputed on every routeOrders or
  // batchRoutes change (initial load, manual sync, and the batchRoutes poll
  // above every 15s — no separate timer needed for "real time" here). Only
  // administrator/manager/admin_staff sessions actually perform the write
  // (matching the backend's own permission check on both
  // /api/route-orders/update's clearCourierStamp path and batch-routes
  // upsert), so a driver/checker/picker session with the app open never
  // attempts a call the server would just 403 anyway. Self-healing: once an
  // order is detached, it drops out of ordersNeedingStuckBatchDetach's
  // result on the very next recompute (it's no longer in any batch's
  // orderNos), so this never reprocesses the same order twice.
  useEffect(() => {
    if (!state.session || !canEditPlan(state.session.role)) return;
    const entries = ordersNeedingStuckBatchDetach(state, todayDayKey());
    if (entries.length > 0) actions.autoDetachStuckOrders(entries, state.batchRoutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.routeOrders, state.batchRoutes, state.session?.username]);

  return { state, actions };
}

export type AppActions = ReturnType<typeof useAppStore>['actions'];
