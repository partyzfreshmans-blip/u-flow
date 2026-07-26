import { useState } from 'react';
import { OrderDetailModal } from '../components/OrderDetailModal';
import { computeRoute } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

type OrderRow = ReturnType<typeof computeRoute>['rowsWithDate'][number];

const PAGE_SIZE = 30;

/** Native date-picker onChange isn't reliable enough to save-on-change (some
 * browsers fire it mid-entry, before all three segments are filled) — so
 * this keeps the picked value local until an explicit "บันทึก" click, the
 * same proven pattern as the suggestion's "ยืนยัน" button. */
function ManualDeliveryDateInput({ onSave }: { onSave: (iso: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input type="date" className="input" style={{ minHeight: 26, fontSize: 11, width: 130 }} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-ghost" style={{ fontSize: 10.5, padding: '2px 7px' }} disabled={!value} onClick={() => onSave(value)}>
        <i className="ph ph-check" />บันทึก
      </button>
    </div>
  );
}

function OrderTable({ title, tone, rows, isEmpty }: { title: string; tone: 'warn' | 'neutral'; rows: OrderRow[]; isEmpty: boolean }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = rows.slice(0, shown);
  return (
    <div className="card elev-sm" style={{ padding: '4px 14px 8px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 2px 8px', fontWeight: 600, fontSize: 13.5, color: tone === 'warn' ? 'var(--st-warn-fg)' : 'var(--color-neutral-200)' }}>
        {tone === 'warn' && <i className="ph ph-calendar-x" />}
        {title} ({rows.length})
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Route</th><th style={{ textAlign: 'center' }}>โซนที่ควรเป็น</th><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th style={{ textAlign: 'right' }}>ยอดขาย</th>
            <th style={{ textAlign: 'center' }}>รายการ</th><th>วันเวลาที่สั่ง</th><th style={{ minWidth: 168 }}>วันที่จะจัดส่ง</th><th>หมายเหตุ</th><th style={{ textAlign: 'center' }}>ใบกำกับภาษี</th><th style={{ textAlign: 'center' }}>โปรโมชั่น</th><th>สถานะ</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.orderNo}>
              <td><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}>{r.route}</span></td>
              <td style={{ textAlign: 'center' }} title={r.zoneReason}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.zoneColor, flex: 'none' }} />
                  {r.zoneName}
                </span>
                {r.zoneMismatch && (
                  <div style={{ fontSize: 10, color: 'var(--st-warn-fg)', marginTop: 2, whiteSpace: 'nowrap' }}>
                    <i className="ph ph-warning" style={{ marginRight: 3 }} />ไม่ตรงกับชีท
                  </div>
                )}
              </td>
              <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 500 }}>{r.orderNo}</td>
              <td>
                {r.customer}
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.address}</div>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.amtText}</td>
              <td style={{ textAlign: 'center' }}>{r.itemCountText}</td>
              <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.orderedAtText}</td>
              <td style={{ fontSize: 12 }}>
                {r.hasDeliveryDate ? (
                  <span style={{ color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.plannedDeliveryDate}</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
                    {r.confirmSuggestedDeliveryDate && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 11, color: 'var(--st-warn-fg)' }} title="แนะนำตามเวลาสั่ง: ก่อน 16:00 ส่งวันถัดไป, หลัง 16:00 ส่งอีก 2 วัน">
                          แนะนำ {r.suggestedDeliveryDateText}
                        </span>
                        <button className="btn btn-ghost" style={{ fontSize: 10.5, padding: '2px 7px' }} onClick={r.confirmSuggestedDeliveryDate}>
                          <i className="ph ph-check" />ยืนยัน
                        </button>
                      </div>
                    )}
                    <ManualDeliveryDateInput onSave={r.setDeliveryDate} />
                  </div>
                )}
              </td>
              <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.noteText}>
                {r.noteText || '—'}
              </td>
              <td style={{ textAlign: 'center' }}>
                {r.wantsTaxInvoice ? <i className="ph ph-check-circle-fill" style={{ color: 'var(--st-ok-fg)' }} title="ต้องการใบกำกับภาษี" /> : <span style={{ color: 'var(--color-neutral-600)' }}>—</span>}
              </td>
              <td style={{ textAlign: 'center' }}>
                {r.hasPromoItem ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: 'var(--color-accent-soft, rgba(255,138,0,.15))', color: 'var(--color-accent)', fontWeight: 500, whiteSpace: 'nowrap' }} title="มีสินค้าในออเดอร์นี้เข้าร่วมโปรโมชั่น">
                    <i className="ph ph-tag-fill" />มีโปรโมชั่น
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
                )}
              </td>
              <td><span style={r.stStyle}>{r.stLabel}</span></td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {r.saving && <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite', marginRight: 6, color: 'var(--color-neutral-400)' }} title="กำลังบันทึก..." />}
                {r.saved && <i className="ph ph-check-circle-fill" style={{ marginRight: 6, color: 'var(--st-ok-fg)' }} title="บันทึกสำเร็จ" />}
                {r.saveError && <i className="ph ph-warning-fill" style={{ marginRight: 6, color: 'var(--st-bad-fg)' }} title={`บันทึกไม่สำเร็จ: ${r.saveError}`} />}
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={r.edit}><i className="ph ph-pencil-simple" />แก้ไข</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={r.viewItems}>ดูสินค้า</button>
                {r.mapLink && (
                  <a className="btn btn-ghost" style={{ fontSize: 12 }} href={r.mapLink} target="_blank" rel="noreferrer" title="เปิดแผนที่">
                    <i className="ph ph-map-pin" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !isEmpty && (
        <div style={{ padding: 18, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12 }}>— ไม่มี —</div>
      )}
      {rows.length > shown && (
        <div style={{ padding: 14, textAlign: 'center' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setShown(shown + PAGE_SIZE)}>
            แสดงเพิ่ม (เหลืออีก {rows.length - shown})
          </button>
        </div>
      )}
    </div>
  );
}

export function OrderManagementPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeRoute(state, actions);
  // Reset each table's "show more" cap whenever a filter narrows/widens the
  // result set, by remounting via key — otherwise narrowing to a handful of
  // matches could still look capped at 30 from a previous broad search.
  const filterSignature = [state.routeFilterValue, state.routeStatusFilter, state.routeQ, state.routeOrderDateFilter, state.routeDeliveryDateFilter].join('|');

  return (
    <div>
      {v.routeOrdersLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดข้อมูลออเดอร์จาก Google Sheet...
        </div>
      )}
      {v.routeOrdersError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดข้อมูลออเดอร์ไม่สำเร็จ: {v.routeOrdersError}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 320 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาลูกค้า / เลขคำสั่งซื้อ" value={v.routeQ} onChange={(e) => v.onRouteSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.resultCount} รายการ</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-neutral-400)' }}>
          วันที่สั่ง
          <input type="date" className="input" style={{ minHeight: 32, width: 155 }} value={v.orderDateFilter} onChange={(e) => v.onOrderDateFilter(e.target.value)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-neutral-400)' }}>
          วันที่จะจัดส่ง
          <input type="date" className="input" style={{ minHeight: 32, width: 155 }} value={v.deliveryDateFilter} onChange={(e) => v.onDeliveryDateFilter(e.target.value)} />
        </label>
        {v.hasDateFilters && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.clearDateFilters}>
            <i className="ph ph-x" />ล้างตัวกรองวันที่
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginRight: 2 }}>โซน</span>
        {v.routeTabs.map((t) => <button key={t.key} style={t.style} onClick={t.go}>{t.label}</button>)}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginRight: 2 }}>สถานะ</span>
        {v.statusTabs.map((t) => <button key={t.key} style={t.style} onClick={t.go}>{t.label}</button>)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}><i className="ph ph-path" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />โซนจัดส่ง</span>
        {v.zoneLegend.map((z) => (
          <span key={z.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: z.color, flex: 'none' }} />
            {z.name} · {z.count}
          </span>
        ))}
        {v.unzonedCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-neutral-500)' }} title="ที่อยู่อยู่นอกโซนที่ตั้งไว้">
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: v.unassignedColor, flex: 'none' }} />
            นอกพื้นที่ · {v.unzonedCount}
          </span>
        )}
        {v.mismatchCount > 0 && (
          <span style={{ marginLeft: 'auto', color: 'var(--st-warn-fg)' }}>
            <i className="ph ph-warning" style={{ marginRight: 4 }} />ชีทระบุไม่ตรงกับโซน {v.mismatchCount} รายการ
          </span>
        )}
      </div>

      {!v.isEmpty && (
        <OrderTable key={`nodate-${filterSignature}`} title="ยังไม่ได้ใส่วันที่จัดส่ง" tone="warn" rows={v.rowsNoDate} isEmpty={v.isEmpty} />
      )}
      {!v.isEmpty && (
        <OrderTable key={`dated-${filterSignature}`} title="ใส่วันที่จัดส่งแล้ว" tone="neutral" rows={v.rowsWithDate} isEmpty={v.isEmpty} />
      )}
      {v.isEmpty && !v.routeOrdersLoading && (
        <div className="card elev-sm" style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบคำสั่งซื้อที่ตรงกับตัวกรอง</div>
      )}

      <OrderDetailModal state={state} actions={actions} />
    </div>
  );
}
