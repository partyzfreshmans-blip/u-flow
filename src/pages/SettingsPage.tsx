import { computeSettings } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function SettingsPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeSettings(state, actions);

  return (
    <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card elev-sm" style={{ gap: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}><i className="ph ph-plug" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />API Key เชื่อมต่อระบบออเดอร์</div>
          <span style={{ ...v.expiryStyle, marginLeft: 'auto' }}>{v.expiryLabel}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--color-neutral-400)' }}>Key ปัจจุบัน</span><span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace' }}>sk_live_••••••••7f3a</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--color-neutral-400)' }}>วันหมดอายุ</span><b>25 ก.ค. 2026</b></div>
        </div>
      </div>

      <div className="card elev-sm" style={{ gap: 13 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>ตั้งค่า API Key ใหม่</div>
        <div className="field"><label>API Key ใหม่</label><input className="input" placeholder="วาง key ที่ได้จากผู้ให้บริการ" value={v.apiKey} onChange={(e) => v.onApiKey(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={v.testConn} disabled={v.apiTesting}>
            {v.apiTesting && <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังทดสอบ...</>}
            {v.apiIdle && <><i className="ph ph-plugs-connected" />ทดสอบการเชื่อมต่อ</>}
          </button>
          {v.apiOk && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--st-ok-fg)' }}>
              <i className="ph ph-check-circle-fill" />เชื่อมต่อสำเร็จ (200 OK · 148ms)
            </span>
          )}
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={v.saveKey} disabled={v.saveDisabled}><i className="ph ph-floppy-disk" />บันทึก Key</button>
        </div>
        {v.keySaved && (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)', fontSize: 12.5 }}>
            <i className="ph ph-check-circle-fill" />บันทึก key ใหม่แล้ว · วันหมดอายุถูกต่ออายุเป็น 25 ต.ค. 2026
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}><i className="ph ph-info" style={{ marginRight: 4 }} />ควร "ทดสอบการเชื่อมต่อ" ให้ผ่านก่อนบันทึก key ใหม่ทุกครั้ง</div>
      </div>
    </div>
  );
}
