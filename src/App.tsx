import { Sidebar } from './components/Sidebar';
import { pageTitles } from './state/derive';
import { useAppStore } from './state/store';
import { DashboardPage } from './pages/DashboardPage';
import { PlannerPage } from './pages/PlannerPage';
import { OrderManagementPage } from './pages/OrderManagementPage';
import { PickPage } from './pages/PickPage';
import { CodPage } from './pages/CodPage';
import { PromoPage } from './pages/PromoPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { SkuPage } from './pages/SkuPage';
import { CustomerPage } from './pages/CustomerPage';
import { SettingsPage } from './pages/SettingsPage';

function App() {
  const { state, actions } = useAppStore();
  const [pageTitle, pageSub] = pageTitles[state.route];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar route={state.route} actions={actions} />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '18px 26px',
            boxShadow: 'inset 0 -1px 0 var(--color-divider)', position: 'sticky', top: 0,
            background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)',
            backdropFilter: 'blur(8px)', zIndex: 5,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h4 style={{ margin: '0 0 1px', fontSize: 19 }}>{pageTitle}</h4>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{pageSub}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-neutral-400)' }}>
              <i className="ph ph-calendar-blank" />23 ก.ค. 2026
            </div>
            <button className="btn btn-icon btn-secondary" title="แจ้งเตือน">
              <i className="ph ph-bell" style={{ fontSize: 16 }} />
            </button>
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
          {state.route === 'settings' && <SettingsPage state={state} actions={actions} />}
        </div>
      </main>
    </div>
  );
}

export default App;
