import { authHeaders, loadSession } from '../session';

export interface SkuMasterUpdatePayload {
  id: string;
  barcode?: string;
  name: string;
  unit?: string;
  stock?: number;
  status?: 'active' | 'inactive';
}

export async function updateSkuMaster(payload: SkuMasterUpdatePayload): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/sku-master/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(loadSession()) },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึก SKU ไม่สำเร็จ (HTTP ${res.status})`);
  }
}
