import { canEditPage } from '../config/permissions';
import { computeSku } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function SkuPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeSku(state, actions);
  const canEdit = state.session ? canEditPage(state.session.role, 'sku') : false;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหา SKU / บาร์โค้ด / ชื่อสินค้า" value={v.skuQ} onChange={(e) => v.onSkuSearch(e.target.value)} />
        </div>
        {canEdit && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={v.openAddSku}><i className="ph ph-plus" />เพิ่มสินค้าใหม่</button>}
      </div>

      {v.skusLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 14, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดข้อมูลสินค้าจาก Google Sheet...
        </div>
      )}
      {v.skusError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 14, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดข้อมูลสินค้าไม่สำเร็จ: {v.skusError}
        </div>
      )}
      {!v.skusLoading && !v.skusError && (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 10 }}>โหลดจาก Google Sheet แล้ว {v.skuCount} รายการ</div>
      )}

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr><th>รหัสสินค้า (SKU)</th><th>บาร์โค้ด</th><th>ชื่อสินค้า</th><th>หน่วยนับ</th><th style={{ textAlign: 'right' }}>สต็อกปัจจุบัน</th><th>สถานะ</th><th></th></tr>
          </thead>
          <tbody>
            {v.skuRows.map((s) => (
              <tr key={s.key}>
                <td style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{s.id}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-400)', fontSize: 13 }}>{s.barcode}</td>
                <td>{s.name}</td>
                <td style={{ color: 'var(--color-neutral-400)' }}>{s.unit}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...s.stockStyle }}>{s.stockText}</td>
                <td><span style={s.stStyle}>{s.stLabel}</span></td>
                <td style={{ textAlign: 'right' }}>{canEdit && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={s.edit}>แก้ไข</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {v.skuModalOpen && (
        <div className="dialog-backdrop" onClick={v.closeSku}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{v.skuModalTitle}</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div className="field"><label>รหัสสินค้า (SKU ID)</label><input className="input" value={v.skuF.id} onChange={(e) => v.onFormId(e.target.value)} disabled={v.skuIsEdit} /></div>
                <div className="field"><label>บาร์โค้ด</label><input className="input" value={v.skuF.barcode} onChange={(e) => v.onFormBarcode(e.target.value)} /></div>
              </div>
              <div className="field"><label>ชื่อสินค้า</label><input className="input" value={v.skuF.name} onChange={(e) => v.onFormName(e.target.value)} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}>
                <div className="field"><label>หน่วยนับ</label>
                  <select className="input" value={v.skuF.unit} onChange={(e) => v.onFormUnit(e.target.value)}>
                    {['ชิ้น', 'ขวด', 'กระป๋อง', 'ถุง', 'ซอง', 'แพค', 'ลัง'].map((u) => <option key={u}>{u}</option>)}
                  </select>
                </div>
                <div className="field"><label>สต็อก</label><input className="input" inputMode="numeric" value={v.skuF.stock} onChange={(e) => v.onFormStock(e.target.value)} /></div>
                <div className="field"><label>สถานะ</label>
                  <select className="input" value={v.skuF.status} onChange={(e) => v.onFormStatus(e.target.value as 'active' | 'inactive')}>
                    <option value="active">มีสินค้า</option>
                    <option value="inactive">หมด</option>
                  </select>
                </div>
              </div>
            </div>
            {v.skuSaveError && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
                <i className="ph ph-warning-fill" style={{ marginRight: 6 }} />{v.skuSaveError}
              </div>
            )}
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeSku} disabled={v.skuSaving}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.saveSku} disabled={v.skuSaving}>
                {v.skuSaving ? <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึกลง Google Sheet...</> : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
