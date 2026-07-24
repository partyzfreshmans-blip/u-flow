import { useEffect, useMemo, useReducer } from 'react';
import {
  initialCustomers,
  initialGrnLog,
  initialLanes,
  promos as initialPromos,
} from '../data/mockData';
import { loadAllOverrides, saveOverride } from '../data/sources/customerOverrides';
import { fetchSkusFromSheet } from '../data/sources/skuSheet';
import { fetchCustomersFromUnii } from '../data/sources/uniiCustomers';
import type { Customer, GrnLine, LatLngOverride, Promo, RouteKey, Sku } from '../data/types';

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

export interface CustForm {
  id: string;
  name: string;
  addr: string;
  route: 'A' | 'B';
  pay: 'cod' | 'credit';
  limit: string;
  balance: string;
  term: string;
  status: 'active' | 'hold';
  conds: string;
  lat: string;
  lng: string;
}

export interface AppState {
  route: RouteKey;

  // dashboard
  q: string;
  statusFilter: string;
  routeFilter: string;
  dateFilter: string;

  // route planning
  lanes: Record<'A' | 'B', string[]>;
  routeMobile: boolean;
  dragFrom: { key: 'A' | 'B'; i: number } | null;
  routeSel: 'A' | 'B';

  // batch picking
  picked: Record<string, boolean>;
  pickClosed: boolean;

  // COD
  codDriver: string;
  codMobile: boolean;
  cod: Record<string, string>;
  codClosed: Record<string, boolean>;

  // promo
  promos: Promo[];
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

  // SKU master (loaded from the Google Sheet at runtime)
  skus: Sku[];
  skusLoading: boolean;
  skusError: string | null;
  skuQ: string;
  skuModal: 'add' | 'edit' | null;
  skuF: SkuForm;

  // customer master (loaded from the Unii API; lat/lng corrections layer on
  // top from a local IndexedDB override store — see customerOverrides.ts)
  customers: Customer[];
  customersLoading: boolean;
  customersError: string | null;
  customerOverrides: Record<string, LatLngOverride>;
  custQ: string;
  custModal: 'add' | 'edit' | null;
  custF: CustForm;

  // settings
  apiKey: string;
  apiTesting: boolean;
  apiOk: boolean;
  keySaved: boolean;
}

export const initialState: AppState = {
  route: 'dashboard',
  q: '',
  statusFilter: 'all',
  routeFilter: 'all',
  dateFilter: '2026-07-23',
  lanes: { A: [...initialLanes.A], B: [...initialLanes.B] },
  routeMobile: false,
  dragFrom: null,
  routeSel: 'A',
  picked: {},
  pickClosed: false,
  codDriver: 'สมชาย ป.',
  codMobile: false,
  cod: { 'OD-6004': '3380', 'OD-6009': '3900', 'OD-6006': '1980', 'OD-6007': '7450' },
  codClosed: {},
  promos: initialPromos,
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
  customers: initialCustomers,
  customersLoading: true,
  customersError: null,
  customerOverrides: {},
  custQ: '',
  custModal: null,
  custF: { id: '', name: '', addr: '', route: 'A', pay: 'cod', limit: '', balance: '', term: '', status: 'active', conds: '', lat: '', lng: '' },
  apiKey: '',
  apiTesting: false,
  apiOk: false,
  keySaved: false,
};

export type Action =
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'moveStop'; key: 'A' | 'B'; i: number; dir: number }
  | { type: 'dropStop'; key: 'A' | 'B'; to: number }
  | { type: 'doLookup' }
  | { type: 'createSkuFromGrn' }
  | { type: 'addGrnLine' }
  | { type: 'saveGrn' }
  | { type: 'openEditSku'; sku: Sku }
  | { type: 'saveSku' }
  | { type: 'openEditCust'; cust: Customer }
  | { type: 'saveCust' }
  | { type: 'addPromo' }
  | { type: 'setCustomerOverride'; id: string; lat: number; lng: number };

function nextSkuId(skus: Sku[]): string {
  const nums = skus.map((s) => parseInt(s.id.replace('SKU', ''), 10)).filter((n) => !isNaN(n));
  return 'SKU' + String(Math.max(0, ...nums) + 1).padStart(5, '0');
}

