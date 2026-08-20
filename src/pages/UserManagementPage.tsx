import { useEffect, useState } from 'react';
import { computeUserManagement } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import type { Role } from '../config/permissions';

interface UserFormState {
  username: string;
  password: string;
  role: Role;
  driverVehicleId: string;
}

function emptyForm(defaultRole: Role): UserFormState {
  return { username: '', password: '', role: defaultRole, driverVehicleId: '' };
}

export function UserManagementPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeUserManagement(state, actions);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(emptyForm(v.roleOptions[0]?.value ?? 'admin_staff'));
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>('admin_staff');
  const [editVehicle, setEditVehicle] = useState('');
  const [editNewPassword, setEditNewPassword] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    v.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (row: (typeof v.rows)[number]) => {
    setEditingUsername(row.username);
    setEditRole((state.users.find((u) => u.username === row.username)?.role as Role) ?? 'admin_staff');
    setEditVehicle(row.driverVehicleId);
    setEditNewPassword('');
    setEditError(null);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await actions.createUserAccount(createForm);
      setShowCreate(false);
      setCreateForm(emptyForm(v.roleOptions[0]?.value ?? 'admin_staff'));
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'สร้างผู้ใช้ไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  const submitEdit = async () => {
    if (!editingUsername) return;
    setEditError(null);
    setEditSaving(true);
    try {
      await actions.updateUserAccount({
        username: editingUsername,
        role: editRole,
        driverVehicleId: editVehicle,
        newPassword: editNewPassword || undefined,
      });
      setEditingUsername(null);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'แก้ไขผู้ใช้ไม่สำเร็จ');
    } finally {
      setEditSaving(false);
    }
  };

  const toggleActive = async (row: (typeof v.rows)[number]) => {
    try {
      await actions.updateUserAccount({ username: row.username, active: !row.active });
    } catch {
      /* surfaced via the row's own state on next reload */
    }
  };

  return (
    <div>
      {!v.canEdit && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-eye" style={{ flex: 'none' }} />ดูได้อย่างเดียว — เฉพาะ Administrator เท่านั้นที่แก้ไขได้
        </div>
      )}
      {v.error && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดรายชื่อผู้ใช้ไม่สำเร็จ: {v.error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.rows.length} ผู้ใช้</div>
        {v.canEdit && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>
            <i className="ph ph-user-plus" />เพิ่มผู้ใช้ใหม่
          </button>
        )}
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <table className="table">
          <thead>
            <tr><th>ชื่อผู้ใช้งาน (Username)</th><th>บทบาท (Role)</th><th>สถานะ</th><th>รถที่รับผิดชอบ (พนักงานขับ)</th><th>สร้างเมื่อ</th><th></th></tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.username}>
                <td style={{ fontWeight: 500 }}>{r.username}</td>
                <td>{r.roleLabel}</td>
                <td>
                  <span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 9px', borderRadius: 6, background: r.active ? 'var(--st-ok-bg)' : 'var(--st-bad-bg)', color: r.active ? 'var(--st-ok-fg)' : 'var(--st-bad-fg)' }}>
                    {r.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{r.vehicleName}</td>
                <td style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{r.createdAt || '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {v.canEdit && (
                    <>
                      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => startEdit(r)}><i className="ph ph-pencil-simple" />แก้ไข</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleActive(r)}>
                        {r.active ? <><i className="ph ph-prohibit" />ปิดใช้งาน</> : <><i className="ph ph-check-circle" />เปิดใช้งาน</>}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.isEmpty && !v.loading && (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ยังไม่มีผู้ใช้ในระบบ</div>
        )}
        {v.loading && (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>
            <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite', marginRight: 6 }} />กำลังโหลด...
          </div>
        )}
      </div>

      {showCreate && (
        <div className="dialog-backdrop" onClick={() => !creating && setShowCreate(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submitCreate} style={{ width: 'min(420px, 100%)' }}>
            <div className="dialog-title">เพิ่มผู้ใช้ใหม่</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label>ชื่อผู้ใช้งาน (Username)</label>
                <input className="input" value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} disabled={creating} />
              </div>
              <div className="field">
                <label>Password เริ่มต้น (อย่างน้อย 8 ตัวอักษร)</label>
                <input className="input" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} disabled={creating} />
              </div>
              <div className="field">
                <label>บทบาท (Role)</label>
                <select className="input" value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as Role })} disabled={creating}>
                  {v.roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {createForm.role === 'driver' && (
                <div className="field">
                  <label>รถที่รับผิดชอบ</label>
                  <select className="input" value={createForm.driverVehicleId} onChange={(e) => setCreateForm({ ...createForm, driverVehicleId: e.target.value })} disabled={creating}>
                    <option value="">— เลือกรถ —</option>
                    {v.vehicleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              {createError && (
                <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
                  <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{createError}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={creating}>ยกเลิก</button>
              <button type="submit" className="btn btn-primary" disabled={creating || !createForm.username.trim() || createForm.password.length < 8}>
                {creating ? <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังสร้าง...</> : <><i className="ph ph-floppy-disk" />สร้างผู้ใช้</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingUsername && (
        <div className="dialog-backdrop" onClick={() => !editSaving && setEditingUsername(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 100%)' }}>
            <div className="dialog-title">แก้ไขผู้ใช้ · {editingUsername}</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label>บทบาท (Role)</label>
                <select className="input" value={editRole} onChange={(e) => setEditRole(e.target.value as Role)} disabled={editSaving}>
                  {v.roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {editRole === 'driver' && (
                <div className="field">
                  <label>รถที่รับผิดชอบ</label>
                  <select className="input" value={editVehicle} onChange={(e) => setEditVehicle(e.target.value)} disabled={editSaving}>
                    <option value="">— เลือกรถ —</option>
                    {v.vehicleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Password ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</label>
                <input className="input" type="password" value={editNewPassword} onChange={(e) => setEditNewPassword(e.target.value)} disabled={editSaving} />
              </div>
              {editError && (
                <div style={{ display: 'flex', gap: 9, padding: 11, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 12.5 }}>
                  <i className="ph ph-warning-fill" style={{ flex: 'none' }} />{editError}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setEditingUsername(null)} disabled={editSaving}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={submitEdit} disabled={editSaving}>
                {editSaving ? <><i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังบันทึก...</> : <><i className="ph ph-floppy-disk" />บันทึก</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
