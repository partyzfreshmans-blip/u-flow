import { computeCustomer } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function CustomerPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeCustomer(state, actions);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหารหัส / ชื่อร้าน" value={v.custQ} onChange={(e) => v.onCustSearch(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={v.openAddCust}><i className="ph ph-plus" />เพิ่มลูกค้าใหม่</button>
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr>
              <th>รหัส</th><th>ร้านค้า</th><th>เส้นทาง</th><th>การชำระ</th><th style={{ textAlign: 'right' }}>วงเงิน / ยอดค้าง</th>
              <th style={{ textAlign: 'center' }}>เทอม</th><th>เงื่อนไขพิเศษ</th><th>สถานะ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {v.custRows.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{c.id}</td>
                <td>{c.name}<div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{c.addr}</div></td>
                <td><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}>Route {c.route}</span></td>
                <td><span style={c.payStyle}>{c.payLabel}</span></td>
                <td style={{ textAlign: 'right' }}>
                  {c.hasCredit && (
                    <>
                      <div style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', ...c.balanceStyle }}>{c.balanceText} / {c.limitText}</div>
                      <div style={{ height: 4, borderRadius: 3, background: 'var(--color-neutral-800)', marginTop: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, background: c.barFill, width: `${c.usagePct}%` }} />
                      </div>
                    </>
                  )}
                  {c.noCredit && <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{c.termText}</td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 230 }}>
                    {c.conds.map((cd, i) => <span key={i} style={cd.style}>{cd.text}</span>)}
                    {c.noConds && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>ไม่มีเงื่อนไขพิเศษ</span>}
                  </div>
                </td>
                <td><span style={c.stStyle}>{c.stLabel}</span></td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={c.edit}>แก้ไข</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {v.custModalOpen && (
        <div className="dialog-backdrop" onClick={v.closeCust}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, 100%)' }}>
            <div className="dialog-title">{v.custModalTitle}</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 11 }}>
                <div className="field"><label>รหัสลูกค้า</label><input className="input" value={v.custF.id} onChange={(e) => v.onCFId(e.target.value)} disabled={v.custIsEdit} /></div>
                <div className="field"><label>ชื่อร้าน</label><input className="input" value={v.custF.name} onChange={(e) => v.onCFName(e.target.value)} /></div>
              </div>
              <div className="field"><label>ที่อยู่</label><input className="input" value={v.custF.addr} onChange={(e) => v.onCFAddr(e.target.value)} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div className="field"><label>เส้นทาง</label>
                  <select className="input" value={v.custF.route} onChange={(e) => v.onCFRoute(e.target.value as 'A' | 'B')}>
                    <option>A</option><option>B</option>
                  </select>
                </div>
                <div className="field"><label>ประเภทการชำระ</label>
                  <div className="seg" style={{ width: '100%' }}>
                    <label className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}><input type="radio" name="cpay" checked={v.custPayCod} onChange={v.setPayCod} />เงินสดปลายทาง</label>
                    <label className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}><input type="radio" name="cpay" checked={v.custPayCredit} onChange={v.setPayCredit} />เครดิต</label>
                  </div>
                </div>
              </div>
              {v.custPayCredit && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}>
                  <div className="field"><label>วงเงินเครดิต (฿)</label><input className="input" inputMode="numeric" value={v.custF.limit} onChange={(e) => v.onCFLimit(e.target.value)} /></div>
                  <div className="field"><label>ยอดค้าง (฿)</label><input className="input" inputMode="numeric" value={v.custF.balance} onChange={(e) => v.onCFBalance(e.target.value)} /></div>
                  <div className="field"><label>เทอม (วัน)</label><input className="input" inputMode="numeric" value={v.custF.term} onChange={(e) => v.onCFTerm(e.target.value)} /></div>
                </div>
              )}
              <div className="field"><label>เงื่อนไข / ข้อจำกัดพิเศษ (บรรทัดละ 1 ข้อ)</label>
                <textarea className="input" style={{ minHeight: 74 }} value={v.custF.conds} onChange={(e) => v.onCFConds(e.target.value)} placeholder={'เช่น ส่งก่อน 12:00\nเก็บเงินสดเท่านั้น'} />
              </div>
              <div className="field"><label>สถานะบัญชี</label>
                <select className="input" value={v.custF.status} onChange={(e) => v.onCFStatus(e.target.value as 'active' | 'hold')}>
                  <option value="active">ปกติ</option>
                  <option value="hold">ระงับ / ตรวจสอบ</option>
                </select>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeCust}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.saveCust}>บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
