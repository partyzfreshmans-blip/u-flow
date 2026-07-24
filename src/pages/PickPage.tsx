import { computePick } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function PickPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computePick(state, actions);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="card elev-md" style={{ gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ width: 42, height: 42, flex: 'none', borderRadius: 11, background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 20 }}>
            <i className="ph ph-list-checks" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>ล็อต {v.pickBatch.id}</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{v.pickBatch.meta}</div>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {v.pickItems.map((p) => (
          <button key={p.sku} onClick={p.toggle} style={p.rowStyle}>
            <span style={p.boxStyle}><i className="ph ph-check" style={{ fontSize: 19, ...p.checkVis }} /></span>
            <span style={{ width: 60, height: 46, flex: 'none', borderRadius: 10, background: 'var(--color-accent-900)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.15 }}>
              <span style={{ fontSize: 9, letterSpacing: '.04em', color: 'var(--color-accent-300)', opacity: 0.8 }}>ตำแหน่ง</span>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-accent-100)' }}>{p.loc}</span>
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600, ...p.textStyle }}>{p.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-500)', fontVariantNumeric: 'tabular-nums' }}>{p.sku}</span>
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
          <span>ปิดล็อตเรียบร้อย — ส่งต่อให้ Checker ตรวจสอบ</span>
        </div>
      )}
      <button className="btn btn-primary btn-block" style={{ minHeight: 54, fontSize: 15, marginTop: 16 }} onClick={v.closePick} disabled={v.pickCloseDisabled}>
        <i className="ph ph-package" />{v.pickBtnLabel}
      </button>
    </div>
  );
}
