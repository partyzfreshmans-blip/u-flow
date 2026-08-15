import type { CSSProperties } from 'react';
import { canAccessPage, ROLE_LABELS } from '../config/permissions';
import type { Session } from '../data/session';
import type { RouteKey } from '../data/types';
import type { AppActions } from '../state/store';

/** Grouped for the sidebar's category headers (null = ungrouped, shown
 * first with no label) — purely a display grouping of the same existing
 * pages/labels/icons, no routing or permission change. */
const navGroups: { header: string | null; items: [RouteKey, string, string][] }[] = [
  {
    header: null,
    items: [
      ['dashboard', 'แดชบอร์ด / ออเดอร์', 'ph ph-squares-four'],
      ['route', 'จัดการออเดอร์', 'ph ph-clipboard-text'],
      ['planner', 'วางแผนจัดรูท', 'ph ph-map-trifold'],
      ['zones', 'จัดการโซน', 'ph ph-polygon'],
      ['driver', 'มุมมองคนขับ (มือถือ)', 'ph ph-device-mobile-speaker'],
      ['pick', 'จัดล็อตหยิบสินค้า', 'ph ph-list-checks'],
      ['cod', 'เคลียร์เงิน COD', 'ph ph-wallet'],
      ['grn', 'รับสินค้าเข้าคลัง', 'ph ph-tray-arrow-down'],
      ['customer', 'ฐานข้อมูลลูกค้า', 'ph ph-users'],
    ],
  },
  {
    header: 'MARKETING',
    items: [
      ['promo', 'โปรโมชั่น', 'ph ph-tag'],
      ['sku', 'ฐานข้อมูลสินค้า', 'ph ph-package'],
    ],
  },
  {
    header: 'SYSTEM',
    items: [
      ['activity', 'บันทึกการเปลี่ยนแปลง', 'ph ph-clock-counter-clockwise'],
      ['users', 'จัดการผู้ใช้', 'ph ph-identification-badge'],
      ['settings', 'ตั้งค่า / API Key', 'ph ph-gear'],
    ],
  },
];

const navBase: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
  border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13.5,
  padding: '9px 11px', borderRadius: 8, transition: 'background .12s',
};

export function Sidebar({ route, actions, session }: { route: RouteKey; actions: AppActions; session: Session }) {
  // Groups (and their headers) with no visible items for this role's
  // permissions just disappear — never an empty "MARKETING" heading with
  // nothing under it.
  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter(([key]) => canAccessPage(session.role, key)) }))
    .filter((g) => g.items.length > 0);
  const initials = session.username.slice(0, 2).toUpperCase();

  return (
    <aside style={{ flex: 'none', width: 236, background: 'var(--color-surface)', boxShadow: 'inset -1px 0 0 var(--color-divider)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '18px 16px 14px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--color-accent)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 17, letterSpacing: '-.02em' }}>U</div>
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 16 }}>Unii</div>
          <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>Warehouse Ops</div>
        </div>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '6px 12px', overflowY: 'auto' }}>
        {visibleGroups.map((g, gi) => (
          <div key={g.header ?? `group-${gi}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.header && (
              <div style={{ padding: '4px 11px 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: 'var(--color-neutral-600)' }}>{g.header}</div>
            )}
            {g.items.map(([key, label, icon]) => {
              const active = key === route;
              const style: CSSProperties = active
                ? { ...navBase, background: 'var(--color-accent-900)', color: 'var(--color-accent-200)', boxShadow: 'inset 0 0 0 1px var(--color-accent-700)' }
                : { ...navBase, background: 'transparent', color: 'var(--color-neutral-300)' };
              return (
                <button key={key} style={style} onClick={() => actions.patch({ route: key })}>
                  <i className={icon} style={{ fontSize: 18 }} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ marginTop: 'auto', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: 'inset 0 1px 0 var(--color-divider)' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-neutral-800)', display: 'grid', placeItems: 'center', color: 'var(--color-neutral-200)', fontSize: 12, fontWeight: 600, flex: 'none' }}>{initials}</div>
        <div style={{ lineHeight: 1.2, minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.username}</div>
          <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)' }}>{ROLE_LABELS[session.role] ?? session.role}</div>
        </div>
        <button className="btn btn-icon btn-ghost" title="ออกจากระบบ" onClick={() => actions.logout()}>
          <i className="ph ph-sign-out" style={{ fontSize: 16 }} />
        </button>
      </div>
    </aside>
  );
}
