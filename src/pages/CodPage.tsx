import { useEffect } from 'react';
import { computeCod } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function CodPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeCod(state, actions);
  const isDriverView = state.session?.role === 'driver';

  useEffect(() => {
    if (isDriverView && !state.codMobile) actions.patch({ codMobile: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDriverView]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {v.hasVisibleBatches && (
          <div style={{ display: 'flex', overflowX: 'auto', maxWidth: '100%' }}>
            <div className="seg">
              {v.batchTabs.map((t) => (
                <label key={t.id} className="seg-opt" style={{ whiteSpace: 'nowrap' }}>
                  <input type="radio" name="cd" checked={t.active} onChange={t.go} />
                  <i className="ph ph-truck" />{t.label}
                  {t.codClosed && <i className="ph ph-check-circle-fill" style={{ color: 'var(--st-ok-fg)', marginLeft: 4 }} title="ปิดยอดแล้ว" />}
                </label>
              ))}
            </div>
          </div>
        )}
        {!isDriverView && v.vehicleFilterOptions.length > 0 && (
          <select className="input" style={{ minHeight: 34, fontSize: 12.5, width: 180 }} value={v.vehicleFilter} onChange={(e) => v.setVehicleFilter(e.target.value)}>
            <option value="all">รถ/คนขับ — ทั้งหมด</option>
            {v.vehicleFilterOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {!isDriverView && (
          <div className="seg" style={{ marginLeft: 'auto' }}>
            <label className="seg-opt"><input type="radio" name="cv" checked={v.codDesktop} onChange={v.setCodDesktop} /><i className="ph ph-desktop" />Admin</label>
            <label className="seg-opt"><input type="radio" name="cv" checked={v.codMobile} onChange={v.setCodMobile} /><i className="ph ph-device-mobile" />Driver</label>
          </div>
        )}
      </div>

      {!v.hasBatches && (
        <div className="card elev-sm" style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>
          ยังไม่มี Batch Route ที่ยืนยันแล้ว — ไปที่หน้า "วางแผนจัดรูท" แล้วกด "ยืนยันรูท" ก่อน
        </div>
      )}
      {v.hasBatches && !v.hasVisibleBatches && (
        <div className="card elev-sm" style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>
          ไม่พบ batch ของรถ/คนขับที่เลือก
        </div>
      )}

      {v.hasVisibleBatches && v.editedAfterClose && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />
          <span>Batch นี้ถูกแก้ไข (เพิ่ม/ลดออเดอร์) หลังจากปิดยอดไปแล้ว — ยอดด้านล่างอาจไม่ตรงกับที่ปิดไว้ กรุณาตรวจสอบใหม่</span>
        </div>
      )}

      {v.hasVisibleBatches && v.codDesktop && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 18, alignItems: 'start' }}>
          <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
            {!v.hasCodOrders ? (
              <div style={{ padding: 22, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่มีออเดอร์เก็บเงินปลายทางใน batch นี้</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>ออเดอร์</th><th>ลูกค้า</th><th style={{ textAlign: 'right' }}>ยอดที่ต้องเก็บ</th>
                    <th style={{ textAlign: 'center', width: 168 }}>รับเงินแบบ</th>
                    <th style={{ textAlign: 'right', width: 150 }}>ยอดคืนจริง</th><th style={{ textAlign: 'right' }}>ส่วนต่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {v.codRows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{r.id}</td>
                      <td>{r.cust}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.expectedText}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="seg" style={{ width: '100%' }}>
                          <label className="seg-opt" style={{ flex: 1, justifyContent: 'center', padding: '5px 8px', fontSize: 12 }}>
                            <input type="radio" name={`m-${r.id}`} checked={r.isCash} onChange={r.setCash} disabled={v.codClosed} />
                            <i className="ph ph-money" />สด
                          </label>
                          <label className="seg-opt" style={{ flex: 1, justifyContent: 'center', padding: '5px 8px', fontSize: 12 }}>
                            <input type="radio" name={`m-${r.id}`} checked={r.isTransfer} onChange={r.setTransfer} disabled={v.codClosed} />
                            <i className="ph ph-bank" />โอน
                          </label>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.isTransfer ? (
                          <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>ไม่ต้องคืนเงินสด</span>
                        ) : (
                          <input
                            className="input"
                            style={{ textAlign: 'right', minHeight: 32, fontVariantNumeric: 'tabular-nums' }}
                            inputMode="numeric"
                            value={r.returned}
                            onChange={(e) => r.onInput(e.target.value)}
                            disabled={v.codClosed}
                          />
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}><span style={r.diffStyle}>{r.diffText}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card elev-md" style={{ gap: 14, position: 'sticky', top: 96 }}>
            <div className="card-kicker">สรุปรอบเก็บเงิน · {v.selectedBatchLabel} · {v.selectedBatchDateText}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--color-neutral-400)' }}>ยอดที่ต้องเก็บทั้งหมด</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{v.codExpectedText}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: 'var(--color-neutral-500)' }}><i className="ph ph-money" style={{ marginRight: 5 }} />เงินสด (ต้องคืน)</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.cashExpectedText}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: 'var(--color-neutral-500)' }}><i className="ph ph-bank" style={{ marginRight: 5 }} />โอน ({v.transferCount} ออเดอร์)</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.transferText}</span>
              </div>
              <div className="hr" style={{ margin: '2px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--color-neutral-400)' }}>เงินสดที่คืนจริง</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{v.codReturnedText}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: 'var(--color-neutral-400)' }}>ส่วนต่างเงินสด</span><span style={v.codDiffStyle}>{v.codDiffText}</span></div>
            </div>
            {v.hasTransfer && (
              <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
                <i className="ph ph-info" style={{ marginRight: 4 }} />ยอดโอนเข้าบัญชีบริษัทแล้ว ไม่ถูกนับรวมในส่วนต่างเงินสด
              </div>
            )}
            {v.codMismatch && (
              <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5, lineHeight: 1.45 }}>
                <i className="ph ph-warning-fill" style={{ fontSize: 16, flex: 'none' }} /><span>ยอดเงินสดไม่ตรง — โปรดตรวจสอบกับ driver ก่อนปิดยอด</span>
              </div>
            )}
            {v.codClosed && (
              <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)', fontSize: 12.5 }}>
                <i className="ph ph-check-circle-fill" style={{ fontSize: 16, flex: 'none' }} /><span>ปิดยอดรอบนี้เรียบร้อยแล้ว</span>
              </div>
            )}
            <button className="btn btn-primary btn-block" style={{ minHeight: 42 }} onClick={v.closeBatch} disabled={v.codClosed}>
              <i className="ph ph-lock-simple" />ปิดยอดรอบนี้ (batch)
            </button>
          </div>
        </div>
      )}

      {v.hasVisibleBatches && v.codMobile && (
        <div style={{ maxWidth: 420, margin: '0 auto', border: '11px solid #0b0c14', borderRadius: 42, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', background: 'var(--color-bg)' }}>
          <div style={{ height: 30, background: '#0b0c14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 120, height: 6, borderRadius: 6, background: '#23252f' }} />
          </div>
          <div style={{ padding: '16px 15px 26px' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>ส่งคืนเงินสด (COD)</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', marginBottom: 14 }}>{v.selectedBatchLabel} · รอบวันที่ {v.selectedBatchDateText}</div>
            {!v.hasCodOrders ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่มีออเดอร์เก็บเงินปลายทางใน batch นี้</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {v.codRows.map((r) => (
                  <div key={r.id} style={{ padding: 13, borderRadius: 12, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 600 }}><span>{r.cust}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.expectedText}</span></div>
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginBottom: 9 }}>{r.id}</div>
                    <div className="field" style={{ marginBottom: 9 }}>
                      <label style={{ fontSize: 11 }}>ลูกค้าจ่ายแบบ</label>
                      <div className="seg" style={{ width: '100%' }}>
                        <label className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                          <input type="radio" name={`mm-${r.id}`} checked={r.isCash} onChange={r.setCash} disabled={v.codClosed} />
                          <i className="ph ph-money" />เงินสด
                        </label>
                        <label className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                          <input type="radio" name={`mm-${r.id}`} checked={r.isTransfer} onChange={r.setTransfer} disabled={v.codClosed} />
                          <i className="ph ph-bank" />โอน
                        </label>
                      </div>
                    </div>
                    {r.isCash ? (
                      <div className="field">
                        <label style={{ fontSize: 11 }}>ยอดคืนจริง (฿)</label>
                        <input className="input" inputMode="numeric" value={r.returned} onChange={(e) => r.onInput(e.target.value)} disabled={v.codClosed} />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 7, padding: '9px 11px', borderRadius: 9, background: 'var(--st-info-bg)', color: 'var(--st-info-fg)', fontSize: 12 }}>
                        <i className="ph ph-check-circle-fill" style={{ flex: 'none' }} />โอนเข้าบัญชีแล้ว ไม่ต้องคืนเงินสด
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 14, padding: 13, borderRadius: 12, background: 'var(--color-accent-900)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-accent-200)' }}>เงินสดที่ต้องคืน {v.cashExpectedText}</div>
                <div style={{ fontSize: 19, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.codReturnedText}</div>
              </div>
              <span style={v.codDiffStyle}>{v.codDiffText}</span>
            </div>
            {v.codClosed && (
              <div style={{ marginTop: 10, display: 'flex', gap: 7, padding: '9px 11px', borderRadius: 9, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)', fontSize: 12 }}>
                <i className="ph ph-check-circle-fill" style={{ flex: 'none' }} />ปิดยอดรอบนี้เรียบร้อยแล้ว
              </div>
            )}
            <button className="btn btn-primary btn-block" style={{ minHeight: 46, marginTop: 14 }} onClick={v.closeBatch} disabled={v.codClosed}>ยืนยันส่งคืนเงิน</button>
          </div>
        </div>
      )}
    </div>
  );
}
