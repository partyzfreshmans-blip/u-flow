import { useState } from 'react';
import { computePlanner } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import { BatchRouteHistoryPanel } from './BatchRouteHistoryPanel';
import { RouteCalendarPanel } from './RouteCalendarPanel';
import { RouteMap } from './RouteMap';

interface DragPayload {
  orderNo: string;
  fromVehicleId: string;
}

const DRAG_MIME = 'application/x-uflow-stop';

export function PlannerPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePlanner(state, actions);
  const [dragOverVehicleId, setDragOverVehicleId] = useState<string | null>(null);
  const [assigningVehicleId, setAssigningVehicleId] = useState<string | null>(null);
  const [assignSyncError, setAssignSyncError] = useState<string | null>(null);
  // Map display filter — which vehicles' routes/pins to draw, and whether to
  // include not-yet-assigned orders. Purely a view toggle (doesn't touch
  // routePlan), so it's fine to keep as local UI state rather than global.
  const [hiddenVehicleIds, setHiddenVehicleIds] = useState<Set<string>>(new Set());
  const [showUnassignedOnMap, setShowUnassignedOnMap] = useState(true);
  // Driver "จองคิว" — inline reject-with-reason UI for one row at a time,
  // rather than a separate modal (rejecting is rare enough not to need one).
  const [rejectingOrderNo, setRejectingOrderNo] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  // "ออเดอร์ค้าง/เลยกำหนด" banner — clicking a count clears plannerDate (so
  // every date's unassigned pool becomes visible, not just today's) and
  // narrows the table below to just that flagged subset via this filter.
  const [attentionFilter, setAttentionFilter] = useState<'none' | 'no-date' | 'overdue'>('none');
  const toggleVehicleOnMap = (vehicleId: string) =>
    setHiddenVehicleIds((cur) => {
      const next = new Set(cur);
      if (next.has(vehicleId)) next.delete(vehicleId);
      else next.add(vehicleId);
      return next;
    });

  const updateVehicle = (id: string, patch: Partial<(typeof state.vehicles)[number]>) =>
    actions.setVehicles(state.vehicles.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const updateZone = (id: string, patch: Partial<(typeof state.zoneRules)[number]>) =>
    actions.setZoneRules(state.zoneRules.map((z) => (z.id === id ? { ...z, ...patch } : z)));

  const readDragPayload = (e: React.DragEvent): DragPayload | null => {
    try {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      return raw ? (JSON.parse(raw) as DragPayload) : null;
    } catch {
      return null;
    }
  };

  /** Always sync the latest sheet data before turning a vehicle's current
   * stop list into a permanent Batch Route — the confirm dialog should never
   * be built from data that's already gone stale. */
  const handleOpenAssign = async (vehicleId: string) => {
    setAssigningVehicleId(vehicleId);
    setAssignSyncError(null);
    const result = await actions.syncNow();
    setAssigningVehicleId(null);
    if (!result.routeOrdersOk) {
      setAssignSyncError('Sync ข้อมูลคำสั่งซื้อล่าสุดไม่สำเร็จ — ลองใหม่อีกครั้งก่อนยืนยันรูท');
      return;
    }
    v.openAssignDialog(vehicleId);
  };

  const mapStopsFiltered = v.mapStops.filter((s) => (s.vehicleId ? !hiddenVehicleIds.has(s.vehicleId) : showUnassignedOnMap));
  const vehicleRoutesFiltered = v.vehicleRoutes.filter((r) => !hiddenVehicleIds.has(r.vehicleId));
  const unassignedFiltered =
    attentionFilter === 'none' ? v.unassigned : v.unassigned.filter((o) => (attentionFilter === 'no-date' ? o.noDeliveryDate : o.isOverdue));

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
      {assignSyncError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{assignSyncError}
          <button className="btn btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => setAssignSyncError(null)}>ปิด</button>
        </div>
      )}
      {v.bookingActionError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{v.bookingActionError}
        </div>
      )}

      {v.canEdit && (
        <div className="seg" style={{ marginBottom: 14, width: 'fit-content' }}>
          <label className="seg-opt">
            <input type="radio" name="plannerTab" checked={v.plannerTab === 'plan'} onChange={() => v.setPlannerTab('plan')} /><i className="ph ph-map-trifold" />แผนวันนี้
          </label>
          <label className="seg-opt">
            <input type="radio" name="plannerTab" checked={v.plannerTab === 'history'} onChange={() => v.setPlannerTab('history')} /><i className="ph ph-clock-counter-clockwise" />ประวัติ Batch Route
          </label>
          <label className="seg-opt">
            <input type="radio" name="plannerTab" checked={v.plannerTab === 'calendar'} onChange={() => v.setPlannerTab('calendar')} /><i className="ph ph-calendar-blank" />Route Calendar
          </label>
        </div>
      )}

      {v.plannerTab === 'history' && v.canEdit ? (
        <BatchRouteHistoryPanel state={state} actions={actions} />
      ) : v.plannerTab === 'calendar' && v.canEdit ? (
        <RouteCalendarPanel state={state} actions={actions} />
      ) : (
        <>
      {/* overdue / no-delivery-date attention banner */}
      {v.canEdit && (v.noDeliveryDateCount > 0 || v.overdueUnassignedCount > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 15px', marginBottom: 14, borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ fontSize: 17, flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            มีออเดอร์
            {v.noDeliveryDateCount > 0 && (
              <>
                {' '}
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13, padding: 0, minHeight: 'auto', textDecoration: 'underline', color: 'inherit', fontWeight: 700 }}
                  onClick={() => { v.clearPlannerDate(); setAttentionFilter('no-date'); }}
                >
                  {v.noDeliveryDateCount} รายการ
                </button>{' '}
                ที่ยังไม่กำหนดวันจัดส่ง
              </>
            )}
            {v.noDeliveryDateCount > 0 && v.overdueUnassignedCount > 0 && ' และ'}
            {v.overdueUnassignedCount > 0 && (
              <>
                {' '}
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13, padding: 0, minHeight: 'auto', textDecoration: 'underline', color: 'inherit', fontWeight: 700 }}
                  onClick={() => { v.clearPlannerDate(); setAttentionFilter('overdue'); }}
                >
                  {v.overdueUnassignedCount} รายการ
                </button>{' '}
                ที่เลยกำหนดส่งแล้วแต่ยังไม่สำเร็จ
              </>
            )}
          </span>
        </div>
      )}
      {attentionFilter !== 'none' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 15px', marginBottom: 14, borderRadius: 10, background: 'var(--st-info-bg)', color: 'var(--st-info-fg)', fontSize: 12.5 }}>
          <i className="ph ph-funnel" style={{ flex: 'none' }} />
          <span>กำลังกรองเฉพาะ{attentionFilter === 'no-date' ? 'ออเดอร์ที่ยังไม่กำหนดวันจัดส่ง' : 'ออเดอร์ที่เลยกำหนดส่งแล้วแต่ยังไม่สำเร็จ'}</span>
          <button className="btn btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => setAttentionFilter('none')}><i className="ph ph-x" />ล้างตัวกรอง</button>
        </div>
      )}

      {/* summary + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 15px', marginBottom: 14, borderRadius: 10, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontSize: 12.5 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i className="ph ph-calendar-blank" style={{ color: 'var(--color-accent-300)' }} />วางแผนวันที่
          <input type="date" className="input" style={{ minHeight: 30, width: 150 }} value={v.plannerDate} onChange={(e) => v.onPlannerDate(e.target.value)} />
        </label>
        {v.plannerDate && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.clearPlannerDate} title="แสดงออเดอร์ค้างส่งทุกวัน">ดูทุกวัน</button>
        )}
        <span style={{ fontWeight: 600 }}><i className="ph ph-truck" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />รถ {state.vehicles.length} คัน · คนไปส่งรวม {v.totalCrew} คน</span>
        <span style={{ color: 'var(--color-neutral-400)' }}>ออกจริงวันนี้ {v.activeCrew} คน</span>
        <span style={{ color: 'var(--color-neutral-400)' }}>จัดลงรถแล้ว {v.plannedStops} จุด</span>
        <span style={{ color: v.unassignedCount > 0 ? 'var(--st-warn-fg)' : 'var(--color-neutral-500)' }}>ยังไม่จัด {v.unassignedCount} จุด</span>
        {v.canEdit && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={v.openZones}><i className="ph ph-path" />ตั้งค่าโซน</button>
            <button className="btn btn-secondary" onClick={v.openVehicles}><i className="ph ph-truck" />จัดการรถ</button>
            <button className="btn btn-primary" onClick={v.suggestByZone} disabled={v.unassignedCount === 0}><i className="ph ph-magic-wand" />จัดอัตโนมัติตามโซน</button>
            <button className="btn btn-secondary" onClick={v.clearAll} disabled={v.plannedStops === 0}><i className="ph ph-eraser" />ล้างแผน</button>
          </div>
        )}
      </div>

      {/* COD overview — collection status across every route going out */}
      {v.codRouteCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '10px 15px', marginBottom: 14, borderRadius: 10, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontSize: 12.5 }}>
          <span style={{ fontWeight: 600 }}><i className="ph ph-money" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />COD {v.codRouteCount} รูท</span>
          <span>ต้องเก็บสด {v.codCashExpectedText}</span>
          <span>เก็บมาแล้ว {v.codCashCollectedText}</span>
          {v.hasCodTransfer && <span style={{ color: 'var(--color-neutral-400)' }}>โอนแล้ว {v.codTransferText}</span>}
          <span style={v.codGrandDiffStyle}>{v.codGrandDiffText}</span>
        </div>
      )}

      {/* zone editor */}
      {v.canEdit && v.configTab === 'zones' && (
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
                  <td><input className="input" style={{ minHeight: 30, fontSize: 12 }} value={z.areaTerms.join(',')} placeholder="เว้นว่าง = ทุกพื้นที่" onChange={(e) => updateZone(z.id, { areaTerms: e.target.value.split(',') })} onBlur={(e) => updateZone(z.id, { areaTerms: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></td>
                  <td><input className="input" style={{ minHeight: 30, fontSize: 12 }} value={z.provinceTerms.join(',')} placeholder="เว้นว่าง = ทุกจังหวัด" onChange={(e) => updateZone(z.id, { provinceTerms: e.target.value.split(',') })} onBlur={(e) => updateZone(z.id, { provinceTerms: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></td>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => actions.setZoneRules([...state.zoneRules, { id: `zone-${Date.now()}`, name: 'โซนใหม่', color: '#b5abfc', route: 'A', areaTerms: [], provinceTerms: [] }])}>
              <i className="ph ph-plus" />เพิ่มโซน
            </button>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => actions.patch({ plannerConfigTab: null })}>
              <i className="ph ph-check" />บันทึก
            </button>
          </div>
        </div>
      )}

      {/* vehicle editor */}
      {v.canEdit && v.configTab === 'vehicles' && (
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => actions.setVehicles([...state.vehicles, { id: `veh-${Date.now()}`, name: 'รถใหม่', loadPrefix: 'X', crew: 2, zoneNote: '' }])}>
              <i className="ph ph-plus" />เพิ่มรถ
            </button>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => actions.patch({ plannerConfigTab: null })}>
              <i className="ph ph-check" />บันทึก
            </button>
          </div>
        </div>
      )}

      <div className="planner-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* per-vehicle plans */}
          {v.vehicles.map((veh) => (
            <div
              key={veh.id}
              className="card elev-sm"
              style={{ gap: 10, boxShadow: dragOverVehicleId === veh.id ? 'inset 0 0 0 2px var(--color-accent-700)' : undefined }}
              onDragOver={v.canEdit && !veh.batchLocked ? (e) => {
                e.preventDefault();
                setDragOverVehicleId(veh.id);
              } : undefined}
              onDragLeave={v.canEdit && !veh.batchLocked ? () => setDragOverVehicleId((cur) => (cur === veh.id ? null : cur)) : undefined}
              onDrop={v.canEdit && !veh.batchLocked ? (e) => {
                e.preventDefault();
                setDragOverVehicleId(null);
                const data = readDragPayload(e);
                if (data) v.moveOrderToVehicle(data.orderNo, data.fromVehicleId, veh.id, null);
              } : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ width: 34, height: 26, borderRadius: 6, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>{veh.loadPrefix}</span>
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: veh.vehicleColor, flex: 'none' }} title="สีเส้นทางบนแผนที่" />
                    {veh.name}
                    {veh.batchId && (
                      <span
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: veh.batchLocked ? 'var(--color-neutral-800)' : 'var(--st-warn-bg)', color: veh.batchLocked ? 'var(--color-neutral-300)' : 'var(--st-warn-fg)' }}
                        title={veh.batchLocked ? 'ลำดับ/รายการถูกล็อกแล้ว' : 'ปลดล็อกชั่วคราว — แก้ไขได้'}
                      >
                        <i className={veh.batchLocked ? 'ph ph-lock-simple' : 'ph ph-lock-simple-open'} />{veh.batchId}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                    <i className="ph ph-users" style={{ marginRight: 3 }} />{veh.crew} คน{veh.zoneNote ? ` · ${veh.zoneNote}` : ''}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{veh.stopCount} จุด · {veh.totalText}</span>
                  {veh.codCount > 0 && (
                    <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <i className="ph ph-money" style={{ color: 'var(--color-accent-300)' }} />COD {veh.codCashCollectedText} / {veh.codCashExpectedText}
                      <span style={veh.codDiffStyle}>{veh.codDiffText}</span>
                    </span>
                  )}
                  {v.canEdit && veh.batchId && (
                    veh.batchLocked ? (
                      <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={veh.unlockBatch}><i className="ph ph-lock-simple-open" />แก้ไข batch</button>
                    ) : (
                      <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={veh.relockBatch}><i className="ph ph-lock-simple" />ล็อกอีกครั้ง</button>
                    )
                  )}
                  {v.canEdit && !veh.batchId && veh.stopCount > 0 && (
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12 }}
                      onClick={() => handleOpenAssign(veh.id)}
                      disabled={!v.canAssign || assigningVehicleId === veh.id}
                      title={!v.plannerDate ? 'เลือกวันที่จัดส่งก่อนจึงจะยืนยันรูทได้' : undefined}
                    >
                      {assigningVehicleId === veh.id ? (
                        <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลัง sync...</>
                      ) : (
                        <><i className="ph ph-seal-check" />ยืนยันรูท (Assign)</>
                      )}
                    </button>
                  )}
                  {v.canEdit && !veh.batchLocked && (
                    <button className="btn btn-secondary" style={{ minHeight: 30 }} onClick={veh.autoSequence} disabled={veh.stopCount < 2} title={veh.autoSequenceTitle}>
                      <i className={veh.autoSequenceIcon} />{veh.autoSequenceLabel}
                    </button>
                  )}
                  {v.canEdit && !veh.batchLocked && (
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={veh.clear} disabled={veh.stopCount === 0}>เอาออกทั้งหมด</button>
                  )}
                </div>
              </div>

              {veh.stopCount === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: 'var(--color-neutral-600)', fontSize: 12, borderRadius: 9, background: 'var(--color-bg)' }}>ยังไม่มีจุดส่ง — เพิ่มจากรายการด้านล่าง</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th>
                      <th style={{ width: 46, textAlign: 'center' }}>ลำดับ</th><th style={{ width: 70, textAlign: 'center' }}>ลำดับโหลด</th>
                      <th>ลูกค้า</th><th>โซน</th><th style={{ textAlign: 'right' }}>ยอดเงิน</th><th style={{ width: 200 }}>COD</th><th style={{ textAlign: 'right' }}>ระยะ</th><th style={{ width: 130 }}>สถานะ</th><th style={{ width: 190 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {veh.stops.map((s) => (
                      <tr
                        key={s.orderNo}
                        draggable={v.canEdit && !veh.batchLocked}
                        onDragStart={v.canEdit && !veh.batchLocked ? (e) => {
                          e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ orderNo: s.orderNo, fromVehicleId: veh.id }));
                          e.dataTransfer.effectAllowed = 'move';
                        } : undefined}
                        onDragOver={v.canEdit && !veh.batchLocked ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverVehicleId(veh.id);
                        } : undefined}
                        onDrop={v.canEdit && !veh.batchLocked ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverVehicleId(null);
                          const data = readDragPayload(e);
                          if (data) v.moveOrderToVehicle(data.orderNo, data.fromVehicleId, veh.id, s.seq - 1);
                        } : undefined}
                        style={v.canEdit && !veh.batchLocked ? { cursor: 'grab' } : undefined}
                      >
                        <td style={{ textAlign: 'center', color: 'var(--color-neutral-600)' }}><i className="ph ph-dots-six-vertical" /></td>
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
                        <td>
                          {s.isCod ? (
                            v.canEdit ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <label className="seg-opt" style={{ fontSize: 10.5 }}>
                                  <input type="radio" checked={s.codMethod === 'cash'} onChange={s.setCodCash} />สด
                                </label>
                                <label className="seg-opt" style={{ fontSize: 10.5 }}>
                                  <input type="radio" checked={s.codMethod === 'transfer'} onChange={s.setCodTransfer} />โอน
                                </label>
                                {s.codMethod === 'cash' && (
                                  <input className="input" style={{ minHeight: 26, width: 70, fontSize: 11 }} inputMode="numeric" placeholder="เก็บได้" value={s.codCollected} onChange={(e) => s.onCodCollected(e.target.value)} />
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{s.codMethod === 'transfer' ? 'โอน' : `สด ${s.codCollected || 0}`}</span>
                            )
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{s.distanceText}</td>
                        <td><span style={s.stStyle}>{s.status || '—'}</span></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {v.canEdit && !veh.batchLocked && (
                            <>
                              <button className="btn btn-icon btn-ghost" onClick={s.moveUp} title="เลื่อนขึ้น"><i className="ph ph-caret-up" style={{ fontSize: 12 }} /></button>
                              <button className="btn btn-icon btn-ghost" onClick={s.moveDown} title="เลื่อนลง"><i className="ph ph-caret-down" style={{ fontSize: 12 }} /></button>
                              <button className="btn btn-icon btn-ghost" onClick={s.remove} title="เอาออก"><i className="ph ph-x" style={{ fontSize: 12 }} /></button>
                              <select
                                className="input"
                                style={{ minHeight: 26, fontSize: 10.5, width: 96, display: 'inline-block', marginLeft: 4 }}
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) s.moveToVehicle(e.target.value);
                                }}
                                title="ย้ายไปรถคันอื่น"
                              >
                                <option value="">ย้ายไป...</option>
                                {v.vehicles.filter((x) => x.id !== veh.id && !x.batchLocked).map((x) => (
                                  <option key={x.id} value={x.id}>{x.name}</option>
                                ))}
                              </select>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          {/* unassigned pool */}
          {v.canEdit && (
          <div className="card elev-sm" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                ออเดอร์ที่ยังไม่จัดลงรถ ({unassignedFiltered.length}{attentionFilter !== 'none' ? `/${v.unassignedCount}` : ''})
              </div>
              {v.selectedCount > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-accent-300)', fontWeight: 500 }}>เลือกแล้ว {v.selectedCount} รายการ</span>
                  <select className="input" style={{ minHeight: 30, fontSize: 12 }} value="" onChange={(e) => e.target.value && v.assignSelectedTo(e.target.value)}>
                    <option value="">จัดลงรถ…</option>
                    {v.vehicles.filter((veh) => !veh.batchLocked).map((veh) => <option key={veh.id} value={veh.id}>{veh.name}</option>)}
                  </select>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.clearSelection}><i className="ph ph-x" />ล้างที่เลือก</button>
                </div>
              ) : (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-500)' }}>เรียงจากไกลคลังที่สุด</span>
              )}
            </div>
            {unassignedFiltered.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: 'var(--st-ok-fg)', fontSize: 12.5 }}>
                <i className="ph ph-check-circle-fill" style={{ marginRight: 5 }} />
                {attentionFilter === 'none' ? 'จัดครบทุกออเดอร์แล้ว' : 'ไม่มีออเดอร์ที่ตรงกับตัวกรองนี้'}
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input type="checkbox" checked={v.allUnassignedSelected} onChange={v.toggleSelectAllUnassigned} />
                    </th>
                    <th>ลูกค้า / ที่อยู่</th><th>อำเภอ, จังหวัด</th><th>เบอร์โทร</th><th>ผู้จัด</th><th>วันที่จะจัดส่ง</th><th>หมายเหตุ</th><th>จำนวน</th><th style={{ textAlign: 'right' }}>ยอดเงิน</th>
                    <th style={{ textAlign: 'right' }}>ระยะ</th><th style={{ width: 150 }}>จัดลงรถ</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {unassignedFiltered.map((o) => (
                    <tr key={o.orderNo} style={o.bookedByDriver ? { background: 'var(--color-bg)' } : undefined}>
                      <td><input type="checkbox" checked={o.selected} onChange={o.toggleSelect} /></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {o.noDeliveryDate && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              <i className="ph ph-calendar-x" />ไม่มีวันจัดส่ง
                            </span>
                          )}
                          {o.isOverdue && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              <i className="ph ph-clock-countdown" />เลยกำหนดส่ง
                            </span>
                          )}
                          {o.bookedByDriver && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              <i className="ph ph-hand-tap" />จองคิวโดย {o.bookedByDriver}
                            </span>
                          )}
                          {o.duplicateCustomer ? (
                            <span
                              style={{ padding: '1px 6px', borderRadius: 5, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontWeight: 600 }}
                              title="ลูกค้าคนนี้มีมากกว่า 1 ออเดอร์ในรายการนี้"
                            >
                              {o.customer}
                            </span>
                          ) : (
                            o.customer
                          )}
                          {o.wantsTaxInvoice && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--st-info-bg)', color: 'var(--st-info-fg)', whiteSpace: 'nowrap' }}>
                              <i className="ph ph-receipt" />ต้องการใบกำกับ
                            </span>
                          )}
                          {o.hasNote && (
                            <span
                              title={o.note}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', whiteSpace: 'nowrap', cursor: 'help' }}
                            >
                              <i className="ph ph-note-pencil" />หมายเหตุ
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', marginTop: 1 }}>{o.orderNo}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-neutral-400)', maxWidth: 320, whiteSpace: 'normal', wordBreak: 'break-word' }}>{o.address}</div>
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{o.districtProvince}</td>
                      <td style={{ fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{o.phone}</td>
                      <td style={{ fontSize: 11.5, color: o.packedBy === 'ยังไม่จัด' ? 'var(--color-neutral-600)' : 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{o.packedBy}</td>
                      <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{o.plannedDeliveryDateText}</td>
                      <td style={{ fontSize: 11.5, color: o.hasNote ? 'var(--color-neutral-200)' : 'var(--color-neutral-600)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={o.hasNote ? o.note : undefined}>
                        {o.noteText}
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{o.qtyText}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.amtText}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{o.distanceText}</td>
                      <td>
                        {o.bookedByDriver && o.canDecideBooking ? (
                          rejectingOrderNo === o.orderNo ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
                              <input
                                className="input"
                                style={{ minHeight: 28, fontSize: 11.5 }}
                                placeholder="เหตุผล (ไม่บังคับ)"
                                value={rejectNote}
                                onChange={(e) => setRejectNote(e.target.value)}
                              />
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  className="btn btn-primary"
                                  style={{ fontSize: 11, flex: 1, minHeight: 26, justifyContent: 'center' }}
                                  onClick={() => {
                                    o.rejectBooking?.(rejectNote.trim() || undefined);
                                    setRejectingOrderNo(null);
                                    setRejectNote('');
                                  }}
                                >
                                  ยืนยันปฏิเสธ
                                </button>
                                <button className="btn btn-ghost" style={{ fontSize: 11, flex: 1, minHeight: 26, justifyContent: 'center' }} onClick={() => { setRejectingOrderNo(null); setRejectNote(''); }}>
                                  ยกเลิก
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-primary" style={{ fontSize: 11.5, minHeight: 28 }} onClick={o.confirmBooking} title="ยืนยันคำขอจองคิว — จัดลงรถของคนขับที่จอง">
                                <i className="ph ph-check" />ยืนยัน
                              </button>
                              <button className="btn btn-ghost" style={{ fontSize: 11.5, minHeight: 28 }} onClick={() => { setRejectingOrderNo(o.orderNo); setRejectNote(''); }} title="ปฏิเสธคำขอจองคิว">
                                <i className="ph ph-x" />ปฏิเสธ
                              </button>
                            </div>
                          )
                        ) : (
                          <select className="input" style={{ minHeight: 30, fontSize: 12 }} value="" onChange={(e) => e.target.value && o.assignTo(e.target.value)}>
                            <option value="">เลือกรถ…</option>
                            {v.vehicles.filter((veh) => !veh.batchLocked).map((veh) => <option key={veh.id} value={veh.id}>{veh.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={o.editLocation} title="ตรวจสอบ/แก้ไขโลเคชั่นบนแผนที่">
                          <i className="ph ph-map-pin-line" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          )}
        </div>

        {/* map — sticky while the (much longer) vehicle list scrolls past;
            see .planner-map-col in nocturne.css for how/why, and its mobile
            breakpoint that drops this to a plain stacked block instead. */}
        <div className="planner-map-col">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginRight: 2 }}>แสดงบนแผนที่</span>
            {v.vehicles.map((veh) => {
              const hidden = hiddenVehicleIds.has(veh.id);
              return (
                <button
                  key={veh.id}
                  onClick={() => toggleVehicleOnMap(veh.id)}
                  title={hidden ? `ซ่อนอยู่ — คลิกเพื่อแสดง ${veh.name}` : `คลิกเพื่อซ่อน ${veh.name}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 9px', borderRadius: 20,
                    border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
                    background: hidden ? 'var(--color-bg)' : 'var(--color-surface)',
                    color: hidden ? 'var(--color-neutral-600)' : 'var(--color-neutral-200)',
                    boxShadow: hidden ? 'inset 0 0 0 1px var(--color-divider)' : 'inset 0 0 0 1px var(--color-neutral-700)',
                    opacity: hidden ? 0.6 : 1,
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: veh.vehicleColor, flex: 'none' }} />
                  {veh.name} ({veh.stopCount})
                  {hidden && <i className="ph ph-eye-slash" style={{ fontSize: 11 }} />}
                </button>
              );
            })}
            <button
              onClick={() => setShowUnassignedOnMap((cur) => !cur)}
              title={showUnassignedOnMap ? 'คลิกเพื่อซ่อนออเดอร์ที่ยังไม่ได้จัด' : 'ซ่อนอยู่ — คลิกเพื่อแสดงออเดอร์ที่ยังไม่ได้จัด'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 9px', borderRadius: 20,
                border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)',
                background: showUnassignedOnMap ? 'var(--color-surface)' : 'var(--color-bg)',
                color: showUnassignedOnMap ? 'var(--color-neutral-200)' : 'var(--color-neutral-600)',
                boxShadow: showUnassignedOnMap ? 'inset 0 0 0 1px var(--color-neutral-700)' : 'inset 0 0 0 1px var(--color-divider)',
                opacity: showUnassignedOnMap ? 1 : 0.6,
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: v.unassignedColor, flex: 'none' }} />
              ยังไม่ได้จัด ({v.unassignedCount})
              {!showUnassignedOnMap && <i className="ph ph-eye-slash" style={{ fontSize: 11 }} />}
            </button>
            {hiddenVehicleIds.size > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => setHiddenVehicleIds(new Set())}
              >
                <i className="ph ph-x" />แสดงทั้งหมด
              </button>
            )}
          </div>
          <div className="card elev-sm" style={{ padding: 0, overflow: 'hidden', height: 560, position: 'relative' }}>
            <RouteMap
              stops={mapStopsFiltered}
              warehouse={v.warehouse}
              vehicleRoutes={vehicleRoutesFiltered}
              vehicleOptions={v.vehicleOptions}
              onMoveToVehicle={v.canEdit ? v.onMapMoveToVehicle : undefined}
            />
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
        </>
      )}

      {v.assignDialogOpen && (
        <div className="dialog-backdrop" onClick={v.closeAssignDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)' }}>
            <div className="dialog-title">ยืนยันรูท — สร้าง Batch Route</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
                เลือกคันรถที่จัดจุดส่งเสร็จแล้ว — ระบบจะสร้างรหัส Batch Route ถาวรและล็อกลำดับจุดส่งของแต่ละคันไว้ (วันที่จัดส่ง {v.plannerDate || '—'})
              </div>
              {v.assignableVehicles.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>ไม่มีรถที่พร้อมยืนยัน (ต้องมีจุดส่งอย่างน้อย 1 จุด และยังไม่ถูกล็อก)</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={v.assignableVehicles.length > 0 && v.assignableVehicles.every((x) => v.assignSelectedVehicleIds.includes(x.id))}
                      onChange={v.toggleAssignAll}
                    />
                    เลือกทั้งหมด
                  </label>
                  <div className="hr" style={{ margin: '2px 0' }} />
                  {v.assignableVehicles.map((x) => (
                    <label key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                      <input type="checkbox" checked={v.assignSelectedVehicleIds.includes(x.id)} onChange={() => v.toggleAssignVehicle(x.id)} />
                      <span style={{ flex: 1 }}>{x.name}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{x.stopCount} จุด · {x.totalText}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeAssignDialog}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={v.assignSelectedVehicleIds.length === 0} onClick={() => v.confirmAssign(v.assignSelectedVehicleIds)}>
                <i className="ph ph-check" />ยืนยัน ({v.assignSelectedVehicleIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {v.plannerTab === 'plan' && v.locationModalOpen && (
        <div className="dialog-backdrop" onClick={v.closeLocationModal}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="dialog-title">ตรวจสอบ/แก้ไขโลเคชั่น</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontSize: 13.5 }}>
                <b>{v.locationCustomer}</b>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{v.locationOrderNo}</div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 4 }}>{v.locationAddress}</div>
              </div>
              <div style={{ height: 220, borderRadius: 10, overflow: 'hidden', position: 'relative', background: 'var(--color-bg)' }}>
                {v.locationPreviewLat != null && v.locationPreviewLng != null ? (
                  <RouteMap
                    stops={[{ id: v.locationOrderNo, lat: v.locationPreviewLat, lng: v.locationPreviewLng, label: v.locationCustomer, status: '', color: '#e5484d', zoneName: '', pinLabel: null }]}
                    warehouse={null}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--color-neutral-500)' }}>ยังไม่มีพิกัด</div>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                พิกัดปัจจุบันในชีท: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.locationOriginalText}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div className="field"><label>Latitude (ละ)</label><input className="input" value={v.locationLat} onChange={(e) => v.onLocationLat(e.target.value)} disabled={v.locationSaving} /></div>
                <div className="field"><label>Longitude (ลอง)</label><input className="input" value={v.locationLng} onChange={(e) => v.onLocationLng(e.target.value)} disabled={v.locationSaving} /></div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                <i className="ph ph-info" style={{ marginRight: 4 }} />บันทึกแล้วจะเขียนทับพิกัดของลูกค้ารายนี้ใน Google Sheet (CS Master) โดยตรง
              </div>
              {v.locationError && (
                <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
                  <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{v.locationError}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={v.closeLocationModal} disabled={v.locationSaving}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={v.saveLocation} disabled={v.locationSaving}>
                {v.locationSaving ? <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</> : <><i className="ph ph-floppy-disk" />บันทึกลงชีท</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
