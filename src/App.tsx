import { Sidebar } from './components/Sidebar';
import { NotificationBell } from './components/NotificationBell';
import { formatDateTime, pageTitles } from './state/derive';
import { useAppStore } from './state/store';
import { DashboardPage } from './pages/DashboardPage';
import { PlannerPage } from './pages/PlannerPage';
import { DriverPage } from './pages/DriverPage';
import { OrderManagementPage } from './pages/OrderManagementPage';
import { PickPage } from './pages/PickPage';
import { CodPage } from './pages/CodPage';
import { PromoPage } from './pages/PromoPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { SkuPage } from './pages/SkuPage';
import { CustomerPage } from './pages/CustomerPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { SettingsPage } from './pages/SettingsPage';

function App() {
  const { state, actions } = useAppStore();

  // Full-screen mobile view for drivers — no admin sidebar/header chrome.
  if (state.route === 'driver') {
    return <DriverPage state={state} actions={actions} />;
  }

  const [pageTitle, pageSub] = pageTitles[state.route];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {!state.sidebarCollapsed && <Sidebar route={state.route} actions={actions} />}

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '18px 26px',
            boxShadow: 'inset 0 -1px 0 var(--color-divider)', position: 'sticky', top: 0,
            background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)',
            backdropFilter: 'blur(8px)', zIndex: 5, flexWrap: 'wrap',
          }}
        >
          <button
            className="btn btn-icon btn-secondary"
            title={state.sidebarCollapsed ? 'แสดงเมนู' : 'ซ่อนเมนู'}
            onClick={() => actions.toggleSidebar(state.sidebarCollapsed)}
          >
            <i className={state.sidebarCollapsed ? 'ph ph-list' : 'ph ph-sidebar-simple'} style={{ fontSize: 16 }} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h4 style={{ margin: '0 0 1px', fontSize: 19 }}>{pageTitle}</h4>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{pageSub}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: state.syncError ? 'var(--st-bad-fg)' : 'var(--color-neutral-400)' }}
              title={state.syncError ? `Sync ล่าสุดไม่สำเร็จ (${state.lastSyncErrorAt ? formatDateTime(state.lastSyncErrorAt) : ''}): ${state.syncError}` : undefined}
            >
              <i className={state.syncError ? 'ph ph-warning-fill' : 'ph ph-calendar-blank'} />
              {state.lastSyncAt ? `อัปเดตล่าสุด ${formatDateTime(state.lastSyncAt)}` : 'ยังไม่เคย sync'}
            </div>
            <button className="btn btn-icon btn-secondary" title="Sync ข้อมูลจาก Google Sheet" disabled={state.syncing} onClick={() => actions.syncNow()}>
              <i className="ph ph-arrows-clockwise" style={{ fontSize: 16, animation: state.syncing ? 'spin .8s linear infinite' : undefined }} />
            </button>
            <NotificationBell state={state} actions={actions} />
          </div>
        </header>

        <div style={{ flex: 1, padding: '24px 26px 60px', overflow: 'auto' }}>
          {state.route === 'dashboard' && <DashboardPage state={state} actions={actions} />}
          {state.route === 'route' && <OrderManagementPage state={state} actions={actions} />}
          {state.route === 'planner' && <PlannerPage state={state} actions={actions} />}
          {state.route === 'pick' && <PickPage state={state} actions={actions} />}
          {state.route === 'cod' && <CodPage state={state} actions={actions} />}
          {state.route === 'promo' && <PromoPage state={state} actions={actions} />}
          {state.route === 'grn' && <ReceivingPage state={state} actions={actions} />}
          {state.route === 'sku' && <SkuPage state={state} actions={actions} />}
          {state.route === 'customer' && <CustomerPage state={state} actions={actions} />}
          {state.route === 'activity' && <ActivityLogPage state={state} actions={actions} />}
          {state.route === 'settings' && <SettingsPage state={state} actions={actions} />}
        </div>
      </main>
    </div>
  );
}

export default App;
