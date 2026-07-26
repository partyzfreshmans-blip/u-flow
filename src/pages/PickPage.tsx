import { OrderDetailModal } from '../components/OrderDetailModal';
import { computePick } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function PickPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePick(state, actions);

  if (v.mode === 'lot') {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <button className="btn btn-ghost" style={{ fontSize: 12.5, marginBottom: 10 }} onClick={v.back}>
          <i className="ph ph-arrow-left" />กลับไปเลือกออเดอร์
        </button>

        {v.hasNoLineOrders && (
          <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 12, borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13 }}>
            <i className="ph ph-warning-fill" style={{ flex: 'none' }} />
            <span>ออเดอร์ {v.noLineOrdersText} ไม่พบรายการสินค้าใน SKU Detail — ข้อมูลอาจไม่ครบ ตรวจสอบก่อนแพ็ค</span>
          </div>
        )}
        {v.hasPendingSync && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 12, borderRadius: 10, background: 'var(--st-warn-bg)', color: 'var(--st-warn-fg)', fontSize: 13 }}>
            <i className="ph ph-cloud-warning" style={{ flex: 'none' }} />
            <span style={{ flex: 1 }}>อัปเดตสถานะกลับชีทไม่สำเร็จสำหรับ: {v.pendingSyncText}</span>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.retrySync}>ลองใหม่</button>
          </div>
        )}

        <div className="card elev-md" style={{ gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <span style={{ width: 42, height: 42, flex: 'none', borderRadius: 11, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 20 }}>
              <i className="ph ph-list-checks" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>ล็อต {v.lotId}</div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
                {v.orderNos.length} ออเดอร์ · {v.orderNos.join(', ')}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 24, lineHeight: 1, color: 'var(--color-accent-200)' }}>{v.pickPct}%</div>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{v.pickedCount}/{v.pickTotal} รายการ</div>
            </div>
          </div>
          <div style={{ height: 10, borderRadius: 6, background: 'var(--color-neutral-800)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 6, background: 'var(--color-accent)', transition: 'width .25s', width: `${v.pickPct}%` }} />
          </div>
        </div>

        {v.isEmpty && (
          <div style={{ marginTop: 16, padding: 20, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5, borderRadius: 10, background: 'var(--color-surface)' }}>
            ไม่พบรายการสินค้าสำหรับล็อตนี้ใน SKU Detail
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {v.pickItems.map((p) => (
            <button key={p.sku} onClick={p.toggle} style={p.rowStyle} title={`แยกตามออเดอร์: ${p.perOrderText}`}>
              <span style={p.boxStyle}><i className="ph ph-check" style={{ fontSize: 19, ...p.checkVis }} /></span>
              <span style={{ width: 60, height: 46, flex: 'none', borderRadius: 10, background: 'var(--color-accent-900)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.15 }}>
                <span style={{ fontSize: 9, letterSpacing: '.04em', color: 'var(--color-accent-300)', opacity: 0.8 }}>ตำแหน่ง</span>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-accent-100)' }}>{p.loc}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600, ...p.textStyle }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-500)', fontVariantNumeric: 'tabular-nums' }}>{p.sku}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--color-neutral-600)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <i className="ph ph-info" style={{ marginRight: 3 }} />{p.perOrderText}
                </span>
              </span>
              <span style={{ textAlign: 'right', flex: 'none' }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 21 }}>{p.qty}</span>
                <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', marginLeft: 3 }}>{p.unit}</span>
              </span>
            </button>
          ))}
        </div>

        {v.pickClosed && (
          <div style={{ marginTop: 16, display: 'flex', gap: 9, padding: 13, borderRadius: 10, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)', fontSize: 13 }}>
            <i className="ph ph-check-circle-fill" style={{ fontSize: 18, flex: 'none' }} />
            <span>ปิดล็อตเรียบร้อย — อัปเดตสถานะออเดอร์แล้ว</span>
          </div>
        )}
        <button className="btn btn-primary btn-block" style={{ minHeight: 54, fontSize: 15, marginTop: 16 }} onClick={v.closePick} disabled={v.pickCloseDisabled}>
          <i className="ph ph-package" />{v.pickBtnLabel}
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {v.loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดคำสั่งซื้อจาก Google Sheet...
        </div>
      )}
      {v.error && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดข้อมูลคำสั่งซื้อไม่สำเร็จ: {v.error}
        </div>
      )}

      {v.hasOpenLots && (
        <div className="card elev-sm" style={{ marginBottom: 16, gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}><i className="ph ph-clock-counter-clockwise" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />ล็อตที่ยังทำไม่เสร็จ</div>
          {v.openLots.map((l) => (
            <button
              key={l.id}
              onClick={l.resume}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: 0, cursor: 'pointer', background: 'var(--color-bg)', fontFamily: 'var(--font-body)' }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{l.id}</span>
              <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{l.orderCount} ออเดอร์ · {l.skuCount} รายการ</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-accent-200)', fontWeight: 600 }}>{l.doneCount}/{l.skuCount} ({l.pct}%)</span>
              <i className="ph ph-caret-right" />
            </button>
          ))}
        </div>
      )}

      {v.hasRecentClosedLots && (
        <div className="card elev-sm" style={{ marginBottom: 16, gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-neutral-400)' }}>ล็อตที่ปิดล่าสุด</div>
          {v.recentClosedLots.map((l) => (
            <button
              key={l.id}
              onClick={l.view}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 0, cursor: 'pointer', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-neutral-400)' }}
            >
              <span>{l.id}</span>
              <span>{l.orderCount} ออเดอร์ · {l.skuCount} รายการ · {l.createdAtText}</span>
              {l.pendingSyncCount > 0 && <span style={{ color: 'var(--st-warn-fg)' }}><i className="ph ph-warning" style={{ marginRight: 3 }} />รอซิงค์ {l.pendingSyncCount}</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาลูกค้า / เลขคำสั่งซื้อ" value={v.q} onChange={(e) => v.onSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.resultCount} ออเดอร์ (สถานะ กำลังดำเนินการ)</div>
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px', marginBottom: 90 }}>
        {v.isEmpty ? (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบออเดอร์สถานะ "กำลังดำเนินการ" ที่ยังไม่ได้จัดล็อต</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th style={{ textAlign: 'center' }}>รายการ</th>
                <th style={{ textAlign: 'right' }}>ยอดขาย</th><th>วันที่สั่ง</th><th>วันที่จะจัดส่ง</th><th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.orderNo} onClick={r.toggle} style={{ cursor: 'pointer' }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={r.checked} onChange={r.toggle} style={{ width: 17, height: 17, cursor: 'pointer' }} />
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 500 }}>{r.orderNo}</td>
                  <td>{r.customer}</td>
                  <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{r.itemCountText}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.amtText}</td>
                  <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{r.orderedDate}</td>
                  <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{r.plannedDeliveryDate}</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={r.viewItems}>ดูสินค้า</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 236, right: 0, padding: '14px 26px', background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)', backdropFilter: 'blur(8px)', boxShadow: 'inset 0 1px 0 var(--color-divider)', display: 'flex', alignItems: 'center', gap: 12, zIndex: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>เลือกแล้ว {v.selectedCount} ออเดอร์</span>
        {v.selectedCount > 0 && (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={v.clearSelection}>ล้างที่เลือก</button>
        )}
        {v.createError && <span style={{ fontSize: 12, color: 'var(--st-bad-fg)' }}>{v.createError}</span>}
        <button className="btn btn-primary" style={{ marginLeft: 'auto', minHeight: 44 }} onClick={v.createLot} disabled={v.selectedCount === 0 || v.creating}>
          {v.creating ? (
            <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังสร้างล็อต...</>
          ) : (
            <><i className="ph ph-package" />สร้างล็อตหยิบสินค้า</>
          )}
        </button>
      </div>

      <OrderDetailModal state={state} actions={actions} />
    </div>
  );
}
