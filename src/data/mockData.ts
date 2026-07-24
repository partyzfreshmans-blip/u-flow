import type { Customer, GrnLogEntry, Order, PickBatch, Promo, Sku } from './types';

export const suppliers = [
  'บ.สหพัฒนพิบูล จำกัด',
  'บ.ทิพรสอุตสาหกรรม จำกัด',
  'บ.ไทยเพรซิเดนท์ฟูดส์',
  'บ.ยูนิลีเวอร์ไทย เทรดดิ้ง',
];

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

export const laneDriver: Record<'A' | 'B', string> = { A: 'สมชาย ป.', B: 'วิรัช ต.' };

export const initialLanes: Record<'A' | 'B', string[]> = {
  A: ['OD-6001', 'OD-6003', 'OD-6004', 'OD-6009'],
  B: ['OD-6005', 'OD-6008', 'OD-6006', 'OD-6007', 'OD-6010'],
};

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

export const promos: Promo[] = [
  { name: 'น้ำปลาทิพรส ลด 10%', value: 'ลด 10%', sku: 'SKU00123', skuName: 'น้ำปลาทิพรส 700ml', type: 'ลดราคา', period: '01–31 ก.ค. 2026', st: 'active' },
  { name: 'ปลากระป๋อง ซื้อ 12 แถม 1', value: 'ของแถม 1 กระป๋อง', sku: 'SKU00125', skuName: 'ปลากระป๋องสามแม่ครัว', type: 'ของแถม', period: '15 ก.ค.–15 ส.ค. 2026', st: 'active' },
  { name: 'มาม่าต้มยำ ล้างสต็อก', value: 'ลด 2฿/ซอง', sku: 'SKU00128', skuName: 'บะหมี่มาม่าต้มยำกุ้ง', type: 'ลดราคา', period: '20–28 ก.ค. 2026', st: 'active' },
  { name: 'น้ำมันพืช + ผงซักฟอก จับคู่', value: 'ซื้อคู่ ลด 25฿', sku: 'SKU00124', skuName: 'น้ำมันพืชองุ่น 1L', type: 'ซื้อพ่วง', period: '25 ก.ค.–10 ส.ค. 2026', st: 'upcoming' },
  { name: 'บรีสโปรเปิดเทอม', value: 'ของแถม กล่องสบู่', sku: 'SKU00126', skuName: 'ผงซักฟอกบรีส 800g', type: 'ของแถม', period: '01–10 ส.ค. 2026', st: 'upcoming' },
  { name: 'นมข้นตรามะลิ ลดพิเศษ', value: 'ลด 8฿/กระป๋อง', sku: 'SKU00127', skuName: 'นมข้นหวานตรามะลิ', type: 'ลดราคา', period: '01–20 ก.ค. 2026', st: 'expired' },
];

export const initialGrnLog: GrnLogEntry[] = [
  { supplier: 'บ.สหพัฒนพิบูล จำกัด', doc: 'SP-2207', count: 3, when: '22 ก.ค. 2026 09:14', by: 'admin.warehouse' },
  { supplier: 'บ.ทิพรสอุตสาหกรรม จำกัด', doc: 'TP-1180', count: 5, when: '21 ก.ค. 2026 16:40', by: 'somchai.k' },
];

export const initialSkus: Sku[] = [
  { id: 'SKU00123', barcode: '8850001112223', name: 'น้ำปลาทิพรส 700ml', unit: 'ขวด', stock: 480, status: 'active' },
  { id: 'SKU00124', barcode: '8850002223334', name: 'น้ำมันพืชองุ่น 1L', unit: 'ขวด', stock: 320, status: 'active' },
  { id: 'SKU00125', barcode: '8851002334445', name: 'ปลากระป๋องสามแม่ครัว', unit: 'กระป๋อง', stock: 1500, status: 'active' },
  { id: 'SKU00126', barcode: '8850003445556', name: 'ผงซักฟอกบรีส 800g', unit: 'ถุง', stock: 90, status: 'active' },
  { id: 'SKU00127', barcode: '8850004556667', name: 'นมข้นหวานตรามะลิ', unit: 'กระป๋อง', stock: 2100, status: 'active' },
  { id: 'SKU00128', barcode: '8858005667778', name: 'บะหมี่มาม่าต้มยำกุ้ง', unit: 'ซอง', stock: 60, status: 'inactive' },
];

export const initialCustomers: Customer[] = [
  { id: 'CUST-101', name: 'ร้านเจ๊แดง มินิมาร์ท', addr: 'ซ.ลาดพร้าว 71', route: 'A', pay: 'cod', limit: 0, balance: 0, term: 0, status: 'active', conds: ['ส่งก่อน 12:00', 'เก็บเงินสดเท่านั้น'] },
  { id: 'CUST-102', name: 'ร้านลุงสมชาย โชห่วย', addr: 'ถ.รามอินทรา กม.4', route: 'A', pay: 'credit', limit: 30000, balance: 12500, term: 15, status: 'active', conds: ['ราคาส่งระดับ B'] },
  { id: 'CUST-103', name: 'คุณนิด มินิมาร์ท', addr: 'ซ.นวมินทร์ 42', route: 'A', pay: 'credit', limit: 50000, balance: 47800, term: 30, status: 'active', conds: ['ใกล้เต็มวงเงิน — เฝ้าระวัง'] },
  { id: 'CUST-104', name: 'เซเว่นเดย์ บางกะปิ', addr: 'ถ.ลาดพร้าว 122', route: 'A', pay: 'credit', limit: 80000, balance: 21000, term: 30, status: 'active', conds: ['ออกใบกำกับภาษีเต็มรูป'] },
  { id: 'CUST-105', name: 'ร้านป้ามาลี ของชำ', addr: 'ถ.สุขาภิบาล 5', route: 'B', pay: 'cod', limit: 0, balance: 0, term: 0, status: 'active', conds: [] },
  { id: 'CUST-106', name: 'ร้านเฮียตง ค้าส่ง', addr: 'ตลาดไท คลอง 1', route: 'B', pay: 'credit', limit: 150000, balance: 152300, term: 45, status: 'hold', conds: ['เกินวงเงิน — ระงับออเดอร์ใหม่', 'ยอดค้างเกินกำหนดชำระ'] },
  { id: 'CUST-107', name: 'มินิบิ๊กโฮม', addr: 'ถ.เสรีไทย 57', route: 'B', pay: 'cod', limit: 0, balance: 0, term: 0, status: 'active', conds: ['ห้ามรับคืนสินค้าแช่เย็น'] },
  { id: 'CUST-108', name: 'ครัวคุณแม่', addr: 'ถ.รัชดา 32', route: 'B', pay: 'credit', limit: 20000, balance: 8000, term: 15, status: 'active', conds: ['ส่งเฉพาะวันจันทร์/พฤหัส'] },
];
