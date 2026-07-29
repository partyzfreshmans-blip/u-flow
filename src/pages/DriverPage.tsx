import { useState } from 'react';
import { canBookStop } from '../config/permissions';
import { DELIVERY_FAILURE_REASONS } from '../data/deliveryFailures';
import { computeDriverBatches, computeDriverBooking, computeDriverChecklist, computeDriverRouteDetail, computePlanner } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

/** Mobile-first route sheet for drivers — full-screen, no admin chrome.
 *
 * Flow: pick a vehicle (or it's fixed for a real driver session) -> pick
 * which of that vehicle's Batch Route dates to view -> route detail for
 * that date (pre-departure checklist first, then stops). Booking ("จองคิว")
 * is reachable via a tab as soon as a vehicle is picked, independent of
 * which date is being viewed, since it's about claiming still-unassigned
 * stops fleet-wide rather than anything scoped to one batch. */
export function DriverPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePlanner(state, actions); // vehicles is already scoped to just this driver's own vehicle when role === 'driver'
  const vehPreview = v.vehicles.find((x) => x.id === state.driverVehicleId) ?? null;
  const vehicle = state.vehicles.find((x) => x.id === state.driverVehicleId) ?? null;
  const pendingSyncCount = state.driverSyncQueue.length + state.deliveryFailureSyncQueue.length;
  const isDriverRole = state.session?.role === 'driver';
  const canBook = state.session ? canBookStop(state.session.role) : false;
  const [tab, setTab] = useState<'route' | 'book'>('route');
  const booking = canBook ? computeDriverBooking(state, actions) : null;

  const selectedBatch = state.driverSelectedBatchId ? (state.batchRoutes.find((b) => b.id === state.driverSelectedBatchId) ?? null) : null;

  const connectionBanner = (!state.driverOnline || pendingSyncCount > 0) && (
    <div style={{ margin: '10px 12px 0', padding: '9px 12px', borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <i className="ph ph-wifi-slash" style={{ flex: 'none' }} />
      <span style={{ flex: 1 }}>
        {!state.driverOnline ? 'ออฟไลน์ — ' : ''}
        {pendingSyncCount > 0 ? `รอซิงค์ ${pendingSyncCount} รายการ (ซิงค์อัตโนมัติเมื่อมีเน็ต)` : 'กลับมาออนไลน์แล้ว'}
      </span>
      {state.driverOnline && pendingSyncCount > 0 && (
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11 }}
          onClick={() => {
            actions.retrySyncQueue();
            actions.retryDeliveryFailureQueue();
          }}
        >
          ลองซิงค์ตอนนี้
        </button>
      )}
    </div>
  );

  // ---- Screen 1: vehicle picker ----
  if (!vehicle) {
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
                <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{x.stopCount} จุด (วันนี้) · {x.totalText}</div>
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

  const header = (
    <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--color-surface)', boxShadow: 'inset 0 -1px 0 var(--color-divider)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="btn btn-icon btn-secondary"
          onClick={() => (selectedBatch ? actions.selectDriverBatch(null) : actions.setDriverVehicle(null))}
          title={selectedBatch ? 'เลือกวันที่อื่น' : 'เลือกคันอื่น'}
          style={!selectedBatch && isDriverRole ? { visibility: 'hidden' } : undefined}
        >
          <i className="ph ph-arrow-left" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{vehicle.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
            {selectedBatch ? `${selectedBatch.id} · ${vehPreview?.stopCount ?? 0} จุด` : 'เลือกวันที่จัดส่ง'}
          </div>
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
      {canBook && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
          <button className={tab === 'route' ? 'btn btn-primary' : 'btn btn-secondary'} style={{ flex: 1, minHeight: 38, justifyContent: 'center', fontSize: 13 }} onClick={() => setTab('route')}>
            เส้นทางของฉัน
          </button>
          <button className={tab === 'book' ? 'btn btn-primary' : 'btn btn-secondary'} style={{ flex: 1, minHeight: 38, justifyContent: 'center', fontSize: 13 }} onClick={() => setTab('book')}>
            <i className="ph ph-hand-tap" />จองคิวจุดส่ง{booking && booking.selectedCount > 0 ? ` (${booking.selectedCount})` : ''}
          </button>
        </div>
      )}
    </div>
  );

  // ---- Booking tab (unchanged feature, reachable regardless of date-selection state) ----
  if (tab === 'book' && booking) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 40 }}>
        {header}
        {connectionBanner}
        <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            เลือกจุดส่งที่ยังไม่มีใครจอง แล้วกด "จองคิว" — ผู้ดูแลระบบจะเห็นคำขอและยืนยัน/ปฏิเสธในหน้าวางแผนจัดรูท
          </div>
          {booking.error && <div style={{ padding: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{booking.error}</div>}
          {booking.submitError && <div style={{ padding: 12, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>{booking.submitError}</div>}
          {booking.conflictOrderNos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 12.5 }}>
              <i className="ph ph-warning-fill" style={{ flex: 'none', marginTop: 1 }} />
              <span style={{ flex: 1 }}>จุดนี้เพิ่งถูกจองไปแล้วก่อนคุณ: {booking.conflictOrderNos.join(', ')} — เลือกจุดอื่นแทน</span>
              <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={booking.clearConflicts}>ปิด</button>
            </div>
          )}
          {booking.loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-neutral-500)', fontSize: 13 }}>กำลังโหลด...</div>}
          {!booking.loading && booking.isEmpty && <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-neutral-500)', fontSize: 13 }}>ไม่มีจุดส่งที่ยังไม่ได้จัดลงรถ</div>}
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
      </div>
    );
  }

  // ---- Screen 2: date selection ----
  if (!selectedBatch) {
    const batches = computeDriverBatches(state, vehicle.id);
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 40 }}>
        {header}
        {connectionBanner}
        <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {batches.isEmpty && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-neutral-500)', fontSize: 13 }}>
              <i className="ph ph-calendar-x" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
              ยังไม่มีรูทที่มอบหมายให้คันนี้
            </div>
          )}
          {batches.rows.map((b) => (
            <button
              key={b.id}
              onClick={() => actions.selectDriverBatch(b.id)}
              style={{
                textAlign: 'left', padding: '14px 16px', borderRadius: 14, border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
                background: 'var(--color-surface)', boxShadow: b.isToday ? 'inset 0 0 0 1.5px var(--color-accent-700)' : 'var(--shadow-sm)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{b.dateText}</span>
                  {b.isToday && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'var(--color-accent-900)', color: 'var(--color-accent-200)' }}>วันนี้</span>}
                  <span style={b.statusStyle}>{b.statusLabel}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{b.id}</div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginTop: 2 }}>
                  {b.stopCount} จุด · {b.totalText}{b.codClosed ? ' · ปิดยอด COD แล้ว' : ''}
                </div>
              </div>
              <i className="ph ph-caret-right" style={{ fontSize: 20, color: 'var(--color-neutral-500)', flex: 'none' }} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Screen 3: route detail for the selected date ----
  const rd = computeDriverRouteDetail(state, actions, selectedBatch);
  const checklist = computeDriverChecklist(state, actions, selectedBatch);
  const failDialogOrderNo = state.deliveryFailureDialogOrderNo;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 40 }}>
      {header}
      {rd.codCount > 0 && (
        <div style={{ margin: '10px 12px 0', padding: '10px 12px', borderRadius: 10, background: 'var(--color-surface)', fontSize: 12.5, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span><i className="ph ph-money" style={{ marginRight: 5, color: 'var(--color-accent-300)' }} />COD ต้องเก็บ {rd.codCashExpectedText}</span>
          <span>เก็บแล้ว {rd.codCashCollectedText}</span>
          <span style={rd.codDiffStyle}>{rd.codDiffText}</span>
        </div>
      )}
      {connectionBanner}

      {/* Pre-departure checklist — first section of the route-detail page,
          not a separate gated screen, so it never blocks moving on to the
          stops below (per spec: warn, don't force). */}
      {!checklist.isEmpty && (
        <div style={{ margin: '14px 12px 0', padding: 14, borderRadius: 14, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <i className="ph ph-clipboard-text" style={{ color: 'var(--color-accent-300)' }} />
            <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>เช็คสินค้าก่อนออกจากคลัง</span>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{checklist.checkedCount}/{checklist.totalCount}</span>
          </div>
          {checklist.confirmed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: checklist.allChecked ? 'var(--st-ok-fg)' : 'var(--st-warn-fg)' }}>
              <i className={checklist.allChecked ? 'ph ph-check-circle-fill' : 'ph ph-warning-fill'} />
              ยืนยันแล้ว ({checklist.confirmedAtText}){!checklist.allChecked ? ' — ยังตรวจนับไม่ครบ' : ''}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {checklist.items.map((it) => (
                  <label key={it.sku} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: it.checked ? 'var(--color-accent-900)' : 'var(--color-bg)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={it.checked} onChange={it.toggle} />
                    <span style={{ flex: 1, fontSize: 13, textDecoration: it.checked ? 'line-through' : 'none', color: it.checked ? 'var(--color-neutral-400)' : undefined }}>{it.name}</span>
                    <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-400)' }}>{it.totalQty.toLocaleString('en-US')} {it.unit}</span>
                  </label>
                ))}
              </div>
              {!checklist.allChecked && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--st-warn-fg)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <i className="ph ph-warning" />ยังตรวจนับไม่ครบ {checklist.totalCount - checklist.checkedCount} รายการ
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%', minHeight: 42, justifyContent: 'center', marginTop: 10, fontSize: 13.5 }} onClick={checklist.confirm}>
                <i className="ph ph-check" />ยืนยันเริ่มเดินทาง
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rd.stops.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-neutral-500)', fontSize: 13 }}>ไม่มีจุดส่งในรูทนี้</div>}
        {rd.stops.map((s) => {
          const pendingSync = state.driverSyncQueue.includes(s.orderNo) || state.deliveryFailureSyncQueue.includes(s.orderNo);
          const done = s.isDelivered || s.status === 'ส่งไม่สำเร็จ';
          return (
            <div key={s.orderNo} style={{ padding: 14, borderRadius: 14, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', opacity: done ? 0.75 : 1 }}>
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

              {s.deliveryFailure && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}><i className="ph ph-warning-fill" style={{ marginRight: 5 }} />ส่งไม่สำเร็จ · {s.deliveryFailure.reason}</div>
                  {s.deliveryFailure.note && <div style={{ marginTop: 3 }}>{s.deliveryFailure.note}</div>}
                  {s.deliveryFailure.photoLinks.length > 0 && (
                    <div style={{ marginTop: 5, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {s.deliveryFailure.photoLinks.map((p) =>
                        p.webViewLink ? (
                          <a key={p.fileId} href={p.webViewLink} target="_blank" rel="noreferrer" style={{ color: 'var(--st-bad-fg)', textDecoration: 'underline', fontSize: 11.5 }}>
                            <i className="ph ph-image" style={{ marginRight: 3 }} />{p.name}
                          </a>
                        ) : (
                          <span key={p.fileId} style={{ fontSize: 11.5 }}><i className="ph ph-image" style={{ marginRight: 3 }} />{p.name}</span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}

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

              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {s.googleMapsUrl && (
                  <a className="btn btn-secondary" style={{ flex: '1 1 100%', minHeight: 44, justifyContent: 'center', fontSize: 13.5 }} href={s.googleMapsUrl} target="_blank" rel="noreferrer">
                    <i className="ph ph-navigation-arrow" />นำทาง
                  </a>
                )}
                <button className={s.isDelivered ? 'btn btn-secondary' : 'btn btn-primary'} style={{ flex: 1, minHeight: 44, justifyContent: 'center', fontSize: 13.5 }} onClick={s.markDelivered} disabled={done}>
                  <i className={s.isDelivered ? 'ph ph-check-circle-fill' : 'ph ph-check-circle'} />
                  {s.isDelivered ? 'ส่งสำเร็จแล้ว' : 'ส่งสำเร็จ'}
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, minHeight: 44, justifyContent: 'center', fontSize: 13.5 }} onClick={s.openDeliveryFailureDialog} disabled={done}>
                  <i className="ph ph-warning" />ส่งไม่สำเร็จ
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

      {failDialogOrderNo && <DeliveryFailureDialog state={state} actions={actions} orderNo={failDialogOrderNo} />}
    </div>
  );
}

function DeliveryFailureDialog({ state, actions, orderNo }: { state: AppState; actions: AppActions; orderNo: string }) {
  return (
    <div className="dialog-backdrop" onClick={() => actions.closeDeliveryFailureDialog()}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 100%)' }}>
        <div className="dialog-title">ส่งไม่สำเร็จ · {orderNo}</div>
        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>เหตุผล</label>
            <select className="input" value={state.deliveryFailureReason} onChange={(e) => actions.setDeliveryFailureReason(e.target.value)}>
              <option value="">เลือกเหตุผล...</option>
              {DELIVERY_FAILURE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>หมายเหตุ (ถ้ามี)</label>
            <textarea className="input" rows={2} value={state.deliveryFailureNote} onChange={(e) => actions.setDeliveryFailureNote(e.target.value)} />
          </div>
          <div className="field">
            <label>รูปถ่ายหลักฐาน (อย่างน้อย 1 รูป)</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => actions.setDeliveryFailurePhotos(Array.from(e.target.files ?? []))}
            />
            {state.deliveryFailurePhotos.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', marginTop: 4 }}>
                แนบแล้ว {state.deliveryFailurePhotos.length} รูป: {state.deliveryFailurePhotos.map((f) => f.name).join(', ')}
              </div>
            )}
          </div>
          {state.deliveryFailureError && (
            <div style={{ padding: 10, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12 }}>{state.deliveryFailureError}</div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={() => actions.closeDeliveryFailureDialog()} disabled={state.deliveryFailureSubmitting}>
            ยกเลิก
          </button>
          <button
            className="btn btn-primary"
            disabled={state.deliveryFailureSubmitting || !state.deliveryFailureReason}
            onClick={() => actions.submitDeliveryFailure(orderNo, state.deliveryFailureReason, state.deliveryFailureNote, state.deliveryFailurePhotos)}
          >
            {state.deliveryFailureSubmitting ? <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} /> : <i className="ph ph-check" />}
            บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}
