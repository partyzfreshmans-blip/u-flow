import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Side-effect only — attaches the `.pm` namespace to L.Map/L.Layer (and the
// draw/edit/remove toolbar) via ambient module augmentation; nothing here is
// imported by name. See RouteMap.tsx for the same pattern with the
// overlapping-marker-spiderfier plugin.
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { point } from '@turf/helpers';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { pointZone, UNASSIGNED_COLOR, type Zone } from '../data/zones';
import type { AppActions, AppState } from '../state/store';

const ZONE_PALETTE = ['#78e3ac', '#8fb2ef', '#f2b0d8', '#f6bd16', '#daaa53', '#9270ca', '#6dc8ec', '#ff9d4d'];
const DRAG_MIME = 'application/x-uflow-zone-reorder';

function newZoneId(): string {
  return `zone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A small placeholder square near the warehouse — dropped in as the
 * starting shape for a brand-new zone so it's immediately visible (and
 * editable) on the map instead of being an invisible zero-vertex shape. */
function placeholderPolygon(center: { lat: number; lng: number }): GeoJSON.Polygon {
  const d = 0.03;
  return {
    type: 'Polygon',
    coordinates: [[
      [center.lng - d, center.lat + d],
      [center.lng + d, center.lat + d],
      [center.lng + d, center.lat - d],
      [center.lng - d, center.lat - d],
      [center.lng - d, center.lat + d],
    ]],
  };
}

export function ZoneManagementPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const isDesktop = useIsDesktop();
  const canManage = state.session?.role === 'administrator';

  // Local editable draft — metadata (name/color/vehicle/active/order) lives
  // in ordinary React state; polygon geometry while editing lives on the
  // Leaflet/geoman layers themselves (see polygonsRef) so a name/colour
  // change never has to recreate a layer mid-edit and risk losing an
  // in-progress vertex drag.
  const [zones, setZones] = useState<Zone[]>(state.zones);
  const [loadedOnce, setLoadedOnce] = useState(false);
  // Pulls in a fresh copy from the server exactly once the real list has
  // arrived (zonesLoading flips false) — never again after that, so it
  // can't clobber whatever the admin is mid-editing.
  useEffect(() => {
    if (!state.zonesLoading && !loadedOnce) {
      setZones(state.zones);
      setLoadedOnce(true);
    }
  }, [state.zonesLoading, state.zones, loadedOnce]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editTick, setEditTick] = useState(0);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<string, L.Polygon>>(new Map());
  const polygonsRef = useRef<Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>>(new Map());
  // Always-current refs so Leaflet event handlers (registered once per
  // layer, not once per render) never close over stale React state.
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const setZonesRef = useRef(setZones);
  setZonesRef.current = setZones;

  const warehouse = useMemo(() => {
    const o = state.routeOrders.find((x) => x.whLat != null && x.whLng != null);
    return o && o.whLat != null && o.whLng != null ? { lat: o.whLat, lng: o.whLng } : { lat: 18.56, lng: 99.04 };
  }, [state.routeOrders]);

  // ---- map bootstrap (once) ----
  useEffect(() => {
    if (!isDesktop || !canManage || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    map.setView([warehouse.lat, warehouse.lng], 10);
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawCircle: false,
      drawText: false,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
      rotateMode: false,
    });

    const bindLayerEvents = (id: string, layer: L.Polygon) => {
      const sync = () => {
        const geo = layer.toGeoJSON();
        if (geo.geometry.type === 'Polygon' || geo.geometry.type === 'MultiPolygon') {
          polygonsRef.current.set(id, geo.geometry);
          setEditTick((n) => n + 1);
        }
      };
      layer.on('pm:edit', sync);
      layer.on('pm:markerdragend', sync);
      layer.on('pm:vertexadded', sync);
      layer.on('pm:dragend', sync);
      layer.on('pm:remove', () => {
        layersRef.current.delete(id);
        polygonsRef.current.delete(id);
        setZonesRef.current((cur) => cur.filter((z) => z.id !== id));
      });
      layer.on('click', () => setSelectedId(id));
    };

    map.on('pm:create', (e) => {
      if (e.shape !== 'Polygon' || !(e.layer instanceof L.Polygon)) return;
      const id = newZoneId();
      const color = ZONE_PALETTE[zonesRef.current.length % ZONE_PALETTE.length];
      e.layer.setStyle({ color: '#161826', weight: 1.5, fillColor: color, fillOpacity: 0.35 });
      const geo = e.layer.toGeoJSON();
      const polygon = geo.geometry.type === 'Polygon' || geo.geometry.type === 'MultiPolygon' ? geo.geometry : placeholderPolygon(warehouse);
      polygonsRef.current.set(id, polygon);
      layersRef.current.set(id, e.layer);
      bindLayerEvents(id, e.layer);
      setZonesRef.current((cur) => [...cur, { id, name: `โซนใหม่ ${cur.length + 1}`, color, vehicleId: '', active: true, polygon }]);
      setSelectedId(id);
    });

    mapRef.current = map;
    // Draw every zone already loaded once the map exists.
    for (const z of zonesRef.current) {
      const layer = L.polygon(polygonToLatLngs(z.polygon), {
        color: '#161826',
        weight: 1.5,
        fillColor: z.color,
        fillOpacity: 0.35,
      }).addTo(map);
      layer.pm.enable({ allowSelfIntersection: false });
      polygonsRef.current.set(z.id, z.polygon);
      layersRef.current.set(z.id, layer);
      bindLayerEvents(z.id, layer);
    }
    if (zonesRef.current.length > 0) {
      const bounds = L.latLngBounds(Array.from(layersRef.current.values()).flatMap((l) => l.getLatLngs().flat(2) as L.LatLng[]));
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
    }

    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = new Map();
    };
    // Bootstraps once per mount (guarded by mapRef.current above) — zones
    // loaded later (after the initial fetch resolves) are handled by the
    // separate sync effect below, not by re-running this whole setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, canManage]);

  // ---- keep Leaflet layers roughly in sync with the zone list: colour
  // changes reflect immediately; zones added/removed outside the map
  // (shouldn't normally happen, but covers the initial-load swap-in) get
  // their layers created/destroyed without touching anyone else's
  // in-progress geometry edit. ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const z of zones) {
      const layer = layersRef.current.get(z.id);
      if (layer) {
        layer.setStyle({ fillColor: z.color });
      } else {
        const newLayer = L.polygon(polygonToLatLngs(polygonsRef.current.get(z.id) ?? z.polygon), {
          color: '#161826',
          weight: 1.5,
          fillColor: z.color,
          fillOpacity: 0.35,
        }).addTo(map);
        newLayer.pm.enable({ allowSelfIntersection: false });
        polygonsRef.current.set(z.id, polygonsRef.current.get(z.id) ?? z.polygon);
        layersRef.current.set(z.id, newLayer);
        newLayer.on('pm:edit', () => {
          const geo = newLayer.toGeoJSON();
          if (geo.geometry.type === 'Polygon' || geo.geometry.type === 'MultiPolygon') {
            polygonsRef.current.set(z.id, geo.geometry);
            setEditTick((n) => n + 1);
          }
        });
        newLayer.on('click', () => setSelectedId(z.id));
      }
    }
    for (const [id, layer] of layersRef.current) {
      if (!zones.some((z) => z.id === id)) {
        map.removeLayer(layer);
        layersRef.current.delete(id);
        polygonsRef.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones]);

  // ---- live per-zone pin counts + the always-visible "ยังไม่ได้จัด" bucket ----
  const orderPoints = useMemo(
    () => state.routeOrders.filter((o) => o.lat != null && o.lng != null).map((o) => ({ lat: o.lat as number, lng: o.lng as number })),
    [state.routeOrders],
  );
  const pinCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const z of zones) {
      const polygon = polygonsRef.current.get(z.id) ?? z.polygon;
      let n = 0;
      for (const p of orderPoints) {
        try {
          if (booleanPointInPolygon(point([p.lng, p.lat]), polygon)) n++;
        } catch {
          // mid-edit shape with too few vertices — not containable yet
        }
      }
      counts.set(z.id, n);
    }
    return counts;
    // editTick is the signal that polygonsRef actually changed — zones/
    // orderPoints alone wouldn't catch a pure geometry edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, orderPoints, editTick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- editTick signals a geometry-only change in polygonsRef
  const liveZones = useMemo(() => zones.map((z) => ({ ...z, polygon: polygonsRef.current.get(z.id) ?? z.polygon })), [zones, editTick]);
  const unassignedCount = useMemo(
    () => orderPoints.filter((p) => pointZone(liveZones, p.lat, p.lng).zoneId === null).length,
    [liveZones, orderPoints],
  );

  // ---- zone list editing ----
  const updateZone = (id: string, patch: Partial<Zone>) => setZones((cur) => cur.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  const deleteZone = (id: string) => {
    const layer = layersRef.current.get(id);
    if (layer) mapRef.current?.removeLayer(layer);
    layersRef.current.delete(id);
    polygonsRef.current.delete(id);
    setZones((cur) => cur.filter((z) => z.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const reorder = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setZones((cur) => {
      const next = [...cur];
      const from = next.findIndex((z) => z.id === draggedId);
      const to = next.findIndex((z) => z.id === targetId);
      if (from === -1 || to === -1) return cur;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const saving = state.zonesSaveStatus?.state === 'saving';
  const handleSave = () => {
    const finalZones = zones.map((z) => ({ ...z, polygon: polygonsRef.current.get(z.id) ?? z.polygon }));
    actions.saveZones({
      zones: finalZones,
      previousZones: state.zones,
      routeOrders: state.routeOrders,
      routePlan: state.routePlan,
      batchRoutes: state.batchRoutes,
    });
  };

  if (!canManage) {
    return (
      <div className="card elev-sm" style={{ padding: 24, textAlign: 'center', color: 'var(--color-neutral-400)' }}>
        <i className="ph ph-lock-key" style={{ fontSize: 22, marginBottom: 8, display: 'block' }} />
        หน้านี้ใช้ได้เฉพาะ Administrator (หัวหน้าคลัง)
      </div>
    );
  }
  if (!isDesktop) {
    return (
      <div className="card elev-sm" style={{ padding: 24, textAlign: 'center', color: 'var(--color-neutral-400)' }}>
        <i className="ph ph-desktop" style={{ fontSize: 22, marginBottom: 8, display: 'block' }} />
        การวาดโซนบนแผนที่ใช้ได้เฉพาะหน้าจอเดสก์ท็อป — เปิดจากคอมพิวเตอร์แทน
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {state.zoneChangeAlerts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 15px', borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ fontSize: 17, flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            มี {state.zoneChangeAlerts.length} จุดที่โซนเปลี่ยนไปหลังแก้ขอบเขต — ไม่ได้ย้ายออเดอร์ให้อัตโนมัติ ไปดูและจัดใหม่เองที่หน้าวางแผนจัดรูท
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => actions.patch({ route: 'planner' })}>ไปวางแผนจัดรูท</button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => actions.dismissZoneChangeAlerts()}><i className="ph ph-x" /></button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '5px 11px', borderRadius: 20, background: 'var(--color-surface)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: UNASSIGNED_COLOR, flex: 'none' }} />
          ยังไม่ได้จัด (นอกทุกโซน หรือไม่มีพิกัด): <b style={{ fontVariantNumeric: 'tabular-nums' }}>{unassignedCount}</b> หมุด
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {state.zonesSaveStatus?.state === 'saved' && <span style={{ fontSize: 12, color: 'var(--st-ok-fg)' }}><i className="ph ph-check-circle-fill" style={{ marginRight: 4 }} />บันทึกแล้ว</span>}
          {state.zonesSaveStatus?.state === 'error' && <span style={{ fontSize: 12, color: 'var(--st-bad-fg)' }}><i className="ph ph-warning-fill" style={{ marginRight: 4 }} />{state.zonesSaveStatus.message}</span>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</> : <><i className="ph ph-floppy-disk" />บันทึกโซน</>}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 14 }}>
        <div className="card elev-sm" style={{ padding: 0, overflow: 'hidden', height: 640, position: 'relative' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: 'var(--color-bg)' }} />
        </div>

        <div className="card elev-sm" style={{ gap: 10, maxHeight: 640, overflowY: 'auto' }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>รายการโซน ({zones.length})</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.5 }}>
            <i className="ph ph-info" style={{ marginRight: 4 }} />ลากเพื่อจัดลำดับ — บนสุดชนะเมื่อโซนซ้อนกัน · วาด polygon บนแผนที่ด้วยเครื่องมือมุมซ้ายบน
          </div>
          {zones.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ยังไม่มีโซน — วาด polygon บนแผนที่เพื่อเริ่ม</div>
          )}
          {zones.map((z) => (
            <div
              key={z.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, z.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(z.id);
              }}
              onDragLeave={() => setDragOverId((cur) => (cur === z.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverId(null);
                const draggedId = e.dataTransfer.getData(DRAG_MIME);
                if (draggedId) reorder(draggedId, z.id);
              }}
              onClick={() => setSelectedId(z.id)}
              style={{
                padding: 10, borderRadius: 9, cursor: 'grab',
                background: selectedId === z.id ? 'var(--color-bg)' : 'transparent',
                boxShadow: dragOverId === z.id ? 'inset 0 0 0 2px var(--color-accent)' : 'inset 0 0 0 1px var(--color-divider)',
                opacity: z.active ? 1 : 0.55,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <i className="ph ph-dots-six-vertical" style={{ color: 'var(--color-neutral-600)', flex: 'none' }} />
                <input type="color" value={z.color} onChange={(e) => updateZone(z.id, { color: e.target.value })} style={{ width: 26, height: 24, background: 'none', border: 0, padding: 0, cursor: 'pointer', flex: 'none' }} />
                <input className="input" style={{ minHeight: 28, fontSize: 12.5, flex: 1 }} value={z.name} onChange={(e) => updateZone(z.id, { name: e.target.value })} />
                <button className="btn btn-icon btn-ghost" style={{ width: 26, height: 26, flex: 'none' }} title="ลบโซนนี้" onClick={(e) => { e.stopPropagation(); deleteZone(z.id); }}>
                  <i className="ph ph-trash" style={{ fontSize: 13 }} />
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <select className="input" style={{ minHeight: 28, fontSize: 12, flex: 1 }} value={z.vehicleId} onChange={(e) => updateZone(z.id, { vehicleId: e.target.value })}>
                  <option value="">— ไม่ผูกรถ —</option>
                  {state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={z.active} onChange={(e) => updateZone(z.id, { active: e.target.checked })} />เปิด
                </label>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 5 }}>
                <i className="ph ph-map-pin" style={{ marginRight: 3 }} />
                <b style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)' }}>{pinCounts.get(z.id) ?? 0}</b> หมุดในขอบเขตนี้
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Below this width the polygon-drawing toolbar and a two-column
 * map+list layout don't fit anything usable — same reasoning as the rest
 * of this app's ~900px collapse breakpoint. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 900);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isDesktop;
}

function polygonToLatLngs(polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon): L.LatLngExpression[] | L.LatLngExpression[][] {
  const ringToLatLngs = (ring: number[][]): L.LatLngExpression[] => ring.map(([lng, lat]) => [lat, lng]);
  if (polygon.type === 'Polygon') {
    return polygon.coordinates.map(ringToLatLngs);
  }
  // MultiPolygon: flatten to the outer ring of each part — geoman edits a
  // single Polygon layer's rings; a drawn zone is always a Polygon in
  // practice, this only has to render something reasonable if one ever
  // arrives as MultiPolygon (e.g. hand-edited in the sheet).
  return polygon.coordinates.map((poly) => poly.map(ringToLatLngs)).flat();
}
