import React from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Login from './components/Login.jsx';
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

export function BuildTekLogo({ size = 36 }) {
  return (
    <svg
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      aria-hidden="true"
    >
      {/* Angular B silhouette with two cutouts (even-odd fills the cutouts as transparent) */}
      <path
        fill="white"
        fillRule="evenodd"
        d="
          M5 3
          L24 3
          L31 9
          L31 17
          L27 20
          L31 23
          L31 33
          L24 37
          L5 37
          Z
          M11 8
          L11 18
          L23 18
          L26 15
          L26 11
          L23 8
          Z
          M11 22
          L11 32
          L23 32
          L26 29
          L26 25
          L23 22
          Z
        "
      />
      {/* Stylized building/skyline inside the lower cutout: three ascending towers with peaked tops */}
      <path
        fill="white"
        d="
          M13 31
          L13 28
          L15 26
          L15 31
          Z
          M16 31
          L16 25
          L18 23
          L18 31
          Z
          M19 31
          L19 22
          L21 20
          L21 31
          Z
          M22 31
          L22 26
          L24 26
          L24 31
          Z
        "
      />
    </svg>
  );
}

function BrandLogo() {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">
        <BuildTekLogo size={36} />
      </div>
      <span className="brand-text">BuildTek</span>
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
        <Route path="/login" element={<Login onLogin={(t, u) => { auth.login(t, u); navigate('/projects'); }} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
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
