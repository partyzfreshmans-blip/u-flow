import { useState } from 'react';
import { computeRouteCalendar } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

/** Read-only month-view overview of delivery days — reuses the same
 * routeOrders/batchRoutes/routeCodMethod state the Planner page and Batch
 * Route History already read, so a day's numbers here can never drift from
 * what those pages show for the same orders. Month/selected-day are local
 * UI navigation state (same pattern as BatchRouteHistoryPanel's own
 * accordion-open state), not global app state. */
export function RouteCalendarPanel({ state, actions }: { state: AppState; actions: AppActions }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const v = computeRouteCalendar(state, year, month);
  const detail = selectedDayKey ? v.dayDetail(selectedDayKey) : null;

  const goPrevMonth = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  };
  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  };

  const openBatchInHistory = (batchId: string) => {
    setSelectedDayKey(null);
    actions.patch({ plannerTab: 'history', batchRouteQ: batchId });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button className="btn btn-icon btn-secondary" onClick={goPrevMonth} title="เดือนก่อนหน้า"><i className="ph ph-caret-left" /></button>
        <div style={{ fontWeight: 700, fontSize: 16, minWidth: 170, textAlign: 'center' }}>{v.monthLabel}</div>
        <button className="btn btn-icon btn-secondary" onClick={goNextMonth} title="เดือนถัดไป"><i className="ph ph-caret-right" /></button>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={goToday}>วันนี้</button>
      </div>

      <div className="card elev-sm" style={{ padding: 10, overflowX: 'auto' }}>
        <div style={{ minWidth: 700 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
            {v.weekdayHeaders.map((w) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--color-neutral-500)', fontWeight: 600, padding: '4px 0' }}>{w}</div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {v.weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                {week.map((d) => (
                  <button
                    key={d.dayKey}
                    onClick={() => d.hasData && setSelectedDayKey(d.dayKey)}
                    disabled={!d.hasData}
                    style={{
                      textAlign: 'left', padding: '7px 8px', minHeight: 86, borderRadius: 9,
                      border: 0, cursor: d.hasData ? 'pointer' : 'default', fontFamily: 'var(--font-body)',
                      background: d.isToday ? 'var(--color-accent-900)' : d.inMonth ? 'var(--color-bg)' : 'transparent',
                      boxShadow: d.isToday ? 'inset 0 0 0 1px var(--color-accent-700)' : d.hasData ? 'inset 0 0 0 1px var(--color-divider)' : 'none',
                      opacity: d.inMonth ? 1 : 0.35,
                      display: 'flex', flexDirection: 'column', gap: 3,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: d.isToday ? 700 : 500, color: d.isToday ? 'var(--color-accent-200)' : 'var(--color-neutral-300)' }}>{d.dayNum}</span>
                    {d.hasData && (
                      <>
                        <span style={{ fontSize: 10.5, color: 'var(--color-neutral-400)' }}>{d.orderCount} ออเดอร์ · {d.batchCount} batch</span>
                        <span style={{ fontSize: 10.5, color: 'var(--color-neutral-300)', fontVariantNumeric: 'tabular-nums' }}>{d.totalText}</span>
                        <span style={{ fontSize: 9.5, color: 'var(--color-neutral-500)' }}>สด {d.cashText} · โอน {d.transferText}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {detail && (
        <div className="dialog-backdrop" onClick={() => setSelectedDayKey(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 100%)' }}>
            <div className="dialog-title">{detail.dateText}</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-neutral-400)' }}>ออเดอร์ทั้งหมด</span><b>{detail.orderCount}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-neutral-400)' }}>ยอดขายรวม</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{detail.totalText}</b>
                </div>
                {detail.hasCod && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--color-neutral-500)' }}><i className="ph ph-money" style={{ marginRight: 4 }} />เงินสด (COD)</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{detail.cashText}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--color-neutral-500)' }}><i className="ph ph-bank" style={{ marginRight: 4 }} />โอน (COD)</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{detail.transferText}</span>
                    </div>
                  </>
                )}
                {detail.unassignedCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--st-warn-fg)' }}><i className="ph ph-warning" style={{ marginRight: 4 }} />ยังไม่จัดลงรถ</span>
                    <span style={{ color: 'var(--st-warn-fg)', fontWeight: 600 }}>{detail.unassignedCount} รายการ</span>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--color-neutral-400)' }}>Batch Route ({detail.batches.length})</div>
                {detail.batches.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>ยังไม่มี batch ที่ยืนยันสำหรับวันนี้</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {detail.batches.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => openBatchInHistory(b.id)}
                        title="ดูรายละเอียดเต็มที่หน้าประวัติ Batch Route"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: 0, cursor: 'pointer', textAlign: 'left', background: 'var(--color-bg)', fontFamily: 'var(--font-body)', flexWrap: 'wrap' }}
                      >
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700, color: 'var(--color-accent-200)' }}>{b.id}</span>
                        <span style={{ fontSize: 12 }}>{b.vehicleName}</span>
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{b.orderCount} ออเดอร์ · {b.totalText}</span>
                        {b.codClosed && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)' }}>ปิดยอด COD แล้ว</span>
                        )}
                        <i className="ph ph-arrow-square-out" style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedDayKey(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
