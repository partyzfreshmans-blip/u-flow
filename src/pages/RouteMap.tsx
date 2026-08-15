import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Side-effect only — attaches L.markerClusterGroup()/L.MarkerClusterGroup via
// ambient module augmentation (see @types/leaflet.markercluster). Nearby pins
// collapse into a numbered bubble at low zoom and split apart (auto-spiderfy
// at max zoom for exact-same-spot pins) on click, instead of the old
// overlapping-marker-spiderfier-leaflet approach of always spreading every
// overlap into a tiny fan — the "18 unassigned pins stacked in one spot"
// case reads as one bubble now instead of an unreadable pile.
import 'leaflet.markercluster';
// Only the base plugin CSS (spiderfy legs, cluster fade/zoom animation) —
// MarkerCluster.Default.css's own circle-colour theme is skipped since every
// cluster bubble here is custom-drawn via iconCreateFunction below.
import 'leaflet.markercluster/dist/MarkerCluster.css';
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

/** Pin sizing/weight step up a little past ~10 and ~30 markers so a big
 * cluster still reads as "clearly more" at a glance, not just a bigger
 * number in the same size bubble. */
function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 30 : count < 30 ? 37 : 45;
  const fontSize = count < 100 ? 12.5 : 10.5;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:var(--color-accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:${fontSize}px;box-shadow:0 2px 7px rgba(0,0,0,.45)">${count}</div>`,
    iconSize: L.point(size, size),
  });
}

export function RouteMap({ stops, warehouse, vehicleRoutes, vehicleOptions, onMoveToVehicle, zones }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  // WH marker, route polylines, and zone polygons — none of these cluster,
  // so they live in a plain layer group separate from the pins below.
  const layerRef = useRef<L.LayerGroup | null>(null);
  // Delivery-stop pins only. Nearby pins collapse into a numbered bubble;
  // clicking one zooms in, and clicking a bubble that's already at max zoom
  // (i.e. pins genuinely on top of each other) spiderfies it apart instead.
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
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
    layerRef.current = L.layerGroup().addTo(map);
    clusterRef.current = L.markerClusterGroup({
      iconCreateFunction: (cluster) => clusterIcon(cluster.getChildCount()),
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const cluster = clusterRef.current;
    if (!map || !layer || !cluster) return;

    layer.clearLayers();
    cluster.clearLayers();

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
    // vehicle's own colour — drawn under the pins, always visible (never
    // clustered or otherwise touched by the pin-grouping below).
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
      // Flat solid colour, no heavy outline — a soft drop shadow alone gives
      // enough separation from the tiles underneath. Labeled pins carry the
      // sequence number; unlabeled ones (not yet assigned to a vehicle) are
      // a small plain dot, same shape family as the labeled pin.
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: s.pinLabel
            ? `<div style="min-width:26px;height:22px;padding:0 7px;border-radius:11px;background:${escapeHtml(s.color)};color:#161826;display:grid;place-items:center;font-weight:700;font-size:11px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)">${escapeHtml(s.pinLabel)}</div>`
            : `<div style="width:14px;height:14px;border-radius:50%;background:${escapeHtml(s.color)};box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`,
          iconSize: s.pinLabel ? [42, 22] : [14, 14],
          iconAnchor: s.pinLabel ? [21, 11] : [7, 7],
        }),
      });

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

      cluster.addLayer(marker);
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
