import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
  /** Present only for stops already on a vehicle's route — lets the popup
   * offer "เลื่อนขึ้น/ลง" using the exact same batch-lock-aware, Activity
   * Log-logging closures the table's own reorder buttons call. */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  moveUp?: () => void;
  moveDown?: () => void;
  /** true once this stop's vehicle has a locked batch — suppresses the
   * whole popup, matching the table's own hide-not-disable behavior. */
  locked?: boolean;
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

/** A delivery zone's colour/name + the same polygon it's drawn with on the
 * Zone Management page — drawn here as a read-only translucent overlay so
 * planners can see the zone boundaries their auto-assign decisions are
 * actually based on, right next to the pins themselves. */
interface ZoneOverlay {
  id: string;
  name: string;
  color: string;
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon;
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
  /** Active zone polygons to draw underneath the pins — omit to skip the
   * overlay entirely (e.g. the location-edit preview map has no zones). */
  zones?: ZoneOverlay[];
}

/** Leaflet inserts divIcon/tooltip content via innerHTML with no escaping of
 * its own, and this text ultimately comes from sheet data (customer names,
 * zone names, vehicle codes) that a user could type HTML into — escape it
 * before interpolating so that can never execute as markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Every pin stays plotted individually at every zoom level (a province-wide
 * overview must still show where the real spread of drops is, not a clump of
 * cluster bubbles) — only its *size* responds to zoom: small and unobtrusive
 * zoomed all the way out, growing past its "native" size once zoomed in close
 * enough that a bigger tap target actually helps. Piecewise-linear between a
 * few hand-picked (zoom, scale) anchors rather than a single formula, so the
 * curve can be tuned at either end independently. */
function pinScaleForZoom(zoom: number): number {
  const anchors: [number, number][] = [
    [6, 0.4],
    [10, 0.55],
    [13, 0.8],
    [15, 1],
    [18, 1.3],
  ];
  if (zoom <= anchors[0][0]) return anchors[0][1];
  if (zoom >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [z0, s0] = anchors[i];
    const [z1, s1] = anchors[i + 1];
    if (zoom >= z0 && zoom <= z1) return s0 + (s1 - s0) * ((zoom - z0) / (z1 - z0));
  }
  return 1;
}

/** Flat solid colour, no heavy outline — a soft drop shadow alone gives
 * enough separation from the tiles underneath. Labeled pins carry the
 * delivery sequence, but only once zoomed in enough to read it; zoomed out
 * they collapse to the same plain dot shape unlabeled (unassigned) stops
 * always use, since a number too small to read is just visual noise. */
