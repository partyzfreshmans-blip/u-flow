import { useEffect, useState } from 'react';
import { canBookStop } from '../config/permissions';
import { addDays, dayKey } from '../data/dateUtils';
import { DELIVERY_FAILURE_REASONS } from '../data/deliveryFailures';
import {
  computeDriverBooking,
  computeDriverChecklist,
  computeDriverDayPicker,
  computeDriverRouteDetail,
  computeDriverVehicles,
} from '../state/derive';
import type { AppActions, AppState } from '../state/store';

/** Mobile route sheet for drivers — full-screen, no admin chrome, sized for
 * a thumb in direct sunlight rather than a mouse at a desk.
 *
 * Deliberately larger type and heavier weights than the admin pages, and
 * every primary control is at least MIN_TOUCH tall and sits in the lower
 * half of the screen where a one-handed thumb actually reaches. The three
 * outcome buttons live in a bottom sheet for the same reason.
 *
 * Flow: pick a vehicle (fixed for a real driver session, and remembered for
 * everyone else) -> pick a day (defaults to today) -> the day's stops.
 */

/** Apple/Google both put the minimum comfortable touch target at ~44px; the
 * primary outcome buttons go well past it since they're used while holding
 * boxes. */
const MIN_TOUCH = 44;
const BIG_TOUCH = 56;

const screenStyle = { minHeight: '100vh', background: 'var(--color-bg)' } as const;

