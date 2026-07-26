import { computeActivityLog } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function ActivityLogPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeActivityLog(state, actions);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 340 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาเลขคำสั่งซื้อ / การกระทำ" value={v.q} onChange={(e) => v.onSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.rows.length} จาก {v.totalCount} รายการ</div>
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr>
              <th>วันเวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th><th>เลขคำสั่งซื้อ</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.timeText}</td>
                <td style={{ fontSize: 12.5 }}>{r.user}</td>
                <td style={{ fontSize: 12.5, fontWeight: 500 }}>{r.action}</td>
                <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{r.detail}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{r.orderNo}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.isEmpty && (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>
            {v.totalCount === 0 ? 'ยังไม่มีการแก้ไขใดๆ ในระบบ' : 'ไม่พบรายการที่ตรงกับคำค้นหา'}
          </div>
        )}
      </div>
    </div>
  );
}
