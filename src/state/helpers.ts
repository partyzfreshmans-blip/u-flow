import type { CSSProperties } from 'react';
import type { OrderStatus, SyncStatus } from '../data/types';

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
};

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
