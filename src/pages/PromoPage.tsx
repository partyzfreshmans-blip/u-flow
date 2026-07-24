import { computePromo } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function PromoPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePromo(state, actions);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาตาม SKU หรือชื่อสินค้า" value={v.promoQ} onChange={(e) => v.onPromoSearch(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={v.openPromo}><i className="ph ph-plus" />สร้างโปรโมชั่น</button>
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr><th>โปรโมชั่น</th><th>SKU / สินค้า</th><th>ประเภท</th><th>ช่วงเวลา</th><th>สถานะ</th><th></th></tr>
          </thead>
          <tbody>
            {v.promos.map((p, i) => (
              <tr key={p.sku + i}>
                <td style={{ fontWeight: 500 }}>{p.name}<div style={{ fontSize: 11.5, color: 'var(--color-accent-300)' }}>{p.value}</div></td>
                <td style={{ fontSize: 13 }}>{p.sku}<div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{p.skuName}</div></td>
                <td><span style={p.typeStyle}>{p.type}</span></td>
                <td style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{p.period}</td>
                <td><span style={p.stStyle}>{p.stLabel}</span></td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }}>แก้ไข</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {v.promoModalOpen && (
        <div className="dialog-backdrop" onClick={v.closePromo}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">สร้างโปรโมชั่นใหม่</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="field"><label>ชื่อโปรโมชั่น</label><input className="input" placeholder="เช่น น้ำปลาทิพรส ลด 10%" value={v.promoForm.name} onChange={(e) => v.onPromoName(e.target.value)} /></div>
              <div className="field"><label>ผูกกับ SKU</label><input className="input" placeholder="ค้นหา SKU หรือชื่อสินค้า" value={v.promoForm.sku} onChange={(e) => v.onPromoSku(e.target.value)} /></div>
              <div className="field"><label>ประเภทส่วนลด</label>
                <div className="seg" style={{ width: '100%' }}>
                  {['ลดราคา', 'ซื้อพ่วง', 'ของแถม'].map((t) => (
                    <label key={t} className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                      <input type="radio" name="pt" checked={v.promoForm.type === t} onChange={() => v.onPromoType(t)} />{t}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div className="field"><label>วันที่เริ่ม</label><input className="input" type="date" value={v.promoForm.start} onChange={(e) => v.onPromoStart(e.target.value)} /></div>
                <div className="field"><label>วันที่สิ้นสุด</label><input className="input" type="date" value={v.promoForm.end} onChange={(e) => v.onPromoEnd(e.target.value)} /></div>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closePromo}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.addPromo}>สร้างโปรโมชั่น</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