function pinIcon(color: string, pinLabel: string | null, zoom: number): L.DivIcon {
  const scale = pinScaleForZoom(zoom);
  const showLabel = pinLabel != null && zoom >= 12;
  if (showLabel) {
    const height = Math.max(13, Math.round(22 * scale));
    const padX = Math.max(3, Math.round(7 * scale));
    const minWidth = Math.max(15, Math.round(26 * scale));
    const fontSize = Math.max(8, Math.round(11 * scale * 10) / 10);
    const width = minWidth + padX * 2;
    return L.divIcon({
      className: '',
      html: `<div style="min-width:${minWidth}px;height:${height}px;padding:0 ${padX}px;border-radius:${Math.round(height / 2)}px;background:${escapeHtml(color)};color:#161826;display:grid;place-items:center;font-weight:700;font-size:${fontSize}px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)">${escapeHtml(pinLabel)}</div>`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height / 2],
    });
  }
  const size = Math.max(5, Math.round((pinLabel != null ? 15 : 13) * scale));
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${escapeHtml(color)};box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function RouteMap({ stops, warehouse, vehicleRoutes, vehicleOptions, onMoveToVehicle, zones }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // Every pin's marker + the (colour, label) it was last drawn with, so a
  // zoom change can restyle every pin's icon in place via setIcon — no need
  // to tear down and rebuild markers (and lose any open popup) just because
  // the zoom level moved.
  const pinMetaRef = useRef(new Map<string, { marker: L.Marker; color: string; pinLabel: string | null }>());
  // Always-current callback ref so marker popups (built once per stops
  // change) never close over a stale onMoveToVehicle from an earlier render.
  const onMoveRef = useRef(onMoveToVehicle);
  onMoveRef.current = onMoveToVehicle;

  // Create the map once; markers are re-drawn separately as filters change.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const pinMeta = pinMetaRef.current;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    map.setView([18.56, 99.04], 10); // Lamphun / Chiang Mai, until data arrives
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on('zoomend', () => {
      const zoom = map.getZoom();
      for (const { marker, color, pinLabel } of pinMetaRef.current.values()) {
        marker.setIcon(pinIcon(color, pinLabel, zoom));
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      pinMeta.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    pinMetaRef.current.clear();
    const zoom = map.getZoom();

    // Zone polygons first, purely decorative — non-interactive so they never
    // steal a click or hover meant for a pin sitting on top of them (Leaflet
    // also keeps vector layers like this in a lower pane than marker icons,
    // so pins already render above them regardless).
    for (const z of zones ?? []) {
      L.geoJSON(z.polygon, {
        interactive: false,
        style: { color: z.color, weight: 1.5, opacity: 0.85, fillColor: z.color, fillOpacity: 0.14 },
      }).addTo(layer);
    }

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
        .addTo(layer);
    }

    // Route lines: warehouse -> stop 1 -> stop 2 -> ... per vehicle, in that
    // vehicle's own colour — drawn under the pins, always visible.
    for (const r of vehicleRoutes ?? []) {
      if (r.points.length === 0) continue;
      const latlngs: L.LatLngExpression[] = [
        ...(warehouse ? [[warehouse.lat, warehouse.lng] as L.LatLngExpression] : []),
        ...r.points.map((p): L.LatLngExpression => [p.lat, p.lng]),
      ];
      if (latlngs.length < 2) continue;
      L.polyline(latlngs, { color: r.color, weight: 2.5, opacity: 0.75, dashArray: '6 5' }).addTo(layer);
    }

    for (const s of stops) {
      const tooltipText = `${escapeHtml(s.label)} · ${escapeHtml(s.zoneName)}${s.status ? ` · ${escapeHtml(s.status)}` : ''}`;
      const marker = L.marker([s.lat, s.lng], { icon: pinIcon(s.color, s.pinLabel, zoom) });
      pinMetaRef.current.set(s.id, { marker, color: s.color, pinLabel: s.pinLabel });

      marker.bindTooltip(s.pinLabel ? tooltipText : `${tooltipText} (ยังไม่จัดลงรถ)`);

      // Popup — built as real DOM nodes (not an HTML string) so change/click
      // handlers can be wired directly, with no risk of injecting
      // sheet-sourced text as markup. Offers "เลื่อนขึ้น/ลง" (reorder within
      // the current vehicle) and "ย้ายไปรถคันอื่น" (move to another
      // vehicle), whichever apply to this stop — an unassigned stop only
      // ever gets the move option, and a vehicle with just one stop only
      // ever gets the move option too (nothing to reorder against).
      const canReorder = !s.locked && !!(s.moveUp || s.moveDown);
      const targets = !s.locked && onMoveRef.current && vehicleOptions ? vehicleOptions.filter((v) => v.id !== s.vehicleId) : [];
      if (canReorder || targets.length > 0) {
        const wrap = document.createElement('div');
        wrap.style.minWidth = '150px';
        wrap.style.fontFamily = 'var(--font-body)';
        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.fontSize = '12.5px';
        title.style.marginBottom = '6px';
        title.textContent = s.label;
        wrap.appendChild(title);

        if (canReorder) {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '6px';
          row.style.marginBottom = targets.length > 0 ? '8px' : '0';
          const makeBtn = (label: string, enabled: boolean, onClick: () => void) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.type = 'button';
            btn.style.flex = '1';
            btn.style.fontSize = '11.5px';
            btn.style.minHeight = '26px';
            btn.textContent = label;
            btn.disabled = !enabled;
            btn.addEventListener('click', () => {
              onClick();
              map.closePopup();
            });
            return btn;
          };
          row.appendChild(makeBtn('↑ เลื่อนขึ้น', !!s.canMoveUp, () => s.moveUp?.()));
          row.appendChild(makeBtn('↓ เลื่อนลง', !!s.canMoveDown, () => s.moveDown?.()));
          wrap.appendChild(row);
        }

        if (targets.length > 0) {
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
        }

        marker.bindPopup(wrap);
      }

      marker.addTo(layer);
    }

    const points: L.LatLngExpression[] = stops.map((s) => [s.lat, s.lng]);
    if (warehouse) points.push([warehouse.lat, warehouse.lng]);
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.15));
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [stops, warehouse, vehicleRoutes, vehicleOptions, zones]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: 'var(--color-bg)' }} />;
}
