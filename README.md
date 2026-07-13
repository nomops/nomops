# nomops

[![CI](https://github.com/nomops/nomops/actions/workflows/ci.yml/badge.svg)](https://github.com/nomops/nomops/actions/workflows/ci.yml)

**Node-based workflow automation you can self-host.** Build automations on a visual
canvas, drop into code when you need it, and run it on your own infrastructure —
see the input and output of every step.

> This repository is the **instance product** (what you self-host). The multi-tenant
> Cloud orchestration layer lives in a separate repo,
> [`nomops/nomops-cloud`](https://github.com/nomops/nomops-cloud).

---

## Features

- **Visual canvas** — drag nodes, connect them, run, and inspect every node's data.
- **Code when you need it** — Code node + expressions (`{{ }}`) alongside no-code.
- **Triggers** — Webhook and Cron/Schedule for real automation (no manual "run").
- **Credentials** — encrypted at rest, never returned by the API or written to logs.
- **Runs your way** — SQLite by default, or PostgreSQL; single process or **queue
  mode** (BullMQ + Redis) for horizontal scale.
- **Team-ready** — projects, members and RBAC roles.
- **Account security** — two-factor auth (TOTP), public **API keys**, password reset.
- **Organize** — workflow **folders** (nested), templates, variables, data tables, insights.
- **Enterprise** (license-gated) — SSO (OIDC), SCIM, LDAP, audit logs, log streaming,
  external secrets, execution quotas.

---

## Quick start

### Docker (recommended)

**Single container** — SQLite, data persisted in a volume:

```bash
docker build -t nomops -f docker/Dockerfile .
docker run -it --rm -p 5678:5678 -v nomops_data:/data nomops
```

Then open **http://localhost:5678** and register the first user — the first account
becomes the instance **owner**.

**Full stack** (app + PostgreSQL + Redis) with Docker Compose:

```bash
docker compose -f docker/docker-compose.yml up --build
```

**Queue mode** (add a horizontally-scalable execution worker):

```bash
docker compose -f docker/docker-compose.yml --profile queue up --build
```

### npm / Node

Requires **Node ≥ 22** and **pnpm**. From a clone:

```bash
git clone https://github.com/nomops/nomops.git
cd nomops
pnpm install
pnpm build
pnpm start            # → http://localhost:5678 (serves the UI + API)
```

`pnpm start` runs the compiled server (`node packages/server/dist/main.js`). It serves
the built frontend automatically and creates a local SQLite database at `./nomops.db`
on first run — no configuration required.

The server package also exposes a **`nomops` CLI** (`bin/nomops.js`). Once published to
npm you can `npm install -g nomops && nomops` or `npx nomops`; from a clone, `pnpm start`
is equivalent.

> **First run**: the encryption key and JWT signing secret are generated automatically
> and stored in the database — you do **not** need to set any secrets to get started.

---

## Configuration

All configuration is via environment variables. Sensible defaults mean nothing is
required for a basic SQLite install.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5678` | HTTP port for the API + UI. |
| `DB_TYPE` | `sqlite` | `sqlite` or `postgres`. |
| `DB_SQLITE_FILE` | `nomops.db` | SQLite file path (when `DB_TYPE=sqlite`). |
| `DB_POSTGRES_URL` | — | PostgreSQL connection string (when `DB_TYPE=postgres`). |
| `EXECUTIONS_MODE` | `regular` | `regular` (single process) or `queue` (BullMQ workers). |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis, required for `queue` mode. |
| `NOMOPS_BASE_URL` | `http://localhost:5678` | Public base URL (used in e.g. password-reset links). |
| `NOMOPS_STATIC_DIR` | *(auto)* | Frontend build dir to serve. Auto-detected next to the server; override to disable/relocate. |
| `LICENSE_KEY` | — | Unlocks enterprise features (see below). Community edition is free. |

Secrets (`encryptionKey`, `jwtSecret`) are auto-generated on first run and persisted in
the database — keep the database safe and they persist across restarts.

---

## Deployment notes

- **SQLite vs PostgreSQL** — SQLite is great for a single instance. For production or
  multiple workers, use PostgreSQL (`DB_TYPE=postgres` + `DB_POSTGRES_URL`).
- **Queue mode** — set `EXECUTIONS_MODE=queue`, point at Redis, and run one or more
  worker processes (`node packages/server/dist/worker.js`, or the Compose `queue`
  profile). Scheduled triggers only fire on the elected leader, so they run once.
- **HTTPS / reverse proxy** — terminate TLS at a proxy (nginx / Traefik / Caddy) in
  front of the app; forward WebSocket upgrades (used for live execution progress).
- **Migrations** run automatically on startup (SQLite and PostgreSQL).

---

## Enterprise features

The **community edition is free and self-hostable**. Setting `LICENSE_KEY` unlocks
enterprise features — SSO (OIDC), SCIM provisioning, LDAP login, RBAC, audit logs,
log streaming, external secrets and execution quotas — gated by the license, in the
same codebase (no separate build).

---

## Cloud

Running nomops as a **multi-tenant hosted service** (instance-per-tenant, a control
plane + operations console) is a separate concern and lives in
[`nomops/nomops-cloud`](https://github.com/nomops/nomops-cloud). It wraps this instance
image over the network and has **zero code dependency** on it. Self-hosting never runs
any Cloud code.

---

## Development

```bash
pnpm install
pnpm build       # build all packages (Turborepo)
pnpm dev         # watch mode
pnpm test        # run the full test suite (Vitest)
pnpm typecheck
```

Monorepo layout (pnpm + Turborepo):

| Package | Role |
|---|---|
| `packages/workflow` | Execution engine core + expression sandbox (zero business deps). |
| `packages/core` | Shared abstractions (node loader, encryption-key provider). |
| `packages/nodes` | Built-in node definitions. |
| `packages/db` | Drizzle ORM, dual dialect (SQLite ↔ PostgreSQL) + migrations. |
| `packages/server` | Express API, triggers, auth, enterprise features, `nomops` CLI. |
| `packages/frontend` | Vue 3 + Vue Flow editor UI. |

---

## Documentation

Design and data-model docs live in [`docs/`](docs/) — architecture, the workflow-JSON /
node-schema contracts, module conventions, and the roadmap.

---

## License

© 2026 nomops. See the repository owner for licensing terms.
