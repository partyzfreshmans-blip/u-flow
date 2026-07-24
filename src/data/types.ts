export type OrderStatus = 'pending' | 'delivering' | 'delivered' | 'cleared';
export type SyncStatus = 'synced' | 'pending' | 'error';

export interface Order {
  id: string;
  cust: string;
  addr: string;
  route: 'A' | 'B';
  driver: string;
  status: OrderStatus;
  cod: boolean;
  amt: number;
  items: number;
  date: string;
  sync: SyncStatus;
}

export interface PickItem {
  sku: string;
  name: string;
  qty: number;
  unit: string;
  loc: string;
}

export interface PickBatch {
  id: string;
  meta: string;
  items: PickItem[];
}

export type PromoStatus = 'active' | 'upcoming' | 'expired';

export interface Promo {
  name: string;
  value: string;
  sku: string;
  skuName: string;
  type: string;
  period: string;
  st: PromoStatus;
}

export interface GrnLogEntry {
  supplier: string;
  doc: string;
  count: number;
  when: string;
  by: string;
}

export interface GrnLine {
  name: string;
  barcode: string;
  price: number;
  piece: number;
  pack: number;
  cs: number;
}

export type SkuStatus = 'active' | 'inactive';

export interface Sku {
  id: string;
  barcode: string;
  name: string;
  unit: string;
  stock: number;
  status: SkuStatus;
}

export type PayType = 'cod' | 'credit';
export type CustomerStatus = 'active' | 'hold';

export interface Customer {
  id: string;
  name: string;
  addr: string;
  route: 'A' | 'B';
  pay: PayType;
  limit: number;
  balance: number;
  term: number;
  status: CustomerStatus;
  conds: string[];
}

export type RouteKey = 'dashboard' | 'route' | 'pick' | 'cod' | 'promo' | 'grn' | 'sku' | 'customer' | 'settings';
