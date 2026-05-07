# Takeoff App — Phase 1

In-house takeoff tool. Enter measurements, tag with assemblies, get a material list out.

## What's in here

- `backend/` — Node + Express + Postgres API
- `frontend/` — React (Vite) single-page app

## Local setup (test before deploying)

### 1. Install Postgres locally OR use a free Render Postgres instance from the start

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and a JWT_SECRET
npm run migrate    # creates tables and seeds example assemblies
npm run dev        # runs on http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
# VITE_API_URL=http://localhost:4000 for local dev
npm run dev        # runs on http://localhost:5173
```

### 4. Login

Default user is created by the migration:
- Username: `admin`
- Password: `changeme`

**Change this immediately by editing the seed in `backend/src/migrate.js` or by adding a user-management screen later.**

## Deploying to Render

### 1. Push this repo to GitHub.

### 2. In Render, create:
- A **Postgres** database (free tier is fine to start). Copy the Internal Database URL.
- A **Web Service** for `backend/`:
  - Build command: `npm install && npm run migrate`
  - Start command: `npm start`
  - Environment variables:
    - `DATABASE_URL` = (paste internal DB URL)
    - `JWT_SECRET` = (any long random string)
    - `NODE_ENV` = `production`
    - `FRONTEND_ORIGIN` = (your frontend URL once you have it, e.g. `https://takeoff-frontend.onrender.com`)
- A **Static Site** for `frontend/`:
  - Build command: `npm install && npm run build`
  - Publish directory: `dist`
  - Environment variable:
    - `VITE_API_URL` = (your backend URL, e.g. `https://takeoff-backend.onrender.com`)

### 3. After both services are up, log in and start adding your real assemblies.

## How to use it

1. **Assemblies tab** — Define your construction assemblies. Each assembly has a unit (e.g. "linear foot", "square foot", "each") and a list of materials with quantity per unit.
   - Example: "Exterior 2x6 wall" / unit: linear foot
     - 2x6x8 SPF stud — 0.75 each
     - 7/16 OSB sheathing 4x8 — 0.28 sheets
     - Housewrap — 1 sf
     - R20 batt insulation — 1 sf

2. **Projects tab** — Create a project for each job. Inside a project, add measurements:
   - Description (e.g. "First floor exterior walls")
   - Quantity (e.g. 184)
   - Assembly (pick from your library)

3. **Material List** — The project page shows a rolled-up material list across all measurements, with a CSV export button. Take that CSV to the POS.

## Known limitations

- **PDF uploads are stored on the server's local disk (`backend/uploads/`).**
  On Render's free tier (and any host with ephemeral storage), the disk is wiped
  on each redeploy. Existing PDF rows in the DB will then point at a missing
  file; the canvas shows a "PDF not found — please re-upload" placeholder. A
  future phase should move uploads to S3 (or similar) for persistence.

## Phase 2 ideas (not built yet)

- SKU mapping (link assembly materials to specific POS SKUs)
- Pricing and quote generation
- Multi-user permissions
- Change orders / project revisions
- Persistent PDF storage (S3)