function nextCustId(customers: Customer[]): string {
  const nums = customers.map((c) => parseInt(c.id.replace('CUST-', ''), 10)).filter((n) => !isNaN(n));
  return 'CUST-' + String(Math.max(100, ...nums) + 1);
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };

    case 'moveStop': {
      const { key, i, dir } = action;
      const ids = [...state.lanes[key]];
      const j = i + dir;
      if (j < 0 || j >= ids.length) return state;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...state, lanes: { ...state.lanes, [key]: ids } };
    }

    case 'dropStop': {
      const { key, to } = action;
      const from = state.dragFrom;
      if (!from || from.key !== key) return { ...state, dragFrom: null };
      const ids = [...state.lanes[key]];
      const [m] = ids.splice(from.i, 1);
      ids.splice(to, 0, m);
      return { ...state, lanes: { ...state.lanes, [key]: ids }, dragFrom: null };
    }

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

    case 'openEditCust': {
      const ov = state.customerOverrides[action.cust.id];
      const lat = ov?.lat ?? action.cust.lat;
      const lng = ov?.lng ?? action.cust.lng;
      return {
        ...state,
        custModal: 'edit',
        custF: {
          id: action.cust.id,
          name: action.cust.name,
          addr: action.cust.addr,
          route: action.cust.route,
          pay: action.cust.pay,
          limit: String(action.cust.limit || ''),
          balance: String(action.cust.balance || ''),
          term: String(action.cust.term || ''),
          status: action.cust.status,
          conds: (action.cust.conds || []).join('\n'),
          lat: lat != null ? String(lat) : '',
          lng: lng != null ? String(lng) : '',
        },
      };
    }

    case 'saveCust': {
      const f = state.custF;
      if (!f.id || !f.name) return state;
      const existing = state.customers.find((x) => x.id === f.id);
      const rec: Customer = {
        id: f.id,
        name: f.name,
        addr: f.addr,
        route: f.route,
        pay: f.pay,
        limit: f.pay === 'credit' ? Number(f.limit || 0) : 0,
        balance: f.pay === 'credit' ? Number(f.balance || 0) : 0,
        term: f.pay === 'credit' ? Number(f.term || 0) : 0,
        status: f.status,
        conds: f.conds.split('\n').map((s) => s.trim()).filter(Boolean),
        // lat/lng always come from the API (or null for a manually-added
        // customer) — corrections live only in customerOverrides, never here.
        lat: existing?.lat ?? null,
        lng: existing?.lng ?? null,
      };
      const arr = [...state.customers];
      const idx = arr.findIndex((x) => x.id === rec.id);
      if (idx >= 0) arr[idx] = rec;
      else arr.push(rec);
      return { ...state, customers: arr, custModal: null };
    }

    case 'setCustomerOverride':
      return {
        ...state,
        customerOverrides: {
          ...state.customerOverrides,
          [action.id]: { lat: action.lat, lng: action.lng, updatedAt: new Date().toISOString() },
        },
      };

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
    fetchCustomersFromUnii()
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

  useEffect(() => {
    let cancelled = false;
    loadAllOverrides()
      .then((overrides) => {
        if (!cancelled) dispatch({ type: 'patch', patch: { customerOverrides: overrides } });
      })
      .catch(() => {
        /* no saved overrides yet, or IndexedDB unavailable — safe to ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const actions = useMemo(
    () => ({
      patch: (patch: Partial<AppState>) => dispatch({ type: 'patch', patch }),
      moveStop: (key: 'A' | 'B', i: number, dir: number) => dispatch({ type: 'moveStop', key, i, dir }),
      dropStop: (key: 'A' | 'B', to: number) => dispatch({ type: 'dropStop', key, to }),
      doLookup: () => dispatch({ type: 'doLookup' }),
      createSkuFromGrn: () => dispatch({ type: 'createSkuFromGrn' }),
      addGrnLine: () => dispatch({ type: 'addGrnLine' }),
      saveGrn: () => dispatch({ type: 'saveGrn' }),
      openEditSku: (sku: Sku) => dispatch({ type: 'openEditSku', sku }),
      saveSku: () => dispatch({ type: 'saveSku' }),
      openEditCust: (cust: Customer) => dispatch({ type: 'openEditCust', cust }),
      saveCust: () => dispatch({ type: 'saveCust' }),
      addPromo: () => dispatch({ type: 'addPromo' }),
      setCustomerOverride: (id: string, lat: number, lng: number) => {
        dispatch({ type: 'setCustomerOverride', id, lat, lng });
        void saveOverride(id, lat, lng);
      },
    }),
    [],
  );

  return { state, actions };
}

export type AppActions = ReturnType<typeof useAppStore>['actions'];

export function nextIds(skus: Sku[], customers: Customer[]) {
  return { nextSkuId: nextSkuId(skus), nextCustId: nextCustId(customers) };
}
