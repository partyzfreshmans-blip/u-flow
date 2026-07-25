import { computeOrderDetail } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function OrderDetailModal({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeOrderDetail(state);
  if (!v.open) return null;

  return (
    <div className="dialog-backdrop" onClick={actions.closeOrderDetail}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 100%)' }}>
        <div className="dialog-title">รายการสินค้า · {v.orderNo}</div>
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
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={actions.closeOrderDetail}>ปิด</button>
        </div>
      </div>
    </div>
  );
}
