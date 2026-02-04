import { BrowserRouter, NavLink, Route, Routes, Navigate } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import PositioningPage from './pages/PositioningPage';
import OrdersPage from './pages/OrdersPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import ExperimentsPage from './pages/ExperimentsPage';
import AgentPerformancePage from './pages/AgentPerformancePage';
import FeatureFlagsPage from './pages/FeatureFlagsPage';
import NotFoundPage from './pages/NotFoundPage';
import { TokenBar } from './components/TokenBar';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/positioning', label: 'Positioning' },
  { to: '/orders', label: 'Orders' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <div>
            <h1>OptionAgents</h1>
            <p className="subtitle">Automated options execution + experimentation</p>
          </div>
          <TokenBar />
        </header>
        <div className="app-shell">
          <nav className="app-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/positioning" element={<PositioningPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/experiments" element={<ExperimentsPage />} />
              <Route path="/agents" element={<AgentPerformancePage />} />
              <Route path="/feature-flags" element={<FeatureFlagsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
