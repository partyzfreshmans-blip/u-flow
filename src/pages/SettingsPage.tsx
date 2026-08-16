import { useEffect, useState } from 'react';
import { computeSettings } from '../state/derive';
import type { AppActions, AppState } from '../state/store';

export function SettingsPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeSettings(state, actions);
  const [showSyncLog, setShowSyncLog] = useState(false);

  useEffect(() => {
    v.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card elev-sm" style={{ gap: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}><i className="ph ph-plug" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />API Key เชื่อมต่อระบบออเดอร์</div>
          <span style={{ ...v.updatedStyle, marginLeft: 'auto' }}>{v.updatedLabel}</span>
        </div>
        {v.settingLoading ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite', marginRight: 6 }} />กำลังโหลด...</div>
        ) : v.settingError ? (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
            <i className="ph ph-warning-fill" />{v.settingError}
            <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 11.5, padding: '2px 8px' }} onClick={v.reload}>ลองใหม่</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-neutral-400)' }}>Key ปัจจุบัน</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace' }}>{v.maskedKey}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-neutral-400)' }}>อัปเดตล่าสุด</span>
              <b>{v.updatedAtText}</b>
            </div>
            {v.hasKey && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-neutral-400)' }}>อัปเดตโดย</span>
                <span>{v.updatedByText}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card elev-sm" style={{ gap: 13 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>ตั้งค่า API Key ใหม่</div>
        <div className="field"><label>API Key ใหม่</label><input className="input" placeholder="วาง key ที่ได้จากผู้ให้บริการ" value={v.apiKey} onChange={(e) => v.onApiKey(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={v.testConn} disabled={v.apiTesting || v.apiKey.trim() === ''}>
            {v.apiTesting && <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังทดสอบ...</>}
            {v.apiIdle && <><i className="ph ph-plugs-connected" />ทดสอบการเชื่อมต่อ</>}
          </button>
          {v.testOkText && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--st-ok-fg)' }}>
              <i className="ph ph-check-circle-fill" />{v.testOkText}
            </span>
          )}
          {v.testErrorText && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--st-bad-fg)' }}>
              <i className="ph ph-x-circle-fill" />{v.testErrorText}
            </span>
          )}
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={v.saveKey} disabled={v.saveDisabled}>
            {v.saveStatus?.state === 'saving' ? <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</> : <><i className="ph ph-floppy-disk" />บันทึก Key</>}
          </button>
        </div>
        {v.saveStatus?.state === 'saved' && (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-ok-bg)', color: 'var(--st-ok-fg)', fontSize: 12.5 }}>
            <i className="ph ph-check-circle-fill" />บันทึก key ใหม่แล้ว · การ์ดด้านบนอัปเดตให้ทันทีแล้ว
          </div>
        )}
        {v.saveStatus?.state === 'error' && (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
            <i className="ph ph-warning-fill" />{v.saveStatus.message || 'บันทึกไม่สำเร็จ'}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}><i className="ph ph-info" style={{ marginRight: 4 }} />ต้อง "ทดสอบการเชื่อมต่อ" ให้ผ่านก่อนจึงจะบันทึก key ใหม่ได้ — แก้ไข key ในช่องนี้ต้องทดสอบใหม่ทุกครั้ง</div>
      </div>

      <div className="card elev-sm" style={{ gap: 13 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}><i className="ph ph-arrows-clockwise" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />ซิงค์ออเดอร์จาก Unii</div>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
          ดึงออเดอร์ทั้งหมดตรงจาก Unii API (ไม่ผ่านชีทที่ Unii เขียนเข้ามาเอง ซึ่งข้อมูลอาจไม่ครบ) — ดึงหน้าละ 100 รายการ มี retry อัตโนมัติเมื่อเจอ rate limit
          ถ้าดึงไม่ครบในรอบเดียว (เช่นออเดอร์เยอะเกินเวลาที่กำหนดไว้ต่อรอบ) จะดึงต่อจากหน้าที่ค้างให้อัตโนมัติเมื่อกดซิงค์อีกครั้ง — ไม่มีการตั้งเวลาซิงค์อัตโนมัติ ต้องกดเอง
        </div>
        <div>
          <button className="btn btn-primary" onClick={v.runSync} disabled={v.syncDisabled}>
            {v.syncing ? (
              <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังซิงค์... (อาจใช้เวลาสักครู่)</>
            ) : v.syncResult?.partial ? (
              <><i className="ph ph-arrows-clockwise" />ซิงค์ต่อ</>
            ) : (
              <><i className="ph ph-arrows-clockwise" />ซิงค์ออเดอร์ทั้งหมดตอนนี้</>
            )}
          </button>
          {!v.hasKey && !v.syncing && (
            <span style={{ marginLeft: 10, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>ต้องบันทึก API Key ด้านบนก่อน</span>
          )}
        </div>

        {v.syncError && (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
            <i className="ph ph-warning-fill" />{v.syncError}
          </div>
        )}

        {v.syncResult && !v.syncError && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: 11, borderRadius: 9, fontSize: 12.5,
                background: v.syncResult.partial ? 'var(--st-warn-bg)' : 'var(--st-ok-bg)',
                color: v.syncResult.partial ? 'var(--st-warn-fg)' : 'var(--st-ok-fg)',
              }}
            >
              <i className={v.syncResult.partial ? 'ph ph-warning-fill' : 'ph ph-check-circle-fill'} />
              {v.syncSummaryText}
            </div>
            {v.syncPartialText && (
              <div style={{ fontSize: 12, color: 'var(--st-warn-fg)' }}>{v.syncPartialText}</div>
            )}
            {v.syncDroppedText && (
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.syncDroppedText}</div>
            )}
            <div>
              <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '3px 8px' }} onClick={() => setShowSyncLog((s) => !s)}>
                {showSyncLog ? 'ซ่อน log' : `ดู log ทั้งหมด (${v.syncResult.log.length} บรรทัด)`}
              </button>
            </div>
            {showSyncLog && (
              <pre
                style={{
                  margin: 0, padding: 10, borderRadius: 8, background: 'var(--color-bg)', fontSize: 11,
                  fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto',
                  boxShadow: 'inset 0 0 0 1px var(--color-divider)',
                }}
              >
                {v.syncResult.log.join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
