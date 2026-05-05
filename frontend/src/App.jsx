import React from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Login from './components/Login.jsx';
import Projects from './components/Projects.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';
import Assemblies from './components/Assemblies.jsx';
import AssemblyEditor from './components/AssemblyEditor.jsx';
import Materials from './components/Materials.jsx';

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

function Shell({ user, onLogout, children }) {
  return (
    <div className="app-shell">
      <div className="topbar">
        <strong>Takeoff</strong>
        <NavLink to="/projects" className={({isActive}) => isActive ? 'active' : ''}>Projects</NavLink>
        <NavLink to="/assemblies" className={({isActive}) => isActive ? 'active' : ''}>Assemblies</NavLink>
        <NavLink to="/materials" className={({isActive}) => isActive ? 'active' : ''}>Materials</NavLink>
        <div className="spacer" />
        <span className="user">{user?.username}</span>
        <button onClick={onLogout}>Log out</button>
      </div>
      <div className="container">{children}</div>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const navigate = useNavigate();

  if (!auth.token) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={(t,u) => { auth.login(t,u); navigate('/projects'); }} />} />
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
        <Route path="/assemblies" element={<Assemblies />} />
        <Route path="/assemblies/new" element={<AssemblyEditor />} />
        <Route path="/assemblies/:id" element={<AssemblyEditor />} />
        <Route path="/materials" element={<Materials />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Shell>
  );
}
