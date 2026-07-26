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
}

interface Props {
  stops: Stop[];
  warehouse: { lat: number; lng: number } | null;
}

/** Leaflet inserts divIcon/tooltip content via innerHTML with no escaping of
 * its own, and this text ultimately comes from sheet data (customer names,
 * zone names, vehicle codes) that a user could type HTML into — escape it
 * before interpolating so that can never execute as markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function RouteMap({ stops, warehouse }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

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
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

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

    for (const s of stops) {
      const tooltipText = `${escapeHtml(s.label)} · ${escapeHtml(s.zoneName)}${s.status ? ` · ${escapeHtml(s.status)}` : ''}`;
      if (s.pinLabel) {
        L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div style="min-width:28px;height:20px;padding:0 6px;border-radius:10px;background:${escapeHtml(s.color)};color:#161826;display:grid;place-items:center;font-weight:800;font-size:10.5px;white-space:nowrap;border:1.5px solid #161826;box-shadow:0 2px 6px rgba(0,0,0,.5)">${escapeHtml(s.pinLabel)}</div>`,
            iconSize: [40, 20],
            iconAnchor: [20, 10],
          }),
        })
          .bindTooltip(tooltipText)
          .addTo(layer);
      } else {
        L.circleMarker([s.lat, s.lng], {
          radius: 5,
          color: '#3a3d49',
          weight: 1.5,
          fillColor: s.color,
          fillOpacity: 0.6,
        })
          .bindTooltip(`${tooltipText} (ยังไม่จัดลงรถ)`)
          .addTo(layer);
      }
    }

    const points: L.LatLngExpression[] = stops.map((s) => [s.lat, s.lng]);
    if (warehouse) points.push([warehouse.lat, warehouse.lng]);
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.15));
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [stops, warehouse]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: 'var(--color-bg)' }} />;
}
