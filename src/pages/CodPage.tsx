import { computeCod } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function CodPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeCod(state, actions);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="seg">
          {v.driverTabs.map((d) => (
            <label key={d.name} className="seg-opt">
              <input type="radio" name="cd" checked={d.active} onChange={d.go} /><i className="ph ph-truck" />{d.name}
            </label>
          ))}
        </div>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          <label className="seg-opt"><input type="radio" name="cv" checked={v.codDesktop} onChange={v.setCodDesktop} /><i className="ph ph-desktop" />Admin</label>
          <label className="seg-opt"><input type="radio" name="cv" checked={v.codMobile} onChange={v.setCodMobile} /><i className="ph ph-device-mobile" />Driver</label>
        </div>
      </div>

      {v.codDesktop && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 18, alignItems: 'start' }}>
          <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>ออเดอร์</th><th>ลูกค้า</th><th style={{ textAlign: 'right' }}>ยอดที่ต้องเก็บ</th>
                  <th style={{ textAlign: 'right', width: 150 }}>ยอดคืนจริง</th><th style={{ textAlign: 'right' }}>ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody>
                {v.codRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{r.id}</td>
                    <td>{r.cust}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.expectedText}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        className="input"
                        style={{ textAlign: 'right', minHeight: 32, fontVariantNumeric: 'tabular-nums' }}
                        inputMode="numeric"
                        value={r.returned}
                        onChange={(e) => r.onInput(e.target.value)}
                        disabled={v.codClosed}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}><span style={r.diffStyle}>{r.diffText}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card elev-md" style={{ gap: 14, position: 'sticky', top: 96 }}>
            <div className="card-kicker">สรุปรอบเก็บเงิน · {v.codDriver} · 23 ก.ค.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--color-neutral-400)' }}>ยอดที่ต้องเก็บ</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{v.codExpectedText}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--color-neutral-400)' }}>ยอดคืนจริง</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{v.codReturnedText}</b></div>
              <div className="hr" style={{ margin: '2px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: 'var(--color-neutral-400)' }}>ส่วนต่างรวม</span><span style={v.codDiffStyle}>{v.codDiffText}</span></div>
            </div>
            {v.codMismatch && (
              <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5, lineHeight: 1.45 }}>
                <i className="ph ph-warning-fill" style={{ fontSize: 16, flex: 'none' }} /><span>ยอดไม่ตรง — โปรดตรวจสอบกับ driver ก่อนปิดยอด</span>
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

      {v.codMobile && (
        <div style={{ maxWidth: 420, margin: '0 auto', border: '11px solid #0b0c14', borderRadius: 42, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', background: 'var(--color-bg)' }}>
          <div style={{ height: 30, background: '#0b0c14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 120, height: 6, borderRadius: 6, background: '#23252f' }} />
          </div>
          <div style={{ padding: '16px 15px 26px' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>ส่งคืนเงินสด (COD)</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', marginBottom: 14 }}>{v.codDriver} · รอบวันที่ 23 ก.ค. 2026</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {v.codRows.map((r) => (
                <div key={r.id} style={{ padding: 13, borderRadius: 12, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 600 }}><span>{r.cust}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.expectedText}</span></div>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginBottom: 9 }}>{r.id}</div>
                  <div className="field">
                    <label style={{ fontSize: 11 }}>ยอดคืนจริง (฿)</label>
                    <input className="input" inputMode="numeric" value={r.returned} onChange={(e) => r.onInput(e.target.value)} disabled={v.codClosed} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: 13, borderRadius: 12, background: 'var(--color-accent-900)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-accent-200)' }}>ยอดคืนรวม</div>
                <div style={{ fontSize: 19, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.codReturnedText}</div>
              </div>
              <span style={v.codDiffStyle}>{v.codDiffText}</span>
            </div>
            <button className="btn btn-primary btn-block" style={{ minHeight: 46, marginTop: 14 }} onClick={v.closeBatch} disabled={v.codClosed}>ยืนยันส่งคืนเงิน</button>
          </div>
        </div>
      )}
    </div>
  );
}
