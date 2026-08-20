import { useState } from 'react';
import type { AppActions, AppState } from '../state/store';

export function LoginPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    actions.login(username.trim(), password);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <form onSubmit={submit} className="card elev-sm" style={{ width: 'min(380px, 100%)', gap: 18, padding: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 4 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--color-accent)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 19, letterSpacing: '-.02em' }}>U</div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 18 }}>Unii</div>
            <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>ระบบจัดการคลังสินค้าและจัดส่ง</div>
          </div>
        </div>

        <div className="field">
          <label>ชื่อผู้ใช้งาน (Username)</label>
          <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} disabled={state.authLoading} autoComplete="username" />
        </div>
        <div className="field">
          <label>รหัสผ่าน (Password)</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={state.authLoading}
              autoComplete="current-password"
              style={{ paddingRight: 38 }}
            />
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}
            >
              <i className={showPassword ? 'ph ph-eye-slash' : 'ph ph-eye'} />
            </button>
          </div>
        </div>

        {state.authError && (
          <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
            <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{state.authError}
          </div>
        )}

        <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={state.authLoading || !username.trim() || !password}>
          {state.authLoading ? (
            <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังเข้าสู่ระบบ...</>
          ) : (
            <><i className="ph ph-sign-in" />เข้าสู่ระบบ</>
          )}
        </button>
      </form>
    </div>
  );
}
