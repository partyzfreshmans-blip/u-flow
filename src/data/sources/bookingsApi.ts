import { authHeaders, type Session } from '../session';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}

export type BookingStatus = 'pending' | 'confirmed' | 'rejected';

export interface BookingRow {
  orderNo: string;
  driverUsername: string;
  driverVehicleId: string;
  status: BookingStatus;
  bookedAt: string;
  decidedBy: string;
  decidedAt: string;
  note: string;
}

export async function fetchBookings(session: Session): Promise<BookingRow[]> {
  const res = await fetch('/api/bookings', { headers: authHeaders(session) });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `โหลดรายการจองคิวไม่สำเร็จ (HTTP ${res.status})`));
  return Array.isArray(body.bookings) ? (body.bookings as BookingRow[]) : [];
}

export async function createBookings(session: Session, orderNos: string[]): Promise<{ created: string[]; conflicts: string[] }> {
  const res = await fetch('/api/bookings/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ orderNos }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `จองคิวไม่สำเร็จ (HTTP ${res.status})`));
  return {
    created: Array.isArray(body.created) ? (body.created as string[]) : [],
    conflicts: Array.isArray(body.conflicts) ? (body.conflicts as string[]) : [],
  };
}

export async function decideBookingRequest(
  session: Session,
  input: { orderNo: string; decision: 'confirm' | 'reject'; note?: string },
): Promise<{ ok: boolean; driverUsername: string; driverVehicleId: string }> {
  const res = await fetch('/api/bookings/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify(input),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `ยืนยัน/ปฏิเสธคำขอจองคิวไม่สำเร็จ (HTTP ${res.status})`));
  return {
    ok: Boolean(body.ok),
    driverUsername: String(body.driverUsername ?? ''),
    driverVehicleId: String(body.driverVehicleId ?? ''),
  };
}
