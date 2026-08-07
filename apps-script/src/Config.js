/**
 * Config.js — every constant the rest of the project reads.
 *
 * Nothing here is business logic; if a value can reasonably change without a
 * code change it lives in the _CONFIG tab instead (see cfg_() below) and this
 * file only holds its default.
 */

/**
 * Two spreadsheets, and the whole safety model rests on the split:
 *
 *   - This script is BOUND to its own file ("Unii Routes 584"), which holds
 *     every "_" tab it writes. SpreadsheetApp.getActive() is that file.
 *   - The warehouse ops file below is opened separately and only ever read.
 *     No write path in this project can address it — see SheetIO.js.
 *
 * Keeping them apart means the ops file gains no new tabs, no menu, and no
 * way for a bug here to touch the API-synced data or the ARRAYFORMULAs.
 */
var ORDERS_SHEET_ID = '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';

/** Source tab inside ORDERS_SHEET_ID — READ ONLY. Resolved by name first,
 * then by gid 0 if the name ever changes. */
var ORDERS_TAB_NAME = 'คำสั่งซื้อ';
var ORDERS_TAB_GID = 0;

/** Tabs this project owns. All start with "_" so they can never be confused
 * with an operational tab someone else maintains. */
var TAB = {
  assign: '_ASSIGN',
  drivers: '_DRIVERS',
  zones: '_ZONES',
  pinfix: '_PINFIX',
  config: '_CONFIG',
};

var HEADERS = {
  _ASSIGN: [
    'order_no', 'delivery_date', 'stop_key', 'driver_id', 'zone_id_locked', 'status',
    'claimed_at', 'done_at', 'gps_lat', 'gps_lng', 'gps_accuracy_m', 'distance_from_pin_m',
    'gps_flag', 'fail_reason', 'note', 'updated_at',
  ],
  _DRIVERS: ['driver_id', 'display_name', 'phone', 'zone_ids', 'color_hex', 'active', 'pin_code', 'created_at'],
  _ZONES: ['zone_id', 'zone_name', 'color_hex', 'priority', 'polygon_geojson', 'active', 'updated_at'],
  _PINFIX: ['phone', 'customer_name', 'lat_new', 'lng_new', 'lat_old', 'lng_old', 'method', 'fixed_by', 'fixed_at', 'active'],
  _CONFIG: ['key', 'value', 'description'],
};

/** Order statuses that mean "this stop no longer needs delivering". Anything
 * else (กำลังจัดส่ง, กำลังดำเนินการ, รอยืนยันออเดอร์, blank, …) still counts as
 * work — the rule is deliberately a denylist so a status nobody has seen yet
 * shows up as work to do rather than vanishing. */
var DONE_STATUSES = ['ยกเลิก', 'ส่งสำเร็จ', 'ได้รับแล้ว'];

var ZONE_UNASSIGNED = 'UNASSIGNED';
var UNASSIGNED_COLOR = '#9397ab';

/** Reasons a driver picks from when a delivery fails. Free text is never
 * required at the roadside — the list is what makes failures countable
 * later. "อื่นๆ" exists so nothing gets forced into a wrong bucket; the note
 * field carries the detail. */
var FAIL_REASONS = [
  'ร้านปิด',
  'ติดต่อลูกค้าไม่ได้',
  'ลูกค้าขอเลื่อนวันส่ง',
  'ลูกค้าปฏิเสธรับของ',
  'ที่อยู่/พิกัดผิด หาไม่เจอ',
  'ของไม่ครบ / ของเสียหาย',
  'ลูกค้าไม่มีเงินจ่าย',
  'อื่นๆ',
];

/** Marks a stop claimable by any driver regardless of zone ("ปล่อยข้ามโซน").
 * Written into the note column of an _ASSIGN row — the agreed schema has no
 * column of its own for it, and adding one would change a layout the manager
 * already signed off on. */
var CROSS_ZONE_ON = 'cross_zone';
var CROSS_ZONE_OFF = 'cross_zone_off';

/** Defaults seeded into _CONFIG on setup. Edit the values in the sheet, not
 * here — cfg_() always prefers the sheet. */
