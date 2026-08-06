/**
 * Tests.js — run from the "Unii Routes > รันชุดทดสอบ" menu.
 *
 * Covers the logic that is wrong-but-silent when it breaks: which rows count
 * as one stop, whether a point is in a polygon, and how a hand-typed date is
 * read. A wrong answer in any of these looks completely normal on screen.
 */

function runTests() {
  var results = [];

  function check(name, actual, expected) {
    var pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push((pass ? 'PASS  ' : 'FAIL  ') + name + (pass ? '' : '  (ได้ ' + JSON.stringify(actual) + ' ควรเป็น ' + JSON.stringify(expected) + ')'));
  }

  // ---- point in polygon ----
  var square = [[[98, 18], [99, 18], [99, 19], [98, 19], [98, 18]]];
  check('จุดกลางสี่เหลี่ยมอยู่ในโซน', pointInPolygon_(18.5, 98.5, square), true);
  check('จุดนอกสี่เหลี่ยมไม่อยู่ในโซน', pointInPolygon_(17.5, 98.5, square), false);
  check('จุดขวาของสี่เหลี่ยมไม่อยู่ในโซน', pointInPolygon_(18.5, 99.5, square), false);
  // A ray cast from a point level with a shared vertex must not double count.
  var vShape = [[[98, 18], [99, 19], [100, 18], [100, 20], [98, 20], [98, 18]]];
  check('ยิงรังสีผ่านมุมร่วมไม่นับซ้ำ', pointInPolygon_(19, 98.5, vShape), true);
  var withHole = [
    [[98, 18], [100, 18], [100, 20], [98, 20], [98, 18]],
    [[98.9, 18.9], [99.1, 18.9], [99.1, 19.1], [98.9, 19.1], [98.9, 18.9]],
  ];
  check('จุดในรูตรงกลางถือว่านอกโซน', pointInPolygon_(19, 99, withHole), false);
  check('จุดนอกรูแต่ในขอบถือว่าในโซน', pointInPolygon_(18.5, 99, withHole), true);

  // ---- distance ----
  var oneDegreeLat = Math.round(haversineMeters_(18, 99, 19, 99));
  check('1 องศาละติจูด ≈ 111 กม.', oneDegreeLat > 110000 && oneDegreeLat < 112000, true);
  check('ระยะจากจุดเดิมเป็นศูนย์', Math.round(haversineMeters_(18.5, 99, 18.5, 99)), 0);

  // ---- dates ----
  check('วันที่แบบ ISO', toDateKey_('2026-08-06', 'Asia/Bangkok', true), '2026-08-06');
  check('วันที่แบบอเมริกา 8/6/2026 = 6 ส.ค.', toDateKey_('8/6/2026', 'Asia/Bangkok', true), '2026-08-06');
  check('วันที่แบบไทย 8/6/2026 = 8 มิ.ย.', toDateKey_('8/6/2026', 'Asia/Bangkok', false), '2026-06-08');
  check('วันที่เดือนเกิน 12 สลับให้เอง', toDateKey_('25/12/2026', 'Asia/Bangkok', true), '2026-12-25');
  check('ปี พ.ศ. แปลงเป็น ค.ศ.', toDateKey_('6/8/2569', 'Asia/Bangkok', false), '2026-08-06');
  check('ช่องว่างได้ค่าว่าง', toDateKey_('', 'Asia/Bangkok', true), '');
  check('ข้อความมั่วได้ค่าว่าง', toDateKey_('ไม่ระบุ', 'Asia/Bangkok', true), '');
  var realDate = new Date(2026, 7, 6, 9, 30, 0); // 6 Aug 2026 09:30 local
  check('เซลล์ที่เป็นวันที่จริง', toDateKey_(realDate, Session.getScriptTimeZone(), true), '2026-08-06');

  // ---- phone / numbers ----
  check('เบอร์ 66 นำหน้า', phoneKey_('66 823848337'), '823848337');
  check('เบอร์มีขีด', phoneKey_('082-384-8337'), '823848337');
  check('เบอร์ขึ้นต้น 0', phoneKey_('0823848337'), '823848337');
  check('เบอร์ว่าง', phoneKey_(''), '');
  check('ปุ่มโทรคืนเบอร์ในประเทศ', phoneDial_('66 823848337'), '0823848337');
  check('ยอดเงินมีคอมมา', toNumber_('1,589.00'), 1589);
  check('พิกัดว่างเป็น null', toCoord_(''), null);
  check('พิกัดศูนย์เป็น null', toCoord_(0), null);
  check('พิกัดข้อความแปลงเป็นตัวเลข', toCoord_('18.49622027'), 18.49622027);

  // ---- polygon parsing ----
  check('อ่าน GeoJSON Polygon ได้', parsePolygonRings_(JSON.stringify({ type: 'Polygon', coordinates: square })).length, 1);
  check('อ่าน Feature ได้', parsePolygonRings_(JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: square } })).length, 1);
  check('อ่าน ring เปล่าๆ ได้', parsePolygonRings_(JSON.stringify(square[0])).length, 1);
  check('JSON พังคืน null', parsePolygonRings_('{not json'), null);
  check('จุดน้อยกว่า 3 คืน null', parsePolygonRings_(JSON.stringify([[[98, 18], [99, 18]]])), null);

  // ---- stop grouping ----
  var sameShop = groupIntoStops_([
    order_('UM-1', '66 823848337', 18.5, 99.0, 3, 500),
    order_('UM-2', '082-384-8337', 18.500004, 99.000004, 2, 300), // same shop, pin drifted
  ]);
  check('ร้านเดียวกันคนละออเดอร์รวมเป็นหมุดเดียว', sameShop.length, 1);
  check('หมุดรวมนับออเดอร์ถูก', sameShop[0].orderCount, 2);
  check('หมุดรวมนับรายการถูก', sameShop[0].itemCount, 5);
  check('หมุดรวมนับยอดเงินถูก', sameShop[0].amount, 800);

  var twoShops = groupIntoStops_([
    order_('UM-3', '0811111111', 18.5, 99.0, 1, 100),
    order_('UM-4', '0822222222', 18.5, 99.0, 1, 100), // same building, different shops
  ]);
  check('คนละร้านพิกัดเดียวกันไม่รวมกัน', twoShops.length, 2);

  var noPhone = groupIntoStops_([
    order_('UM-5', '', 18.5, 99.0, 1, 100),
    order_('UM-6', '', 18.5, 99.0, 1, 100),
  ]);
  check('ไม่มีเบอร์แต่พิกัดตรงกันรวมเป็นหมุดเดียว', noPhone.length, 1);

  var noCoord = groupIntoStops_([order_('UM-7', '', null, null, 1, 100)]);
  check('ไม่มีทั้งเบอร์และพิกัดยังเป็นหมุดของตัวเอง', noCoord.length, 1);
  check('หมุดไม่มีพิกัดติดธง no_coord', noCoord[0].flags, ['no_coord']);

  var outside = groupIntoStops_([order_('UM-8', '0833333333', 15.87, 100.99, 1, 100)]);
  check('พิกัดหลุดกรอบติดธง out_of_bounds', outside[0].flags, ['out_of_bounds']);

  // ---- claim roll-up ----
  check('ทุกออเดอร์ส่งแล้ว = จุดส่งแล้ว', rollUpState_(['done', 'done']), 'done');
  check('มีออเดอร์ล้มเหลว = จุดล้มเหลว', rollUpState_(['done', 'failed']), 'failed');
  check('ยังส่งไม่ครบ = จองอยู่', rollUpState_(['done', 'claimed']), 'claimed');

  var failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  var summary = (failed ? failed + ' ข้อไม่ผ่าน' : 'ผ่านทั้งหมด') + ' (' + results.length + ' ข้อ)';
  return { summary: summary, failed: failed, lines: results };
}

/** Minimal order shaped exactly like computeDay_ builds them. */
function order_(orderNo, phone, lat, lng, itemCount, amount) {
  return {
    orderNo: orderNo,
    customer: 'ร้านทดสอบ',
    phone: phoneKey_(phone),
    phoneDial: phoneDial_(phone),
    itemCount: itemCount,
    amount: amount,
    payment: 'Cash On Delivery',
    status: 'กำลังดำเนินการ',
    autoRoute: '',
    subdistrict: '',
    address: '',
    lat: lat,
    lng: lng,
    sheetLat: lat,
    sheetLng: lng,
    coordSource: 'order',
    flags: [],
    sheetRow: 0,
  };
}

function showTestResults() {
  var result = runTests();
  var ui = safeUi_();
  if (ui) ui.alert('ชุดทดสอบ — ' + result.summary, result.lines.join('\n'), ui.ButtonSet.OK);
  Logger.log(result.lines.join('\n'));
  return result;
}
