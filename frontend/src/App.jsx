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

function BrandLogo() {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">BT</div>
      <span className="brand-text">BuildTech</span>
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
            <NavLink to="/customers" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Customers
            </NavLink>
            <NavLink to="/assemblies" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Assemblies
            </NavLink>
            <NavLink to="/materials" className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
              Materials
            </NavLink>
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
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Shell>
  );
}
