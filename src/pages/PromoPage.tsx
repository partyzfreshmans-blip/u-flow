import { canEditPage } from '../config/permissions';
import { computePromo } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function PromoPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePromo(state, actions);
  const canEdit = state.session ? canEditPage(state.session.role, 'promo') : false;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาตาม SKU หรือชื่อสินค้า" value={v.promoQ} onChange={(e) => v.onPromoSearch(e.target.value)} />
        </div>
        {canEdit && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={v.openPromo}><i className="ph ph-plus" />สร้างโปรโมชั่น</button>}
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr><th>โปรโมชั่น</th><th>SKU / สินค้า</th><th>ประเภท</th><th>ราคาตามจำนวน</th><th>ช่วงเวลา</th><th>สถานะ</th><th></th></tr>
          </thead>
          <tbody>
            {v.promos.map((p, i) => (
              <tr key={p.sku + i}>
                <td style={{ fontWeight: 500 }}>{p.name}<div style={{ fontSize: 11.5, color: 'var(--color-accent-300)' }}>{p.value}</div></td>
                <td style={{ fontSize: 13 }}>{p.sku}<div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{p.skuName}</div></td>
                <td><span style={p.typeStyle}>{p.type}</span></td>
                <td style={{ fontSize: 11.5 }}>
                  {p.tierRows.length === 0 ? (
                    <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {p.tierRows.map((t, ti) => (
                        <div key={ti} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', minWidth: 132, fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: 'var(--color-neutral-400)' }}>{t.label}</span>
                          <b>{t.priceText}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{p.period}</td>
                <td><span style={p.stStyle}>{p.stLabel}</span></td>
                <td style={{ textAlign: 'right' }}>{canEdit && <button className="btn btn-ghost" style={{ fontSize: 12 }}>แก้ไข</button>}</td>
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

              <div className="field"><label>คิดราคาต่อหน่วย</label>
                <div className="seg" style={{ width: '100%' }}>
                  {v.promoUnits.map((u) => (
                    <label key={u} className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                      <input type="radio" name="pu" checked={v.promoForm.unit === u} onChange={() => v.onPromoUnit(u)} />{u}
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>ราคาตามจำนวน (โปรขั้นบันได)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {v.tierRows.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', width: 54, flex: 'none' }}>
                        {t.isFirst ? 'ตั้งแต่' : 'ตั้งแต่'}
                      </span>
                      <input className="input" style={{ minHeight: 32, width: 74, textAlign: 'right' }} inputMode="numeric"
                        value={t.minQty} onChange={(e) => t.onMinQty(e.target.value)} placeholder="1" />
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', width: 46, flex: 'none' }}>{v.promoForm.unit}ขึ้นไป</span>
                      <input className="input" style={{ minHeight: 32, flex: 1, textAlign: 'right' }} inputMode="numeric"
                        value={t.price} onChange={(e) => t.onPrice(e.target.value)} placeholder="ราคา/หน่วย" />
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', flex: 'none' }}>บาท</span>
                      <button className="btn btn-icon btn-ghost" onClick={t.remove} disabled={v.tierRows.length === 1} title="ลบขั้นนี้">
                        <i className="ph ph-x" style={{ fontSize: 12 }} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn btn-secondary" style={{ marginTop: 8, minHeight: 30 }} onClick={v.addTier}>
                  <i className="ph ph-plus" />เพิ่มขั้นราคา
                </button>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 6, lineHeight: 1.5 }}>
                  <i className="ph ph-info" style={{ marginRight: 4 }} />ซื้อมากขึ้นได้ราคาถูกลง เช่น 1 ลัง 279 บาท · 5 ลังขึ้นไป 275 บาท · 20 ลังขึ้นไป 270 บาท
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div className="field"><label>วันที่เริ่ม</label><input className="input" type="date" value={v.promoForm.start} onChange={(e) => v.onPromoStart(e.target.value)} /></div>
                <div className="field"><label>วันที่สิ้นสุด</label><input className="input" type="date" value={v.promoForm.end} onChange={(e) => v.onPromoEnd(e.target.value)} /></div>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closePromo}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.addPromo} disabled={!v.canSavePromo}>สร้างโปรโมชั่น</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
