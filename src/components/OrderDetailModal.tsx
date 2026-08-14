import { useEffect, useState } from 'react';
import { exportOrderLineItemsXlsx } from '../data/sources/exportXlsx';
import { computeOrderDetail } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import { AttachmentPanel } from './AttachmentPanel';
import { CopyButton } from './CopyButton';

const STOCK_TONE = {
  ok: { bg: 'var(--st-ok-bg)', fg: 'var(--st-ok-fg)', icon: 'ph ph-check-circle-fill' },
  short: { bg: 'var(--st-bad-bg)', fg: 'var(--st-bad-fg)', icon: 'ph ph-warning-fill' },
  unknown: { bg: 'transparent', fg: 'var(--color-neutral-600)', icon: 'ph ph-question' },
} as const;

export function OrderDetailModal({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeOrderDetail(state, actions);
  const [q, setQ] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Esc closes, matching the backdrop click and the X button. Bound only
  // while the modal is actually open so it can never swallow Esc for
  // anything else on the page.
  useEffect(() => {
    if (!v.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.closeOrderDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [v.open, actions]);

  // Reopening on a different order starts from a clean search box / no stale
  // error, without the parent having to remount this component.
  useEffect(() => {
    setQ('');
    setExportError(null);
  }, [v.orderNo]);

  if (!v.open) return null;

  const needle = q.trim().toLowerCase();
  const shown = needle ? v.lines.filter((l) => l.sku.toLowerCase().includes(needle) || l.name.toLowerCase().includes(needle)) : v.lines;
  const filtering = needle !== '' && v.lines.length > 0;

  const doExport = () => {
    setExporting(true);
    setExportError(null);
    exportOrderLineItemsXlsx(state.session, v.orderNo)
      .catch((err: unknown) => setExportError(err instanceof Error ? err.message : 'Export ไม่สำเร็จ'))
      .finally(() => setExporting(false));
  };

  return (
    <div className="dialog-backdrop" onClick={actions.closeOrderDetail}>
      {/* Wider than the default dialog so long product names fit on one line
          — the narrow columns beside them are pinned small below. */}
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(1080px, 100%)' }}>
        {/* ---- header (stays put; outside the scrolling body) ---- */}
        <div>
          <div className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            รายการสินค้า · {v.orderNo}<CopyButton value={v.orderNo} label="เลขคำสั่งซื้อ" />
            <button className="btn btn-ghost no-print" style={{ marginLeft: 'auto', fontSize: 11.5 }} onClick={v.viewHistory}>
              <i className="ph ph-clock-counter-clockwise" />ดูประวัติการแก้ไข
            </button>
            <button className="btn btn-icon btn-ghost no-print" onClick={actions.closeOrderDetail} title="ปิด (Esc)" aria-label="ปิด">
              <i className="ph ph-x" />
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', marginTop: 2 }}>{v.customer}<CopyButton value={v.customer} label="ชื่อลูกค้า" /></div>
          {(v.phone || v.districtProvince) && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)', marginTop: 2 }}>
              {v.phone && (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <i className="ph ph-phone" style={{ marginRight: 4 }} />{v.phone}<CopyButton value={v.phone} label="เบอร์โทร" />
                </span>
              )}
              {v.districtProvince && (
                <span>
                  <i className="ph ph-map-pin" style={{ marginRight: 4 }} />{v.districtProvince}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ---- toolbar (also fixed) ---- */}
        {!v.loading && !v.error && v.lines.length > 0 && (
          <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
              <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--color-neutral-500)' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, minHeight: 32, fontSize: 12.5 }}
                placeholder="ค้นหา SKU หรือชื่อสินค้า"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {filtering && (
              <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                แสดง {shown.length} จาก {v.lines.length} รายการ
                <button className="btn btn-ghost" style={{ fontSize: 11, marginLeft: 4 }} onClick={() => setQ('')}>
                  <i className="ph ph-x" />ล้าง
                </button>
              </span>
            )}
            <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => window.print()}>
              <i className="ph ph-printer" />พิมพ์
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={exporting} onClick={doExport}>
              <i className={exporting ? 'ph ph-circle-notch' : 'ph ph-file-xls'} style={exporting ? { animation: 'spin .8s linear infinite' } : undefined} />
              {exporting ? 'กำลัง Export...' : 'Export Excel'}
            </button>
          </div>
        )}
        {exportError && (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
            <i className="ph ph-warning-fill" style={{ flex: 'none' }} />Export ไม่สำเร็จ: {exportError}
          </div>
        )}

        {/* ---- the one scrolling region ---- */}
        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {v.loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
              <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดรายการสินค้า...
            </div>
          )}
          {v.error && (
            <div style={{ display: 'flex', gap: 9, padding: 13, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
              <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดรายการสินค้าไม่สำเร็จ: {v.error}
            </div>
          )}
          {v.isEmpty && <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบรายการสินค้าสำหรับออเดอร์นี้ใน SKU Detail</div>}
          {!v.loading && !v.error && v.lines.length > 0 && (
            <>
              <table className="table dialog-sticky-head">
                <thead>
                  <tr>
                    <th style={{ width: 108 }}>SKU</th>
                    <th>สินค้า</th>
                    <th style={{ width: 54 }}>หน่วย</th>
                    <th style={{ width: 52, textAlign: 'right' }}>จำนวน</th>
                    <th style={{ width: 84, textAlign: 'right' }}>ราคา/หน่วย</th>
                    <th style={{ width: 88, textAlign: 'right' }}>ยอดรวม</th>
                    <th style={{ width: 74, textAlign: 'center' }}>สต็อก</th>
                    <th style={{ width: 128 }}>โปรโมชั่น</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l, i) => {
                    const tone = STOCK_TONE[l.stockState];
                    return (
                      <tr key={i}>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{l.sku}</td>
                        <td>{l.name}</td>
                        <td style={{ color: 'var(--color-neutral-400)', fontSize: 12.5 }}>{l.unit}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.qty}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.unitPriceText}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{l.lineTotalText}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            title={l.stockTitle}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, padding: '2px 7px', borderRadius: 6,
                              whiteSpace: 'nowrap', cursor: 'help', background: tone.bg, color: tone.fg,
                              fontWeight: l.stockState === 'unknown' ? 400 : 600,
                            }}
                          >
                            <i className={tone.icon} />{l.stockLabel}
                          </span>
                        </td>
                        <td style={{ fontSize: 11.5 }}>
                          {l.linkSaving ? (
                            <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite', color: 'var(--color-neutral-400)' }} title="กำลังบันทึก..." />
                          ) : l.linkedPromoSku ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--st-ok-fg)' }} title={l.isConfirmed ? undefined : 'ราคาปัจจุบันไม่ตรงกับโปรนี้แล้ว'}>
                                <i className="ph ph-check-circle-fill" />ใช้โปร {l.linkedPromoSku}
                              </span>
                              {v.canEditRole && (
                                <button className="btn btn-ghost no-print" style={{ fontSize: 10.5, padding: '2px 6px' }} onClick={l.unconfirmPromo}>ยกเลิก</button>
                              )}
                            </span>
                          ) : l.matchedPromoSku ? (
                            v.canEditRole ? (
                              <button className="btn btn-ghost no-print" style={{ fontSize: 11 }} onClick={l.confirmPromo}>
                                <i className="ph ph-tag" />ยืนยันใช้โปร {l.matchedPromoSku}
                              </button>
                            ) : (
                              <span style={{ color: 'var(--color-neutral-500)' }}>ราคาตรงกับโปร {l.matchedPromoSku}</span>
                            )
                          ) : (
                            <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
                          )}
                          {l.linkError && <div style={{ color: 'var(--st-bad-fg)', marginTop: 2 }}>{l.linkError}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบสินค้าที่ตรงกับ "{q}"</div>
              )}
            </>
          )}

          <div className="hr" style={{ margin: '4px 0' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>แก้ไขข้อมูลออเดอร์</div>
            {!v.canEdit && (
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                <i className="ph ph-info" style={{ marginRight: 4 }} />ไม่พบออเดอร์นี้ในชีท "คำสั่งซื้อ" — แก้ไขได้เมื่อออเดอร์ถูกจัดเข้าชีทนี้แล้ว
              </div>
            )}
            {v.canEdit && !v.canEditRole && (
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                <i className="ph ph-eye" style={{ marginRight: 4 }} />สิทธิ์ของคุณดูได้อย่างเดียว
              </div>
            )}
            {v.canEdit && v.canEditRole && (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--color-neutral-400)' }}>
                    วันที่จะจัดส่ง
                    <input type="date" className="input" style={{ minHeight: 32, width: 170 }} value={v.plannedDeliveryDate} onChange={(e) => v.onPlannedDeliveryDate(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginTop: 19 }}>
                    <input type="checkbox" checked={v.wantsTaxInvoice} onChange={(e) => v.onWantsTaxInvoice(e.target.checked)} />
                    ต้องการใบกำกับภาษี
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--color-neutral-400)' }}>
                  หมายเหตุ
                  <textarea className="input" style={{ minHeight: 60, resize: 'vertical', fontFamily: 'var(--font-body)' }} value={v.note} onChange={(e) => v.onNote(e.target.value)} placeholder="เช่น เงื่อนไขพิเศษ, ปัญหาที่พบ" />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary no-print" onClick={v.save} disabled={v.saving}>
                    {v.saving ? (
                      <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</>
                    ) : (
                      <><i className="ph ph-floppy-disk" />บันทึกกลับชีท</>
                    )}
                  </button>
                  {v.saved && (
                    <span style={{ fontSize: 12, color: 'var(--st-ok-fg)' }}><i className="ph ph-check-circle-fill" style={{ marginRight: 4 }} />บันทึกสำเร็จ</span>
                  )}
                  {v.saveError && (
                    <span style={{ fontSize: 12, color: 'var(--st-bad-fg)' }}><i className="ph ph-warning-fill" style={{ marginRight: 4 }} />{v.saveError} — ลองใหม่อีกครั้ง</span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="hr" style={{ margin: '4px 0' }} />

          <AttachmentPanel
            state={state}
            actions={actions}
            scope="order"
            storageKey={v.orderNo}
            label="ใบส่งสินค้า / ใบเสร็จ / ใบกำกับภาษี"
            hint="แนบไฟล์ที่ปริ้นจากระบบ Unii · รับ PDF, JPG, PNG ไม่เกิน 10MB ต่อไฟล์ · แนบได้หลายไฟล์"
          />
        </div>

        {/* ---- summary, always visible (outside the scrolling body) ----
            Figures are always for the WHOLE bill, never the filtered subset —
            a running total that changed as you typed in the search box would
            be actively misleading. */}
        <div className="dialog-footer-bar">
          {!v.loading && !v.error && v.lines.length > 0 && (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>
                <i className="ph ph-list-numbers" style={{ marginRight: 5 }} />
                {v.skuCountText} · {v.qtyTotalText}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>ยอดรวมทั้งบิล</span>
                <span style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v.totalText}</span>
              </span>
            </>
          )}
          <button className="btn btn-secondary no-print" style={{ marginLeft: v.lines.length > 0 ? 0 : 'auto' }} onClick={actions.closeOrderDetail}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
