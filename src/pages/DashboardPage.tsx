import { computeDashboard } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function DashboardPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeDashboard(state, actions);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 15px', marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--st-ok-fg)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--st-ok-fg) 22%, transparent)' }} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>เชื่อมต่อระบบ Unii</span>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
          <i className="ph ph-arrows-clockwise" style={{ marginRight: 4 }} />ซิงค์ล่าสุด 09:42 น.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={v.syncBadgeSynced}><i className="ph ph-check-circle" />ซิงค์แล้ว {v.syncCountSynced}</span>
          <span style={v.syncBadgePending}><i className="ph ph-clock" />รอซิงค์ {v.syncCountPending}</span>
          <span style={v.syncBadgeError}><i className="ph ph-warning" />ผิดพลาด {v.syncCountError}</span>
          <button className="btn btn-secondary" style={{ minHeight: 32 }}><i className="ph ph-arrows-clockwise" />ซิงค์ตอนนี้</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
        {v.stats.map((s) => (
          <div className="card" key={s.label} style={{ gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="card-kicker" style={{ color: 'var(--color-neutral-400)' }}>{s.label}</span>
              <i className={s.icon} style={{ fontSize: 18, color: s.iconColor }} />
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 27, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 340 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาลูกค้า / เลขที่ออเดอร์" value={v.q} onChange={(e) => v.onSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 'auto', minWidth: 130 }} value={v.routeFilter} onChange={(e) => v.onRouteFilter(e.target.value)}>
          <option value="all">ทุกเส้นทาง</option>
          <option value="A">Route A</option>
          <option value="B">Route B</option>
        </select>
        <input className="input" type="date" style={{ width: 'auto' }} value={v.dateFilter} onChange={(e) => v.onDateFilter(e.target.value)} />
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.resultCount} รายการ</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {v.statusChips.map((c) => (
          <button key={c.key} style={c.style} onClick={c.go}>
            {c.label}<span style={{ opacity: 0.6, marginLeft: 6 }}>{c.count}</span>
          </button>
        ))}
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr>
              <th>เลขที่ออเดอร์</th><th>ลูกค้า</th><th>เส้นทาง</th><th style={{ textAlign: 'right' }}>มูลค่า (COD)</th>
              <th style={{ textAlign: 'center' }}>รายการ</th><th>วันที่</th><th>สถานะ</th><th>สถานะในระบบ Unii</th><th></th>
            </tr>
          </thead>
          <tbody>
            {v.orders.map((o) => (
              <tr key={o.id}>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{o.id}</td>
                <td>{o.cust}<div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{o.addr}</div></td>
                <td><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}>{o.routeLabel}</span></td>
                <td style={{ textAlign: 'right', color: o.amtColor || undefined }}>{o.amtText}</td>
                <td style={{ textAlign: 'center' }}>{o.items}</td>
                <td style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{o.date}</td>
                <td><span style={o.stStyle}>{o.stLabel}</span></td>
                <td>
                  <span style={o.syncStyle}><i className={o.syncIcon} />{o.syncLabel}</span>
                  <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', marginTop: 2 }}>{o.syncSub}</div>
                </td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }}>ดู</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.noOrders && (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบออเดอร์ที่ตรงกับตัวกรอง</div>
        )}
      </div>
    </div>
  );
}
