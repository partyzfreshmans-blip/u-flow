import { useEffect, useMemo, useReducer } from 'react';
import { initialGrnLog } from '../data/mockData';
import { fetchApiImportOrders } from '../data/sources/apiImportOrders';
import { CS_MASTER_CSV_URL, fetchCsMasterCustomers } from '../data/sources/csMaster';
import { updateCsMasterLatLng } from '../data/sources/csMasterWrite';
import { fetchActivePromotions } from '../data/sources/promotionsSheet';
import { fetchRouteOrders } from '../data/sources/routeOrders';
import { invalidateSheetCache } from '../data/sources/sheetCsv';
import { fetchOrderLineItems } from '../data/sources/skuDetail';
import { fetchSkusFromSheet } from '../data/sources/skuSheet';
import type { ApiImportOrder, CsMasterCustomer, GrnLine, Promo, RouteKey, RouteOrder, Sku } from '../data/types';

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

  // order line-items modal (shared by dashboard's "ดู" button — "SKU Detail" tab)
  orderDetailOpen: boolean;
  orderDetailOrderNo: string;
  orderDetailCustomer: string;
  orderDetailLines: { sku: string; name: string; unit: string; qty: number; unitPrice: number; discount: number; lineTotal: number }[];
  orderDetailLoading: boolean;
  orderDetailError: string | null;

  // route planning / delivery history ("คำสั่งซื้อ" tab)
  routeOrders: RouteOrder[];
  routeOrdersLoading: boolean;
  routeOrdersError: string | null;
  routeFilterValue: string;
  routeStatusFilter: string;
  routeQ: string;

  // batch picking
  picked: Record<string, boolean>;
  pickClosed: boolean;

  // COD
  codDriver: string;
  codMobile: boolean;
  cod: Record<string, string>;
  codClosed: Record<string, boolean>;

  // promo ("โปรโมชั่น" tab, Active rows only; "create promotion" flow is local)
  promos: Promo[];
  promosLoading: boolean;
  promosError: string | null;
  promoQ: string;
  promoModal: boolean;
  promoForm: { name: string; sku: string; type: string; start: string; end: string };

  // GRN
  grnSupplier: string;
  grnDoc: string;
  grnDate: string;
  grnBarcode: string;
  grnLookup: (Sku & { notFound?: false }) | { notFound: true } | null;
  grnPrice: string;
  grnQtyPiece: string;
  grnQtyPack: string;
  grnQtyCase: string;
  grnNewOpen: boolean;
  grnNewName: string;
  grnNewUnit: string;
  grnLines: GrnLine[];
  grnLog: typeof initialGrnLog;

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

