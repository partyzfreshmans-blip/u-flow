import { OrderDetailModal } from '../components/OrderDetailModal';
import { computeDashboard } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function DashboardPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeDashboard(state, actions);

  return (
    <div>
      {v.apiOrdersLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดออเดอร์ใหม่จาก Google Sheet...
        </div>
      )}
      {v.apiOrdersError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดออเดอร์ใหม่ไม่สำเร็จ: {v.apiOrdersError}
        </div>
      )}

      {v.stuckCount > 0 && (
        <div className="card elev-sm" style={{ marginBottom: 18, gap: 10, boxShadow: 'inset 0 0 0 1px var(--st-bad-fg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ph ph-warning-fill" style={{ color: 'var(--st-bad-fg)', fontSize: 17 }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>ออเดอร์ตกหล่น — เลยวันจัดส่งแล้วแต่ยังไม่สำเร็จ ({v.stuckCount})</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th>วันที่จะจัดส่ง</th><th style={{ textAlign: 'center' }}>ล่าช้า</th><th>สถานะ</th><th></th></tr>
            </thead>
            <tbody>
              {v.stuckOrders.map((o) => (
                <tr key={o.orderNo}>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>{o.orderNo}</td>
                  <td>{o.customer}</td>
                  <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{o.plannedDeliveryDate}</td>
                  <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--st-bad-fg)', fontWeight: 600 }}>{o.daysLate} วัน</td>
                  <td><span style={o.stStyle}>{o.stLabel}</span></td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={o.viewItems}>ดูสินค้า</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card elev-sm" style={{ marginBottom: 22, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}><i className="ph ph-calendar-check" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />พยากรณ์ 7 วันข้างหน้า</span>
          <select className="input" style={{ minHeight: 30, width: 200, marginLeft: 'auto', fontSize: 12.5 }} value={v.forecastStatusFilter} onChange={(e) => v.onForecastStatusFilter(e.target.value)}>
            <option value="all">ทุกสถานะ</option>
            {v.forecastStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
          {v.forecastDays.map((d) => (
            <div key={d.dayKey} style={{ padding: '10px 8px', borderRadius: 9, background: d.isToday ? 'var(--color-accent-900)' : 'var(--color-bg)', boxShadow: d.isToday ? 'inset 0 0 0 1px var(--color-accent-700)' : 'none', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-400)', marginBottom: 4 }}>{d.label}{d.isToday ? ' · วันนี้' : ''}</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 22, lineHeight: 1 }}>{d.count}</div>
              <div style={{ fontSize: 10, color: 'var(--color-neutral-500)', marginTop: 2 }}>ออเดอร์</div>
              {d.count === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 6 }}>—</div>
              ) : d.fullyRouted ? (
                <div style={{ fontSize: 10, color: 'var(--st-ok-fg)', marginTop: 6 }}><i className="ph ph-check-circle-fill" style={{ marginRight: 3 }} />จัดรูทแล้ว</div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--st-warn-fg)', marginTop: 6 }}><i className="ph ph-warning" style={{ marginRight: 3 }} />ยังไม่จัด {d.notRoutedCount}</div>
              )}
            </div>
          ))}
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
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาลูกค้า / เลขออเดอร์ / เบอร์โทร" value={v.q} onChange={(e) => v.onSearch(e.target.value)} />
        </div>
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
              <th>เลขออเดอร์</th><th>ลูกค้า</th><th style={{ textAlign: 'center' }}>รายการ</th><th style={{ textAlign: 'right' }}>ยอดขายรวม</th>
              <th>การชำระ</th><th>วันที่สั่ง</th><th>สถานะ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {v.orders.map((o) => (
              <tr key={o.orderUid}>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, fontSize: 12.5 }}>{o.orderUid}</td>
                <td>
                  {o.cust}
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{o.addr}</div>
                  {o.phone && <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', fontVariantNumeric: 'tabular-nums' }}>{o.phone}</div>}
                </td>
                <td style={{ textAlign: 'center' }}>{o.items}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.amtText}</td>
                <td style={{ fontSize: 12 }}>
                  {o.paymentType}
                  <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>{o.paid}</div>
                </td>
                <td style={{ fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{o.orderedAt}</td>
                <td><span style={o.stStyle}>{o.stLabel}</span></td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={o.viewItems}>ดูสินค้า</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.noOrders && !v.apiOrdersLoading && (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบออเดอร์ที่ตรงกับตัวกรอง</div>
        )}
      </div>

      <OrderDetailModal state={state} actions={actions} />
    </div>
  );
}
