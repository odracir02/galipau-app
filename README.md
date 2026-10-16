# 🐸 Galipau App

> Management application for a screen printing and garment customisation workshop: quote calculator, customers, catalogue and backups — with orders, production, calendar, inventory and profit & loss planned.

Galipau App is a single-owner web application. It is moving to a **cloud deployment** (Supabase Free + Cloudflare Pages, no recurring cost) so it can be used from any computer or phone. The original **local mode** (Express + SQLite on a Windows PC) remains available during the migration; see the `v0.4.0-local-sqlite` tag.

## ✨ Features

- Quote calculator for DTF and screen printing (multiple blocks and lines, live validation)
- **Real-cost calculator for screen printing**: garments with waste, consumables, electricity, machinery reserve and labour, with a readable cost breakdown, recommended price and margin
- **Versioned pricing parameters** editable from the app (each change creates a new version; previous versions are kept)
- **Persistent quotes** (cloud mode): customers, multi-line jobs, lifecycle with enforced transitions (draft → presented → accepted → in production → finished → paid, or cancelled), gap-free numbering assigned on presentation, and an economic snapshot (engine and parameter versions) that keeps every quote reproducible
- **Customer PDF** in Spanish or Valencian, without internal costs or margins
- **Modern interface**: collapsible side navigation (off-canvas on phones), grouped settings, light and dark themes with a persistent preference, a home dashboard and a customer list; brand identity and design tokens are centralised
- **Controlled data migration** from the legacy browser history and catalogue: preview, duplicate detection, integrity checks and revert
- Customers API (create, edit, search, archive)
- Product catalogue (suppliers → models → variants), costs stored as integer cents
- Single-owner authentication (scrypt password hashing, server-side sessions, brute-force protection)
- Automatic and manual backups using SQLite's online backup API, integrity-checked, with optional off-site copy (e.g. a OneDrive folder) and controlled restore
- Versioned database migrations with an automatic backup before every schema change

## ☁️ Cloud deployment (Supabase + Cloudflare Pages)

| Part | Service |
|---|---|
| Database and authentication | [Supabase](https://supabase.com/) Free (PostgreSQL + Auth) |
| Web hosting | [Cloudflare Pages](https://pages.cloudflare.com/) (HTTPS) |
| Backups | GitHub Actions in a separate private repository ([`ops/copias`](ops/copias/README.md)) |

- **Schema:** versioned SQL migrations in `supabase/migrations` (apply with `supabase db push`). Every table uses Row Level Security, so only the registered owner account can read or write. The public (publishable/anon) key shipped to the browser is **not** a security mechanism. Secret keys are rejected at build time and at runtime.
- **Tests:** `supabase/pruebas` runs the real migrations on an in-process PostgreSQL ([PGlite](https://pglite.dev/)) and checks constraints and authorised/unauthorised access, with no cloud project or Docker needed.
- **Cloudflare Pages settings:**
  - build command `npm run build`, output directory `dist`, Node version from `.nvmrc`;
  - environment variables `VITE_BACKEND=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`;
  - use a test Supabase project for preview deployments and the production project for production;
  - React Router routes are served by the Pages single-page-application fallback;
  - security headers are defined in `public/_headers`.
- **Production helpers:** `npm run sql:instalacion` writes all migrations as one transactional SQL file (to a git-ignored folder) for the Supabase SQL Editor; `npm run verificar:nube` checks a project from the outside, as an anonymous visitor, using only its public URL and publishable key.
- **Sample data:** `supabase/datos-ficticios.sql` contains fictitious data for the test project only. It refuses to run on a database marked as production.

## 🛠️ Built With

- [React](https://react.dev/) + [Vite](https://vitejs.dev/) + [Bootstrap](https://getbootstrap.com/)
- [Supabase](https://supabase.com/) (PostgreSQL, Auth, Storage)
- [Express](https://expressjs.com/) + [SQLite](https://sqlite.org/) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (local mode)
- [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/)
- Firebase/Firestore: legacy catalogue source, kept only until the catalogue is migrated

## 🖥️ Local mode (Windows)

Requirements: [Node.js](https://nodejs.org/) 22.9 or newer, and Git.

```bash
git clone https://github.com/odracir02/galipau-app.git
cd galipau-app
npm install
npm run build
npm start
```

Open <http://localhost:4173>. On first use, create the access password **from the PC itself** (it cannot be created from another device).

**Daily use:** create a desktop shortcut to `scripts\windows\Galipau.cmd`. It starts the server (if it is not running) and opens the app. The server runs in a minimised window; closing that window stops the app safely.

Tip: in Edge or Chrome, use *Install this site as an app* to get a separate window and taskbar icon.

### Where is my data?

| What | Default location |
|---|---|
| Database | `%LOCALAPPDATA%\GalipauApp\galipau.db` |
| Local backups | `%LOCALAPPDATA%\GalipauApp\copias\` |

⚠️ Backups kept only on the same PC do **not** protect against hardware failure, theft or loss. In **Copias de seguridad**, configure an external folder (for example inside OneDrive, or a USB drive) so every finished backup is also copied there. Never put the live database itself in a synced folder.

### Configuration

Copy `.env.example` to `.env` to change the port, data folder, backup folder, backup frequency, local network access or catalogue source. All settings are optional.

### Access from a phone (optional)

Set `GALIPAU_HOST=0.0.0.0` in `.env` and restart. Allow the Windows firewall prompt **for private networks only**. Then open `http://<PC-IP>:4173` from a device on the same Wi-Fi. Never forward router ports to expose the app to the internet.

### Maintenance commands

```bash
npm run copias -- listar               # list backups
npm run copias -- crear                # create a backup (app stopped)
npm run copias -- restaurar <file>     # restore a backup (app stopped)
npm run contrasena:restablecer         # forgotten password (requires access to the PC)
```

### Updating

```bash
git pull
npm install
npm run build
```

Then restart the app. Pending database migrations are applied automatically after a backup.

## 🧑‍💻 Development

```bash
npm run dev          # UI + API in one process (Vite), using a separate dev database in ./data/dev
npm run db:ejemplo   # load a fictitious sample catalogue into the dev database
npm test             # unit, API, database and UI tests
npm run lint
npm run build
```

Set `VITE_CATALOGO_FUENTE=local` in `.env` to make the quote form read the catalogue from SQLite instead of the legacy Firestore collection.

## 📁 Project structure

```
src/        React UI (app shell, session, pages, domain logic)
supabase/   PostgreSQL migrations, RLS policies, fictitious test data and database tests
ops/        Backup workflows and restore tooling (for a private repository)
server/     Local mode: Express API, SQLite, migrations, backups, authentication
scripts/    Local mode: Windows launcher
```