export function DriverPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const vehicles = computeDriverVehicles(state);
  const vehicle = state.vehicles.find((x) => x.id === state.driverVehicleId) ?? null;
  const pendingSyncCount = state.driverSyncQueue.length + state.deliveryFailureSyncQueue.length;
  const isDriverRole = state.session?.role === 'driver';
  const canBook = state.session ? canBookStop(state.session.role) : false;
  const [tab, setTab] = useState<'route' | 'book'>('route');
  const booking = canBook ? computeDriverBooking(state, actions) : null;
  const selectedBatch = state.driverSelectedBatchId ? (state.batchRoutes.find((b) => b.id === state.driverSelectedBatchId) ?? null) : null;

  const connectionBanner = (!state.driverOnline || pendingSyncCount > 0) && (
    <div
      style={{
        margin: '10px 12px 0', padding: '12px 14px', borderRadius: 12, fontSize: 14, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: state.driverOnline ? 'var(--st-warn-bg)' : 'var(--st-bad-bg)',
        color: state.driverOnline ? 'var(--st-warn-fg)' : 'var(--st-bad-fg)',
      }}
    >
      <i className={state.driverOnline ? 'ph ph-cloud-arrow-up' : 'ph ph-wifi-slash'} style={{ flex: 'none', fontSize: 20 }} />
      <span style={{ flex: 1 }}>
        {!state.driverOnline && 'ออฟไลน์ — บันทึกไว้ในเครื่องแล้ว'}
        {!state.driverOnline && pendingSyncCount > 0 && ' · '}
        {pendingSyncCount > 0 ? `ยังไม่ส่งขึ้นระบบ ${pendingSyncCount} รายการ` : ''}
        {state.driverOnline && pendingSyncCount > 0 && ' (กำลังส่งอัตโนมัติ)'}
      </span>
      {state.driverOnline && pendingSyncCount > 0 && (
        <button
          className="btn btn-ghost"
          style={{ fontSize: 13, minHeight: MIN_TOUCH, color: 'inherit' }}
          onClick={() => {
            actions.retrySyncQueue();
            actions.retryDeliveryFailureQueue();
          }}
        >
          ส่งเลย
        </button>
      )}
    </div>
  );

  // ---- Screen 1: vehicle picker ----
  if (!vehicle) {
    return (
      <div style={screenStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px 6px' }}>
          {!isDriverRole && (
            <button className="btn btn-icon btn-secondary" style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }} onClick={() => actions.patch({ route: 'dashboard' })} title="กลับหน้าแอดมิน">
              <i className="ph ph-arrow-left" />
            </button>
          )}
          <div style={{ fontWeight: 800, fontSize: 22, flex: 1 }}>เลือกคันรถ</div>
          {isDriverRole && (
            <button className="btn btn-icon btn-secondary" style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }} onClick={() => actions.logout()} title="ออกจากระบบ">
              <i className="ph ph-sign-out" />
            </button>
          )}
        </div>
        {connectionBanner}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
          {vehicles.map((x) => (
            <button
              key={x.id}
              onClick={() => actions.setDriverVehicle(x.id)}
              style={{
                textAlign: 'left', padding: 16, minHeight: 76, borderRadius: 16, background: 'var(--color-surface)',
                boxShadow: 'var(--shadow-sm)', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
                fontFamily: 'var(--font-body)', color: 'var(--color-text)',
              }}
            >
              <span style={{ width: 50, height: 50, borderRadius: 12, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18, flex: 'none' }}>
                {x.loadPrefix}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{x.name}</div>
                {/* Counts come from assigned Batch Routes — the same source
                    the next screen opens — so this can no longer promise
                    stops that aren't there. */}
                <div style={{ fontSize: 14, color: 'var(--color-neutral-300)', marginTop: 2 }}>
                  {x.hasToday ? (
                    <>วันนี้ {x.todayStopCount} จุด · {x.todayTotalText}{x.remainingCount > 0 ? ` · เหลือ ${x.remainingCount}` : ' · ครบแล้ว'}</>
                  ) : x.hasAnyRoute ? (
                    <span style={{ color: 'var(--color-neutral-500)' }}>วันนี้ไม่มีรูท{x.nextDateText ? ` · มีรูท ${x.nextDateText}` : ''}</span>
                  ) : (
                    <span style={{ color: 'var(--color-neutral-500)' }}>ยังไม่มีรูทที่มอบหมาย</span>
                  )}
                </div>
              </div>
              <i className="ph ph-caret-right" style={{ fontSize: 24, color: 'var(--color-neutral-500)', flex: 'none' }} />
            </button>
          ))}
          {vehicles.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 15 }}>ยังไม่มีรถในระบบ — ตั้งค่าในหน้าวางแผนจัดรูทก่อน</div>
          )}
        </div>
      </div>
    );
  }

  const header = (
    <div style={{ position: 'sticky', top: 0, zIndex: 6, background: 'var(--color-surface)', boxShadow: 'inset 0 -1px 0 var(--color-divider)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="btn btn-icon btn-secondary"
          style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, ...(!selectedBatch && isDriverRole ? { visibility: 'hidden' as const } : {}) }}
          onClick={() => (selectedBatch ? actions.selectDriverBatch(null) : actions.setDriverVehicle(null))}
          title={selectedBatch ? 'เลือกวันที่อื่น' : 'เลือกคันอื่น'}
        >
          <i className="ph ph-arrow-left" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{vehicle.name}</div>
          <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{selectedBatch ? selectedBatch.id : 'เลือกวันที่จัดส่ง'}</div>
        </div>
        {!isDriverRole ? (
          <button className="btn btn-icon btn-secondary" style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }} onClick={() => actions.patch({ route: 'dashboard' })} title="กลับหน้าแอดมิน">
            <i className="ph ph-x" />
          </button>
        ) : (
          <button className="btn btn-icon btn-secondary" style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }} onClick={() => actions.logout()} title="ออกจากระบบ">
            <i className="ph ph-sign-out" />
          </button>
        )}
      </div>
      {canBook && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button className={tab === 'route' ? 'btn btn-primary' : 'btn btn-secondary'} style={{ flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', fontSize: 15 }} onClick={() => setTab('route')}>
            เส้นทางของฉัน
          </button>
          <button className={tab === 'book' ? 'btn btn-primary' : 'btn btn-secondary'} style={{ flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', fontSize: 15 }} onClick={() => setTab('book')}>
            <i className="ph ph-hand-tap" />จองคิว{booking && booking.selectedCount > 0 ? ` (${booking.selectedCount})` : ''}
          </button>
        </div>
      )}
    </div>
  );

  // ---- Booking tab (unchanged feature, reachable regardless of date) ----
  if (tab === 'book' && booking) {
    return (
      <div style={{ ...screenStyle, paddingBottom: 40 }}>
        {header}
        {connectionBanner}
        <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13.5, color: 'var(--color-neutral-400)' }}>
            เลือกจุดส่งที่ยังไม่มีใครจอง แล้วกด "จองคิว" — ผู้ดูแลระบบจะเห็นคำขอและยืนยัน/ปฏิเสธในหน้าวางแผนจัดรูท
          </div>
          {booking.error && <div style={{ padding: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13.5 }}>{booking.error}</div>}
          {booking.submitError && <div style={{ padding: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13.5 }}>{booking.submitError}</div>}
          {booking.conflictOrderNos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13.5 }}>
              <i className="ph ph-warning-fill" style={{ flex: 'none', marginTop: 1 }} />
              <span style={{ flex: 1 }}>จุดนี้เพิ่งถูกจองไปแล้วก่อนคุณ: {booking.conflictOrderNos.join(', ')} — เลือกจุดอื่นแทน</span>
              <button className="btn btn-ghost" style={{ fontSize: 13, minHeight: MIN_TOUCH }} onClick={booking.clearConflicts}>ปิด</button>
            </div>
          )}
          {booking.loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-neutral-500)', fontSize: 15 }}>กำลังโหลด...</div>}
          {!booking.loading && booking.isEmpty && <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-neutral-500)', fontSize: 15 }}>ไม่มีจุดส่งที่ยังไม่ได้จัดลงรถ</div>}
          {booking.rows.map((r) => (
            <label
              key={r.orderNo}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: 15, borderRadius: 14, minHeight: MIN_TOUCH,
                background: r.bookedByOther ? 'var(--color-bg)' : 'var(--color-surface)',
                boxShadow: 'var(--shadow-sm)', opacity: r.bookedByOther ? 0.6 : 1,
                cursor: r.bookedByOther ? 'not-allowed' : 'pointer',
              }}
            >
              <input type="checkbox" style={{ marginTop: 3, width: 22, height: 22 }} checked={r.selected} disabled={r.bookedByOther} onChange={r.toggleSelect} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{r.customer}</span>
                  {r.bookedByLabel && (
                    <span
                      style={{
                        fontSize: 11.5, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap',
                        background: r.bookedByMe ? 'var(--st-info-bg)' : 'var(--st-warn-bg)',
                        color: r.bookedByMe ? 'var(--st-info-fg)' : 'var(--st-warn-fg)',
                      }}
                    >
                      {r.bookedByLabel}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--color-neutral-400)' }}>{r.address}</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)', marginTop: 2 }}>{r.orderNo} · {r.distanceText} · {r.amtText}</div>
              </div>
            </label>
          ))}
          {booking.selectedCount > 0 && (
            <div style={{ position: 'sticky', bottom: 10, marginTop: 4 }}>
              <button className="btn btn-primary" style={{ width: '100%', minHeight: BIG_TOUCH, justifyContent: 'center', fontSize: 16, fontWeight: 700 }} onClick={booking.submit} disabled={booking.submitting}>
                {booking.submitting ? <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} /> : <i className="ph ph-hand-tap" />}
                จองคิว ({booking.selectedCount})
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Screen 2: which day ----
  if (!selectedBatch) {
    return <DayPicker state={state} actions={actions} vehicleId={vehicle.id} header={header} banner={connectionBanner} />;
  }

  // ---- Screen 3: the day's stops ----
  return <RouteDetail state={state} actions={actions} batchId={selectedBatch.id} header={header} banner={connectionBanner} />;
}

