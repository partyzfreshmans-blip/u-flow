interface Stop {
  id: string;
  seq: number;
  cust: string;
}

function hashSeed(id: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) >>> 0;
  return h;
}

function hashPos(id: string): { x: number; y: number } {
  const x = 10 + (hashSeed(id, 17) % 80);
  const y = 12 + (hashSeed(id, 977) % 76);
  return { x, y };
}

export function RouteMap({ stops }: { stops: Stop[] }) {
  const points = stops.map((s) => ({ ...s, ...hashPos(s.id) }));
  const path = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        background: 'repeating-linear-gradient(0deg, var(--color-neutral-900) 0, var(--color-neutral-900) 1px, transparent 1px, transparent 42px), repeating-linear-gradient(90deg, var(--color-neutral-900) 0, var(--color-neutral-900) 1px, transparent 1px, transparent 42px), var(--color-bg)',
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <polyline points={path} fill="none" stroke="var(--color-accent-700)" strokeWidth={0.6} strokeDasharray="2,1.4" />
      </svg>
      {points.map((p) => (
        <div
          key={p.id}
          title={p.cust}
          style={{
            position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)',
            width: 26, height: 26, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff',
            display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, boxShadow: '0 3px 10px rgba(0,0,0,.45)',
            border: '2px solid var(--color-bg)',
          }}
        >
          {p.seq}
        </div>
      ))}
    </div>
  );
}
