import type { RouteKey } from '../data/types';

// Single source of truth for role-based access control. Every place in the
// app that needs to know "can this role see/edit X" imports from here —
// never duplicate a role check inline, so the permission matrix stays a
// one-file change.

export const ROLES = ['administrator', 'manager', 'admin_staff', 'checker', 'picker', 'driver'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  administrator: 'ผู้ดูแลระบบ (Admin)',
  manager: 'ผู้จัดการ (Manager)',
  admin_staff: 'เจ้าหน้าที่แอดมิน (Admin Staff)',
  checker: 'เจ้าหน้าที่ตรวจสอบ (Checker)',
  picker: 'เจ้าหน้าที่หยิบสินค้า (Picker)',
  driver: 'พนักงานขับรถ (Driver)',
};

export type PageAccess = 'edit' | 'view' | 'none';

/** Per-page access level. 'none' hides the nav item entirely and blocks
 * direct navigation (not just disables buttons). 'view' means the page
 * renders but every edit/save affordance on it is hidden or disabled. */
const PAGE_ACCESS: Record<RouteKey, Record<Role, PageAccess>> = {
  dashboard: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'view', picker: 'none', driver: 'none' },
  route: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'view', picker: 'none', driver: 'none' },
  planner: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'none', picker: 'none', driver: 'view' },
  // Zone Management (drawing delivery-area polygons) is a "หัวหน้าคลัง"
  // action — same admin-only treatment as settings/users below, not the
  // broader canEditPlan set the rest of the Planner uses.
  zones: { administrator: 'edit', manager: 'none', admin_staff: 'none', checker: 'none', picker: 'none', driver: 'none' },
  driver: { administrator: 'edit', manager: 'edit', admin_staff: 'none', checker: 'none', picker: 'none', driver: 'edit' },
  pick: { administrator: 'edit', manager: 'edit', admin_staff: 'view', checker: 'edit', picker: 'edit', driver: 'none' },
  cod: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'none', picker: 'none', driver: 'view' },
  promo: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'view', picker: 'none', driver: 'view' },
  grn: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'edit', picker: 'none', driver: 'none' },
  sku: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'view', picker: 'view', driver: 'none' },
  customer: { administrator: 'edit', manager: 'edit', admin_staff: 'edit', checker: 'none', picker: 'none', driver: 'view' },
  activity: { administrator: 'edit', manager: 'edit', admin_staff: 'view', checker: 'view', picker: 'view', driver: 'view' },
  settings: { administrator: 'edit', manager: 'none', admin_staff: 'none', checker: 'none', picker: 'none', driver: 'none' },
  users: { administrator: 'edit', manager: 'view', admin_staff: 'none', checker: 'none', picker: 'none', driver: 'none' },
};

export function pageAccess(role: Role, page: RouteKey): PageAccess {
  return PAGE_ACCESS[page]?.[role] ?? 'none';
}

export function canAccessPage(role: Role, page: RouteKey): boolean {
  return pageAccess(role, page) !== 'none';
}

export function canEditPage(role: Role, page: RouteKey): boolean {
  return pageAccess(role, page) === 'edit';
}

/** First page (in nav order) a role lands on after login / whenever their
 * current route becomes inaccessible (role changed, direct URL, etc). */
const NAV_ORDER: RouteKey[] = ['dashboard', 'route', 'planner', 'zones', 'driver', 'pick', 'cod', 'promo', 'grn', 'sku', 'customer', 'activity', 'settings', 'users'];
export function defaultRouteFor(role: Role): RouteKey {
  if (role === 'driver') return 'driver';
  return NAV_ORDER.find((p) => canAccessPage(role, p)) ?? 'dashboard';
}

// ---------- fine-grained action permissions (finer than whole-page edit/view) ----------

/** Order Management page: date/note/tax-invoice edits. */
export function canEditOrder(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'admin_staff';
}

/** Planner page: dragging/reordering/moving orders between vehicles.
 * Driver sees the page (their own vehicle only) but never rearranges it. */
export function canEditPlan(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'admin_staff';
}

/** Batch picking: creating a lot (selecting orders) and ticking items off. */
export function canPickWork(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'picker';
}
/** Batch picking: the final "close lot" confirmation. */
export function canClosePickLot(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'checker';
}

/** Cancelling a Batch Route (mistaken assignment) or an unfinished pick lot
 * are both data-correction actions, not routine page work — deliberately a
 * separate check from canEditPlan/canPickWork so a role's normal page access
 * never has to change to grant them. admin_staff gets both even though its
 * Pick page access is otherwise 'view'-only (see PAGE_ACCESS above): fixing a
 * mis-created lot is an admin-adjacent correction, not "doing the pick". */
export function canCancelBatchRoute(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'admin_staff';
}
export function canCancelPickLot(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'admin_staff';
}

/** Customer master: lat/lng is the only field a driver may ever write —
 * every other field on that page stays read-only for them. */
export function canEditCustomerLatLng(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'admin_staff' || role === 'driver';
}
export function canEditCustomerOther(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'admin_staff';
}

/** Activity Log: administrator/manager see every entry; everyone else only
 * their own — enforced both in the UI filter and (defensively) wherever the
 * log is read. */
export function seesAllActivityLog(role: Role): boolean {
  return role === 'administrator' || role === 'manager';
}

/** User Management: only administrator can create/edit; manager can view
 * the roster read-only; everyone else has no access at all (page hidden). */
export function canManageUsers(role: Role): boolean {
  return role === 'administrator';
}

/** Zone Management: drawing/editing delivery-area polygons, and confirming
 * a cross-zone assign override, are both "หัวหน้าคลัง" actions —
 * administrator only, same treatment as canManageUsers above. */
export function canManageZones(role: Role): boolean {
  return role === 'administrator';
}

/** Driver "จองคิว": booking an unassigned stop is a driver-only action —
 * it never grants assign rights, just a request a manager/admin later acts on. */
export function canBookStop(role: Role): boolean {
  return role === 'driver';
}

/** Confirming/rejecting a driver's booking request — same role set as
 * canEditPlan, since this is a planner-editing action. */
export function canDecideBooking(role: Role): boolean {
  return role === 'administrator' || role === 'manager' || role === 'admin_staff';
}

/** Dashboard: viewing the raw Unii API object behind an order row. Exists so
 * a wrong field-key guess in server/unii.ts's mapUniiOrder (Unii renaming or
 * never having used a guessed key) can be diagnosed straight from the app —
 * without Vercel log/DevTools access — rather than only in server logs.
 * Administrator-only since it's the full unfiltered API payload for that
 * order, not a normal operational affordance. */
export function canViewRawOrderDebug(role: Role): boolean {
  return role === 'administrator';
}
