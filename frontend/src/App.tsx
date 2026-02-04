import { BrowserRouter, NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import PositioningPage from './pages/PositioningPage';
import OrdersPage from './pages/OrdersPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import ExperimentsPage from './pages/ExperimentsPage';
import AgentPerformancePage from './pages/AgentPerformancePage';
import FeatureFlagsPage from './pages/FeatureFlagsPage';
import NotFoundPage from './pages/NotFoundPage';
import LoginPage from './pages/LoginPage';
import { TokenBar } from './components/TokenBar';
import { getToken } from './services/apiClient';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/positioning', label: 'Positioning' },
  { to: '/orders', label: 'Orders' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
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
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Navigate to="/dashboard" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <AppLayout>
                <DashboardPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/positioning"
          element={
            <ProtectedRoute>
              <AppLayout>
                <PositioningPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <AppLayout>
                <OrdersPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <AppLayout>
                <HistoryPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <AppLayout>
                <SettingsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/experiments"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ExperimentsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/agents"
          element={
            <ProtectedRoute>
              <AppLayout>
                <AgentPerformancePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/feature-flags"
          element={
            <ProtectedRoute>
              <AppLayout>
                <FeatureFlagsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
