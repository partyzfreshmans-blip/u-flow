import { useEffect, useRef } from 'react';
import { computeNotifications } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function NotificationBell({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeNotifications(state, actions);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click-outside closes the dropdown, same convention as any other panel.
  useEffect(() => {
    if (!v.isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) v.close();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.isOpen]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button className="btn btn-icon btn-secondary" title="แจ้งเตือน" onClick={v.toggle} style={{ position: 'relative' }}>
        <i className="ph ph-bell" style={{ fontSize: 16 }} />
        {v.unreadCount > 0 && (
          <span
            style={{
              position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 3px', borderRadius: 8,
              background: 'var(--st-bad-fg)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center',
              lineHeight: 1, fontFamily: 'var(--font-body)',
            }}
          >
            {v.unreadCount > 99 ? '99+' : v.unreadCount}
          </span>
        )}
      </button>

      {v.isOpen && (
        <div
          className="card elev-sm"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 360, maxHeight: 420, overflow: 'auto',
            padding: '10px 0', zIndex: 20, gap: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 8px', boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>แจ้งเตือน</span>
            {v.unreadCount > 0 && (
              <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 11.5 }} onClick={v.markAllRead}>
                อ่านทั้งหมด
              </button>
            )}
          </div>
          {v.isEmpty ? (
            <div style={{ padding: 22, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่มีการแจ้งเตือน</div>
          ) : (
            v.items.map((n) => (
              <button
                key={n.id}
                onClick={n.markRead}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', padding: '10px 14px', background: n.read ? 'transparent' : 'var(--color-accent-900)',
                }}
              >
                <i className={n.icon} style={{ fontSize: 15, color: n.iconColor, marginTop: 2, flex: 'none' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--color-neutral-100)', lineHeight: 1.4 }}>{n.message}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', marginTop: 3 }}>{n.timeText}</div>
                </div>
                {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--st-info-fg)', flex: 'none', marginTop: 5, marginLeft: 'auto' }} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
