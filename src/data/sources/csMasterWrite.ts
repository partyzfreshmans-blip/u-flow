/**
 * Writes a corrected lat/lng back to the real CS Master Google Sheet via the
 * backend (server/ locally, api/ on Vercel), which holds the Service Account
 * credential. The backend matches the row by name+phone and updates it in
 * place — it never appends a new row.
 */
export async function updateCsMasterLatLng(name: string, phone: string, lat: number, lng: number): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/cs-master/update-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, lat, lng }),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึกพิกัดไม่สำเร็จ (HTTP ${res.status})`);
  }
}
