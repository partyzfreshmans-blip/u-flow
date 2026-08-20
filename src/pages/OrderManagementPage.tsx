import { useState } from 'react';
import { CopyButton } from '../components/CopyButton';
import { OrderDetailModal } from '../components/OrderDetailModal';
import { canEditOrder } from '../config/permissions';
import { addDays, dayKey } from '../data/dateUtils';
import { exportRouteOrdersXlsx } from '../data/sources/exportXlsx';
import type { Vehicle } from '../data/vehicles';
import { computeRoute } from '../state/derive';
import { DELIVERY_FAILED_STATUS, PICK_CLOSED_STATUS } from '../state/helpers';
import type { AppActions, AppState } from '../state/store';

type OrderRow = ReturnType<typeof computeRoute>['rowsWithDate'][number];

const PAGE_SIZE = 30;
/** Same allowlist as server/lib.ts's KNOWN_OPERATIONAL_STATUS_VALUES — the
 * bulk "เปลี่ยนสถานะ" dialog can only ever pick one of these three. */
const BULK_STATUS_OPTIONS = [PICK_CLOSED_STATUS, 'ส่งสำเร็จ', DELIVERY_FAILED_STATUS];
/** Above this many selected orders, every bulk-actions dialog requires an
 * extra explicit checkbox before its confirm button enables. */
const BULK_DOUBLE_CONFIRM_THRESHOLD = 200;

/** Shared second-confirmation gate for every bulk-actions dialog once the
 * selection is large — returns null (no gate needed) at/under the threshold. */
function BulkCountGate({ count, confirmed, onChange }: { count: number; confirmed: boolean; onChange: (v: boolean) => void }) {
  if (count <= BULK_DOUBLE_CONFIRM_THRESHOLD) return null;
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, padding: '9px 11px', borderRadius: 8, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 12.5, cursor: 'pointer' }}>
      <input type="checkbox" checked={confirmed} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2, flex: 'none' }} />
      <span>รายการนี้มีถึง {count.toLocaleString('en-US')} รายการ — ติ๊กเพื่อยืนยันว่าต้องการดำเนินการกับทุกรายการจริง</span>
    </label>
  );
}

/** Native date-picker onChange isn't reliable enough to save-on-change (some
 * browsers fire it mid-entry, before all three segments are filled) — so
 * this keeps the picked value local until an explicit "บันทึก" click.
 * Clicking the suggestion's "ยืนยัน" doesn't save straight away either — it
 * just fills this same box with the suggested date, so both paths always go
 * through the one visible field and the one save action.
 *
 * Save feedback renders right here, next to the field the user is actually
 * looking at — a failure (e.g. a duplicate order number blocking the write,
 * see handleUpdateRouteOrder's matches.length>1 guard) previously only
 * showed as a small icon in the far-right actions column, easy to miss when
 * the row doesn't visibly move to the "already scheduled" group and looks
 * like nothing happened. */
