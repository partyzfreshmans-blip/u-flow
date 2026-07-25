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

/** Plots real lat/lng onto a simple equirectangular projection, scaled to
 * fit whatever points are present (plus the warehouse). No tile layer —
 * this is a relative-position sketch, not a street map. */
export function RouteMap({ stops, warehouse }: Props) {
  const points = [...stops, ...(warehouse ? [{ id: '__wh', lat: warehouse.lat, lng: warehouse.lng, label: 'คลังสินค้า', status: '__wh' }] : [])];

  if (points.length === 0) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--color-neutral-500)', fontSize: 13 }}>
        ไม่มีพิกัดสำหรับแสดงบนแผนที่
      </div>
    );
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 0.01);
  const spanLng = Math.max(maxLng - minLng, 0.01);

  const pad = 8;
  const project = (lat: number, lng: number) => ({
    x: pad + ((lng - minLng) / spanLng) * (100 - pad * 2),
    // latitude grows northward, screen y grows downward
    y: pad + ((maxLat - lat) / spanLat) * (100 - pad * 2),
  });

  return (
    <div
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        background:
          'repeating-linear-gradient(0deg, var(--color-neutral-900) 0, var(--color-neutral-900) 1px, transparent 1px, transparent 42px), repeating-linear-gradient(90deg, var(--color-neutral-900) 0, var(--color-neutral-900) 1px, transparent 1px, transparent 42px), var(--color-bg)',
      }}
    >
      {warehouse && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {stops.map((s) => {
            const a = project(warehouse.lat, warehouse.lng);
            const b = project(s.lat, s.lng);
            return <line key={s.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-accent-800)" strokeWidth={0.25} />;
          })}
        </svg>
      )}

      {stops.map((s) => {
        const { x, y } = project(s.lat, s.lng);
        return (
          <div
            key={s.id}
            title={`${s.label} · ${s.status}`}
            style={{
              position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)',
              width: 11, height: 11, borderRadius: '50%', background: 'var(--color-accent)',
              border: '2px solid var(--color-bg)', boxShadow: '0 2px 6px rgba(0,0,0,.5)',
            }}
          />
        );
      })}

      {warehouse && (() => {
        const { x, y } = project(warehouse.lat, warehouse.lng);
        return (
          <div
            title="คลังสินค้า"
            style={{
              position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)',
              width: 28, height: 28, borderRadius: 8, background: 'var(--st-ok-fg)', color: '#0b0c14',
              display: 'grid', placeItems: 'center', fontSize: 15, border: '2px solid var(--color-bg)',
              boxShadow: '0 3px 10px rgba(0,0,0,.55)',
            }}
          >
            <i className="ph ph-warehouse" />
          </div>
        );
      })()}
    </div>
  );
}