/** Date selection — defaults to today, so the common case is zero taps. */
function DayPicker({
  state, actions, vehicleId, header, banner,
}: { state: AppState; actions: AppActions; vehicleId: string; header: React.ReactNode; banner: React.ReactNode }) {
  const d = computeDriverDayPicker(state, actions, vehicleId);

  const shortcutStyle = (active: boolean, hasRoute: boolean) => ({
    flex: 1, minHeight: BIG_TOUCH, borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
    fontSize: 15, fontWeight: 700, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 2,
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : hasRoute ? 'var(--color-text)' : 'var(--color-neutral-500)',
    boxShadow: active ? 'var(--shadow-md)' : 'var(--shadow-sm)',
  });

  return (
    <div style={{ ...screenStyle, paddingBottom: 40 }}>
      {header}
      {banner}
      <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={shortcutStyle(d.yesterday.active, d.yesterday.hasRoute)} onClick={d.yesterday.go}>
            เมื่อวาน{d.yesterday.hasRoute && <span style={{ fontSize: 11, opacity: 0.75 }}>มีรูท</span>}
          </button>
          <button style={shortcutStyle(d.today.active, d.today.hasRoute)} onClick={d.today.go}>
            วันนี้{d.today.hasRoute && <span style={{ fontSize: 11, opacity: 0.75 }}>มีรูท</span>}
          </button>
          <button style={shortcutStyle(d.tomorrow.active, d.tomorrow.hasRoute)} onClick={d.tomorrow.go}>
            พรุ่งนี้{d.tomorrow.hasRoute && <span style={{ fontSize: 11, opacity: 0.75 }}>มีรูท</span>}
          </button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-calendar-blank" style={{ fontSize: 20 }} />
          ย้อนดูวันอื่น
          <input
            type="date"
            className="input"
            style={{ minHeight: MIN_TOUCH, fontSize: 15, flex: 1 }}
            value={d.selected}
            onChange={(e) => d.onPickDate(e.target.value)}
          />
        </label>

        <div style={{ fontWeight: 800, fontSize: 17 }}>
          {d.selectedLabel}
          {d.isToday && <span style={{ fontSize: 12, marginLeft: 8, padding: '2px 9px', borderRadius: 20, background: 'var(--color-accent-900)', color: 'var(--color-accent-200)' }}>วันนี้</span>}
        </div>

        {d.routes.map((b) => (
          <button
            key={b.id}
            onClick={() => actions.selectDriverBatch(b.id)}
            style={{
              textAlign: 'left', padding: 16, minHeight: 72, borderRadius: 16, border: 0, cursor: 'pointer',
              fontFamily: 'var(--font-body)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)',
              display: 'flex', alignItems: 'center', gap: 12, color: 'var(--color-text)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: 18 }}>{b.stopCount} จุด</span>
                <span style={b.statusStyle}>{b.statusLabel}</span>
              </div>
              <div style={{ fontSize: 14, color: 'var(--color-neutral-300)', marginTop: 3 }}>
                {b.totalText}{b.remainingCount > 0 ? ` · เหลืออีก ${b.remainingCount} จุด` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{b.id}</div>
            </div>
            <i className="ph ph-caret-right" style={{ fontSize: 24, color: 'var(--color-neutral-500)', flex: 'none' }} />
          </button>
        ))}

        {/* An empty day names the days that DO have work, rather than being a
            dead end the driver has to guess their way out of. */}
        {d.isEmpty && (
          <div style={{ padding: 20, borderRadius: 16, background: 'var(--color-surface)', textAlign: 'center' }}>
            <i className="ph ph-calendar-x" style={{ fontSize: 34, color: 'var(--color-neutral-500)', display: 'block', marginBottom: 8 }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>วันนี้ไม่มีรูทสำหรับรถคันนี้</div>
            {d.otherDays.length > 0 ? (
              <>
                <div style={{ fontSize: 13.5, color: 'var(--color-neutral-400)', marginBottom: 12 }}>วันที่มีรูท — แตะเพื่อเปิด</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {d.otherDays.map((o) => (
                    <button
                      key={o.iso}
                      onClick={o.go}
                      style={{
                        minHeight: MIN_TOUCH, borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
                        background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 15,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', gap: 10,
                      }}
                    >
                      <span>{o.label}{o.isPast && <span style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginLeft: 6 }}>(ผ่านมาแล้ว)</span>}</span>
                      <span style={{ color: 'var(--color-neutral-400)', fontSize: 14 }}>{o.stopCount} จุด</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: 'var(--color-neutral-400)' }}>ยังไม่มีรูทที่มอบหมายให้รถคันนี้เลย</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type Outcome = 'delivered' | 'failed' | 'postponed';

function RouteDetail({
  state, actions, batchId, header, banner,
}: { state: AppState; actions: AppActions; batchId: string; header: React.ReactNode; banner: React.ReactNode }) {
  const batch = state.batchRoutes.find((b) => b.id === batchId)!;
  const rd = computeDriverRouteDetail(state, actions, batch);
  const checklist = computeDriverChecklist(state, actions, batch);
  const [sheetOrderNo, setSheetOrderNo] = useState<string | null>(null);
  const stop = sheetOrderNo ? (rd.stops.find((s) => s.orderNo === sheetOrderNo) ?? null) : null;

  // Close the sheet if its stop disappears (batch edited elsewhere) so it
  // can't be left hanging over a stop that no longer exists.
  useEffect(() => {
    if (sheetOrderNo && !rd.stops.some((s) => s.orderNo === sheetOrderNo)) setSheetOrderNo(null);
  }, [sheetOrderNo, rd.stops]);

  return (
    <div style={{ ...screenStyle, paddingBottom: 24 }}>
      {header}

      {/* Sticky summary — the two numbers a driver checks constantly. */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          padding: '12px 14px', background: 'var(--color-surface)', boxShadow: 'inset 0 -1px 0 var(--color-divider)',
        }}
      >
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>เหลืออีก</div>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
            {rd.remainingCount} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-neutral-400)' }}>/ {rd.stopCount} จุด</span>
          </div>
        </div>
        {rd.codCount > 0 && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>COD เก็บแล้ว</div>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
              {rd.codCashCollectedText}
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-neutral-400)' }}> / {rd.codCashExpectedText}</span>
            </div>
          </div>
        )}
      </div>

      {banner}

      {!checklist.isEmpty && !checklist.confirmed && (
        <div style={{ margin: '14px 12px 0', padding: 16, borderRadius: 16, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <i className="ph ph-clipboard-text" style={{ color: 'var(--color-accent-300)', fontSize: 20 }} />
            <span style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>เช็คสินค้าก่อนออก</span>
            <span style={{ fontSize: 14, color: 'var(--color-neutral-400)' }}>{checklist.checkedCount}/{checklist.totalCount}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 280, overflowY: 'auto' }}>
            {checklist.items.map((it) => (
              <label key={it.sku} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', minHeight: MIN_TOUCH, borderRadius: 11, background: it.checked ? 'var(--color-accent-900)' : 'var(--color-bg)', cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={it.checked} onChange={it.toggle} />
                <span style={{ flex: 1, fontSize: 15, textDecoration: it.checked ? 'line-through' : 'none', color: it.checked ? 'var(--color-neutral-400)' : undefined }}>{it.name}</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{it.totalQty.toLocaleString('en-US')} {it.unit}</span>
              </label>
            ))}
          </div>
          <button className="btn btn-primary" style={{ width: '100%', minHeight: BIG_TOUCH, justifyContent: 'center', marginTop: 12, fontSize: 16, fontWeight: 700 }} onClick={checklist.confirm}>
            <i className="ph ph-check" />ยืนยันเริ่มเดินทาง
          </button>
        </div>
      )}

      <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rd.stops.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-neutral-500)', fontSize: 15 }}>ไม่มีจุดส่งในรูทนี้</div>}
        {rd.allDone && (
          <div style={{ padding: 16, borderRadius: 14, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)', fontSize: 16, fontWeight: 700, textAlign: 'center' }}>
            <i className="ph ph-check-circle-fill" style={{ marginRight: 6 }} />ส่งครบทุกจุดแล้ว
          </div>
        )}
        {rd.stops.map((s) => {
          const pendingSync = state.driverSyncQueue.some((q) => q.orderNo === s.orderNo) || state.deliveryFailureSyncQueue.includes(s.orderNo);
          const failed = s.status === 'ส่งไม่สำเร็จ';
          const done = s.isDelivered || failed || s.isPostponed;
          return (
            <div
              key={s.orderNo}
              style={{
                padding: 16, borderRadius: 16, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)',
                opacity: done ? 0.72 : 1,
                borderLeft: `5px solid ${s.isDelivered ? 'var(--st-ok-fg)' : failed ? 'var(--st-bad-fg)' : s.isPostponed ? 'var(--st-warn-fg)' : s.zoneColor}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ width: 42, height: 42, borderRadius: '50%', background: s.zoneColor, color: '#161826', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18, flex: 'none' }}>
                  {s.seq}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Shop name is the biggest thing on the card — it's what a
                      driver matches against the shopfront at a glance. */}
                  <div style={{ fontWeight: 800, fontSize: 19, lineHeight: 1.25 }}>{s.customer}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                    {s.isNewCustomer && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 7, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)' }} title={`ลูกค้าใหม่ (จากชีต: ${s.newCustomerText})`}>
                        <i className="ph ph-star-fill" />ลูกค้าใหม่
                      </span>
                    )}
                    <span style={{ fontSize: 12, padding: '3px 9px', borderRadius: 7, background: 'var(--color-bg)', color: 'var(--color-neutral-300)' }}>
                      <i className="ph ph-package" style={{ marginRight: 4 }} />
                      {s.itemCount} รายการ{s.qtyText !== '—' ? ` · ${s.qtyText}` : ''}
                    </span>
                    {done && <span style={s.stStyle}>{s.status}</span>}
                  </div>
                </div>
              </div>

              {/* Full address, wrapped — never truncated. */}
              <div style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--color-neutral-200)', marginTop: 11 }}>{s.address}</div>
              {s.districtProvince !== '-' && (
                <div style={{ fontSize: 13.5, color: 'var(--color-neutral-400)', marginTop: 2 }}>
                  <i className="ph ph-map-pin" style={{ marginRight: 4 }} />{s.districtProvince}
                </div>
              )}

              {s.hasNote && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 11, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 14, lineHeight: 1.45 }}>
                  <i className="ph ph-note-pencil" style={{ marginRight: 6 }} />{s.note}
                </div>
              )}

              {s.isCod && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>เก็บเงิน</span>
                  {/* The number a driver must not misread — largest figure on the card. */}
                  <span style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--color-accent-200)', lineHeight: 1.1 }}>{s.amtText}</span>
                </div>
              )}
              {!s.isCod && <div style={{ marginTop: 10, fontSize: 15, color: 'var(--color-neutral-400)' }}>ยอด {s.amtText} · ไม่ต้องเก็บเงิน</div>}

              {s.deliveryFailure && (
                <div style={{ marginTop: 10, padding: 12, borderRadius: 11, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13.5 }}>
                  <div style={{ fontWeight: 700 }}><i className="ph ph-warning-fill" style={{ marginRight: 5 }} />{s.deliveryFailure.reason}</div>
                  {s.deliveryFailure.note && <div style={{ marginTop: 3 }}>{s.deliveryFailure.note}</div>}
                </div>
              )}

              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                {s.telHref && (
                  <a className="btn btn-secondary" style={{ flex: 1, minHeight: BIG_TOUCH, justifyContent: 'center', fontSize: 16, fontWeight: 700 }} href={s.telHref}>
                    <i className="ph ph-phone" />โทร
                  </a>
                )}
                {s.googleMapsUrl && (
                  <a className="btn btn-secondary" style={{ flex: 1, minHeight: BIG_TOUCH, justifyContent: 'center', fontSize: 16, fontWeight: 700 }} href={s.googleMapsUrl} target="_blank" rel="noreferrer">
                    <i className="ph ph-navigation-arrow" />นำทาง
                  </a>
                )}
              </div>
              <button
                className={done ? 'btn btn-secondary' : 'btn btn-primary'}
                style={{ width: '100%', minHeight: BIG_TOUCH, justifyContent: 'center', fontSize: 16, fontWeight: 700, marginTop: 8 }}
                onClick={() => setSheetOrderNo(s.orderNo)}
              >
                <i className={done ? 'ph ph-pencil-simple' : 'ph ph-flag-checkered'} />
                {done ? 'แก้ไขผลการส่ง' : 'จบงานจุดนี้'}
              </button>
              {pendingSync && (
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--st-warn-fg)', fontWeight: 600 }}>
                  <i className="ph ph-clock-clockwise" style={{ marginRight: 5 }} />ยังไม่ส่งขึ้นระบบ — จะส่งอัตโนมัติเมื่อมีเน็ต
                </div>
              )}
            </div>
          );
        })}
      </div>

      {stop && <OutcomeSheet state={state} actions={actions} stop={stop} onClose={() => setSheetOrderNo(null)} />}
    </div>
  );
}

/** Bottom sheet: the three outcomes, then whatever each one needs. Anchored
 * to the bottom of the screen so every control sits under the thumb. */
function OutcomeSheet({
  state, actions, stop, onClose,
}: {
  state: AppState;
  actions: AppActions;
  stop: ReturnType<typeof computeDriverRouteDetail>['stops'][number];
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [postponeDate, setPostponeDate] = useState(dayKey(addDays(new Date(), 1)));
  // Proof-of-delivery photos are kept separate from state.deliveryFailurePhotos
  // (which belongs to the failure flow and its IndexedDB queue) and uploaded
  // as ordinary order attachments, so a photo taken here is actually stored
  // rather than silently dropped by markDelivered.
  const [successPhotos, setSuccessPhotos] = useState<File[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bigButton = (bg: string, fg: string) => ({
    width: '100%', minHeight: 64, borderRadius: 14, border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
    fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    background: bg, color: fg,
  });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'color-mix(in srgb, var(--color-neutral-900) 55%, transparent)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: '85vh', overflowY: 'auto', background: 'var(--color-surface)',
          borderRadius: '20px 20px 0 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{stop.customer}</div>
            <div style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>จุดที่ {stop.seq} · {stop.orderNo}</div>
          </div>
          <button className="btn btn-icon btn-secondary" style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }} onClick={onClose} title="ปิด">
            <i className="ph ph-x" />
          </button>
        </div>

        {outcome === null && (
          <>
            <button style={bigButton('var(--st-ok-bg)', 'var(--st-ok-fg)')} onClick={() => setOutcome('delivered')}>
              <i className="ph ph-check-circle-fill" style={{ fontSize: 24 }} />ส่งสำเร็จ
            </button>
            <button style={bigButton('var(--st-bad-bg)', 'var(--st-bad-fg)')} onClick={() => setOutcome('failed')}>
              <i className="ph ph-x-circle-fill" style={{ fontSize: 24 }} />ส่งไม่สำเร็จ
            </button>
            <button style={bigButton('var(--st-warn-bg)', 'var(--st-warn-fg)')} onClick={() => setOutcome('postponed')}>
              <i className="ph ph-calendar-plus" style={{ fontSize: 24 }} />เลื่อนส่ง
            </button>
          </>
        )}

        {outcome === 'delivered' && (
          <>
            {stop.isCod ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700 }}>รับเงินแบบไหน? <span style={{ color: 'var(--color-accent-200)' }}>{stop.amtText}</span></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([
                    ['cash', 'เงินสด', 'ph ph-money'],
                    ['transfer', 'โอน', 'ph ph-bank'],
                    ['credit', 'เครดิต', 'ph ph-hourglass'],
                  ] as const).map(([m, label, icon]) => {
                    const active = stop.codMethod === m;
                    return (
                      <button
                        key={m}
                        onClick={m === 'cash' ? stop.setCodCash : m === 'transfer' ? stop.setCodTransfer : stop.setCodCredit}
                        style={{
                          flex: 1, minHeight: BIG_TOUCH, borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
                          fontSize: 15, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                          background: active ? 'var(--color-accent)' : 'var(--color-bg)',
                          color: active ? '#fff' : 'var(--color-neutral-300)',
                        }}
                      >
                        <i className={icon} style={{ fontSize: 20 }} />{label}
                      </button>
                    );
                  })}
                </div>
                {stop.codMethod === 'cash' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14, color: 'var(--color-neutral-400)' }}>
                    เก็บเงินได้เท่าไหร่
                    <input
                      className="input"
                      style={{ minHeight: BIG_TOUCH, fontSize: 22, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                      inputMode="numeric"
                      placeholder={String(stop.amount)}
                      value={stop.codCollected}
                      onChange={(e) => stop.onCodCollected(e.target.value)}
                    />
                  </label>
                )}
                {stop.codMethod === 'credit' && (
                  <div style={{ padding: 12, borderRadius: 11, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13.5 }}>
                    <i className="ph ph-info" style={{ marginRight: 5 }} />ขายเครดิต — ยอดนี้จะไม่ถูกนับในเงินสดที่ต้องคืน
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 15, color: 'var(--color-neutral-400)' }}>ออเดอร์นี้ไม่ต้องเก็บเงิน</div>
            )}

            <label className="btn btn-secondary" style={{ minHeight: BIG_TOUCH, justifyContent: 'center', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
              <i className="ph ph-camera" />
              {successPhotos.length > 0 ? `แนบรูปแล้ว ${successPhotos.length} รูป` : 'ถ่ายรูปหลักฐาน (ไม่บังคับ)'}
              <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={(e) => setSuccessPhotos(Array.from(e.target.files ?? []))} />
            </label>
            {successPhotos.length > 0 && !state.driverOnline && (
              <div style={{ padding: 11, borderRadius: 11, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13 }}>
                <i className="ph ph-warning" style={{ marginRight: 5 }} />ตอนนี้ออฟไลน์ — สถานะจะถูกบันทึกไว้ แต่รูปต้องมีเน็ตจึงจะอัปโหลดได้
              </div>
            )}

            <button
              style={bigButton('var(--st-ok-fg)', '#0e1116')}
              onClick={() => {
                // The delivered mark itself is offline-safe (persisted outbox);
                // the photo upload is a best-effort extra that reports its own
                // failure through uploadError rather than blocking the mark.
                stop.markDelivered();
                if (successPhotos.length > 0) void actions.uploadAttachments('order', stop.orderNo, successPhotos, state.attachments);
                setSuccessPhotos([]);
                onClose();
              }}
            >
              <i className="ph ph-check" style={{ fontSize: 22 }} />ยืนยันส่งสำเร็จ
            </button>
          </>
        )}

        {outcome === 'failed' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700 }}>เพราะอะไร?</div>
            {/* Reasons are buttons, not a dropdown or a text box — a keyboard
                at a shop door is the slowest possible input. */}
            {DELIVERY_FAILURE_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => actions.setDeliveryFailureReason(r)}
                style={{
                  width: '100%', minHeight: BIG_TOUCH, borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
                  fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px',
                  background: state.deliveryFailureReason === r ? 'var(--st-bad-fg)' : 'var(--color-bg)',
                  color: state.deliveryFailureReason === r ? '#0e1116' : 'var(--color-neutral-200)',
                }}
              >
                <i className={state.deliveryFailureReason === r ? 'ph ph-radio-button-fill' : 'ph ph-circle'} />{r}
              </button>
            ))}
            <label className="btn btn-secondary" style={{ minHeight: MIN_TOUCH, justifyContent: 'center', fontSize: 15, cursor: 'pointer' }}>
              <i className="ph ph-camera" />
              {state.deliveryFailurePhotos.length > 0 ? `แนบรูปแล้ว ${state.deliveryFailurePhotos.length} รูป` : 'ถ่ายรูป (ไม่บังคับ)'}
              <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={(e) => actions.setDeliveryFailurePhotos(Array.from(e.target.files ?? []))} />
            </label>
            {state.deliveryFailureError && (
              <div style={{ padding: 12, borderRadius: 11, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13.5 }}>{state.deliveryFailureError}</div>
            )}
            <button
              style={{ ...bigButton('var(--st-bad-fg)', '#0e1116'), opacity: state.deliveryFailureReason ? 1 : 0.5 }}
              disabled={!state.deliveryFailureReason || state.deliveryFailureSubmitting}
              onClick={() => {
                actions.submitDeliveryFailure(stop.orderNo, state.deliveryFailureReason, state.deliveryFailureNote, state.deliveryFailurePhotos);
                onClose();
              }}
            >
              {state.deliveryFailureSubmitting ? <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} /> : <i className="ph ph-check" style={{ fontSize: 22 }} />}
              ยืนยันส่งไม่สำเร็จ
            </button>
          </>
        )}

        {outcome === 'postponed' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700 }}>เลื่อนไปวันไหน?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2, 3].map((n) => {
                const iso = dayKey(addDays(new Date(), n));
                const active = postponeDate === iso;
                return (
                  <button
                    key={n}
                    onClick={() => setPostponeDate(iso)}
                    style={{
                      flex: 1, minHeight: BIG_TOUCH, borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
                      fontSize: 15, fontWeight: 700,
                      background: active ? 'var(--color-accent)' : 'var(--color-bg)',
                      color: active ? '#fff' : 'var(--color-neutral-300)',
                    }}
                  >
                    {n === 1 ? 'พรุ่งนี้' : `+${n} วัน`}
                  </button>
                );
              })}
            </div>
            <input
              type="date"
              className="input"
              style={{ minHeight: BIG_TOUCH, fontSize: 16 }}
              value={postponeDate}
              onChange={(e) => e.target.value && setPostponeDate(e.target.value)}
            />
            <button
              style={bigButton('var(--st-warn-fg)', '#0e1116')}
              onClick={() => {
                stop.postpone(postponeDate);
                onClose();
              }}
            >
              <i className="ph ph-calendar-plus" style={{ fontSize: 22 }} />ยืนยันเลื่อนส่ง
            </button>
          </>
        )}

        {outcome !== null && (
          <button className="btn btn-ghost" style={{ minHeight: MIN_TOUCH, justifyContent: 'center', fontSize: 15 }} onClick={() => setOutcome(null)}>
            <i className="ph ph-arrow-left" />เลือกใหม่
          </button>
        )}
      </div>
    </div>
  );
}
