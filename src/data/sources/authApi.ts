import type { Role } from '../../config/permissions';
import { authHeaders, type Session } from '../session';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}

export async function login(username: string, password: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `เข้าสู่ระบบไม่สำเร็จ (HTTP ${res.status})`));
  return {
    token: String(body.token ?? ''),
    username: String(body.username ?? username),
    role: body.role as Role,
    driverVehicleId: (body.driverVehicleId as string | null) ?? null,
  };
}

export interface UserListRow {
  username: string;
  role: Role;
  active: boolean;
  driverVehicleId: string;
  createdAt: string;
}

export async function fetchUsers(session: Session): Promise<UserListRow[]> {
  let res: Response;
  try {
    res = await fetch('/api/users/list', { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `โหลดรายชื่อผู้ใช้ไม่สำเร็จ (HTTP ${res.status})`));
  return Array.isArray(body.users) ? (body.users as UserListRow[]) : [];
}

export async function createUser(session: Session, input: { username: string; password: string; role: Role; driverVehicleId: string }): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `สร้างผู้ใช้ไม่สำเร็จ (HTTP ${res.status})`));
}

export async function updateUser(
  session: Session,
  input: { username: string; role?: Role; active?: boolean; driverVehicleId?: string; newPassword?: string },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/users/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `แก้ไขผู้ใช้ไม่สำเร็จ (HTTP ${res.status})`));
}
