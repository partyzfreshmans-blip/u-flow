import { AttachmentPanel } from '../components/AttachmentPanel';
import { DISCOUNT_MODES, RECEIVING_TYPES, type DiscountMode, type ReceivingType } from '../data/receiving';
import { computeReceiving } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

const UNITS = ['ชิ้น', 'ขวด', 'กระป๋อง', 'ถุง', 'ซอง', 'แพ็ค', 'ลัง', 'หีบ'];

export function ReceivingPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeReceiving(state, actions);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* bill header */}
      <div className="card elev-sm" style={{ gap: 13 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>
          <i className="ph ph-truck" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />ข้อมูลบิล / ซัพพลายเออร์
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>ชื่อซัพพลายเออร์ *</label>
            <input className="input" list="known-suppliers" placeholder="พิมพ์ชื่อ หรือเลือกจากที่เคยบันทึก" value={v.supplier} onChange={(e) => v.onSupplier(e.target.value)} />
            <datalist id="known-suppliers">
              {v.historySuppliers.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div className="field"><label>เลขบิล / ใบส่งของ *</label><input className="input" placeholder="เช่น SP-2209" value={v.billNo} onChange={(e) => v.onBillNo(e.target.value)} /></div>
          <div className="field"><label>วันที่รับเข้า</label><input className="input" type="date" value={v.date} onChange={(e) => v.onDate(e.target.value)} /></div>
        </div>
        <div className="field"><label>หมายเหตุรวมของบิลนี้</label><input className="input" placeholder="เช่น ของครบ แต่กล่องบุบ 2 ใบ" value={v.note} onChange={(e) => v.onNote(e.target.value)} /></div>

        <div className="hr" style={{ margin: '2px 0' }} />
        <AttachmentPanel
          state={state}
          actions={actions}
          scope="receiving"
          storageKey={v.folderKey}
          label="แนบไฟล์บิลจากซัพพลายเออร์"
          hint="รับ PDF, JPG, PNG ไม่เกิน 10MB ต่อไฟล์ · เก็บใน Drive แยกตามวันที่-ซัพพลายเออร์"
          disabledReason={v.supplier.trim() === '' ? 'กรอกชื่อซัพพลายเออร์ก่อน จึงจะแนบไฟล์ได้ (ใช้ตั้งชื่อโฟลเดอร์)' : undefined}
        />
      </div>

      {/* line items */}
      <div className="card elev-sm" style={{ gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            <i className="ph ph-list-plus" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />รายการสินค้าที่รับเข้า ({v.lineCount})
          </div>
          {v.hasDiscrepancy && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 10px', borderRadius: 6, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)' }}>
              <i className="ph ph-warning-fill" />จำนวนไม่ตรงกับบิล {v.discrepancyCount} รายการ
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13 }}>รวมสุทธิ <b style={{ fontVariantNumeric: 'tabular-nums' }}>{v.grandTotalText}</b></span>
            <button className="btn btn-secondary" onClick={v.addLine}><i className="ph ph-plus" />เพิ่มรายการ</button>
          </div>
        </div>

        {v.skusLoading && (
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
            <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite', marginRight: 5 }} />กำลังโหลด SKU master…
          </div>
        )}

        {v.isEmpty ? (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5, borderRadius: 9, background: 'var(--color-bg)' }}>
            ยังไม่มีรายการ — กด "เพิ่มรายการ" เพื่อเริ่มบันทึกทีละ SKU
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {v.lines.map((l, idx) => (
              <div key={l.id} style={{ padding: 12, borderRadius: 10, background: 'var(--color-bg)', boxShadow: l.hasDiff ? 'inset 0 0 0 1.5px var(--st-bad-fg)' : 'inset 0 0 0 1px var(--color-divider)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>รายการที่ {idx + 1}</span>
                  <span style={l.diffStyle}>{l.diffText}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12.5 }}>สุทธิ <b style={{ fontVariantNumeric: 'tabular-nums' }}>{l.netTotalText}</b></span>
                  <button className="btn btn-icon btn-ghost" onClick={l.remove} title="ลบรายการนี้"><i className="ph ph-trash" style={{ fontSize: 14 }} /></button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.4fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div className="field">
                    <label>สินค้าใน Unii (SKU master)</label>
                    <select className="input" style={{ minHeight: 32 }} value={l.skuId} onChange={(e) => l.onSku(e.target.value)}>
                      <option value="">— เลือก SKU —</option>
                      {v.skuOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>ชื่อในบิล (ถ้าไม่ตรงกับระบบ)</label>
                    <input className="input" style={{ minHeight: 32 }} value={l.billName} onChange={(e) => l.set({ billName: e.target.value })} placeholder="พิมพ์ชื่อตามที่ระบุในบิล" />
                  </div>
                  <div className="field">
                    <label>บาร์โค้ดจากบิล</label>
                    <input className="input" style={{ minHeight: 32 }} value={l.billBarcode} onChange={(e) => l.set({ billBarcode: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 10 }}>
                  <div className="field"><label>หน่วยนับ</label>
                    <select className="input" style={{ minHeight: 32 }} value={l.unit} onChange={(e) => l.set({ unit: e.target.value })}>
                      {UNITS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>จำนวนตามบิล</label>
                    <input className="input" style={{ minHeight: 32, textAlign: 'right' }} inputMode="numeric" value={String(l.billQty)} onChange={(e) => l.set({ billQty: Number(e.target.value.replace(/[^0-9]/g, '') || 0) })} />
                  </div>
                  <div className="field"><label>จำนวนรับจริง</label>
                    <input className="input" style={{ minHeight: 32, textAlign: 'right', ...(l.hasDiff ? { borderColor: 'var(--st-bad-fg)' } : {}) }} inputMode="numeric" value={String(l.actualQty)} onChange={(e) => l.set({ actualQty: Number(e.target.value.replace(/[^0-9]/g, '') || 0) })} />
                  </div>
                  <div className="field"><label>ราคา/หน่วย (฿)</label>
                    <input className="input" style={{ minHeight: 32, textAlign: 'right' }} inputMode="numeric" value={String(l.unitPrice)} onChange={(e) => l.set({ unitPrice: Number(e.target.value.replace(/[^0-9.]/g, '') || 0) })} />
                  </div>
                  <div className="field"><label>ส่วนลด</label>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <input className="input" style={{ minHeight: 32, textAlign: 'right', flex: 1 }} inputMode="numeric" value={String(l.discount)} onChange={(e) => l.set({ discount: Number(e.target.value.replace(/[^0-9.]/g, '') || 0) })} />
                      <select className="input" style={{ minHeight: 32, width: 62 }} value={l.discountMode} onChange={(e) => l.set({ discountMode: e.target.value as DiscountMode })}>
                        {DISCOUNT_MODES.map((m) => <option key={m} value={m}>{m === 'baht' ? '฿' : '%'}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field"><label>ประเภท</label>
                    <select className="input" style={{ minHeight: 32 }} value={l.type} onChange={(e) => l.set({ type: e.target.value as ReceivingType })}>
                      {RECEIVING_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label>หมายเหตุรายการนี้</label>
                  <input className="input" style={{ minHeight: 32 }} value={l.note} onChange={(e) => l.set({ note: e.target.value })} placeholder="เช่น ของขาด 2 ลัง แจ้ง supplier แล้ว" />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {!v.canSave && v.lineCount > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--st-warn-fg)' }}>
              <i className="ph ph-warning" style={{ marginRight: 4 }} />ต้องกรอกซัพพลายเออร์ เลขบิล และชื่อสินค้าให้ครบก่อนบันทึก
            </span>
          )}
          <button className="btn btn-primary" onClick={v.save} disabled={!v.canSave}>
            <i className="ph ph-floppy-disk" />บันทึกการรับเข้า
          </button>
        </div>

        {v.savedKey && (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)', fontSize: 12.5 }}>
            <i className="ph ph-check-circle-fill" style={{ flex: 'none' }} />บันทึกเรียบร้อย — ดูได้ในประวัติด้านล่าง
          </div>
        )}
      </div>

      {/* history */}
      <div className="card elev-sm" style={{ gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            <i className="ph ph-clock-counter-clockwise" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />ประวัติการรับเข้า ({v.historyCount}/{v.totalRecords})
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="input" style={{ width: 'auto', minHeight: 32, fontSize: 12 }} value={v.filterSupplier} onChange={(e) => v.onFilterSupplier(e.target.value)}>
              <option value="all">ทุกซัพพลายเออร์</option>
              {v.historySuppliers.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input className="input" type="date" style={{ width: 'auto', minHeight: 32, fontSize: 12 }} value={v.filterDate} onChange={(e) => v.onFilterDate(e.target.value)} />
            <input className="input" style={{ width: 170, minHeight: 32, fontSize: 12 }} placeholder="ค้นหา SKU / ชื่อ / บาร์โค้ด" value={v.filterSku} onChange={(e) => v.onFilterSku(e.target.value)} />
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.clearFilters}>ล้างตัวกรอง</button>
          </div>
        </div>

        {v.history.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>
            {v.totalRecords === 0 ? 'ยังไม่มีประวัติการรับเข้า' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {v.history.map((r) => (
              <div key={r.id} style={{ padding: 12, borderRadius: 10, background: 'var(--color-bg)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.supplier}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>บิล {r.billNo} · {r.receivedDate}</span>
                  {r.hasDiscrepancy && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)' }}>
                      <i className="ph ph-warning-fill" />ไม่ตรง {r.discrepancyCount} รายการ
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 12.5 }}>{r.lineCount} รายการ · <b style={{ fontVariantNumeric: 'tabular-nums' }}>{r.totalText}</b></span>
                  <button className="btn btn-icon btn-ghost" onClick={r.remove} title="ลบบันทึกนี้"><i className="ph ph-trash" style={{ fontSize: 13 }} /></button>
                </div>
                {r.note && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', marginBottom: 8 }}>หมายเหตุ: {r.note}</div>}
                <table className="table">
                  <thead>
                    <tr>
                      <th>สินค้า</th><th>บาร์โค้ด</th><th style={{ textAlign: 'right' }}>ตามบิล</th><th style={{ textAlign: 'right' }}>รับจริง</th>
                      <th style={{ textAlign: 'center' }}>ผลต่าง</th><th style={{ textAlign: 'right' }}>ราคา/หน่วย</th><th>ประเภท</th><th style={{ textAlign: 'right' }}>สุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.uniiName || l.billName}
                          {l.billName && l.uniiName && l.billName !== l.uniiName && (
                            <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)' }}>ในบิล: {l.billName}</div>
                          )}
                          {l.note && <div style={{ fontSize: 10.5, color: 'var(--st-warn-fg)' }}>{l.note}</div>}
                        </td>
                        <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{l.billBarcode || '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.billQty} {l.unit}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: l.diff !== 0 ? 600 : 400 }}>{l.actualQty} {l.unit}</td>
                        <td style={{ textAlign: 'center' }}><span style={l.diffStyle}>{l.diffText}</span></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.unitPrice.toLocaleString('en-US')}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{l.type}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{l.netTotalText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 10 }}>
                  <AttachmentPanel state={state} actions={actions} scope="receiving" storageKey={r.folderKey} label="ไฟล์บิลที่แนบไว้" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