var CONFIG_DEFAULTS = [
  ['REFRESH_SECONDS', '20', 'คนขับ: รีเฟรชอัตโนมัติทุกกี่วินาที'],
  ['CACHE_SECONDS', '30', 'แคชผลลัพธ์ต่อวันที่กี่วินาที'],
  ['GPS_FAR_METERS', '300', 'ปิดงานห่างจากหมุดเกินกี่เมตรถึงติดธง far'],
  ['BOUNDS_LAT_MIN', '17.9', 'กรอบพิกัดที่ยอมรับ (ต่ำกว่านี้ = น่าสงสัย)'],
  ['BOUNDS_LAT_MAX', '19.3', 'กรอบพิกัดที่ยอมรับ'],
  ['BOUNDS_LNG_MIN', '98.4', 'กรอบพิกัดที่ยอมรับ'],
  ['BOUNDS_LNG_MAX', '99.6', 'กรอบพิกัดที่ยอมรับ'],
  ['WAREHOUSE_LAT', '18.5622345', 'พิกัดคลัง (ใช้เมื่อชีตไม่มี wh_lat/wh_long)'],
  ['WAREHOUSE_LNG', '99.0413487', 'พิกัดคลัง'],
  ['ADMIN_PIN_HASH', '', 'PIN แอดมิน (เก็บเป็นแฮช ตั้งจากเมนู Unii Routes)'],
  ['AUTH_SECRET', '', 'กุญแจเซ็น token — ห้ามแก้ด้วยมือ'],
  ['PIN_MAX_ATTEMPTS', '8', 'กรอก PIN ผิดกี่ครั้งถึงล็อกชั่วคราว'],
  ['PIN_LOCKOUT_MINUTES', '10', 'ล็อกนานกี่นาทีเมื่อกรอกผิดครบ'],
];

/** How long a login lasts. Drivers stay signed in across days (the whole
 * point of the PIN-in-localStorage design); admin sessions are short because
 * that PIN can edit zones and drivers. */
var TOKEN_TTL_DAYS_DRIVER = 30;
var TOKEN_TTL_HOURS_ADMIN = 12;

/**
 * Logical field -> how to find its column in the source tab.
 *
 * `names` is matched against the real header row first (exact match after
 * trimming, then case-insensitive). `fallbackCol` is the 1-based column from
 * the original spec, used ONLY when no header matches — so a renamed header
 * still works, and a column that moved is found by name rather than read from
 * the wrong place.
 *
 * Confirmed against the live sheet 2026-08-06: A=f, B=AutoR, C=วันที่จะจัดส่ง,
 * D=วันเวลาที่สั่ง, E=ชื่อลูกค้า, F=เลขคำสั่งซื้อ, G=สถานะการปริ๊น (NOT
 * จำนวนรายการ as the spec assumed — this is exactly why matching is by name),
 * H=ยอดขายรวม, I=การจ่ายเงิน, J=Status.
 */
var ORDER_FIELDS = {
  autoRoute: { names: ['AutoR'], fallbackCol: 2, required: false },
  deliveryDate: { names: ['วันที่จะจัดส่ง'], fallbackCol: 3, required: true },
  orderedAt: { names: ['วันเวลาที่สั่ง'], fallbackCol: 4, required: false },
  customer: { names: ['ชื่อลูกค้า'], fallbackCol: 5, required: true },
  orderNo: { names: ['เลขคำสั่งซื้อ'], fallbackCol: 6, required: true },
  itemCount: { names: ['จำนวนรายการ', 'จำนวนสินค้า'], fallbackCol: 0, required: false },
  totalAmount: { names: ['ยอดขายรวม', 'ยอดรวม'], fallbackCol: 8, required: true },
  payment: { names: ['การจ่ายเงิน'], fallbackCol: 9, required: false },
  status: { names: ['Status', 'สถานะ'], fallbackCol: 10, required: true },
  subdistrict: { names: ['ตำบล, อำเภอ', 'ตำบล อำเภอ', 'ตำบล,อำเภอ'], fallbackCol: 19, required: false },
  address: { names: ['ที่อยู่จาก Unii', 'ที่อยู่'], fallbackCol: 20, required: false },
  lat: { names: ['CS_Lat', 'cs_lat'], fallbackCol: 22, required: true },
  lng: { names: ['CS_Long', 'cs_long', 'CS_Lng'], fallbackCol: 23, required: true },
  phone: { names: ['Phone Number', 'เบอร์โทร', 'PhoneNumber'], fallbackCol: 24, required: true },
  whLat: { names: ['wh_lat'], fallbackCol: 26, required: false },
  whLng: { names: ['wh_long', 'wh_lng'], fallbackCol: 27, required: false },
};
