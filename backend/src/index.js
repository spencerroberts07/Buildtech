import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';
import { signToken, authRequired, adminRequired } from './auth.js';
import adminRouter from './routes/admin.js';
import materialsRouter from './routes/materials.js';
import assembliesRouter from './routes/assemblies.js';
import projectsRouter from './routes/projects.js';
import settingsRouter from './routes/settings.js';
import skuCatalogRouter, { skuSearchRouter } from './routes/skuCatalog.js';
import customersRouter from './routes/customers.js';
import systemSettingsRouter from './routes/systemSettings.js';
import quotesRouter, { attachProjectQuotesRoutes } from './routes/quotes.js';

// Mount project-scoped quote routes (/projects/:id/quotes) onto the projects router.
attachProjectQuotesRoutes(projectsRouter);

dotenv.config();

const app = express();

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '*').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const { rows } = await query('SELECT * FROM users WHERE username=$1', [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role || 'admin' } });
});

app.post('/auth/verify-password', authRequired, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password required' });
  const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'user not found' });
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  res.json({ valid: !!ok });
});

app.post('/auth/change-password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'user not found' });
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'current password incorrect' });
  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
  res.json({ ok: true });
});

app.use('/materials', authRequired, materialsRouter);
app.use('/assemblies', authRequired, assembliesRouter);
app.use('/projects', authRequired, projectsRouter);
app.use('/settings', authRequired, settingsRouter);
app.use('/sku-catalog', authRequired, skuCatalogRouter);
app.use('/sku-search', authRequired, skuSearchRouter);
app.use('/customers', authRequired, customersRouter);
app.use('/system-settings', authRequired, systemSettingsRouter);
app.use('/quotes', authRequired, quotesRouter);
app.use('/admin', authRequired, adminRequired, adminRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend listening on ${port}`));
