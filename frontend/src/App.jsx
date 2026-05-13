import React from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Login from './components/Login.jsx';
import LandingPage from './components/LandingPage.jsx';
import Projects from './components/Projects.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';
import Assemblies from './components/Assemblies.jsx';
import AssemblyEditor from './components/AssemblyEditor.jsx';
import Materials from './components/Materials.jsx';
import Settings from './components/Settings.jsx';
import Customers from './components/Customers.jsx';
import CustomerDetail from './components/CustomerDetail.jsx';
import Defaults from './components/Defaults.jsx';
import QuotesList from './components/QuotesList.jsx';
import QuotePage from './components/QuotePage.jsx';

function useAuth() {
  const [token, setToken] = React.useState(localStorage.getItem('token'));
  const [user, setUser] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const login = (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(token); setUser(user);
  };
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null); setUser(null);
  };
  return { token, user, login, logout };
}

// Full BuildTek lockup (icon + wordmark) served as a static SVG file from
// /public. `size` controls height; width auto-scales from the artwork's
// aspect ratio (~4:1).
export function BuildTekLogo({ size = 48 }) {
  return (
    <img
      src="/buildtek-logo.svg?v=2"
      alt="BuildTek"
      height={size}
      style={{ height: size, width: 'auto', display: 'block' }}
    />
  );
}

function BrandLogo() {
  return (
    <div className="brand">
      <BuildTekLogo size={48} />
    </div>
  );
}

function Shell({ user, onLogout, children }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <BrandLogo />
        <div className="spacer" />
        <NavLink to="/settings" className="topbar-link">Settings</NavLink>
        <span className="user">{user?.username}</span>
        <button className="topbar-btn" onClick={onLogout}>Log out</button>
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <div className="sidebar-section-title">Navigation</div>
          <nav className="sidebar-nav">
            <NavLink to="/projects" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Projects
            </NavLink>
            <NavLink to="/quotes" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Quotes
            </NavLink>
            <NavLink to="/customers" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Customers
            </NavLink>
            <NavLink to="/assemblies" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Assemblies
            </NavLink>
            <NavLink to="/materials" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Materials
            </NavLink>
            {user?.username === 'admin' && (
              <NavLink to="/defaults" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
                Defaults
              </NavLink>
            )}
          </nav>
        </aside>
        <main className="app-main">
          <div className="container">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const navigate = useNavigate();

  if (!auth.token) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login onLogin={(t, u) => { auth.login(t, u); navigate('/projects'); }} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Shell user={auth.user} onLogout={() => { auth.logout(); navigate('/login'); }}>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/assemblies" element={<Assemblies />} />
        <Route path="/assemblies/new" element={<AssemblyEditor />} />
        <Route path="/assemblies/:id" element={<AssemblyEditor />} />
        <Route path="/materials" element={<Materials />} />
        <Route path="/defaults" element={<Defaults />} />
        <Route path="/quotes" element={<QuotesList />} />
        <Route path="/quotes/:id" element={<QuotePage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Shell>
  );
}
