import type { Order, PickBatch } from './types';

// Everything below is still local/mock — COD clearing, batch picking, and
// GRN supplier list were out of scope for the Google Sheets migration and
// keep their illustrative data. SKU master, dashboard orders, route/delivery
// history, promotions, and customers now load from Google Sheets at runtime
// (see src/data/sources/*.ts and src/state/store.ts).

export const orders: Order[] = [
  { id: 'OD-6001', cust: 'ร้านเจ๊แดง มินิมาร์ท', addr: 'ซ.ลาดพร้าว 71', route: 'A', driver: 'สมชาย ป.', status: 'delivering', cod: true, amt: 4820, items: 12, date: '23 ก.ค.', sync: 'synced' },
  { id: 'OD-6002', cust: 'ร้านลุงสมชาย โชห่วย', addr: 'ถ.รามอินทรา กม.4', route: 'A', driver: 'สมชาย ป.', status: 'cleared', cod: true, amt: 2650, items: 8, date: '22 ก.ค.', sync: 'synced' },
  { id: 'OD-6003', cust: 'คุณนิด มินิมาร์ท', addr: 'ซ.นวมินทร์ 42', route: 'A', driver: 'สมชาย ป.', status: 'pending', cod: true, amt: 6120, items: 15, date: '23 ก.ค.', sync: 'pending' },
  { id: 'OD-6004', cust: 'เซเว่นเดย์ บางกะปิ', addr: 'ถ.ลาดพร้าว 122', route: 'A', driver: 'สมชาย ป.', status: 'delivered', cod: true, amt: 3380, items: 9, date: '23 ก.ค.', sync: 'synced' },
  { id: 'OD-6005', cust: 'ร้านป้ามาลี ของชำ', addr: 'ถ.สุขาภิบาล 5', route: 'B', driver: 'วิรัช ต.', status: 'delivering', cod: true, amt: 5290, items: 14, date: '23 ก.ค.', sync: 'synced' },
  { id: 'OD-6006', cust: 'ตี๋น้อยมาร์ท', addr: 'ซ.รามคำแหง 24', route: 'B', driver: 'วิรัช ต.', status: 'delivered', cod: true, amt: 1980, items: 6, date: '23 ก.ค.', sync: 'synced' },
  { id: 'OD-6007', cust: 'ร้านเฮียตง ค้าส่ง', addr: 'ตลาดไท คลอง 1', route: 'B', driver: 'วิรัช ต.', status: 'delivered', cod: true, amt: 7450, items: 20, date: '23 ก.ค.', sync: 'error' },
  { id: 'OD-6008', cust: 'มินิบิ๊กโฮม', addr: 'ถ.เสรีไทย 57', route: 'B', driver: 'วิรัช ต.', status: 'pending', cod: true, amt: 2240, items: 7, date: '23 ก.ค.', sync: 'pending' },
  { id: 'OD-6009', cust: 'ร้านสมหญิง ของชำ', addr: 'ซ.โพธิ์แก้ว 3', route: 'A', driver: 'สมชาย ป.', status: 'delivered', cod: true, amt: 3990, items: 11, date: '23 ก.ค.', sync: 'synced' },
  { id: 'OD-6010', cust: 'ครัวคุณแม่ (เครดิต)', addr: 'ถ.รัชดา 32', route: 'B', driver: 'วิรัช ต.', status: 'delivering', cod: false, amt: 0, items: 5, date: '23 ก.ค.', sync: 'synced' },
];

export const pickBatch: PickBatch = {
  id: 'PICK-2207',
  meta: 'รอบเช้า · Route A · รวม 3 ออเดอร์ (OD-6001, OD-6003, OD-6004)',
  items: [
    { sku: 'SKU00125', name: 'ปลากระป๋องสามแม่ครัว', qty: 4, unit: 'ลัง', loc: 'A1-02' },
    { sku: 'SKU00123', name: 'น้ำปลาทิพรส 700ml', qty: 6, unit: 'แพค', loc: 'A1-05' },
    { sku: 'SKU00127', name: 'นมข้นหวานตรามะลิ', qty: 3, unit: 'ลัง', loc: 'A2-01' },
    { sku: 'SKU00124', name: 'น้ำมันพืชองุ่น 1L', qty: 8, unit: 'แพค', loc: 'A2-04' },
    { sku: 'SKU00126', name: 'ผงซักฟอกบรีส 800g', qty: 24, unit: 'ถุง', loc: 'B1-01' },
    { sku: 'SKU00128', name: 'บะหมี่มาม่าต้มยำกุ้ง', qty: 5, unit: 'ลัง', loc: 'B1-06' },
  ],
};

