import { computeOrderDetail } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import { AttachmentPanel } from './AttachmentPanel';

export function OrderDetailModal({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeOrderDetail(state, actions);
  if (!v.open) return null;

  return (
    <div className="dialog-backdrop" onClick={actions.closeOrderDetail}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 100%)' }}>
        <div className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          รายการสินค้า · {v.orderNo}
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 11.5 }} onClick={v.viewHistory}>
            <i className="ph ph-clock-counter-clockwise" />ดูประวัติการแก้ไข
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', marginTop: -6 }}>{v.customer}</div>
        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {v.loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
              <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดรายการสินค้า...
            </div>
          )}
          {v.error && (
            <div style={{ display: 'flex', gap: 9, padding: 13, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
              <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดรายการสินค้าไม่สำเร็จ: {v.error}
            </div>
          )}
          {v.isEmpty && <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบรายการสินค้าสำหรับออเดอร์นี้ใน SKU Detail</div>}
          {!v.loading && !v.error && v.lines.length > 0 && (
            <table className="table">
              <thead>
                <tr><th>SKU</th><th>สินค้า</th><th>หน่วย</th><th style={{ textAlign: 'right' }}>จำนวน</th><th style={{ textAlign: 'right' }}>ราคา/หน่วย</th><th style={{ textAlign: 'right' }}>ยอดรวม</th></tr>
              </thead>
              <tbody>
                {v.lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{l.sku}</td>
                    <td>{l.name}</td>
                    <td style={{ color: 'var(--color-neutral-400)' }}>{l.unit}</td>
                    <td style={{ textAlign: 'right' }}>{l.qty}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.unitPriceText}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{l.lineTotalText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!v.loading && !v.error && v.lines.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, fontSize: 14, fontWeight: 600, paddingTop: 4 }}>
              <span style={{ color: 'var(--color-neutral-400)', fontWeight: 400 }}>รวมทั้งหมด</span>{v.totalText}
            </div>
          )}

          <div className="hr" style={{ margin: '4px 0' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>แก้ไขข้อมูลออเดอร์</div>
            {!v.canEdit && (
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                <i className="ph ph-info" style={{ marginRight: 4 }} />ไม่พบออเดอร์นี้ในชีท "คำสั่งซื้อ" — แก้ไขได้เมื่อออเดอร์ถูกจัดเข้าชีทนี้แล้ว
              </div>
            )}
            {v.canEdit && !v.canEditRole && (
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                <i className="ph ph-eye" style={{ marginRight: 4 }} />สิทธิ์ของคุณดูได้อย่างเดียว
              </div>
            )}
            {v.canEdit && v.canEditRole && (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--color-neutral-400)' }}>
                    วันที่จะจัดส่ง
                    <input type="date" className="input" style={{ minHeight: 32, width: 170 }} value={v.plannedDeliveryDate} onChange={(e) => v.onPlannedDeliveryDate(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginTop: 19 }}>
                    <input type="checkbox" checked={v.wantsTaxInvoice} onChange={(e) => v.onWantsTaxInvoice(e.target.checked)} />
                    ต้องการใบกำกับภาษี
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--color-neutral-400)' }}>
                  หมายเหตุ
                  <textarea className="input" style={{ minHeight: 60, resize: 'vertical', fontFamily: 'var(--font-body)' }} value={v.note} onChange={(e) => v.onNote(e.target.value)} placeholder="เช่น เงื่อนไขพิเศษ, ปัญหาที่พบ" />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={v.save} disabled={v.saving}>
                    {v.saving ? (
                      <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>
                    ) : (
                      <><i className="ph ph-floppy-disk" />บันทึกกลับชีท</>
                    )}
                  </button>
                  {v.saved && (
                    <span style={{ fontSize: 12, color: 'var(--st-ok-fg)' }}><i className="ph ph-check-circle-fill" style={{ marginRight: 4 }} />บันทึกสำเร็จ</span>
                  )}
                  {v.saveError && (
                    <span style={{ fontSize: 12, color: 'var(--st-bad-fg)' }}><i className="ph ph-warning-fill" style={{ marginRight: 4 }} />{v.saveError} — ลองใหม่อีกครั้ง</span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="hr" style={{ margin: '4px 0' }} />

          <AttachmentPanel
            state={state}
            actions={actions}
            scope="order"
            storageKey={v.orderNo}
            label="ใบส่งสินค้า / ใบเสร็จ / ใบกำกับภาษี"
            hint="แนบไฟล์ที่ปริ้นจากระบบ Unii · รับ PDF, JPG, PNG ไม่เกิน 10MB ต่อไฟล์ · แนบได้หลายไฟล์"
          />
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={actions.closeOrderDetail}>ปิด</button>
        </div>
      </div>
    </div>
  );
}
