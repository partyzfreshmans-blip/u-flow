import { canEditCustomerLatLng } from '../config/permissions';
import { computeCustomer } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function CustomerPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeCustomer(state, actions);
  const canEditLatLng = state.session ? canEditCustomerLatLng(state.session.role) : false;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาชื่อ / เบอร์โทร" value={v.custQ} onChange={(e) => v.onCustSearch(e.target.value)} />
        </div>
        {!v.customersLoading && !v.customersError && (
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>โหลดจาก CS Master แล้ว {v.customerCount} รายการ</div>
        )}
      </div>

      {v.customersLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 14, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดรายชื่อลูกค้าจาก Google Sheet...
        </div>
      )}
      {v.customersError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 14, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดรายชื่อลูกค้าไม่สำเร็จ: {v.customersError}
        </div>
      )}

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr><th>ชื่อ</th><th>เบอร์โทร</th><th>ที่อยู่</th><th>พิกัด (lat, lng)</th><th>ใบกำกับภาษี</th><th>หมายเหตุ</th><th></th></tr>
          </thead>
          <tbody>
            {v.custRows.map((c) => (
              <tr key={c.rowIndex}>
                <td style={{ fontWeight: 500 }}>{c.name}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{c.phone}</td>
                <td style={{ fontSize: 12, maxWidth: 260 }}>{c.address}</td>
                <td style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>
                  {c.locText}
                  {c.mapLink && (
                    <a href={c.mapLink} target="_blank" rel="noreferrer" style={{ marginLeft: 6, fontSize: 12 }} title="เปิดใน Google Maps">
                      <i className="ph ph-map-pin" />
                    </a>
                  )}
                </td>
                <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{c.wantsTaxInvoice || '—'}</td>
                <td style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', maxWidth: 160 }}>{c.note || '—'}</td>
                <td style={{ textAlign: 'right' }}>{canEditLatLng && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={c.edit}>แก้พิกัด</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!v.customersLoading && v.custRows.length === 0 && (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบลูกค้าที่ตรงกับคำค้นหา</div>
        )}
      </div>

      {v.editModalOpen && (
        <div className="dialog-backdrop" onClick={v.closeEdit}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">แก้ไขพิกัดลูกค้า</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontSize: 13.5 }}>
                <b>{v.editingName}</b>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{v.editingPhone}</div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 4 }}>{v.editingAddress}</div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                พิกัดปัจจุบันในชีท: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.editingOriginalLatLngText}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div className="field"><label>Latitude (ละ)</label><input className="input" value={v.custEditLat} onChange={(e) => v.onEditLat(e.target.value)} disabled={v.custEditSaving} /></div>
                <div className="field"><label>Longitude (ลอง)</label><input className="input" value={v.custEditLng} onChange={(e) => v.onEditLng(e.target.value)} disabled={v.custEditSaving} /></div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                <i className="ph ph-info" style={{ marginRight: 4 }} />บันทึกแล้วจะเขียนทับแถวเดิมใน Google Sheet (CS Master) โดยตรง ไม่เพิ่มแถวใหม่
              </div>
              {v.custEditError && (
                <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
                  <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{v.custEditError}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeEdit} disabled={v.custEditSaving}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.saveEdit} disabled={v.custEditSaving}>
                {v.custEditSaving ? <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</> : <><i className="ph ph-floppy-disk" />บันทึกลงชีท</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
