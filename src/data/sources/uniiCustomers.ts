import type { Customer } from '../types';

const API_TOKEN: string | undefined = import.meta.env.VITE_UNII_API_TOKEN;

// TODO: fill in once the customer-list endpoint URL is confirmed.
const CUSTOMERS_ENDPOINT: string | null = null;

export async function fetchCustomersFromUnii(): Promise<Customer[]> {
  if (!CUSTOMERS_ENDPOINT) {
    throw new Error('ยังไม่ได้ตั้งค่า endpoint สำหรับดึงรายชื่อลูกค้าจาก Unii (รอ URL จริง)');
  }
  if (!API_TOKEN) {
    throw new Error('ไม่พบ VITE_UNII_API_TOKEN — ตั้งค่าใน .env ก่อนใช้งาน');
  }

  const res = await fetch(CUSTOMERS_ENDPOINT, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`โหลดรายชื่อลูกค้าไม่สำเร็จ (HTTP ${res.status})`);
  }
  const json = await res.json();
  const rows = Array.isArray(json) ? json : (json.data ?? json.customers ?? json.items ?? []);
  return rows.map(mapUniiCustomer);
}

// Field mapping is provisional until a real sample response is confirmed.
function mapUniiCustomer(raw: Record<string, unknown>): Customer {
  const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    id: String(raw.id ?? raw.customerId ?? raw.code ?? ''),
    name: String(raw.name ?? raw.shopName ?? raw.customerName ?? ''),
    addr: String(raw.address ?? raw.addr ?? ''),
    route: (raw.route === 'B' ? 'B' : 'A'),
    pay: raw.paymentType === 'credit' || raw.pay === 'credit' ? 'credit' : 'cod',
    limit: Number(raw.creditLimit ?? raw.limit ?? 0),
    balance: Number(raw.creditBalance ?? raw.balance ?? 0),
    term: Number(raw.paymentTermDays ?? raw.term ?? 0),
    status: raw.status === 'hold' || raw.isHold ? 'hold' : 'active',
    conds: Array.isArray(raw.conditions) ? raw.conditions.map(String) : [],
    lat: num(raw.lat ?? raw.latitude),
    lng: num(raw.lng ?? raw.longitude),
  };
}
