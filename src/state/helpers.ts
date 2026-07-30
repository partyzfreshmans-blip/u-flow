import type { CSSProperties } from 'react';
import type { OrderStatus, SyncStatus } from '../data/types.js';

export function fmt(n: number): string {
  return '฿' + Number(n).toLocaleString('en-US');
}

export type BadgeKind = 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'neutral';

const badgeColors: Record<BadgeKind, [string, string]> = {
  ok: ['--st-ok-bg', '--st-ok-fg'],
  warn: ['--st-warn-bg', '--st-warn-fg'],
  bad: ['--st-bad-bg', '--st-bad-fg'],
  info: ['--st-info-bg', '--st-info-fg'],
  accent: ['--color-accent-800', '--color-accent-100'],
  neutral: ['--color-neutral-800', '--color-neutral-100'],
};

export function badgeStyle(kind: BadgeKind): CSSProperties {
  const [bg, fg] = badgeColors[kind];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    padding: '2px 9px',
    borderRadius: 6,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    background: `var(${bg})`,
    color: `var(${fg})`,
  };
}

const statusMetaMap: Record<OrderStatus, [string, BadgeKind]> = {
  pending: ['รอจัด', 'warn'],
  delivering: ['กำลังส่ง', 'info'],
  delivered: ['ส่งสำเร็จ', 'ok'],
  cleared: ['เคลียร์เงินแล้ว', 'accent'],
};

export function statusMeta(s: OrderStatus) {
  const [label, kind] = statusMetaMap[s];
  return { label, style: badgeStyle(kind) };
}

const syncMetaMap: Record<SyncStatus, [string, BadgeKind, string]> = {
  synced: ['ซิงค์แล้ว', 'ok', 'ph ph-check-circle'],
  pending: ['รอซิงค์', 'warn', 'ph ph-clock'],
  error: ['ผิดพลาด', 'bad', 'ph ph-warning-circle'],
};

export function syncMeta(s: SyncStatus) {
  const [label, kind, icon] = syncMetaMap[s];
  return { label, style: badgeStyle(kind), icon, kind: s };
}

// Real order-status text as it appears verbatim in the Google Sheets (API
// Import + คำสั่งซื้อ tabs use overlapping-but-not-identical status sets).
const sheetStatusKind: Record<string, BadgeKind> = {
  'รอยืนยันออเดอร์': 'warn',
  'กำลังดำเนินการ': 'info',
  'รอชำระเงิน': 'warn',
  'ได้รับแล้ว': 'ok',
  'ยกเลิก': 'bad',
  'ส่งสำเร็จ': 'ok',
  'กำลังจัดส่ง': 'info',
  'ส่งไม่สำเร็จ': 'bad',
};

/** Written back (via routeOrdersWrite's generic `status` field) when a
 * driver marks a stop "ส่งไม่สำเร็จ" instead of delivered — must match
 * server/lib.ts's DELIVERY_FAILED_STATUS_VALUE exactly, since that's the
 * allowlisted value the backend accepts for this write. Deliberately NOT
 * added to DELIVERY_DONE_STATUSES below — a failed delivery still needs
 * follow-up (redeliver, cancel, etc.), so it should keep surfacing in
 * stuck-order/incomplete tracking like any other still-open order. */
export const DELIVERY_FAILED_STATUS = 'ส่งไม่สำเร็จ';

export function sheetStatusStyle(status: string): CSSProperties {
  return badgeStyle(sheetStatusKind[status] ?? 'neutral');
}

// Map markers need a concrete colour, not a CSS var — Leaflet paints onto
// canvas/SVG outside the token-inheriting DOM.
const badgeKindHex: Record<BadgeKind, string> = {
  ok: '#78e3ac',
  warn: '#edc866',
  bad: '#f19a9a',
  info: '#8fb2ef',
  accent: '#be4696',
  neutral: '#9397ab',
};

export function sheetStatusColor(status: string): string {
  return badgeKindHex[sheetStatusKind[status] ?? 'neutral'];
}

/** Statuses that mean an order is done moving — delivered, received, or
 * cancelled. Anything else with a delivery date in the past is a stuck order. */
export const DELIVERY_DONE_STATUSES = ['ส่งสำเร็จ', 'ได้รับแล้ว', 'ยกเลิก'];

/** Statuses that mean a batch no longer needs to physically carry this
 * order — done moving (DELIVERY_DONE_STATUSES) OR the driver already
 * reported a failed attempt (which has its own follow-up flow via Driver
 * View's "ส่งไม่สำเร็จ" report, so it isn't "forgotten" the way a stalled
 * "กำลังจัดส่ง" order is). Deliberately NOT the same set as
 * DELIVERY_DONE_STATUSES above — that one still treats ส่งไม่สำเร็จ as
 * "needs follow-up" for the general ออเดอร์ตกหล่น panel, a different,
 * correct concern from "should this order still occupy a spot on a truck's
 * manifest." Used only to gate the cross-day stuck-order batch-detach
 * mechanism (see derive.ts's ordersNeedingStuckBatchDetach). */
export const ORDER_RESOLVED_FOR_BATCH_STATUSES = [...DELIVERY_DONE_STATUSES, DELIVERY_FAILED_STATUS];

/** Narrower than DELIVERY_DONE_STATUSES above — actually-delivered outcomes
 * only, deliberately excluding "ยกเลิก" (an order the customer/Unii itself
 * cancelled upstream, unrelated to this app's own Batch Route). Used to gate
 * "ยกเลิก Batch Route": that action must stay blocked once real delivery has
 * happened, but an order that was separately cancelled shouldn't itself lock
 * the batch out of correction. */
export const DELIVERED_STATUSES = ['ส่งสำเร็จ', 'ได้รับแล้ว'];

/** Status written back when a batch-picking lot closes — reuses "กำลังจัดส่ง"
 * (already a real value in the sheet, the step right after "กำลังดำเนินการ")
 * rather than inventing a new one that isn't part of the existing flow. */
export const PICK_CLOSED_STATUS = 'กำลังจัดส่ง';
