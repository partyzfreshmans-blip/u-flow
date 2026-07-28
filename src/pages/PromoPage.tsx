import { canEditPage } from '../config/permissions';
import { computePromo, computePromoUsage } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function PromoPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePromo(state, actions);
  const u = computePromoUsage(state, actions);
  const canEdit = state.session ? canEditPage(state.session.role, 'promo') : false;
  const saving = v.promoSaveStatus?.state === 'saving';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาตาม SKU หรือชื่อสินค้า" value={v.promoQ} onChange={(e) => v.onPromoSearch(e.target.value)} />
        </div>
        {canEdit && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={v.openPromo}><i className="ph ph-plus" />สร้างโปรโมชั่น</button>}
      </div>

      {v.promosError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดโปรโมชั่นไม่สำเร็จ: {v.promosError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {v.statusChips.map((c) => (
          <button key={c.key} style={c.style} onClick={c.go}>
            {c.label}<span style={{ opacity: 0.6, marginLeft: 6 }}>{c.count}</span>
          </button>
        ))}
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr><th>โปรโมชั่น</th><th>SKU / สินค้า</th><th>ประเภท</th><th>ราคา</th><th>ช่วงเวลา</th><th>สถานะ</th><th></th></tr>
          </thead>
          <tbody>
            {v.promos.map((p, i) => (
              <tr key={p.sku + i}>
                <td style={{ fontWeight: 500 }}>{p.name}<div style={{ fontSize: 11.5, color: 'var(--color-accent-300)' }}>{p.value}</div></td>
                <td style={{ fontSize: 13 }}>{p.sku}<div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{p.skuName}</div></td>
                <td><span style={p.typeStyle}>{p.type}</span></td>
                <td style={{ fontSize: 11.5 }}>
                  {p.isPackUnits ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {p.packUnitRows.map((u, ui) => (
                        <div key={ui} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', minWidth: 168, fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: 'var(--color-neutral-400)' }}>{u.label}{u.qtyPerUnit > 1 ? `(${u.qtyPerUnit})` : ''}</span>
                          <b>{u.priceText}</b>
                          <span style={{ color: 'var(--color-neutral-500)', fontSize: 10.5 }}>{u.avgText}</span>
                        </div>
                      ))}
                    </div>
                  ) : p.tierRows.length === 0 ? (
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
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={p.viewUsage}>ดูสถิติการใช้งาน</button>
                  {canEdit && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={p.edit}>แก้ไข</button>}
                </td>
              </tr>
            ))}
            {v.promos.length === 0 && !v.promosLoading && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 26, color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบโปรโมชั่นที่ตรงกับตัวกรอง</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {v.promoModalOpen && (
        <div className="dialog-backdrop" onClick={v.closePromo}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{v.isEditingPromo ? `แก้ไขโปรโมชั่น — ${v.editingPromoSku}` : 'สร้างโปรโมชั่นใหม่'}</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="field"><label>ชื่อสินค้า (Product Name)</label><input className="input" placeholder="เช่น เบนเนท สบู่วิตามินซี&อี ส้ม 130ก" value={v.promoForm.name} onChange={(e) => v.onPromoName(e.target.value)} /></div>
              <div className="field">
                <label>ผูกกับ SKU</label>
                <input
                  className="input"
                  placeholder="ค้นหา SKU หรือชื่อสินค้า"
                  value={v.promoForm.sku}
                  onChange={(e) => v.onPromoSku(e.target.value)}
                  disabled={v.isEditingPromo}
                />
                {v.isEditingPromo && (
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 4 }}>
                    <i className="ph ph-lock-simple" style={{ marginRight: 4 }} />SKU ล็อกไว้ขณะแก้ไข (ใช้จับคู่แถวเดิมในชีท)
                  </div>
                )}
              </div>

              <div className="field"><label>รูปแบบราคา</label>
                <div className="seg" style={{ width: '100%' }}>
                  <label className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                    <input type="radio" name="pm" checked={v.promoForm.mode === 'packUnits'} onChange={() => v.onPromoMode('packUnits')} />
                    ตามหน่วยบรรจุ (ชิ้น/แพ็ค/หีบ)
                  </label>
                  <label className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
                    <input type="radio" name="pm" checked={v.promoForm.mode === 'tiers'} onChange={() => v.onPromoMode('tiers')} />
                    ขั้นบันได (ซื้อเยอะราคาถูกลง)
                  </label>
                </div>
              </div>

              {v.promoForm.mode === 'packUnits' ? (
                <div className="field">
                  <label>ราคาต่อหน่วยบรรจุ</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {v.packUnitRows.map((u, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select className="input" style={{ minHeight: 32, width: 92 }} value={u.label} onChange={(e) => u.onLabel(e.target.value as typeof u.label)}>
                          {v.promoUnits.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>บรรจุ</span>
                        <input className="input" style={{ minHeight: 32, width: 60, textAlign: 'right' }} inputMode="numeric"
                          value={u.qtyPerUnit} onChange={(e) => u.onQtyPerUnit(e.target.value)} placeholder="1" />
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', flex: 'none' }}>ชิ้น/หน่วยย่อย</span>
                        <input className="input" style={{ minHeight: 32, flex: 1, textAlign: 'right' }} inputMode="numeric"
                          value={u.price} onChange={(e) => u.onPrice(e.target.value)} placeholder="ราคา" />
                        <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', flex: 'none' }}>บาท</span>
                        <button className="btn btn-icon btn-ghost" onClick={u.remove} disabled={v.packUnitRows.length === 1} title="ลบหน่วยนี้">
                          <i className="ph ph-x" style={{ fontSize: 12 }} />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 100 }}>
                      {v.packUnitRows.map((u, i) => (
                        <div key={i} style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>เฉลี่ย {u.avgText}</div>
                      ))}
                    </div>
                  </div>
                  <button className="btn btn-secondary" style={{ marginTop: 8, minHeight: 30 }} onClick={v.addPackUnit}>
                    <i className="ph ph-plus" />เพิ่มหน่วยบรรจุ
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 6, lineHeight: 1.5 }}>
                    <i className="ph ph-info" style={{ marginRight: 4 }} />ระบุจำนวนที่บรรจุอยู่ข้างในหน่วยที่ใหญ่กว่าถัดไป เช่น แพ็คบรรจุ 4 ชิ้น ราคา 157 บาท (เฉลี่ย ฿39.25/ชิ้น) · หีบบรรจุ 24 แพ็ค ราคา 790 บาท (เฉลี่ย ฿32.91/ชิ้น)
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div className="field">
                  <label>วันที่เริ่ม{v.isEditingPromo ? ' (ว่าง = ไม่เปลี่ยน)' : ''}</label>
                  <input className="input" type="date" value={v.promoForm.start} onChange={(e) => v.onPromoStart(e.target.value)} />
                </div>
                <div className="field">
                  <label>วันที่สิ้นสุด{v.isEditingPromo ? ' (ว่าง = ไม่เปลี่ยน)' : ''}</label>
                  <input className="input" type="date" value={v.promoForm.end} onChange={(e) => v.onPromoEnd(e.target.value)} />
                </div>
              </div>

              {v.promoSaveStatus?.state === 'error' && (
                <div style={{ display: 'flex', gap: 8, padding: 10, borderRadius: 8, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
                  <i className="ph ph-warning-fill" style={{ flex: 'none' }} />บันทึกไม่สำเร็จ: {v.promoSaveStatus.message ?? 'ไม่ทราบสาเหตุ'}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closePromo} disabled={saving}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.savePromo} disabled={!v.canSavePromo || saving}>
                {saving ? (
                  <>
                    <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...
                  </>
                ) : v.isEditingPromo ? (
                  'บันทึกการแก้ไข'
                ) : (
                  'สร้างโปรโมชั่น'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {u.open && (
        <div className="dialog-backdrop" onClick={u.close}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 100%)' }}>
            <div className="dialog-title">สถิติการใช้งาน — {u.sku}</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', marginTop: -6 }}>{u.promoName}</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {u.isEmpty ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 13 }}>
                  <i className="ph ph-tray" style={{ fontSize: 22, display: 'block', marginBottom: 8 }} />
                  ยังไม่มีการใช้งาน
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                    <div className="card" style={{ gap: 4 }}>
                      <span className="card-kicker">ใช้ไปทั้งหมด</span>
                      <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 24 }}>{u.totalUses} ออเดอร์</div>
                    </div>
                    <div className="card" style={{ gap: 4 }}>
                      <span className="card-kicker">ยอดขายรวม</span>
                      <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 24 }}>{u.totalRevenueText}</div>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>ออเดอร์ที่ใช้โปรนี้</div>
                    <div className="table-scroll">
                      <table className="table table-compact">
                        <thead>
                          <tr><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th>วันที่สั่ง</th><th style={{ textAlign: 'right' }}>จำนวน</th><th style={{ textAlign: 'right' }}>ยอดรวม</th><th></th></tr>
                        </thead>
                        <tbody>
                          {u.orderRows.map((o, i) => (
                            <tr key={i}>
                              <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>{o.orderNo}</td>
                              <td>{o.customer}</td>
                              <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{o.orderedAtText}</td>
                              <td style={{ textAlign: 'right' }}>{o.qtyText}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.totalText}</td>
                              <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={o.viewOrder}>ดูออเดอร์</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>ลูกค้าที่สั่ง</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {u.customerRows.map((c, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 2px' }}>
                          <span>{c.customer}</span>
                          <b>{c.count} ครั้ง</b>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={u.close}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
