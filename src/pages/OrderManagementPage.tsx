import { useState } from 'react';
import { OrderDetailModal } from '../components/OrderDetailModal';
import { canEditOrder } from '../config/permissions';
import { computeRoute } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

type OrderRow = ReturnType<typeof computeRoute>['rowsWithDate'][number];

const PAGE_SIZE = 30;

/** Native date-picker onChange isn't reliable enough to save-on-change (some
 * browsers fire it mid-entry, before all three segments are filled) — so
 * this keeps the picked value local until an explicit "บันทึก" click.
 * Clicking the suggestion's "ยืนยัน" doesn't save straight away either — it
 * just fills this same box with the suggested date, so both paths always go
 * through the one visible field and the one save action. */
function DeliveryDateCell({ suggestedIso, suggestedText, onSave }: { suggestedIso: string | null; suggestedText: string | null; onSave: (iso: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
      {suggestedIso && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 11, color: 'var(--st-warn-fg)' }} title="แนะนำตามเวลาสั่ง: ก่อน 16:00 ส่งวันถัดไป, หลัง 16:00 ส่งอีก 2 วัน">
            แนะนำ {suggestedText}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 10.5, padding: '2px 7px' }} onClick={() => setValue(suggestedIso)}>
            <i className="ph ph-check" />ยืนยัน
          </button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="date" className="input" style={{ minHeight: 26, fontSize: 11, width: 130 }} value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn btn-ghost" style={{ fontSize: 10.5, padding: '2px 7px' }} disabled={!value} onClick={() => onSave(value)}>
          <i className="ph ph-check" />บันทึก
        </button>
      </div>
    </div>
  );
}

