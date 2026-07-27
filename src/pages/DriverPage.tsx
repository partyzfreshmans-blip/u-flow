import { useState } from 'react';
import { canBookStop } from '../config/permissions';
import { computeDriverBooking, computePlanner } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

/** Mobile-first route sheet for drivers — full-screen, no admin chrome.
 * Reuses computePlanner's per-vehicle stop derivation directly so it can
 * never drift from what the desktop planner shows for the same vehicle. */
export function DriverPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePlanner(state, actions); // vehicles is already scoped to just this driver's own vehicle when role === 'driver'
  const veh = v.vehicles.find((x) => x.id === state.driverVehicleId) ?? null;
  const pendingSyncCount = state.driverSyncQueue.length;
  const isDriverRole = state.session?.role === 'driver';
  const canBook = state.session ? canBookStop(state.session.role) : false;
  const [tab, setTab] = useState<'route' | 'book'>('route');
  const booking = canBook ? computeDriverBooking(state, actions) : null;

  const connectionBanner = (!state.driverOnline || pendingSyncCount > 0) && (
    <div style={{ margin: '10px 12px 0', padding: '9px 12px', borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <i className="ph ph-wifi-slash" style={{ flex: 'none' }} />
      <span style={{ flex: 1 }}>
        {!state.driverOnline ? 'ออฟไลน์ — ' : ''}
        {pendingSyncCount > 0 ? `รอซิงค์ ${pendingSyncCount} รายการ (ซิงค์อัตโนมัติเมื่อมีเน็ต)` : 'กลับมาออนไลน์แล้ว'}
      </span>
      {state.driverOnline && pendingSyncCount > 0 && (
        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={actions.retrySyncQueue}>ลองซิงค์ตอนนี้</button>
      )}
    </div>
  );

  if (!veh) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 6px' }}>
          {!isDriverRole && (
            <button className="btn btn-icon btn-secondary" onClick={() => actions.patch({ route: 'dashboard' })} title="กลับหน้าแอดมิน">
              <i className="ph ph-arrow-left" />
            </button>
          )}
          <div style={{ fontWeight: 700, fontSize: 18, flex: 1 }}>เลือกคันรถ</div>
          {isDriverRole && (
            <button className="btn btn-icon btn-secondary" onClick={() => actions.logout()} title="ออกจากระบบ">
              <i className="ph ph-sign-out" />
            </button>
          )}
        </div>
        {connectionBanner}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
          {v.vehicles.map((x) => (
            <button
              key={x.id}
              onClick={() => actions.setDriverVehicle(x.id)}
              style={{ textAlign: 'left', padding: '16px 16px', minHeight: 64, borderRadius: 14, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'var(--font-body)' }}
            >
              <span style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16, flex: 'none' }}>{x.loadPrefix}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{x.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{x.stopCount} จุด · {x.totalText}</div>
              </div>
              <i className="ph ph-caret-right" style={{ fontSize: 20, color: 'var(--color-neutral-500)', flex: 'none' }} />
            </button>
          ))}
          {v.vehicles.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 13 }}>ยังไม่มีรถในระบบ — ตั้งค่าในหน้าวางแผนจัดรูทก่อน</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 40 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--color-surface)', boxShadow: 'inset 0 -1px 0 var(--color-divider)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!isDriverRole && (
            <button className="btn btn-icon btn-secondary" onClick={() => actions.setDriverVehicle(null)} title="เลือกคันอื่น">
              <i className="ph ph-arrow-left" />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{veh.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{veh.stopCount} จุด · {veh.totalText}</div>
          </div>
          {!isDriverRole && (
            <button className="btn btn-icon btn-secondary" onClick={() => actions.patch({ route: 'dashboard' })} title="กลับหน้าแอดมิน">
              <i className="ph ph-x" />
            </button>
          )}
          {isDriverRole && (
            <button className="btn btn-icon btn-secondary" onClick={() => actions.logout()} title="ออกจากระบบ">
              <i className="ph ph-sign-out" />
            </button>
          )}
        </div>
        {veh.codCount > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--color-bg)', fontSize: 12.5, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span><i className="ph ph-money" style={{ marginRight: 5, color: 'var(--color-accent-300)' }} />COD ต้องเก็บ {veh.codCashExpectedText}</span>
            <span>เก็บแล้ว {veh.codCashCollectedText}</span>
            <span style={veh.codDiffStyle}>{veh.codDiffText}</span>
          </div>
        )}
        {canBook && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button
              className={tab === 'route' ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ flex: 1, minHeight: 38, justifyContent: 'center', fontSize: 13 }}
              onClick={() => setTab('route')}
            >
              เส้นทางของฉัน
            </button>
            <button
              className={tab === 'book' ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ flex: 1, minHeight: 38, justifyContent: 'center', fontSize: 13 }}
              onClick={() => setTab('book')}
            >
              <i className="ph ph-hand-tap" />จองคิวจุดส่ง{booking && booking.selectedCount > 0 ? ` (${booking.selectedCount})` : ''}
            </button>
          </div>
        )}
      </div>

      {connectionBanner}

      {tab === 'book' && booking ? (
        <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            เลือกจุดส่งที่ยังไม่มีใครจอง แล้วกด "จองคิว" — ผู้ดูแลระบบจะเห็นคำขอและยืนยัน/ปฏิเสธในหน้าวางแผนจัดรูท
          </div>
          {booking.error && (
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{booking.error}</div>
          )}
          {booking.submitError && (
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{booking.submitError}</div>
          )}
          {booking.conflictOrderNos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 12.5 }}>
              <i className="ph ph-warning-fill" style={{ flex: 'none', marginTop: 1 }} />
              <span style={{ flex: 1 }}>จุดนี้เพิ่งถูกจองไปแล้วก่อนคุณ: {booking.conflictOrderNos.join(', ')} — เลือกจุดอื่นแทน</span>
              <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={booking.clearConflicts}>ปิด</button>
            </div>
          )}
          {booking.loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-neutral-500)', fontSize: 13 }}>กำลังโหลด...</div>}
          {!booking.loading && booking.isEmpty && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-neutral-500)', fontSize: 13 }}>ไม่มีจุดส่งที่ยังไม่ได้จัดลงรถ</div>
          )}
          {booking.rows.map((r) => (
            <label
              key={r.orderNo}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14,
                background: r.bookedByOther ? 'var(--color-bg)' : 'var(--color-surface)',
                boxShadow: 'var(--shadow-sm)',
                opacity: r.bookedByOther ? 0.6 : 1,
                cursor: r.bookedByOther ? 'not-allowed' : 'pointer',
              }}
            >
              <input type="checkbox" style={{ marginTop: 3 }} checked={r.selected} disabled={r.bookedByOther} onChange={r.toggleSelect} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{r.customer}</span>
                  {r.bookedByLabel && (
                    <span
                      style={{
                        fontSize: 10.5, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap',
                        background: r.bookedByMe ? 'var(--st-info-bg)' : 'var(--st-warn-bg)',
                        color: r.bookedByMe ? 'var(--st-info-fg)' : 'var(--st-warn-fg)',
                      }}
                    >
                      {r.bookedByLabel}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{r.address}</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginTop: 2 }}>{r.orderNo} · {r.distanceText} · {r.amtText}</div>
              </div>
            </label>
          ))}
          {booking.selectedCount > 0 && (
            <div style={{ position: 'sticky', bottom: 10, marginTop: 4 }}>
              <button className="btn btn-primary" style={{ width: '100%', minHeight: 46, justifyContent: 'center', fontSize: 14 }} onClick={booking.submit} disabled={booking.submitting}>
                {booking.submitting ? <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} /> : <i className="ph ph-hand-tap" />}
                จองคิว ({booking.selectedCount})
              </button>
            </div>
          )}
        </div>
      ) : (
      <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {veh.stops.length === 0 && (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-neutral-500)', fontSize: 13 }}>ยังไม่มีจุดส่งสำหรับรถคันนี้</div>
        )}
        {veh.stops.map((s) => {
          const pendingSync = state.driverSyncQueue.includes(s.orderNo);
          return (
            <div key={s.orderNo} style={{ padding: 14, borderRadius: 14, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', opacity: s.isDelivered ? 0.7 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', background: s.zoneColor, color: '#161826', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, flex: 'none' }}>{s.seq}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.customer}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{s.address}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginTop: 2 }}>{s.orderNo} · {s.distanceText}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.amtText}</div>
                  <span style={s.stStyle}>{s.status || '—'}</span>
                </div>
              </div>

              {s.isCod && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label className="seg-opt" style={{ fontSize: 12.5 }}>
                    <input type="radio" checked={s.codMethod === 'cash'} onChange={s.setCodCash} />เก็บสด
                  </label>
                  <label className="seg-opt" style={{ fontSize: 12.5 }}>
                    <input type="radio" checked={s.codMethod === 'transfer'} onChange={s.setCodTransfer} />โอนแล้ว
                  </label>
                  {s.codMethod === 'cash' && (
                    <input className="input" style={{ minHeight: 38, width: 120, fontSize: 13.5 }} inputMode="numeric" placeholder="เก็บได้เท่าไหร่" value={s.codCollected} onChange={(e) => s.onCodCollected(e.target.value)} />
                  )}
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                {s.googleMapsUrl && (
                  <a className="btn btn-secondary" style={{ flex: 1, minHeight: 44, justifyContent: 'center', fontSize: 13.5 }} href={s.googleMapsUrl} target="_blank" rel="noreferrer">
                    <i className="ph ph-navigation-arrow" />นำทาง
                  </a>
                )}
                <button
                  className={s.isDelivered ? 'btn btn-secondary' : 'btn btn-primary'}
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center', fontSize: 13.5 }}
                  onClick={s.markDelivered}
                  disabled={s.isDelivered}
                >
                  <i className={s.isDelivered ? 'ph ph-check-circle-fill' : 'ph ph-check-circle'} />
                  {s.isDelivered ? 'ส่งสำเร็จแล้ว' : 'ส่งสำเร็จ'}
                </button>
              </div>
              {pendingSync && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--st-warn-fg)' }}>
                  <i className="ph ph-clock-clockwise" style={{ marginRight: 4 }} />รอซิงค์กลับชีท
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
