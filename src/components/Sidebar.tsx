import type { CSSProperties } from 'react';
import type { RouteKey } from '../data/types';
import type { AppActions } from '../state/store';

const navDef: [RouteKey, string, string][] = [
  ['dashboard', 'แดชบอร์ด / ออเดอร์', 'ph ph-squares-four'],
  ['route', 'จัดการออเดอร์', 'ph ph-clipboard-text'],
  ['planner', 'วางแผนจัดรูท', 'ph ph-map-trifold'],
  ['pick', 'จัดล็อตหยิบสินค้า', 'ph ph-list-checks'],
  ['cod', 'เคลียร์เงิน COD', 'ph ph-wallet'],
  ['promo', 'โปรโมชั่น', 'ph ph-tag'],
  ['grn', 'รับสินค้าเข้าคลัง', 'ph ph-tray-arrow-down'],
  ['sku', 'ฐานข้อมูลสินค้า', 'ph ph-package'],
  ['customer', 'ฐานข้อมูลลูกค้า', 'ph ph-users'],
  ['settings', 'ตั้งค่า / API Key', 'ph ph-gear'],
];

const navBase: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
  border: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13.5,
  padding: '9px 11px', borderRadius: 8, transition: 'background .12s',
};

export function Sidebar({ route, actions }: { route: RouteKey; actions: AppActions }) {
  return (
    <aside style={{ flex: 'none', width: 236, background: 'var(--color-surface)', boxShadow: 'inset -1px 0 0 var(--color-divider)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '18px 16px 14px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--color-accent)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 17, letterSpacing: '-.02em' }}>U</div>
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 16 }}>Unii</div>
          <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>Warehouse Ops</div>
        </div>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 12px' }}>
        {navDef.map(([key, label, icon]) => {
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
      </nav>
      <div style={{ marginTop: 'auto', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: 'inset 0 1px 0 var(--color-divider)' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-neutral-800)', display: 'grid', placeItems: 'center', color: 'var(--color-neutral-200)', fontSize: 12, fontWeight: 600 }}>AW</div>
        <div style={{ lineHeight: 1.2, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>admin.warehouse</div>
          <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)' }}>Warehouse manager</div>
        </div>
      </div>
    </aside>
  );
}
