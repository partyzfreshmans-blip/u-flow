import { OrderDetailModal } from '../components/OrderDetailModal';
import { computeRoute } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import { RouteMap } from './RouteMap';

export function RoutePage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeRoute(state, actions);

  return (
    <div>
      {v.routeOrdersLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดข้อมูลเส้นทางจาก Google Sheet...
        </div>
      )}
      {v.routeOrdersError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดข้อมูลเส้นทางไม่สำเร็จ: {v.routeOrdersError}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 320 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาลูกค้า / เลขคำสั่งซื้อ" value={v.routeQ} onChange={(e) => v.onRouteSearch(e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
          เส้นทาง
          <select className="input" style={{ width: 'auto', minWidth: 160 }} value={v.routeFilterValue} onChange={(e) => v.onRouteFilter(e.target.value)}>
            {v.routeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.resultCount} รายการ</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginRight: 2 }}>สถานะ</span>
        {v.statusTabs.map((t) => <button key={t.key} style={t.style} onClick={t.go}>{t.label}</button>)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}><i className="ph ph-path" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />แบ่งโซนอัตโนมัติ</span>
        <span style={{ color: 'var(--st-info-fg)' }}>Route A · {v.zoneSummary.a}</span>
        <span style={{ color: 'var(--color-accent-300)' }}>Route B · {v.zoneSummary.b}</span>
        {v.zoneSummary.unassigned > 0 && (
          <span style={{ color: 'var(--color-neutral-500)' }} title="ที่อยู่อยู่นอกลำพูน/เชียงใหม่ — กฎที่ให้มายังไม่ครอบคลุม">
            นอกพื้นที่ · {v.zoneSummary.unassigned}
          </span>
        )}
        {v.mismatchCount > 0 && (
          <span style={{ marginLeft: 'auto', color: 'var(--st-warn-fg)' }}>
            <i className="ph ph-warning" style={{ marginRight: 4 }} />ชีทระบุไม่ตรงกับโซน {v.mismatchCount} รายการ
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 460px', gap: 18, alignItems: 'start' }}>
        <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Route</th><th style={{ textAlign: 'center' }}>โซนที่ควรเป็น</th><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th style={{ textAlign: 'right' }}>ยอดขาย</th>
                <th style={{ textAlign: 'center' }}>รายการ</th><th>วันที่จะจัดส่ง</th><th style={{ textAlign: 'right' }}>ระยะทาง</th><th>สถานะ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.orderNo}>
                  <td><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-200)' }}>{r.route}</span></td>
                  <td style={{ textAlign: 'center' }} title={r.zoneReason}>
                    <span style={r.zoneStyle}>{r.zoneRoute}</span>
                    {r.zoneMismatch && (
                      <div style={{ fontSize: 10, color: 'var(--st-warn-fg)', marginTop: 2, whiteSpace: 'nowrap' }}>
                        <i className="ph ph-warning" style={{ marginRight: 3 }} />ไม่ตรงกับชีท
                      </div>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 500 }}>{r.orderNo}</td>
                  <td>
                    {r.customer}
                    <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.address}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.amtText}</td>
                  <td style={{ textAlign: 'center' }}>{r.itemCount}</td>
                  <td style={{ fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{r.plannedDeliveryDate}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-400)' }}>{r.distanceText}</td>
                  <td><span style={r.stStyle}>{r.stLabel}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={r.viewItems}>ดูสินค้า</button>
                    {r.mapLink && (
                      <a className="btn btn-ghost" style={{ fontSize: 12 }} href={r.mapLink} target="_blank" rel="noreferrer" title="เปิดแผนที่">
                        <i className="ph ph-map-pin" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.isEmpty && !v.routeOrdersLoading && (
            <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบคำสั่งซื้อที่ตรงกับตัวกรอง</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'sticky', top: 96 }}>
          <div className="card elev-sm" style={{ padding: 0, overflow: 'hidden', height: 620, position: 'relative' }}>
            <RouteMap stops={v.mapStops} warehouse={v.warehouse} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-neutral-500)' }}>
            <span><i className="ph ph-map-pin" style={{ marginRight: 3 }} />แสดง {v.mapStops.length} จุด</span>
            {v.excludedStopCount > 0 && (
              <span style={{ color: 'var(--st-warn-fg)' }} title="พิกัดผิดปกติ เช่น 0,0 หรืออยู่ไกลเกินจริง — ถูกซ่อนไว้เพื่อไม่ให้แผนที่ซูมออกจนดูไม่รู้เรื่อง">
                <i className="ph ph-warning" style={{ marginRight: 3 }} />ซ่อนพิกัดผิดปกติ {v.excludedStopCount} จุด
              </span>
            )}
          </div>
        </div>
      </div>

      <OrderDetailModal state={state} actions={actions} />
    </div>
  );
}
