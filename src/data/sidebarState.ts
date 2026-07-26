// Whether the sidebar nav is collapsed — persisted so it stays put across
// reloads instead of re-expanding every visit.

const STORAGE_KEY = 'warehouse-ops.sidebarCollapsed.v1';

/** null = no preference saved yet (first-ever visit); caller decides the
 * default (e.g. collapsed on a narrow viewport). */
export function loadSidebarCollapsed(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return raw === 'true';
  } catch {
    return null;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    /* storage unavailable (private mode) — preference stays in memory for this session */
  }
}
