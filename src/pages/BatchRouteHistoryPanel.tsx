import { useState } from 'react';
import { computeBatchRouteHistory } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function BatchRouteHistoryPanel({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeBatchRouteHistory(state, actions);
  const [openId, setOpenId] = useState<string | null>(null);

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
      </div>

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
                  {b.missingCount > 0 && (
                    <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)' }} title="ออเดอร์บางรายการไม่พบในชีทปัจจุบันแล้ว">
                      ไม่พบ {b.missingCount} ออเดอร์
                    </span>
                  )}
                  <i className={open ? 'ph ph-caret-up' : 'ph ph-caret-down'} style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)' }} />
                </button>

                {open && (
                  <div style={{ padding: '4px 2px 12px' }}>
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-400)', marginBottom: 10 }}>
                      <span>สร้างโดย {b.createdBy || '—'} · {b.createdAtText}</span>
                      {b.edited && <span>แก้ไขล่าสุดโดย {b.updatedBy || '—'} · {b.updatedAtText}</span>}
                      {b.hasCodTransfer && <span>โอน {b.codTransferText}</span>}
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
    </div>
  );
}
