import { computeRoute } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import { RouteMap } from './RouteMap';

export function RoutePage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeRoute(state, actions);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="seg">
          {v.routeTabs.map((t) => (
            <label key={t.key} className="seg-opt">
              <input type="radio" name="rsel" checked={t.active} onChange={t.go} />
              <i className="ph ph-path" />Route {t.key}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-cursor-click" style={{ marginRight: 5 }} />ลากรายการในลิสต์ด้านขวาเพื่อจัดลำดับการส่ง
        </div>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          <label className="seg-opt"><input type="radio" name="rv" checked={v.routeDesktop} onChange={v.setRouteDesktop} /><i className="ph ph-map-trifold" />แผนที่</label>
          <label className="seg-opt"><input type="radio" name="rv" checked={v.routeMobile} onChange={v.setRouteMobile} /><i className="ph ph-device-mobile" />มือถือ (Driver)</label>
        </div>
      </div>

      {v.routeDesktop && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 348px', gap: 18, alignItems: 'start' }}>
          <div className="card elev-sm" style={{ padding: 0, overflow: 'hidden', height: 624, position: 'relative' }}>
            <RouteMap stops={v.selLane.stops} />
          </div>
          <div className="card elev-sm" style={{ gap: 0, padding: 0, overflow: 'hidden', position: 'sticky', top: 96 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'var(--color-accent-900)', boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>{v.selLane.key}</span>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>ลำดับส่ง · Route {v.selLane.key}</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}><i className="ph ph-user" style={{ marginRight: 3 }} />{v.selLane.driver}</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{v.selLane.total}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)' }}>{v.selLane.stopsText}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, maxHeight: 476, overflow: 'auto' }}>
              {v.selLane.stops.map((st) => (
                <div
                  key={st.id}
                  draggable
                  onDragStart={st.onDragStart}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={st.onDrop}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 11px', borderRadius: 9, background: 'var(--color-bg)', boxShadow: 'inset 0 0 0 1px var(--color-divider)', cursor: 'grab' }}
                >
                  <span style={{ width: 24, height: 24, flex: 'none', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{st.seq}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.cust}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.id} · {st.addr}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button className="btn btn-icon btn-ghost" style={{ width: 20, height: 20 }} onClick={st.up}><i className="ph ph-caret-up" style={{ fontSize: 12 }} /></button>
                    <button className="btn btn-icon btn-ghost" style={{ width: 20, height: 20 }} onClick={st.down}><i className="ph ph-caret-down" style={{ fontSize: 12 }} /></button>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{st.amtText}</div>
                    <span style={st.stStyle}>{st.stLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {v.routeMobile && (
        <div style={{ maxWidth: 420, margin: '0 auto', border: '11px solid #0b0c14', borderRadius: 42, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', background: 'var(--color-bg)' }}>
          <div style={{ height: 30, background: '#0b0c14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 120, height: 6, borderRadius: 6, background: '#23252f' }} />
          </div>
          <div style={{ padding: '16px 15px 26px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{v.driverLane.key}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>เส้นทางวันนี้ · Route {v.driverLane.key}</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{v.driverLane.driver} · {v.driverLane.stopsText}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {v.driverLane.stops.map((st) => (
                <div key={st.id} style={{ display: 'flex', gap: 12, padding: '13px 13px', borderRadius: 12, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{st.seq}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{st.cust}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', margin: '2px 0 8px' }}><i className="ph ph-map-pin" style={{ marginRight: 4 }} />{st.addr}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={st.stStyle}>{st.stLabel}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>เก็บ {st.amtText}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 16, minHeight: 46 }}><i className="ph ph-navigation-arrow-fill" />เริ่มนำทางส่งของ</button>
          </div>
        </div>
      )}
    </div>
  );
}
