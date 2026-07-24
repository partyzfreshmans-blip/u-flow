import { computeGrn } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function GrnPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeGrn(state, actions);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card elev-sm" style={{ gap: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}><i className="ph ph-truck" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />แหล่งที่มา / ซัพพลายเออร์</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>ซัพพลายเออร์</label>
              <select className="input" value={v.grnSupplier} onChange={(e) => v.onSupplier(e.target.value)}>
                <option value="">— เลือกซัพพลายเออร์ —</option>
                {v.suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field"><label>เลขที่ใบส่งของ</label><input className="input" placeholder="เช่น SP-2209" value={v.grnDoc} onChange={(e) => v.onGrnDoc(e.target.value)} /></div>
            <div className="field"><label>วันที่รับเข้า</label><input className="input" type="date" value={v.grnDate} onChange={(e) => v.onGrnDate(e.target.value)} /></div>
            <div className="field"><label>ผู้บันทึก</label><input className="input" value="admin.warehouse" disabled /></div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}><i className="ph ph-info" style={{ marginRight: 4 }} />ข้อมูลซัพพลายเออร์เก็บอยู่ในหน้านี้เท่านั้น ไม่ปนกับฐานข้อมูลสินค้า (SKU master)</div>
        </div>

        <div className="card elev-sm" style={{ gap: 13 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}><i className="ph ph-barcode" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />เพิ่มรายการรับเข้า</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>สแกน / กรอกบาร์โค้ด</label>
              <input
                className="input"
                placeholder="เช่น 8850001112223"
                value={v.grnBarcode}
                onChange={(e) => v.onBarcode(e.target.value)}
                onKeyDown={(e) => v.onBarcodeKey(e.key)}
              />
            </div>
            <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={v.lookup}><i className="ph ph-magnifying-glass" />ค้นหา SKU</button>
          </div>

          {v.lookupFound && (
            <div style={{ padding: 13, borderRadius: 10, background: 'var(--st-ok-bg)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--st-ok-fg) 30%, transparent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--st-ok-fg)', marginBottom: 11 }}>
                <i className="ph ph-check-circle-fill" />พบ SKU: <b>{v.found.name}</b> ({v.found.id}) · หน่วยนับ {v.found.unit}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <div className="field"><label>ราคา/หน่วย (฿)</label><input className="input" inputMode="numeric" value={v.grnPrice} onChange={(e) => v.onPrice(e.target.value)} /></div>
                <div className="field"><label>จำนวน (ชิ้น)</label><input className="input" inputMode="numeric" value={v.grnQtyPiece} onChange={(e) => v.onQtyPiece(e.target.value)} /></div>
                <div className="field"><label>จำนวน (แพค)</label><input className="input" inputMode="numeric" value={v.grnQtyPack} onChange={(e) => v.onQtyPack(e.target.value)} /></div>
                <div className="field"><label>จำนวน (ลัง)</label><input className="input" inputMode="numeric" value={v.grnQtyCase} onChange={(e) => v.onQtyCase(e.target.value)} /></div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 11 }} onClick={v.addLine}><i className="ph ph-plus" />เพิ่มลงรายการ</button>
            </div>
          )}

          {v.lookupMissing && (
            <div style={{ padding: 13, borderRadius: 10, background: 'var(--st-bad-bg)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--st-bad-fg) 30%, transparent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--st-bad-fg)' }}>
                <i className="ph ph-warning-fill" />ไม่พบ SKU นี้ในระบบ (บาร์โค้ด {v.grnBarcode})
              </div>
              {v.newSkuClosed && (
                <button className="btn btn-secondary" style={{ marginTop: 11 }} onClick={v.openNewSku}><i className="ph ph-plus-circle" />ขอสร้าง SKU ใหม่</button>
              )}
              {v.newSkuOpen && (
                <>
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <div className="field"><label>ชื่อสินค้า</label><input className="input" placeholder="ชื่อสินค้าใหม่" value={v.grnNewName} onChange={(e) => v.onNewName(e.target.value)} /></div>
                    <div className="field"><label>หน่วยนับ</label>
                      <select className="input" value={v.grnNewUnit} onChange={(e) => v.onNewUnit(e.target.value)}>
                        {['ชิ้น', 'ขวด', 'กระป๋อง', 'ถุง', 'ซอง', 'แพค', 'ลัง'].map((u) => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={v.createSku}><i className="ph ph-check" />สร้าง SKU แล้วใช้ต่อ</button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="card elev-sm" style={{ padding: '4px 14px 10px' }}>
          <div style={{ padding: '12px 2px 4px', fontWeight: 600, fontSize: 14 }}>รายการที่จะรับเข้า ({v.grnLineCount})</div>
          <table className="table">
            <thead>
              <tr><th>สินค้า</th><th>บาร์โค้ด</th><th style={{ textAlign: 'right' }}>ราคา/หน่วย</th><th style={{ textAlign: 'right' }}>จำนวน</th><th></th></tr>
            </thead>
            <tbody>
              {v.grnLines.map((l, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{l.name}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{l.barcode}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.priceText}</td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{l.qtyText}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-icon btn-ghost" onClick={l.remove}><i className="ph ph-trash" style={{ fontSize: 14 }} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.grnEmpty && <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ยังไม่มีรายการ — สแกนบาร์โค้ดเพื่อเริ่มบันทึก</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 2px 4px' }}>
            <button className="btn btn-primary" onClick={v.saveGrn} disabled={v.grnEmpty}><i className="ph ph-floppy-disk" />บันทึกรับของเข้าคลัง</button>
          </div>
        </div>
      </div>

      <div className="card elev-sm" style={{ gap: 2, position: 'sticky', top: 96 }}>
        <div style={{ fontWeight: 600, fontSize: 14, padding: '2px 0 8px' }}><i className="ph ph-clock-counter-clockwise" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />ประวัติการรับเข้า (audit log)</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {v.grnLog.map((g, i) => (
            <div key={i} style={{ display: 'flex', gap: 11, padding: '11px 2px', boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
              <i className="ph ph-tray-arrow-down" style={{ fontSize: 16, color: 'var(--color-accent-300)', marginTop: 2 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{g.supplier} <span style={{ color: 'var(--color-neutral-500)', fontWeight: 400 }}>· {g.doc}</span></div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{g.count} รายการ</div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 2 }}>{g.when} · โดย {g.by}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
