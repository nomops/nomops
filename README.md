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

### npx / global install

nomops also ships as a **self-contained npm package** (server + UI + migrations bundled,
no build step needed):

```bash
npx nomops                       # run without installing
# or
npm install -g nomops && nomops  # install the `nomops` CLI globally
```

Zero configuration — it creates `./nomops.db` (SQLite) on first run and serves the UI +
API at **http://localhost:5678**. Set `DB_TYPE=postgres` + `DB_POSTGRES_URL` for PostgreSQL.

> **First run**: zero-configuration development keeps the legacy database key. For production,
> set `NOMOPS_ENCRYPTION_KEY` (or its file variant) before the first start so only wrapped
> data-encryption keys are stored in the database.

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
| `NOMOPS_SMTP_HOST` / `NOMOPS_SMTP_PORT` | — / `587` | SMTP server used for password-reset and invitation emails. |
| `NOMOPS_SMTP_SECURE` | `false` | Use implicit TLS; port `465` enables it automatically. |
| `NOMOPS_SMTP_USER` / `NOMOPS_SMTP_PASS` | — | SMTP authentication credentials. |
| `NOMOPS_SMTP_FROM` | `NOMOPS_SMTP_USER` | Sender address, optionally with a display name. |
| `NOMOPS_SMTP_REJECT_UNAUTHORIZED` | `true` | Verify the SMTP TLS certificate. Keep enabled in production; set `false` only for explicitly trusted local/self-signed mail servers. |
| `NOMOPS_STATIC_DIR` | *(auto)* | Frontend build dir to serve. Auto-detected next to the server; override to disable/relocate. |
| `NOMOPS_ENCRYPTION_KEY` | — | 32-byte external envelope master key (64 hex chars or base64). Enabling it migrates the legacy DB key into a wrapped DEK keyring. |
| `NOMOPS_ENCRYPTION_KEY_FILE` | — | Read the external envelope master key from a mounted secret file; mutually exclusive with the inline variable. |
| `NOMOPS_COMMUNITY_NODE_INTEGRITIES` | `{}` | JSON map of exact `package@version` to npm `sha512-…` integrity. Required for community node installation by default. |
| `NOMOPS_COMMUNITY_NODE_ALLOWED_IMPORTS` | — | Comma-separated additional imports permitted by the community-node static policy. |
| `NOMOPS_ALLOW_UNVERIFIED_COMMUNITY_NODES` | `false` | Emergency provenance bypass. Static dangerous-API/import scanning still applies. |
| `NOMOPS_SUPPORT_URL` | — | Optional nomops-site base URL. The server appends the fixed `/api/instance/v1/tickets` path. Requires `NOMOPS_SUPPORT_TOKEN`. |
| `NOMOPS_SUPPORT_TOKEN` | — | Per-install `nomops_support_…` credential used only by the server to create support tickets. Never returned to the browser or stored in the database. |
| `LICENSE_KEY` | — | Unlocks enterprise features (see below). Community edition is free. |

With `NOMOPS_ENCRYPTION_KEY` configured, the database contains only AES-GCM-wrapped DEKs
and ciphertext carries a `keyId`. An instance admin can rotate the active DEK through
`POST /api/security/encryption-key/rotate`; retained DEKs continue to decrypt old data.
Removing or changing the external key makes startup fail closed. `jwtSecret` remains an
auto-generated instance setting.

When both support variables are set, signed-in users can open **Get support** and send a
minimal request to the configured nomops-site. Only the form fields, current product
version, and `regular`/`queue` deployment mode leave the instance. The browser calls the
local nomops API and never receives the support token. The destination is checked by the
same DNS/IP, connect-time, and redirect-hop SSRF policy used for user-controlled outbound
HTTP; private, loopback, link-local, and cloud-metadata destinations are rejected. If
either variable is absent, the page reports that support is not configured and cannot
submit. See [docs/15-SUPPORT-INTEGRATION.md](docs/15-SUPPORT-INTEGRATION.md).

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
- **Optional support integration** is one-way and is not a Cloud control plane. The
  configured site can receive a support request but cannot access workflows, credentials,
  executions, logs, environment variables, databases, files, or control this instance.

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
