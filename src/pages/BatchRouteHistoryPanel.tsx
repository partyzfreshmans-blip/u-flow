import { useState } from 'react';
import { exportBatchRouteHistoryXlsx } from '../data/sources/exportXlsx';
import { computeBatchRouteHistory } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function BatchRouteHistoryPanel({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeBatchRouteHistory(state, actions);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const confirmingRow = v.rows.find((b) => b.id === confirmCancelId) ?? null;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const doExport = () => {
    setExporting(true);
    setExportError(null);
    exportBatchRouteHistoryXlsx(state.session)
      .catch((err: unknown) => setExportError(err instanceof Error ? err.message : 'Export ไม่สำเร็จ'))
      .finally(() => setExporting(false));
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="ค้นหารหัส batch / วันที่ / ชื่อคนขับ-รถ"
            value={v.q}
            onChange={(e) => v.onSearch(e.target.value)}
          />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.rows.length}/{v.totalCount} batch</div>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={exporting} onClick={doExport}>
          <i className={exporting ? 'ph ph-circle-notch' : 'ph ph-file-xls'} style={exporting ? { animation: 'spin .8s linear infinite' } : undefined} />
          {exporting ? 'กำลัง Export...' : 'Export เป็น Excel'}
        </button>
      </div>
      {exportError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />Export ไม่สำเร็จ: {exportError}
        </div>
      )}

      {v.isEmpty ? (
        <div className="card elev-sm" style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>
          {v.totalCount === 0 ? 'ยังไม่เคยยืนยันรูท (Assign) เลย' : 'ไม่พบ batch ที่ตรงกับคำค้นหา'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {v.rows.map((b) => {
            const open = openId === b.id;
            return (
              <div key={b.id} className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
                <button
                  onClick={() => setOpenId(open ? null : b.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '10px 2px', border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-body)', flexWrap: 'wrap' }}
                >
                  <span style={{ fontWeight: 700, fontSize: 14, fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent-200)' }}>{b.id}</span>
                  <span style={{ fontSize: 12.5 }}>{b.vehicleName}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{b.deliveryDateText}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{b.orderCount} ออเดอร์ · {b.totalText}</span>
                  {b.hasCodTransfer || Number(b.codCashExpectedText.replace(/[^0-9]/g, '')) > 0 ? (
                    <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
                      <i className="ph ph-money" style={{ marginRight: 3 }} />COD {b.codCashCollectedText}/{b.codCashExpectedText}
                    </span>
                  ) : null}
                  <span style={{ fontSize: 11.5, color: b.deliveredCount === b.orderCount ? 'var(--st-ok-fg)' : 'var(--color-neutral-400)' }}>ส่งแล้ว {b.deliveredText}</span>
                  {b.edited && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--st-info-bg)', color: 'var(--st-info-fg)' }}>แก้ไขแล้ว</span>}
                  <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: b.codClosed ? 'var(--st-ok-bg)' : 'var(--st-warn-bg)', color: b.codClosed ? 'var(--st-ok-fg)' : 'var(--st-warn-fg)' }}>
                    <i className={b.codClosed ? 'ph ph-check-circle-fill' : 'ph ph-circle-dashed'} style={{ marginRight: 3 }} />
                    {b.codClosed ? 'ปิดยอด COD แล้ว' : 'ยังไม่ปิดยอด COD'}
                  </span>
                  {b.codEditedAfterClose && (
                    <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)' }} title="แก้ไข batch หลังปิดยอดแล้ว — ยอด COD อาจไม่ตรง ต้องตรวจสอบใหม่">
                      ยอด COD อาจไม่ตรง
                    </span>
                  )}
                  {b.missingCount > 0 && (
                    <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)' }} title="ออเดอร์บางรายการไม่พบในชีทปัจจุบันแล้ว">
                      ไม่พบ {b.missingCount} ออเดอร์
                    </span>
                  )}
                  {b.cancelled && (
                    <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)' }} title={`ยกเลิกโดย ${b.cancelledBy || '—'} · ${b.cancelledAtText}`}>
                      <i className="ph ph-x-circle" style={{ marginRight: 3 }} />ยกเลิกแล้ว
                    </span>
                  )}
                  <i className={open ? 'ph ph-caret-up' : 'ph ph-caret-down'} style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)' }} />
                </button>

                {b.canCancelRole && !b.cancelled && (
                  <div style={{ padding: '0 2px 8px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11.5, color: 'var(--st-bad-fg)' }}
                      disabled={!b.canCancel}
                      title={b.canCancel ? '' : b.cancelBlockedReason}
                      onClick={() => setConfirmCancelId(b.id)}
                    >
                      <i className="ph ph-x-circle" />ยกเลิก Batch Route
                    </button>
                  </div>
                )}

                {open && (
                  <div style={{ padding: '4px 2px 12px' }}>
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-400)', marginBottom: 10 }}>
                      <span>สร้างโดย {b.createdBy || '—'} · {b.createdAtText}</span>
                      {b.edited && <span>แก้ไขล่าสุดโดย {b.updatedBy || '—'} · {b.updatedAtText}</span>}
                      {b.hasCodTransfer && <span>โอน {b.codTransferText}</span>}
                      {b.codClosed && <span>ปิดยอด COD โดย {b.codClosedBy || '—'} · {b.codClosedAtText}</span>}
                    </div>
                    <table className="table">
                      <thead>
                        <tr><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th style={{ textAlign: 'right' }}>ยอดเงิน</th><th>สถานะ</th></tr>
                      </thead>
                      <tbody>
                        {b.stops.map((s) => (
                          <tr key={s.orderNo}>
                            <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 500 }}>{s.orderNo}</td>
                            <td>{s.customer}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.amtText}</td>
                            <td><span style={s.stStyle}>{s.status || '—'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmingRow && (
        <div className="dialog-backdrop" onClick={() => setConfirmCancelId(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">ยกเลิก Batch Route {confirmingRow.id}?</div>
            <div className="dialog-body">
              ออเดอร์ {confirmingRow.cancelOrderCount} รายการในนี้จะถูกปลดออกจากรถ/batch นี้ กลับไปเป็น "ยังไม่ได้จัดลงรถ" ทันที
              — สามารถจัดเข้า batch ใหม่ได้ตามปกติ การกระทำนี้จะถูกบันทึกลง Activity Log
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmCancelId(null)}>ยกเลิก (ไม่ทำอะไร)</button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--st-bad-fg)' }}
                onClick={() => {
                  confirmingRow.cancel();
                  setConfirmCancelId(null);
                }}
              >
                ยืนยันยกเลิก Batch Route
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