export const initialState: AppState = {
  route: 'dashboard',

  apiOrders: [],
  apiOrdersLoading: true,
  apiOrdersError: null,
  q: '',
  statusFilter: 'all',

  orderDetailOpen: false,
  orderDetailOrderNo: '',
  orderDetailCustomer: '',
  orderDetailLines: [],
  orderDetailLoading: false,
  orderDetailError: null,

  routeOrders: [],
  routeOrdersLoading: true,
  routeOrdersError: null,
  routeFilterValue: 'all',
  routeStatusFilter: 'all',
  routeQ: '',

  picked: {},
  pickClosed: false,
  codDriver: 'สมชาย ป.',
  codMobile: false,
  cod: { 'OD-6004': '3380', 'OD-6009': '3900', 'OD-6006': '1980', 'OD-6007': '7450' },
  codClosed: {},

  promos: [],
  promosLoading: true,
  promosError: null,
  promoQ: '',
  promoModal: false,
  promoForm: { name: '', sku: '', type: 'ลดราคา', start: '2026-07-24', end: '2026-08-24' },

  grnSupplier: '',
  grnDoc: '',
  grnDate: '2026-07-23',
  grnBarcode: '',
  grnLookup: null,
  grnPrice: '',
  grnQtyPiece: '',
  grnQtyPack: '',
  grnQtyCase: '',
  grnNewOpen: false,
  grnNewName: '',
  grnNewUnit: 'ชิ้น',
  grnLines: [],
  grnLog: initialGrnLog,

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
  | { type: 'doLookup' }
  | { type: 'createSkuFromGrn' }
  | { type: 'addGrnLine' }
  | { type: 'saveGrn' }
  | { type: 'openEditSku'; sku: Sku }
  | { type: 'saveSku' }
  | { type: 'addPromo' }
  | { type: 'updateCustomerLatLng'; rowIndex: number; lat: number; lng: number };

function nextSkuId(skus: Sku[]): string {
  const nums = skus.map((s) => parseInt(s.id.replace('SKU', ''), 10)).filter((n) => !isNaN(n));
  return 'SKU' + String(Math.max(0, ...nums) + 1).padStart(5, '0');
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };

    case 'doLookup': {
      const bc = state.grnBarcode.trim();
      if (!bc) return { ...state, grnLookup: null };
      const s = state.skus.find((x) => x.barcode === bc);
      return {
        ...state,
        grnLookup: s ? { ...s } : { notFound: true },
        grnNewOpen: false,
        grnNewName: '',
        grnPrice: '',
        grnQtyPiece: '',
        grnQtyPack: '',
        grnQtyCase: '',
      };
    }

    case 'createSkuFromGrn': {
      if (!state.grnNewName.trim()) return state;
      const newSkuId = nextSkuId(state.skus);
      const ns: Sku = {
        id: newSkuId,
        displayId: newSkuId,
        barcode: state.grnBarcode.trim(),
        name: state.grnNewName.trim(),
        unit: state.grnNewUnit,
        stock: 0,
        status: 'active',
      };
      return {
        ...state,
        skus: [...state.skus, ns],
        grnLookup: { ...ns },
        grnNewOpen: false,
        grnNewName: '',
      };
    }

    case 'addGrnLine': {
      const lk = state.grnLookup;
      if (!lk || 'notFound' in lk) return state;
      const { grnPrice, grnQtyPiece, grnQtyPack, grnQtyCase } = state;
      if (!grnQtyPiece && !grnQtyPack && !grnQtyCase) return state;
      const line: GrnLine = {
        name: lk.name,
        barcode: lk.barcode,
        price: Number(grnPrice || 0),
        piece: Number(grnQtyPiece || 0),
        pack: Number(grnQtyPack || 0),
        cs: Number(grnQtyCase || 0),
      };
      return {
        ...state,
        grnLines: [...state.grnLines, line],
        grnBarcode: '',
        grnLookup: null,
        grnPrice: '',
        grnQtyPiece: '',
        grnQtyPack: '',
        grnQtyCase: '',
      };
    }

    case 'saveGrn': {
      if (state.grnLines.length === 0) return state;
      const now = new Date();
      const entry = {
        supplier: state.grnSupplier || '(ไม่ระบุซัพพลายเออร์)',
        doc: state.grnDoc || '—',
        count: state.grnLines.length,
        when: '23 ก.ค. 2026 ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
        by: 'admin.warehouse',
      };
      return {
        ...state,
        grnLog: [entry, ...state.grnLog],
        grnLines: [],
        grnDoc: '',
        grnBarcode: '',
        grnLookup: null,
      };
    }

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
      const rec: Sku = { id: key, displayId: f.id, barcode: f.barcode, name: f.name, unit: f.unit, stock: Number(f.stock || 0), status: f.status };
      const arr = [...state.skus];
      const idx = arr.findIndex((x) => x.id === key);
      if (idx >= 0) arr[idx] = rec;
      else arr.push(rec);
      return { ...state, skus: arr, skuModal: null };
    }

    case 'addPromo': {
      const f = state.promoForm;
      if (!f.name.trim()) return state;
      const match = state.skus.find((s) => s.id === f.sku || s.name === f.sku);
      const promo: Promo = {
        name: f.name.trim(),
        value: f.type,
        sku: match ? match.id : f.sku.trim() || '—',
        skuName: match ? match.name : f.sku.trim() || '—',
        type: f.type,
        period: `${f.start} – ${f.end}`,
        st: 'active',
      };
      return {
        ...state,
        promos: [promo, ...state.promos],
        promoModal: false,
        promoForm: { name: '', sku: '', type: 'ลดราคา', start: '2026-07-24', end: '2026-08-24' },
      };
    }

    case 'updateCustomerLatLng': {
      const arr = state.customers.map((c) => (c.rowIndex === action.rowIndex ? { ...c, lat: action.lat, lng: action.lng } : c));
      return { ...state, customers: arr };
    }

    default:
      return state;
  }
}

export function useAppStore() {
  const [state, dispatch] = useReducer(reducer, initialState);

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

  const actions = useMemo(
    () => ({
      patch: (patch: Partial<AppState>) => dispatch({ type: 'patch', patch }),
      doLookup: () => dispatch({ type: 'doLookup' }),
      createSkuFromGrn: () => dispatch({ type: 'createSkuFromGrn' }),
      addGrnLine: () => dispatch({ type: 'addGrnLine' }),
      saveGrn: () => dispatch({ type: 'saveGrn' }),
      openEditSku: (sku: Sku) => dispatch({ type: 'openEditSku', sku }),
      saveSku: () => dispatch({ type: 'saveSku' }),
      addPromo: () => dispatch({ type: 'addPromo' }),

      openOrderDetail: (orderNo: string, customer: string) => {
        dispatch({
          type: 'patch',
          patch: { orderDetailOpen: true, orderDetailOrderNo: orderNo, orderDetailCustomer: customer, orderDetailLoading: true, orderDetailError: null, orderDetailLines: [] },
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
    }),
    [],
  );

  return { state, actions };
}

export type AppActions = ReturnType<typeof useAppStore>['actions'];
