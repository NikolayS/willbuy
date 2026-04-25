# infra/dev — local self-hosted Supabase

Local-development bring-up for willbuy.dev. Spec ref §4.1.

> Production deploy of Supabase is **out of scope here** (lands in Sprint 3). This compose file is for laptop-grade dev only — single host, no TLS, no backups.

## Fastest path from clean clone to a working DB

```sh
# 1. Copy and fill the env template (placeholders only in the example).
cp infra/dev/.env.example infra/dev/.env
$EDITOR infra/dev/.env   # see "Generating local dev secrets" below

# 2. Bring up Supabase.
docker compose -f infra/dev/docker-compose.yml --env-file infra/dev/.env up -d

# 3. Apply migrations (creates _migrations + the placeholder row).
set -a; . infra/dev/.env; set +a
bun run migrate
```

Studio is now at <http://localhost:54323>. The Kong API gateway is at <http://localhost:8000>. Postgres is on `127.0.0.1:54322` with the credentials in your `.env`.

## What's in the compose

Every image is pinned by tag **and** sha256 digest — no floating tags. Healthchecks gate `depends_on`, so dependents do not start until the dependency answers healthy.

| service          | image                       | role                                |
|------------------|-----------------------------|-------------------------------------|
| `db`             | `supabase/postgres`         | Postgres 15.6 with Supabase extensions |
| `auth`           | `supabase/gotrue`           | Auth (magic-link, JWT)              |
| `rest`           | `postgrest/postgrest`       | REST over Postgres                  |
| `realtime`       | `supabase/realtime`         | Realtime change-feed                |
| `storage`        | `supabase/storage-api`      | Object storage                      |
| `imgproxy`       | `darthsim/imgproxy`         | On-the-fly image transforms         |
| `meta`           | `supabase/postgres-meta`    | Schema introspection for Studio     |
| `studio`         | `supabase/studio`           | Web UI                              |
| `kong`           | `kong`                      | API gateway in front of the above   |
| `edge-functions` | `supabase/edge-runtime`     | Deno-based edge functions runtime   |

To bump an image: update **both** the tag and the `@sha256:…` digest in `docker-compose.yml`. Floating-tag updates are not allowed.

## Generating local dev secrets

`infra/dev/.env.example` ships with `replace-me-…` placeholders. To turn it into a working `.env`:

```sh
# 1. Random Postgres password.
openssl rand -hex 16

# 2. JWT signing secret (≥ 32 chars).
openssl rand -base64 48 | tr -d '\n'

# 3. Realtime SECRET_KEY_BASE (64 char base64).
openssl rand -base64 48 | tr -d '\n'

# 4. ANON_KEY + SERVICE_ROLE_KEY are JWTs signed with JWT_SECRET. Mint them
#    with any local JWT tool. Quick Node one-liner (no deps required):
node --input-type=module -e '
  import { createHmac } from "node:crypto";
  const secret = process.env.JWT_SECRET;
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const sign = (role) => {
    const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64u(JSON.stringify({
      role,
      iss: "supabase-dev",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10,
    }));
    const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${sig}`;
  };
  console.log("ANON_KEY=" + sign("anon"));
  console.log("SERVICE_ROLE_KEY=" + sign("service_role"));
'
```

Paste the output into `infra/dev/.env`. None of these values are committed.

## Migrations

`scripts/migrate.sh` (wired as `bun run migrate`) is a thin wrapper around
[NikolayS/sqlever](https://github.com/NikolayS/sqlever) v0.3.0 (amendment A4, issue #48):

- reads `DATABASE_URL` from the environment
- delegates to `bunx sqlever deploy --top-dir infra/sqlever/ --db-uri $DATABASE_URL`
- sqlever applies pending changes in plan order (lexicographic, per `infra/sqlever/sqitch.plan`)
- tracks applied changes in the `sqitch.*` schema (Sqitch-compatible)
- each deploy script also writes a backward-compat row into `_migrations` for tools that read it
- exits non-zero and rolls back the failing change's transaction if any SQL errors mid-way

Re-running `bun run migrate` against the same DB is a no-op — sqlever skips already-applied changes.

**What sqlever adds over the old bash runner:**
- 43 static-analysis rules that catch dangerous migration patterns before deploy
- `bunx sqlever status` — see which changes are pending vs deployed
- `bunx sqlever analyze infra/sqlever/deploy/` — lint any migration file for safety issues
- Machine-readable output (`--format json`) for CI integration

**Migrating an existing database** (one that ran the old bash `migrate.sh`): the `_migrations` table
already exists. Run `bun run migrate` — sqlever seeds its `sqitch.*` tracking from the deploy
scripts, which are idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` guards on all DDL).

**psql prerequisite:** sqlever shells out to psql for script execution. Install `postgresql-client`
(`brew install libpq` on macOS, `apt-get install postgresql-client` on Ubuntu).

## Tearing it all down

```sh
docker compose -f infra/dev/docker-compose.yml --env-file infra/dev/.env down -v
```

`-v` drops the named volumes (`db-data`, `storage-data`) — your local DB is gone after this.

## What's NOT here (deferred)

- Real schema migrations — land in #26.
- Production deploy of self-hosted Supabase — Sprint 3.
- KMS envelope encryption + per-env root keys — Sprint 3 ship-gate (§2 #23).
- Preview-env-per-PR provisioning — out of Sprint 2 scope; see §2 #25.
