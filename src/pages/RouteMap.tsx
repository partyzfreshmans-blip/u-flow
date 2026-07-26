import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useEffect, useRef } from 'react';

interface Stop {
  id: string;
  lat: number;
  lng: number;
  label: string;
  status: string;
  /** Zone colour, so a glance at the map shows which zone each drop is in. */
  color: string;
  zoneName: string;
  /** Short text shown on the pin itself, e.g. "A-3" (vehicle + sequence).
   * null renders a plain small gray dot instead — used for orders not yet
   * assigned to a vehicle, so they read as visually distinct at a glance. */
  pinLabel: string | null;
  /** Vehicle this stop currently belongs to; null = unassigned. Needed so a
   * pin click can offer "move to another vehicle" and exclude its own. */
  vehicleId?: string | null;
}

interface VehicleRoute {
  vehicleId: string;
  color: string;
  points: { lat: number; lng: number }[];
}

interface VehicleOption {
  id: string;
  name: string;
}

interface Props {
  stops: Stop[];
  warehouse: { lat: number; lng: number } | null;
  /** Per-vehicle delivery-sequence polylines (WH -> stop 1 -> stop 2 -> ...). */
  vehicleRoutes?: VehicleRoute[];
  /** Vehicles a pin's popup may offer as a move target — omit to disable the
   * move-from-map feature entirely (e.g. the small single-order preview map
   * in the location-edit dialog has no use for it). */
  vehicleOptions?: VehicleOption[];
  onMoveToVehicle?: (orderNo: string, fromVehicleId: string | null, toVehicleId: string) => void;
}

/** Leaflet inserts divIcon/tooltip content via innerHTML with no escaping of
 * its own, and this text ultimately comes from sheet data (customer names,
 * zone names, vehicle codes) that a user could type HTML into — escape it
 * before interpolating so that can never execute as markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function RouteMap({ stops, warehouse, vehicleRoutes, vehicleOptions, onMoveToVehicle }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Stop pins live in a cluster group (so nearby pins merge visually when
  // zoomed out); the warehouse marker and route lines stay in a plain layer
  // group so they're never swallowed into a cluster bubble.
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const baseLayerRef = useRef<L.LayerGroup | null>(null);
  // Always-current callback ref so marker popups (built once per stops
  // change) never close over a stale onMoveToVehicle from an earlier render.
  const onMoveRef = useRef(onMoveToVehicle);
  onMoveRef.current = onMoveToVehicle;

  // Create the map once; markers are re-drawn separately as filters change.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    map.setView([18.56, 99.04], 10); // Lamphun / Chiang Mai, until data arrives
    baseLayerRef.current = L.layerGroup().addTo(map);
    clusterRef.current = L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const base = baseLayerRef.current;
    if (!map || !cluster || !base) return;

    cluster.clearLayers();
    base.clearLayers();

    if (warehouse) {
      L.marker([warehouse.lat, warehouse.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:34px;height:24px;border-radius:6px;background:#fff;color:#161826;display:grid;place-items:center;font-weight:800;font-size:12px;letter-spacing:.04em;border:2px solid #161826;box-shadow:0 2px 8px rgba(0,0,0,.6)">WH</div>',
          iconSize: [34, 24],
          iconAnchor: [17, 12],
        }),
      })
        .bindTooltip('WH · คลังสินค้า')
        .addTo(base);
    }

    // Route lines: warehouse -> stop 1 -> stop 2 -> ... per vehicle, in that
    // vehicle's own colour — drawn under the pins, in the always-visible
    // base layer so they're never hidden inside a cluster bubble.
    for (const r of vehicleRoutes ?? []) {
      if (r.points.length === 0) continue;
      const latlngs: L.LatLngExpression[] = [
        ...(warehouse ? [[warehouse.lat, warehouse.lng] as L.LatLngExpression] : []),
        ...r.points.map((p): L.LatLngExpression => [p.lat, p.lng]),
      ];
      if (latlngs.length < 2) continue;
      L.polyline(latlngs, { color: r.color, weight: 2.5, opacity: 0.75, dashArray: '6 5' }).addTo(base);
    }

    for (const s of stops) {
      const tooltipText = `${escapeHtml(s.label)} · ${escapeHtml(s.zoneName)}${s.status ? ` · ${escapeHtml(s.status)}` : ''}`;
      const marker = s.pinLabel
        ? L.marker([s.lat, s.lng], {
            icon: L.divIcon({
              className: '',
              html: `<div style="min-width:28px;height:20px;padding:0 6px;border-radius:10px;background:${escapeHtml(s.color)};color:#161826;display:grid;place-items:center;font-weight:800;font-size:10.5px;white-space:nowrap;border:1.5px solid #161826;box-shadow:0 2px 6px rgba(0,0,0,.5)">${escapeHtml(s.pinLabel)}</div>`,
              iconSize: [40, 20],
              iconAnchor: [20, 10],
            }),
          })
        : L.circleMarker([s.lat, s.lng], {
            radius: 5,
            color: '#3a3d49',
            weight: 1.5,
            fillColor: s.color,
            fillOpacity: 0.6,
          });

      marker.bindTooltip(s.pinLabel ? tooltipText : `${tooltipText} (ยังไม่จัดลงรถ)`);

      // "ย้ายไปรถคันอื่น" straight from the map — built as real DOM nodes
      // (not an HTML string) so the change handler can be wired directly,
      // with no risk of injecting sheet-sourced text as markup.
      if (onMoveRef.current && vehicleOptions && vehicleOptions.length > 0) {
        const targets = vehicleOptions.filter((v) => v.id !== s.vehicleId);
        if (targets.length > 0) {
          const wrap = document.createElement('div');
          wrap.style.minWidth = '150px';
          wrap.style.fontFamily = 'var(--font-body)';
          const title = document.createElement('div');
          title.style.fontWeight = '600';
          title.style.fontSize = '12.5px';
          title.style.marginBottom = '6px';
          title.textContent = s.label;
          wrap.appendChild(title);
          const select = document.createElement('select');
          select.className = 'input';
          select.style.width = '100%';
          select.style.minHeight = '28px';
          select.style.fontSize = '12px';
          const blank = document.createElement('option');
          blank.value = '';
          blank.textContent = 'ย้ายไปรถคันอื่น...';
          select.appendChild(blank);
          for (const t of targets) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            select.appendChild(opt);
          }
          select.addEventListener('change', () => {
            const toVehicleId = select.value;
            if (!toVehicleId) return;
            onMoveRef.current?.(s.id, s.vehicleId ?? null, toVehicleId);
            map.closePopup();
          });
          wrap.appendChild(select);
          marker.bindPopup(wrap);
        }
      }

      cluster.addLayer(marker);
    }

    const points: L.LatLngExpression[] = stops.map((s) => [s.lat, s.lng]);
    if (warehouse) points.push([warehouse.lat, warehouse.lng]);
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.15));
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [stops, warehouse, vehicleRoutes, vehicleOptions]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: 'var(--color-bg)' }} />;
}
