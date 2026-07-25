import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { sheetStatusColor } from '../state/helpers';

interface Stop {
  id: string;
  lat: number;
  lng: number;
  label: string;
  status: string;
}

interface Props {
  stops: Stop[];
  warehouse: { lat: number; lng: number } | null;
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
          html: '<div style="width:26px;height:26px;border-radius:7px;background:#78e3ac;color:#0b0c14;display:grid;place-items:center;font-weight:700;font-size:13px;border:2px solid #161826;box-shadow:0 2px 8px rgba(0,0,0,.6)">คล</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .bindTooltip('คลังสินค้า')
        .addTo(layer);
    }

    for (const s of stops) {
      L.circleMarker([s.lat, s.lng], {
        radius: 6,
        color: '#161826',
        weight: 2,
        fillColor: sheetStatusColor(s.status),
        fillOpacity: 0.95,
      })
        .bindTooltip(`${s.label} · ${s.status || '—'}`)
        .addTo(layer);
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
