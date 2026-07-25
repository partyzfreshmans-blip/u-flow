import { useRef } from 'react';
import { UPLOAD_ACCEPT, humanFileSize, type AttachmentScope } from '../config/drive';
import { attachmentKey, formatUploadedAt } from '../data/sources/attachments';
import type { AppActions, AppState } from '../state/store';

interface Props {
  state: AppState;
  actions: AppActions;
  scope: AttachmentScope;
  /** Order UID, or "date-supplier" for a receiving record. */
  storageKey: string;
  label: string;
  hint?: string;
  /** Blocks uploading until the key is meaningful (e.g. supplier chosen). */
  disabledReason?: string;
}

export function AttachmentPanel({ state, actions, scope, storageKey, label, hint, disabledReason }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const key = attachmentKey(scope, storageKey);
  const files = state.attachments[key] ?? [];
  const uploading = state.uploadingKey === key;

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    void actions.uploadAttachments(scope, storageKey, Array.from(list), state.attachments);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          <i className="ph ph-paperclip" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />{label}
          {files.length > 0 && <span style={{ color: 'var(--color-neutral-500)', fontWeight: 400 }}> · {files.length} ไฟล์</span>}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => pick(e.target.files)}
        />
        <button
          className="btn btn-secondary"
          style={{ minHeight: 32 }}
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !!disabledReason}
          title={disabledReason}
        >
          {uploading ? (
            <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังอัปโหลด...</>
          ) : (
            <><i className="ph ph-upload-simple" />แนบไฟล์</>
          )}
        </button>
      </div>

      {(hint || disabledReason) && (
        <div style={{ fontSize: 11, color: disabledReason ? 'var(--st-warn-fg)' : 'var(--color-neutral-500)' }}>
          <i className={disabledReason ? 'ph ph-warning' : 'ph ph-info'} style={{ marginRight: 4 }} />
          {disabledReason ?? hint}
        </div>
      )}

      {state.uploadError && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5, lineHeight: 1.45 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none', marginTop: 1 }} />
          <span style={{ flex: 1 }}>{state.uploadError}</span>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '0 6px' }} onClick={actions.clearUploadError}>ปิด</button>
        </div>
      )}

      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((f) => (
            <div key={f.fileId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 9, background: 'var(--color-bg)', boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
              <i className={f.mimeType === 'application/pdf' ? 'ph ph-file-pdf' : 'ph ph-image'} style={{ fontSize: 18, color: 'var(--color-accent-300)', flex: 'none' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)' }}>
                  {humanFileSize(f.size)} · อัปโหลด {formatUploadedAt(f.uploadedAt)}
                  {f.mock && <span style={{ color: 'var(--st-warn-fg)', marginLeft: 6 }}>· ยังไม่ได้ขึ้น Drive จริง (โหมดทดสอบ)</span>}
                </div>
              </div>
              {f.webViewLink ? (
                <a className="btn btn-ghost" style={{ fontSize: 12 }} href={f.webViewLink} target="_blank" rel="noreferrer">
                  <i className="ph ph-arrow-square-out" />เปิดดู
                </a>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>ไม่มีลิงก์</span>
              )}
              <button className="btn btn-icon btn-ghost" title="เอาไฟล์ออกจากรายการ" onClick={() => actions.removeAttachment(scope, storageKey, f.fileId, state.attachments)}>
                <i className="ph ph-x" style={{ fontSize: 12 }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