function DeliveryDateCell({
  suggestedIso,
  suggestedText,
  onSave,
  saving,
  saveError,
}: {
  suggestedIso: string | null;
  suggestedText: string | null;
  onSave: (iso: string) => void;
  saving: boolean;
  saveError: string | null;
}) {
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
        <button className="btn btn-ghost" style={{ fontSize: 10.5, padding: '2px 7px' }} disabled={!value || saving} onClick={() => onSave(value)}>
          {saving ? <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} /> : <i className="ph ph-check" />}
          บันทึก
        </button>
      </div>
      {saveError && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 11, color: 'var(--st-bad-fg)', maxWidth: 220 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none', marginTop: 1 }} />
          <span>บันทึกไม่สำเร็จ: {saveError}</span>
        </div>
      )}
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
  const [collapsed, setCollapsed] = useState(true);
  const visible = rows.slice(0, shown);
  // Header checkbox selects only the currently-shown (paginated) page — bulk
  // selection beyond that is the separate "เลือกทั้งหมด N รายการที่ตรงตัวกรอง"
  // link above the table, never implied by this checkbox.
  const visibleOrderNos = visible.map((r) => r.orderNo);
  const allSelected = visibleOrderNos.length > 0 && visibleOrderNos.every((no) => selectedOrderNos.includes(no));
  const toggleSelectAll = () => {
    if (allSelected) setSelection(selectedOrderNos.filter((no) => !visibleOrderNos.includes(no)));
    else setSelection(Array.from(new Set([...selectedOrderNos, ...visibleOrderNos])));
  };
  return (
    <div className="card elev-sm" style={{ padding: '4px 14px 8px', marginBottom: 18 }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '12px 2px 8px', border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5, color: tone === 'warn' ? 'var(--st-warn-fg)' : 'var(--color-neutral-200)' }}
      >
        <i className={collapsed ? 'ph ph-caret-right' : 'ph ph-caret-down'} />
        {tone === 'warn' && <i className="ph ph-calendar-x" />}
        {title} ({rows.length})
      </button>
      {!collapsed && (
      <>
      <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {canEdit && <th style={{ width: 26 }}><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} /></th>}
            <th>สายส่ง (Route)</th><th>อำเภอ, จังหวัด</th><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th>ชุดจัดส่ง (Batch Route)</th><th style={{ textAlign: 'right' }}>ยอดขาย</th>
            <th style={{ textAlign: 'center' }}>รายการ</th><th>วันเวลาที่สั่ง</th><th style={{ minWidth: 168 }}>วันที่จะจัดส่ง</th><th>หมายเหตุ</th><th style={{ textAlign: 'center' }}>ใบกำกับภาษี</th><th style={{ textAlign: 'center' }}>โปรโมชั่น</th><th style={{ textAlign: 'center' }}>ปัญหาการส่ง</th><th>สถานะ</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.orderNo}>
              {canEdit && <td><input type="checkbox" checked={r.selected} onChange={r.toggleSelect} /></td>}
              <td><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}>{r.route}</span></td>
              <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{r.districtProvince}</td>
              <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
                {r.orderNo}<CopyButton value={r.orderNo} label="เลขคำสั่งซื้อ" />
              </td>
              <td>
                {r.customer}<CopyButton value={r.customer} label="ชื่อลูกค้า" />
                {r.phone && <CopyButton value={r.phone} label="เบอร์โทร" />}
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
                  <DeliveryDateCell
                    suggestedIso={r.suggestedDeliveryDateIso}
                    suggestedText={r.suggestedDeliveryDateText}
                    onSave={r.setDeliveryDate}
                    saving={r.saving}
                    saveError={r.saveError}
                  />
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
              <td style={{ textAlign: 'center' }}>
                {r.deliveryFailure ? (
                  <a
                    href={r.deliveryFailure.photoLinks[0]?.webViewLink || undefined}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, padding: '2px 7px', borderRadius: 20,
                      background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontWeight: 500, whiteSpace: 'nowrap',
                      textDecoration: r.deliveryFailure.photoLinks[0]?.webViewLink ? 'underline' : 'none',
                      cursor: r.deliveryFailure.photoLinks[0]?.webViewLink ? 'pointer' : 'default',
                    }}
                    title={`${r.deliveryFailure.reason}${r.deliveryFailure.note ? ` · ${r.deliveryFailure.note}` : ''} · ${r.deliveryFailure.photoLinks.length} รูป`}
                    onClick={(e) => { if (!r.deliveryFailure!.photoLinks[0]?.webViewLink) e.preventDefault(); }}
                  >
                    <i className="ph ph-warning-fill" />{r.deliveryFailure.reason}
                    {r.deliveryFailure.photoLinks.length > 0 && ` · ${r.deliveryFailure.photoLinks.length} รูป`}
                  </a>
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
      </>
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

  const [pendingBatchDialogOpen, setPendingBatchDialogOpen] = useState(false);
  const [pendingBatchCollapsed, setPendingBatchCollapsed] = useState(true);
  const [stuckCollapsed, setStuckCollapsed] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const doExport = (selectedOnly: boolean) => {
    setExporting(true);
    setExportError(null);
    exportRouteOrdersXlsx(state.session, selectedOnly ? state.routeSelectedOrderNos : undefined)
      .catch((err: unknown) => setExportError(err instanceof Error ? err.message : 'ส่งออกไม่สำเร็จ'))
      .finally(() => setExporting(false));
  };

  // ---- bulk-actions toolbar dialogs — each dialog's own form fields are
  // local, ephemeral UI state (see the bulkDialog field's comment in
  // store.ts); only open/submitting/error/result is global. ----
  const [archiveDoubleConfirm, setArchiveDoubleConfirm] = useState(false);
  const [deliveryDateMode, setDeliveryDateMode] = useState<'suggested' | 'fixed'>('suggested');
  const [deliveryDateFixed, setDeliveryDateFixed] = useState('');
  const [deliveryDateDoubleConfirm, setDeliveryDateDoubleConfirm] = useState(false);
  const [assignVehicleId, setAssignVehicleId] = useState('');
  const [assignBatchId, setAssignBatchId] = useState('');
  const [assignDoubleConfirm, setAssignDoubleConfirm] = useState(false);
  const [statusValue, setStatusValue] = useState(BULK_STATUS_OPTIONS[0]);
  const [statusDoubleConfirm, setStatusDoubleConfirm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteMode, setNoteMode] = useState<'append' | 'overwrite'>('append');
  const [noteDoubleConfirm, setNoteDoubleConfirm] = useState(false);
  const [taxInvoiceValue, setTaxInvoiceValue] = useState(true);
  const [taxInvoiceDoubleConfirm, setTaxInvoiceDoubleConfirm] = useState(false);
  const [promotionValue, setPromotionValue] = useState(true);
  const [promotionDoubleConfirm, setPromotionDoubleConfirm] = useState(false);

  const openBulk = (kind: NonNullable<AppState['bulkDialog']>) => {
    // Reset every dialog's own gate/defaults on open, not just the one being
    // opened — cheap, and guarantees a stale double-confirm tick from a
    // previous run can never silently carry into the next dialog.
    setArchiveDoubleConfirm(false);
    setDeliveryDateMode('suggested');
    setDeliveryDateFixed('');
    setDeliveryDateDoubleConfirm(false);
    setAssignVehicleId('');
    setAssignBatchId('');
    setAssignDoubleConfirm(false);
    setStatusValue(BULK_STATUS_OPTIONS[0]);
    setStatusDoubleConfirm(false);
    setNoteText('');
    setNoteMode('append');
    setNoteDoubleConfirm(false);
    setTaxInvoiceValue(true);
    setTaxInvoiceDoubleConfirm(false);
    setPromotionValue(true);
    setPromotionDoubleConfirm(false);
    v.openBulkDialog(kind);
  };
  const needsDoubleConfirm = v.selectedCount > BULK_DOUBLE_CONFIRM_THRESHOLD;
  const selectedVehicle = state.vehicles.find((veh: Vehicle) => veh.id === assignVehicleId) ?? null;
  /** "Batch ทั้งหมดที่รอ" doesn't invent a new batch-creation path — it just
   * preselects every pending order into the Planner's existing multi-select
   * (plannerSelectedOrderNos) and drops the user there, where "จัดลงรถ" +
   * "ยืนยันรูท (Assign)" is the one real batch-creation flow already in the
   * app. A single click can't safely pick vehicles across orders that may
   * span many different delivery dates on its own. */
  const confirmBatchAllPending = () => {
    // Gate: orders with no delivery date are excluded from the preselection
    // — see pendingBatchReadyOrderNos in computeRoute — they stay listed in
    // "รอจัด Batch" with a warning badge instead, so staff sees them without
    // being able to sweep them into a batch by mistake.
    actions.setPlannerSelection(v.pendingBatchReadyOrderNos);
    // Pending orders can span many different delivery dates — clear the
    // Planner's own date filter too, so whichever ones are still selectable
    // (i.e. not already queued on some vehicle's routePlan) are visible
    // right away instead of silently hidden by today's default date filter.
    actions.patch({ route: 'planner', plannerDate: '' });
    setPendingBatchDialogOpen(false);
  };

  return (
    <div>
      {v.routeOrdersLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดข้อมูลออเดอร์จาก Unii API...
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

      {pendingBatchDialogOpen && (
        <div className="dialog-backdrop" onClick={() => setPendingBatchDialogOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">ยืนยันจัดชุดส่งทั้งหมดที่รอ</div>
            <div className="dialog-body">
              เลือกออเดอร์ที่รอ batch ทั้งหมด {v.pendingBatchReadyOrderNos.length} รายการไว้แล้ว แล้วพาไปหน้า "วางแผนจัดรูท" — จากนั้นเลือกรถจากดรอปดาวน์ "จัดลงรถ…" แล้วกด "ยืนยันรูท (Assign)" ตามขั้นตอนปกติเพื่อสร้าง Batch Route จริง (ออเดอร์ที่คนละวันจัดส่งกันต้อง Assign แยกรอบกัน เพราะหนึ่ง Batch ผูกกับวันที่จัดส่งเดียว)
              {v.pendingBatchNoDateCount > 0 && (
                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
                  <i className="ph ph-warning-fill" style={{ marginRight: 5 }} />
                  ข้าม {v.pendingBatchNoDateCount} ออเดอร์ที่ยังไม่มีวันที่จัดส่ง — ระบุวันที่จัดส่งในตารางก่อน แล้วค่อยจัด Batch ให้ทีหลัง
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setPendingBatchDialogOpen(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={confirmBatchAllPending} disabled={v.pendingBatchReadyOrderNos.length === 0}>
                ไปเลือกรถที่วางแผนจัดรูท
              </button>
            </div>
          </div>
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
        {canEdit && v.allFilteredCount > v.selectedCount && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => v.setSelection(v.allFilteredOrderNos)}>
            <i className="ph ph-checks" />เลือกทั้งหมด {v.allFilteredCount.toLocaleString('en-US')} รายการที่ตรงตัวกรอง
          </button>
        )}
        <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={exporting} onClick={() => doExport(false)}>
          <i className={exporting ? 'ph ph-circle-notch' : 'ph ph-file-xls'} style={exporting ? { animation: 'spin .8s linear infinite' } : undefined} />
          {exporting ? 'กำลังส่งออก...' : 'ส่งออกเป็น Excel'}
        </button>
      </div>
      {exportError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />Export ไม่สำเร็จ: {exportError}
        </div>
      )}

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
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 14px',
            marginBottom: 14,
            borderRadius: 10,
            background: 'var(--color-accent-900)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--color-accent-200)', marginRight: 2 }}>เลือกแล้ว {v.selectedCount} รายการ</span>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => openBulk('deliveryDate')}>
            <i className="ph ph-calendar-check" />ตั้งวันที่จัดส่ง
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => openBulk('assign')}>
            <i className="ph ph-truck" />จัดมอบหมายรถยกชุด
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => openBulk('status')}>
            <i className="ph ph-flag" />เปลี่ยนสถานะ
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => openBulk('note')}>
            <i className="ph ph-note-pencil" />ใส่หมายเหตุ
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => openBulk('taxInvoice')}>
            <i className="ph ph-receipt" />ใบกำกับภาษี
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => openBulk('promotion')}>
            <i className="ph ph-tag" />โปรโมชั่น
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={exporting} onClick={() => doExport(true)}>
            <i className={exporting ? 'ph ph-circle-notch' : 'ph ph-file-xls'} style={exporting ? { animation: 'spin .8s linear infinite' } : undefined} />
            ส่งออกเฉพาะที่เลือก
          </button>
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} onClick={() => { setArchiveDoubleConfirm(false); v.openArchiveDialog(); }}>
            <i className={v.archivedFilter ? 'ph ph-arrow-counter-clockwise' : 'ph ph-archive'} />
            {v.archivedFilter ? 'นำกลับมาใช้งาน' : 'จัดเก็บ (Archive)'}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.clearSelection}>
            <i className="ph ph-x" />ล้างที่เลือก
          </button>
        </div>
      )}

      {v.bulkResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 13, marginBottom: 14, borderRadius: 10, background: v.bulkResult.failed.length > 0 ? 'var(--st-bad-bg)' : 'var(--st-ok-bg)', color: v.bulkResult.failed.length > 0 ? 'var(--st-bad-fg)' : 'var(--st-ok-fg)', fontSize: 12.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <i className={v.bulkResult.failed.length > 0 ? 'ph ph-warning-fill' : 'ph ph-check-circle-fill'} />
            <span style={{ flex: 1 }}>
              {v.bulkResult.label}: สำเร็จ {v.bulkResult.succeeded.toLocaleString('en-US')}/{(v.bulkResult.succeeded + v.bulkResult.failed.length).toLocaleString('en-US')} รายการ
              {v.bulkResult.failed.length > 0 && ` — ล้มเหลว ${v.bulkResult.failed.length} รายการ`}
            </span>
            <button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={v.dismissBulkResult}>
              <i className="ph ph-x" />ปิด
            </button>
          </div>
          {v.bulkResult.failed.length > 0 && (
            <div style={{ fontSize: 11.5, opacity: 0.9 }}>
              {v.bulkResult.failed.map((f) => `${f.orderNo} (${f.reason})`).join(' · ')}
            </div>
          )}
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
            {v.pendingBatchCount > 0 && (
        <div className="card elev-sm" style={{ padding: '4px 14px 8px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 2px 8px', fontWeight: 600, fontSize: 13.5, color: 'var(--st-info-fg)', flexWrap: 'wrap' }}>
            <button
              onClick={() => setPendingBatchCollapsed(!pendingBatchCollapsed)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5, color: 'inherit' }}
            >
              <i className={pendingBatchCollapsed ? 'ph ph-caret-right' : 'ph ph-caret-down'} />
              <i className="ph ph-truck" />
              รอจัด Batch ({v.pendingBatchCount})
            </button>
            {canEdit && (
              <button className="btn btn-primary" style={{ marginLeft: 'auto', fontSize: 12.5 }} onClick={() => setPendingBatchDialogOpen(true)}>
                <i className="ph ph-package" />จัด Batch ทั้งหมดที่รอ
              </button>
            )}
          </div>
          {!pendingBatchCollapsed && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>สายส่ง (Route)</th><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th style={{ textAlign: 'right' }}>ยอดรวม</th>
                    <th style={{ textAlign: 'center' }}>รายการ</th><th>เวลาที่สั่ง</th><th>วันที่จะจัดส่ง</th><th>สถานะ</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {v.pendingBatchOrders.map((o) => (
                    <tr key={o.orderNo}>
                      <td><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}>{o.route}</span></td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {o.orderNo}<CopyButton value={o.orderNo} label="เลขคำสั่งซื้อ" />
                      </td>
                      <td>
                        {o.customer}<CopyButton value={o.customer} label="ชื่อลูกค้า" />
                        {o.phone && <CopyButton value={o.phone} label="เบอร์โทร" />}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.amtText}</td>
                      <td style={{ textAlign: 'center' }}>{o.itemCountText}</td>
                      <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{o.orderedAtText}</td>
                      <td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: o.noDeliveryDate ? 'var(--st-bad-fg)' : 'var(--color-neutral-300)' }}>{o.plannedDeliveryDate}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={o.stStyle}>{o.stLabel}</span>
                        {o.noDeliveryDate ? (
                          <span
                            style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)' }}
                            title="ระบุวันที่จะจัดส่งในตารางด้านล่างก่อน จึงจะจัดลงรถ/จัดล็อตได้"
                          >
                            <i className="ph ph-calendar-x" style={{ marginRight: 3 }} />ต้องระบุวันที่จัดส่งก่อน
                          </span>
                        ) : (
                          <span
                            style={{
                              marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 5,
                              background: o.batchReady ? 'var(--st-ok-bg)' : 'var(--st-warn-bg)',
                              color: o.batchReady ? 'var(--st-ok-fg)' : 'var(--st-warn-fg)',
                            }}
                          >
                            {o.batchReady ? 'พร้อม batch' : 'รอ batch'}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={o.viewItems}>ดูสินค้า</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
        <div className="card elev-sm" style={{ padding: '4px 14px 8px', marginBottom: 18 }}>
          <button
            onClick={() => setStuckCollapsed(!stuckCollapsed)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '12px 2px 8px', border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5, color: 'var(--st-warn-fg)' }}
          >
            <i className={stuckCollapsed ? 'ph ph-caret-right' : 'ph ph-caret-down'} />
            <i className="ph ph-calendar-x" />
            ออเดอร์ตกหล่น — เลยวันจัดส่งแล้วแต่ยังไม่สำเร็จ ({v.stuckCount})
          </button>
          {!stuckCollapsed && (
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {canEdit && <th style={{ width: 26 }}><input type="checkbox" checked={stuckAllSelected} onChange={toggleStuckSelectAll} /></th>}
                  <th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th>วันที่จะจัดส่ง</th><th style={{ textAlign: 'center' }}>ล่าช้า</th><th>สถานะ</th><th>หมายเหตุ</th><th></th>
                </tr>
              </thead>
              <tbody>
                {v.stuckOrders.map((o) => (
                  <tr key={o.orderNo}>
                    {canEdit && <td><input type="checkbox" checked={o.selected} onChange={o.toggleSelect} /></td>}
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                      {o.orderNo}<CopyButton value={o.orderNo} label="เลขคำสั่งซื้อ" />
                    </td>
                    <td>
                      {o.customer}<CopyButton value={o.customer} label="ชื่อลูกค้า" />
                      {o.phone && <CopyButton value={o.phone} label="เบอร์โทร" />}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{o.plannedDeliveryDate}</td>
                    <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--st-bad-fg)', fontWeight: 600 }}>{o.daysLate} วัน</td>
                    <td><span style={o.stStyle}>{o.stLabel}</span></td>
                    <td style={{ fontSize: 11.5, color: o.hasNote ? 'var(--color-neutral-200)' : 'var(--color-neutral-600)', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={o.hasNote ? o.note : undefined}>
                      {o.hasNote ? o.note : '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canEdit && (
                        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={o.viewItems} title="เพิ่ม/แก้ไขหมายเหตุ">
                          <i className="ph ph-note-pencil" />{o.hasNote ? 'แก้ไขโน๊ต' : 'เพิ่มโน๊ต'}
                        </button>
                      )}
                      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={o.viewItems}>ดูสินค้า</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
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
            <BulkCountGate count={v.selectedCount} confirmed={archiveDoubleConfirm} onChange={setArchiveDoubleConfirm} />
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeArchiveDialog} disabled={v.archiveSubmitting}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.confirmArchive} disabled={v.archiveSubmitting || (needsDoubleConfirm && !archiveDoubleConfirm)}>
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

      {v.bulkDialog === 'deliveryDate' && (() => {
        const tomorrow = dayKey(addDays(new Date(), 1));
        const plusTwo = dayKey(addDays(new Date(), 2));
        const suggestedCoverage = state.routeSelectedOrderNos.filter((no) => v.suggestedDateByOrderNo[no]).length;
        const dates: Record<string, string> = {};
        for (const no of state.routeSelectedOrderNos) {
          if (deliveryDateMode === 'suggested') {
            if (v.suggestedDateByOrderNo[no]) dates[no] = v.suggestedDateByOrderNo[no];
          } else if (deliveryDateFixed) {
            dates[no] = deliveryDateFixed;
          }
        }
        const canConfirm = deliveryDateMode === 'suggested' ? suggestedCoverage > 0 : !!deliveryDateFixed;
        return (
          <div className="dialog-backdrop" onClick={v.closeBulkDialog}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-title">ตั้งวันที่จัดส่ง — {v.selectedCount} รายการ</div>
              <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                  <input type="radio" checked={deliveryDateMode === 'suggested'} onChange={() => setDeliveryDateMode('suggested')} />
                  ใช้วันที่แนะนำของแต่ละแถว (ตามเวลาที่สั่ง — อาจได้วันต่างกัน)
                </label>
                {deliveryDateMode === 'suggested' && (
                  <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginLeft: 22 }}>
                    มีวันที่แนะนำให้ {suggestedCoverage}/{v.selectedCount} รายการ
                    {suggestedCoverage < v.selectedCount && ' (ส่วนที่เหลือไม่มีเวลาที่สั่งให้คำนวณ จะถูกข้าม)'}
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                  <input type="radio" checked={deliveryDateMode === 'fixed'} onChange={() => setDeliveryDateMode('fixed')} />
                  เลือกวันเดียวกันทั้งหมด
                </label>
                {deliveryDateMode === 'fixed' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginLeft: 22, flexWrap: 'wrap' }}>
                    <input type="date" className="input" style={{ minHeight: 32, width: 160 }} value={deliveryDateFixed} onChange={(e) => setDeliveryDateFixed(e.target.value)} />
                    <button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={() => setDeliveryDateFixed(tomorrow)}>พรุ่งนี้</button>
                    <button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={() => setDeliveryDateFixed(plusTwo)}>+2 วัน</button>
                  </div>
                )}
                {v.bulkError && <div style={{ color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{v.bulkError}</div>}
                <BulkCountGate count={v.selectedCount} confirmed={deliveryDateDoubleConfirm} onChange={setDeliveryDateDoubleConfirm} />
              </div>
              <div className="dialog-actions">
                <button className="btn btn-secondary" onClick={v.closeBulkDialog} disabled={v.bulkSubmitting}>ยกเลิก</button>
                <button
                  className="btn btn-primary"
                  disabled={v.bulkSubmitting || !canConfirm || (needsDoubleConfirm && !deliveryDateDoubleConfirm)}
                  onClick={() => v.runBulkSetDeliveryDate(state.routeSelectedOrderNos, dates)}
                >
                  {v.bulkSubmitting ? (<><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>) : 'ยืนยันตั้งวันที่'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {v.bulkDialog === 'assign' && (
        <div className="dialog-backdrop" onClick={v.closeBulkDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Assign ยกชุด — {v.selectedCount} รายการ</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
                Route (รถ)
                <select className="input" style={{ minHeight: 32, marginTop: 4 }} value={assignVehicleId} onChange={(e) => setAssignVehicleId(e.target.value)}>
                  <option value="">— เลือกรถ —</option>
                  {state.vehicles.map((veh: Vehicle) => (
                    <option key={veh.id} value={veh.id}>{veh.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
                BATCH ROUTE
                <input className="input" style={{ minHeight: 32, marginTop: 4 }} value={assignBatchId} onChange={(e) => setAssignBatchId(e.target.value)} placeholder="เช่น BATCH-01" />
              </label>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>คนส่งจะถูกกำหนดอัตโนมัติจากคนขับที่ผูกกับรถคันนี้ และ "วันที่ Assign" จะบันทึกเป็นเวลาปัจจุบัน</div>
              {v.bulkError && <div style={{ color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{v.bulkError}</div>}
              <BulkCountGate count={v.selectedCount} confirmed={assignDoubleConfirm} onChange={setAssignDoubleConfirm} />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeBulkDialog} disabled={v.bulkSubmitting}>ยกเลิก</button>
              <button
                className="btn btn-primary"
                disabled={v.bulkSubmitting || !selectedVehicle || !assignBatchId.trim() || (needsDoubleConfirm && !assignDoubleConfirm)}
                onClick={() => selectedVehicle && v.runBulkAssign(state.routeSelectedOrderNos, selectedVehicle.id, selectedVehicle.name, assignBatchId.trim())}
              >
                {v.bulkSubmitting ? (<><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>) : 'ยืนยัน Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {v.bulkDialog === 'status' && (
        <div className="dialog-backdrop" onClick={v.closeBulkDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">เปลี่ยนสถานะ — {v.selectedCount} รายการ</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <select className="input" style={{ minHeight: 32 }} value={statusValue} onChange={(e) => setStatusValue(e.target.value)}>
                {BULK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>บันทึกลงคอลัมน์ "ปัญหาการส่ง" ของทุกออเดอร์ที่เลือก</div>
              {v.bulkError && <div style={{ color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{v.bulkError}</div>}
              <BulkCountGate count={v.selectedCount} confirmed={statusDoubleConfirm} onChange={setStatusDoubleConfirm} />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeBulkDialog} disabled={v.bulkSubmitting}>ยกเลิก</button>
              <button
                className="btn btn-primary"
                disabled={v.bulkSubmitting || (needsDoubleConfirm && !statusDoubleConfirm)}
                onClick={() => v.runBulkSetStatus(state.routeSelectedOrderNos, statusValue)}
              >
                {v.bulkSubmitting ? (<><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>) : 'ยืนยันเปลี่ยนสถานะ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {v.bulkDialog === 'note' && (
        <div className="dialog-backdrop" onClick={v.closeBulkDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">ใส่หมายเหตุ — {v.selectedCount} รายการ</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea className="input" style={{ minHeight: 72, resize: 'vertical' }} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="ข้อความหมายเหตุ" />
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="radio" checked={noteMode === 'append'} onChange={() => setNoteMode('append')} />ต่อท้ายของเดิม
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="radio" checked={noteMode === 'overwrite'} onChange={() => setNoteMode('overwrite')} />เขียนทับ
                </label>
              </div>
              {v.bulkError && <div style={{ color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{v.bulkError}</div>}
              <BulkCountGate count={v.selectedCount} confirmed={noteDoubleConfirm} onChange={setNoteDoubleConfirm} />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeBulkDialog} disabled={v.bulkSubmitting}>ยกเลิก</button>
              <button
                className="btn btn-primary"
                disabled={v.bulkSubmitting || (noteMode === 'append' && !noteText.trim()) || (needsDoubleConfirm && !noteDoubleConfirm)}
                onClick={() => v.runBulkSetNote(state.routeSelectedOrderNos, noteText, noteMode)}
              >
                {v.bulkSubmitting ? (<><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>) : 'ยืนยันบันทึกหมายเหตุ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {v.bulkDialog === 'taxInvoice' && (
        <div className="dialog-backdrop" onClick={v.closeBulkDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">ใบกำกับภาษี — {v.selectedCount} รายการ</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="radio" checked={taxInvoiceValue} onChange={() => setTaxInvoiceValue(true)} />ต้องการ
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="radio" checked={!taxInvoiceValue} onChange={() => setTaxInvoiceValue(false)} />ไม่ต้องการ
                </label>
              </div>
              {v.bulkError && <div style={{ color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{v.bulkError}</div>}
              <BulkCountGate count={v.selectedCount} confirmed={taxInvoiceDoubleConfirm} onChange={setTaxInvoiceDoubleConfirm} />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeBulkDialog} disabled={v.bulkSubmitting}>ยกเลิก</button>
              <button
                className="btn btn-primary"
                disabled={v.bulkSubmitting || (needsDoubleConfirm && !taxInvoiceDoubleConfirm)}
                onClick={() => v.runBulkSetTaxInvoice(state.routeSelectedOrderNos, taxInvoiceValue)}
              >
                {v.bulkSubmitting ? (<><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>) : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {v.bulkDialog === 'promotion' && (
        <div className="dialog-backdrop" onClick={v.closeBulkDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">โปรโมชั่น — {v.selectedCount} รายการ</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="radio" checked={promotionValue} onChange={() => setPromotionValue(true)} />ใช่
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="radio" checked={!promotionValue} onChange={() => setPromotionValue(false)} />ไม่ใช่
                </label>
              </div>
              {v.bulkError && <div style={{ color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{v.bulkError}</div>}
              <BulkCountGate count={v.selectedCount} confirmed={promotionDoubleConfirm} onChange={setPromotionDoubleConfirm} />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeBulkDialog} disabled={v.bulkSubmitting}>ยกเลิก</button>
              <button
                className="btn btn-primary"
                disabled={v.bulkSubmitting || (needsDoubleConfirm && !promotionDoubleConfirm)}
                onClick={() => v.runBulkSetPromotion(state.routeSelectedOrderNos, promotionValue)}
              >
                {v.bulkSubmitting ? (<><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>) : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}

      <OrderDetailModal state={state} actions={actions} />
    </div>
  );
}
