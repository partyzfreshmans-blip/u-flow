import { computePlanner } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import { RouteMap } from './RouteMap';

export function PlannerPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePlanner(state, actions);

  const updateVehicle = (id: string, patch: Partial<(typeof state.vehicles)[number]>) =>
    actions.setVehicles(state.vehicles.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const updateZone = (id: string, patch: Partial<(typeof state.zoneRules)[number]>) =>
    actions.setZoneRules(state.zoneRules.map((z) => (z.id === id ? { ...z, ...patch } : z)));

  return (
    <div>
      {v.loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดคำสั่งซื้อจาก Google Sheet...
        </div>
      )}
      {v.error && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{v.error}
        </div>
      )}

      {/* summary + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 15px', marginBottom: 14, borderRadius: 10, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontSize: 12.5 }}>
        <span style={{ fontWeight: 600 }}><i className="ph ph-truck" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />รถ {state.vehicles.length} คัน · คนไปส่งรวม {v.totalCrew} คน</span>
        <span style={{ color: 'var(--color-neutral-400)' }}>ออกจริงวันนี้ {v.activeCrew} คน</span>
        <span style={{ color: 'var(--color-neutral-400)' }}>จัดลงรถแล้ว {v.plannedStops} จุด</span>
        <span style={{ color: v.unassignedCount > 0 ? 'var(--st-warn-fg)' : 'var(--color-neutral-500)' }}>ยังไม่จัด {v.unassignedCount} จุด</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={v.openZones}><i className="ph ph-path" />ตั้งค่าโซน</button>
          <button className="btn btn-secondary" onClick={v.openVehicles}><i className="ph ph-truck" />จัดการรถ</button>
          <button className="btn btn-primary" onClick={v.suggestByZone} disabled={v.unassignedCount === 0}><i className="ph ph-magic-wand" />จัดอัตโนมัติตามโซน</button>
          <button className="btn btn-secondary" onClick={v.clearAll} disabled={v.plannedStops === 0}><i className="ph ph-eraser" />ล้างแผน</button>
        </div>
      </div>

      {/* zone editor */}
      {v.configTab === 'zones' && (
        <div className="card elev-sm" style={{ marginBottom: 16, gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>โซนจัดส่ง — แก้ไข เพิ่ม หรือลบได้</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
            <i className="ph ph-info" style={{ marginRight: 4 }} />ตรวจจากบนลงล่าง เจอข้อแรกที่ตรงถือเป็นโซนนั้น — วางโซนที่เจาะจงที่สุดไว้บนสุด · "จังหวัด" อ่านจากคอลัมน์ อำเภอ,จังหวัด เท่านั้น (กันที่อยู่ที่ชื่อถนนมีคำว่าเชียงใหม่-ลำพูน) · เว้นว่าง = ไม่จำกัด
          </div>
          <table className="table">
            <thead>
              <tr><th style={{ width: 40 }}>สี</th><th>ชื่อโซน</th><th>คำในตำบล/อำเภอ (คั่นด้วย ,)</th><th>จังหวัด (คั่นด้วย ,)</th><th style={{ width: 70 }}>รถ</th><th style={{ width: 90 }}>ลำดับ</th><th></th></tr>
            </thead>
            <tbody>
              {state.zoneRules.map((z, i) => (
                <tr key={z.id}>
                  <td><input type="color" value={z.color} onChange={(e) => updateZone(z.id, { color: e.target.value })} style={{ width: 34, height: 28, background: 'none', border: 0, padding: 0, cursor: 'pointer' }} /></td>
                  <td><input className="input" style={{ minHeight: 30 }} value={z.name} onChange={(e) => updateZone(z.id, { name: e.target.value })} /></td>
                  <td><input className="input" style={{ minHeight: 30, fontSize: 12 }} value={z.areaTerms.join(', ')} placeholder="เว้นว่าง = ทุกพื้นที่" onChange={(e) => updateZone(z.id, { areaTerms: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></td>
                  <td><input className="input" style={{ minHeight: 30, fontSize: 12 }} value={z.provinceTerms.join(', ')} placeholder="เว้นว่าง = ทุกจังหวัด" onChange={(e) => updateZone(z.id, { provinceTerms: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></td>
                  <td><input className="input" style={{ minHeight: 30, textAlign: 'center' }} value={z.route} onChange={(e) => updateZone(z.id, { route: e.target.value.toUpperCase() })} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-icon btn-ghost" disabled={i === 0} title="เลื่อนขึ้น" onClick={() => {
                      const a = [...state.zoneRules]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; actions.setZoneRules(a);
                    }}><i className="ph ph-caret-up" /></button>
                    <button className="btn btn-icon btn-ghost" disabled={i === state.zoneRules.length - 1} title="เลื่อนลง" onClick={() => {
                      const a = [...state.zoneRules]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; actions.setZoneRules(a);
                    }}><i className="ph ph-caret-down" /></button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-icon btn-ghost" title="ลบโซนนี้" onClick={() => actions.setZoneRules(state.zoneRules.filter((x) => x.id !== z.id))}>
                      <i className="ph ph-trash" style={{ fontSize: 14 }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => actions.setZoneRules([...state.zoneRules, { id: `zone-${Date.now()}`, name: 'โซนใหม่', color: '#b5abfc', route: 'A', areaTerms: [], provinceTerms: [] }])}>
            <i className="ph ph-plus" />เพิ่มโซน
          </button>
        </div>
      )}

      {/* vehicle editor */}
      {v.configTab === 'vehicles' && (
        <div className="card elev-sm" style={{ marginBottom: 16, gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>รถจัดส่ง — เพิ่ม ลด และบันทึกจำนวนคน</div>
          <table className="table">
            <thead>
              <tr><th>ชื่อรถ</th><th style={{ width: 110 }}>รหัสโหลด</th><th style={{ width: 110, textAlign: 'center' }}>ไปกี่คน</th><th>โซนที่รับผิดชอบ</th><th></th></tr>
            </thead>
            <tbody>
              {state.vehicles.map((veh) => (
                <tr key={veh.id}>
                  <td><input className="input" style={{ minHeight: 30 }} value={veh.name} onChange={(e) => updateVehicle(veh.id, { name: e.target.value })} /></td>
                  <td><input className="input" style={{ minHeight: 30, textAlign: 'center' }} value={veh.loadPrefix} title="ตัวอักษรขึ้นต้นของลำดับโหลด เช่น A → A01, A02" onChange={(e) => updateVehicle(veh.id, { loadPrefix: e.target.value.toUpperCase().slice(0, 2) })} /></td>
                  <td>
                    <input className="input" style={{ minHeight: 30, textAlign: 'center' }} inputMode="numeric" value={String(veh.crew)}
                      onChange={(e) => updateVehicle(veh.id, { crew: Number(e.target.value.replace(/[^0-9]/g, '') || 0) })} />
                  </td>
                  <td><input className="input" style={{ minHeight: 30, fontSize: 12 }} value={veh.zoneNote} onChange={(e) => updateVehicle(veh.id, { zoneNote: e.target.value })} /></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-icon btn-ghost" title="ลบรถคันนี้" onClick={() => {
                      actions.setVehicles(state.vehicles.filter((x) => x.id !== veh.id));
                      const plan = { ...state.routePlan }; delete plan[veh.id]; actions.setRoutePlan(plan);
                    }}><i className="ph ph-trash" style={{ fontSize: 14 }} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => actions.setVehicles([...state.vehicles, { id: `veh-${Date.now()}`, name: 'รถใหม่', loadPrefix: 'X', crew: 2, zoneNote: '' }])}>
            <i className="ph ph-plus" />เพิ่มรถ
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* per-vehicle plans */}
          {v.vehicles.map((veh) => (
            <div key={veh.id} className="card elev-sm" style={{ gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ width: 34, height: 26, borderRadius: 6, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>{veh.loadPrefix}</span>
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{veh.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                    <i className="ph ph-users" style={{ marginRight: 3 }} />{veh.crew} คน{veh.zoneNote ? ` · ${veh.zoneNote}` : ''}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{veh.stopCount} จุด · {veh.totalText}</span>
                  <button className="btn btn-secondary" style={{ minHeight: 30 }} onClick={veh.autoSequence} disabled={veh.stopCount < 2} title="เรียงจากจุดไกลคลังที่สุดไปใกล้ที่สุด">
                    <i className="ph ph-sort-descending" />เรียงไกล→ใกล้
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={veh.clear} disabled={veh.stopCount === 0}>เอาออกทั้งหมด</button>
                </div>
              </div>

              {veh.stopCount === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: 'var(--color-neutral-600)', fontSize: 12, borderRadius: 9, background: 'var(--color-bg)' }}>ยังไม่มีจุดส่ง — เพิ่มจากรายการด้านล่าง</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 46, textAlign: 'center' }}>ลำดับ</th><th style={{ width: 70, textAlign: 'center' }}>ลำดับโหลด</th>
                      <th>ลูกค้า</th><th>โซน</th><th style={{ textAlign: 'right' }}>ยอดเงิน</th><th style={{ textAlign: 'right' }}>ระยะ</th><th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {veh.stops.map((s) => (
                      <tr key={s.orderNo}>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{s.seq}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--color-accent-200)' }}>{s.loadCode}</td>
                        <td>
                          {s.customer}
                          <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.orderNo} · {s.address}</div>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, whiteSpace: 'nowrap' }}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.zoneColor, flex: 'none' }} />{s.zoneName}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.amtText}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{s.distanceText}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-icon btn-ghost" onClick={s.moveUp} title="เลื่อนขึ้น"><i className="ph ph-caret-up" style={{ fontSize: 12 }} /></button>
                          <button className="btn btn-icon btn-ghost" onClick={s.moveDown} title="เลื่อนลง"><i className="ph ph-caret-down" style={{ fontSize: 12 }} /></button>
                          <button className="btn btn-icon btn-ghost" onClick={s.remove} title="เอาออก"><i className="ph ph-x" style={{ fontSize: 12 }} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          {/* unassigned pool */}
          <div className="card elev-sm" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>ออเดอร์ที่ยังไม่จัดลงรถ ({v.unassignedCount})</div>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-500)' }}>เรียงจากไกลคลังที่สุด</span>
            </div>
            {v.unassignedCount === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: 'var(--st-ok-fg)', fontSize: 12.5 }}>
                <i className="ph ph-check-circle-fill" style={{ marginRight: 5 }} />จัดครบทุกออเดอร์แล้ว
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>ลูกค้า</th><th>โซน</th><th style={{ textAlign: 'right' }}>ยอดเงิน</th><th style={{ textAlign: 'right' }}>ระยะ</th><th style={{ width: 150 }}>จัดลงรถ</th></tr>
                </thead>
                <tbody>
                  {v.unassigned.map((o) => (
                    <tr key={o.orderNo}>
                      <td>
                        {o.customer}
                        <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.orderNo} · {o.address}</div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, whiteSpace: 'nowrap' }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: o.zoneColor, flex: 'none' }} />{o.zoneName}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.amtText}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{o.distanceText}</td>
                      <td>
                        <select className="input" style={{ minHeight: 30, fontSize: 12 }} value="" onChange={(e) => e.target.value && o.assignTo(e.target.value)}>
                          <option value="">เลือกรถ…</option>
                          {state.vehicles.map((veh) => <option key={veh.id} value={veh.id}>{veh.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* map */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'sticky', top: 96 }}>
          <div className="card elev-sm" style={{ padding: 0, overflow: 'hidden', height: 560, position: 'relative' }}>
            <RouteMap stops={v.mapStops} warehouse={v.warehouse} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: 'var(--color-neutral-500)' }}>
            {v.zoneLegend.map((z) => (
              <span key={z.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: z.color, flex: 'none' }} />{z.name}
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 16, height: 12, borderRadius: 3, background: '#fff', border: '1.5px solid var(--color-neutral-700)', flex: 'none' }} />WH คลัง
            </span>
            {v.excludedStopCount > 0 && (
              <span style={{ color: 'var(--st-warn-fg)' }}><i className="ph ph-warning" style={{ marginRight: 3 }} />ซ่อนพิกัดผิดปกติ {v.excludedStopCount} จุด</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