function OrderTable({
  title,
  tone,
  rows,
  isEmpty,
  canEdit,
  selectedOrderNos,
  setSelection,
}: {
  title: string;
  tone: 'warn' | 'neutral';
  rows: OrderRow[];
  isEmpty: boolean;
  canEdit: boolean;
  selectedOrderNos: string[];
  setSelection: (orderNos: string[]) => void;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = rows.slice(0, shown);
  const allOrderNos = rows.map((r) => r.orderNo);
  const allSelected = allOrderNos.length > 0 && allOrderNos.every((no) => selectedOrderNos.includes(no));
  const toggleSelectAll = () => {
    if (allSelected) setSelection(selectedOrderNos.filter((no) => !allOrderNos.includes(no)));
    else setSelection(Array.from(new Set([...selectedOrderNos, ...allOrderNos])));
  };
  return (
    <div className="card elev-sm" style={{ padding: '4px 14px 8px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 2px 8px', fontWeight: 600, fontSize: 13.5, color: tone === 'warn' ? 'var(--st-warn-fg)' : 'var(--color-neutral-200)' }}>
        {tone === 'warn' && <i className="ph ph-calendar-x" />}
        {title} ({rows.length})
      </div>
      <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {canEdit && <th style={{ width: 26 }}><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} /></th>}
            <th>Route</th><th>อำเภอ, จังหวัด</th><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th>Batch Route</th><th style={{ textAlign: 'right' }}>ยอดขาย</th>
            <th style={{ textAlign: 'center' }}>รายการ</th><th>วันเวลาที่สั่ง</th><th style={{ minWidth: 168 }}>วันที่จะจัดส่ง</th><th>หมายเหตุ</th><th style={{ textAlign: 'center' }}>ใบกำกับภาษี</th><th style={{ textAlign: 'center' }}>โปรโมชั่น</th><th>สถานะ</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.orderNo}>
              {canEdit && <td><input type="checkbox" checked={r.selected} onChange={r.toggleSelect} /></td>}
              <td><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}>{r.route}</span></td>
              <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{r.districtProvince}</td>
              <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 500 }}>{r.orderNo}</td>
              <td>
                {r.customer}
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.address}</div>
              </td>
              <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                {r.batchId ? (
                  <span
                    style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, padding: '3px 8px', borderRadius: 6, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}
                    title={`Assign เมื่อ ${r.batchAssignedAtText}`}
                  >
                    <span style={{ fontWeight: 600 }}><i className="ph ph-truck" style={{ marginRight: 4 }} />{r.batchVehicleName}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-neutral-500)', fontFamily: 'ui-monospace, monospace' }}>{r.batchId}</span>
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
                )}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.amtText}</td>
              <td style={{ textAlign: 'center' }}>{r.itemCountText}</td>
              <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.orderedAtText}</td>
              <td style={{ fontSize: 12 }}>
                {r.hasDeliveryDate || !canEdit ? (
                  <span style={{ color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.plannedDeliveryDate || '—'}</span>
                ) : (
                  <DeliveryDateCell suggestedIso={r.suggestedDeliveryDateIso} suggestedText={r.suggestedDeliveryDateText} onSave={r.setDeliveryDate} />
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
                {canEdit && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={r.edit}><i className="ph ph-pencil-simple" />แก้ไข</button>}
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
      </div>
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
  const canEdit = state.session ? canEditOrder(state.session.role) : false;
  // Reset each table's "show more" cap whenever a filter narrows/widens the
  // result set, by remounting via key — otherwise narrowing to a handful of
  // matches could still look capped at 30 from a previous broad search.
  const filterSignature = [
    state.routeFilterValue,
    state.routeStatusFilter,
    state.routeQ,
    state.routeOrderDateFilter,
    state.routeDeliveryDateFilter,
    state.routeArchivedFilter,
  ].join('|');

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
      {v.geocodeProgress && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />
          กำลังระบุพื้นที่จากพิกัด ({v.geocodeProgress.done.toLocaleString('en-US')}/{v.geocodeProgress.total.toLocaleString('en-US')}) — ใช้ข้อมูลที่มีอยู่ก่อนได้ตามปกติ
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 320 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาลูกค้า / เลขคำสั่งซื้อ" value={v.routeQ} onChange={(e) => v.onRouteSearch(e.target.value)} />
        </div>
        {v.canArchive && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-neutral-400)', marginLeft: 'auto' }}>
            <input type="checkbox" checked={v.archivedFilter} onChange={v.toggleArchivedFilter} />
            แสดงออเดอร์ที่จัดเก็บแล้ว{v.archivedCount > 0 ? ` (${v.archivedCount})` : ''}
          </label>
        )}
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginLeft: v.canArchive ? 0 : 'auto' }}>{v.resultCount} รายการ</div>
      </div>

      {v.archivedFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-archive" style={{ color: 'var(--color-accent-300)' }} />
          กำลังดูออเดอร์ที่จัดเก็บแล้ว — ออเดอร์เหล่านี้ถูกซ่อนจากตารางหลักและหน้าอื่นๆ (วางแผนจัดรูท / จัดล็อตหยิบสินค้า / แดชบอร์ด) แต่ข้อมูลยังอยู่ครบ เลือกแล้วกด "นำกลับมาใช้งาน" เพื่อย้ายกลับ
        </div>
      )}

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
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginRight: 2 }}>อำเภอ,จังหวัด</span>
        <select className="input" style={{ minHeight: 32, maxWidth: 320, fontSize: 12.5 }} value={v.districtProvinceFilter} onChange={(e) => v.onDistrictProvinceFilter(e.target.value)}>
          {v.districtProvinceOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginRight: 2 }}>สถานะ</span>
        {v.statusTabs.map((t) => <button key={t.key} style={t.style} onClick={t.go}>{t.label}</button>)}
      </div>

      {v.canArchive && v.selectedCount > 0 && (
        <div
          style={{
            position: 'sticky',
            top: 8,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            marginBottom: 14,
            borderRadius: 10,
            background: 'var(--color-accent-900)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--color-accent-200)' }}>เลือกแล้ว {v.selectedCount} รายการ</span>
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={v.openArchiveDialog}>
            <i className={v.archivedFilter ? 'ph ph-arrow-counter-clockwise' : 'ph ph-archive'} />
            {v.archivedFilter ? 'นำกลับมาใช้งาน' : 'จัดเก็บ (Archive)'}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.clearSelection}>
            <i className="ph ph-x" />ล้างที่เลือก
          </button>
        </div>
      )}

      {!v.isEmpty && (
        <OrderTable
          key={`nodate-${filterSignature}`}
          title="ยังไม่ได้ใส่วันที่จัดส่ง"
          tone="warn"
          rows={v.rowsNoDate}
          isEmpty={v.isEmpty}
          canEdit={canEdit}
          selectedOrderNos={v.selectedOrderNos}
          setSelection={v.setSelection}
        />
      )}
      {!v.isEmpty && (
        <OrderTable
          key={`dated-${filterSignature}`}
          title="ใส่วันที่จัดส่งแล้ว"
          tone="neutral"
          rows={v.rowsWithDate}
          isEmpty={v.isEmpty}
          canEdit={canEdit}
          selectedOrderNos={v.selectedOrderNos}
          setSelection={v.setSelection}
        />
      )}

      {v.stuckCount > 0 && (() => {
        const stuckOrderNos = v.stuckOrders.map((o) => o.orderNo);
        const stuckAllSelected = stuckOrderNos.length > 0 && stuckOrderNos.every((no) => v.selectedOrderNos.includes(no));
        const toggleStuckSelectAll = () => {
          if (stuckAllSelected) v.setSelection(v.selectedOrderNos.filter((no) => !stuckOrderNos.includes(no)));
          else v.setSelection(Array.from(new Set([...v.selectedOrderNos, ...stuckOrderNos])));
        };
        return (
        <div className="card elev-sm" style={{ marginBottom: 18, gap: 10, boxShadow: 'inset 0 0 0 1px var(--st-bad-fg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ph ph-warning-fill" style={{ color: 'var(--st-bad-fg)', fontSize: 17 }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>ออเดอร์ตกหล่น — เลยวันจัดส่งแล้วแต่ยังไม่สำเร็จ ({v.stuckCount})</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                {canEdit && <th style={{ width: 26 }}><input type="checkbox" checked={stuckAllSelected} onChange={toggleStuckSelectAll} /></th>}
                <th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th>วันที่จะจัดส่ง</th><th style={{ textAlign: 'center' }}>ล่าช้า</th><th>สถานะ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {v.stuckOrders.map((o) => (
                <tr key={o.orderNo}>
                  {canEdit && <td><input type="checkbox" checked={o.selected} onChange={o.toggleSelect} /></td>}
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>{o.orderNo}</td>
                  <td>{o.customer}</td>
                  <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{o.plannedDeliveryDate}</td>
                  <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--st-bad-fg)', fontWeight: 600 }}>{o.daysLate} วัน</td>
                  <td><span style={o.stStyle}>{o.stLabel}</span></td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={o.viewItems}>ดูสินค้า</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}

      {v.isEmpty && !v.routeOrdersLoading && (
        <div className="card elev-sm" style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบคำสั่งซื้อที่ตรงกับตัวกรอง</div>
      )}

      {v.archiveDialogOpen && (
        <div className="dialog-backdrop" onClick={v.closeArchiveDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{v.archiveDialogMode === 'archive' ? 'ยืนยันจัดเก็บออเดอร์' : 'ยืนยันนำออเดอร์กลับมาใช้งาน'}</div>
            <div className="dialog-body">
              {v.archiveDialogMode === 'archive'
                ? `จัดเก็บ ${v.selectedCount} ออเดอร์ — ออเดอร์เหล่านี้จะไม่แสดงในตารางหลักของหน้านี้ และในหน้าวางแผนจัดรูท / จัดล็อตหยิบสินค้า / แดชบอร์ด (ข้อมูลจะไม่ถูกลบ ดูย้อนหลังและนำกลับมาใช้งานได้ทุกเมื่อ)`
                : `นำ ${v.selectedCount} ออเดอร์กลับมาใช้งานปกติ — ออเดอร์เหล่านี้จะกลับไปแสดงในตารางหลักและหน้าอื่นๆ อีกครั้ง`}
            </div>
            {v.archiveError && <div style={{ color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{v.archiveError}</div>}
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeArchiveDialog} disabled={v.archiveSubmitting}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.confirmArchive} disabled={v.archiveSubmitting}>
                {v.archiveSubmitting ? (
                  <>
                    <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...
                  </>
                ) : v.archiveDialogMode === 'archive' ? (
                  'ยืนยันจัดเก็บ'
                ) : (
                  'ยืนยันนำกลับมาใช้งาน'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <OrderDetailModal state={state} actions={actions} />
    </div>
  );
}
