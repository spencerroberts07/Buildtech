import React, { useState } from 'react';
import { api } from '../api.js';
import { BuildTekLogo } from '../App.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const { token, user } = await api.login(username, password);
      onLogin(token, user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-page-inner">
        <div className="login-brand">
          <BuildTekLogo size={88} />
        </div>
        <div className="login-wrap">
          <h2 style={{marginTop:0}}>Sign in</h2>
          <form onSubmit={submit}>
            <label>Username</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} autoFocus />
            <label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            {error && <p className="error">{error}</p>}
            <div style={{marginTop:'1rem'}}>
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
            </div>
            <p className="muted" style={{marginTop:'1rem'}}>Default: admin / changeme — change after first login.</p>
          </form>
        </div>
      </div>
    </div>
  );
}
