# Deployment

Keyglide runs as two Fly.io apps plus a hosted Supabase project:

| App | What it is | Exposure |
|---|---|---|
| `keyglide` | Axum backend with the frontend compiled in | public, `:443` |
| `keyglide-editor` | Helix in a PTY inside a bubblewrap sandbox | **private only**, reachable at `keyglide-editor.internal:3001` |

The editor service has no public ports on purpose. It executes an editor on
behalf of anonymous users, so the only thing that should reach it is the
backend, over Fly's private WireGuard network.

## Before the first deploy

### 1. The sandbox (already confirmed)

bubblewrap runs on a Fly Machine with no special configuration. Under Docker it
needs `--cap-add=SYS_ADMIN --security-opt seccomp=unconfined`, because the
daemon drops the capability and its seccomp profile blocks `pivot_root`; a Fly
Machine is a Firecracker microVM with its own kernel, so neither applies.

This was verified by deploying the editor image to a throwaway app and running
Helix under `bwrap` with the same bind set the code uses. Repeat it if the base
image or Fly's platform changes:

```sh
fly launch --no-deploy --name keyglide-sandbox-probe --dockerfile editor-service/Dockerfile
fly deploy -a keyglide-sandbox-probe --dockerfile editor-service/Dockerfile
fly ssh console -a keyglide-sandbox-probe -C \
  "bwrap --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
     --proc /proc --die-with-parent --clearenv --tmpfs /home \
     --setenv HOME /home/user /usr/bin/helix --version"
fly apps destroy keyglide-sandbox-probe
```

Printing a Helix version means the sandbox works. `Creating new namespace
failed` or `pivot_root: Operation not permitted` means it does not, and the
editor service needs a plain VM instead — in which case keep the backend on
Fly and point `EDITOR_SERVICE_ADDR` at the VM over a private link.

### 2. Apply the database migrations

The backend writes to the merged `challenges` table and calls
`promote_challenge_for_date`. Neither exists on a database that has not been
migrated, so **migrate before deploying the new images**.

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

`20260930000001_merge_user_challenges.sql` rewrites every solution row and
deletes solutions that were duplicated across the old two-table split. Take a
backup from the Supabase dashboard first.

### 3. Create the apps and set secrets

```sh
fly apps create keyglide
fly apps create keyglide-editor

fly secrets set -a keyglide \
  SUPABASE_URL=https://<ref>.supabase.co \
  PUBLISHABLE_KEY=sb_publishable_... \
  SECRET_KEY=sb_secret_... \
  JWT_PUBLIC_KEY_X=... \
  JWT_PUBLIC_KEY_Y=...
```

> **The JWT env vars were renamed.** They used to be `X` and `Y`. The backend
> parses its config with `clap` and every field is required, so a deploy that
> still sets the old names exits immediately and the machine crash-loops.

`JWT_PUBLIC_KEY_X` / `JWT_PUBLIC_KEY_Y` are the `x` and `y` components of the
project's ES256 signing key. They are the public half and are not secret:

```sh
curl -s https://<ref>.supabase.co/auth/v1/.well-known/jwks.json | jq '.keys[0] | {x, y}'
```

The editor service needs no secrets.

### 4. Repository secrets for CI

`.github/workflows/deploy.yml` needs:

Create a `production` environment (Settings → Environments) and restrict it to
the `main` branch. The Fly tokens go there as **environment** secrets, so they
are reachable only from a run targeting that environment; the rest are ordinary
repository secrets. Environments and their protection rules are free on public
repositories — note that making the repository private again would cause
environment secrets to be ignored, silently breaking deploys.

| Name | Kind | Used for |
|---|---|---|
| `FLY_TOKEN_BACKEND` | **environment** secret (`production`) | deploying `keyglide` |
| `FLY_TOKEN_EDITOR` | **environment** secret (`production`) | deploying `keyglide-editor` |
| `SUPABASE_URL` | repository secret | baked into the frontend bundle |
| `SUPABASE_PUBLISHABLE_KEY` | repository secret | baked into the frontend bundle |
| `GA_MEASUREMENT_ID` | repository variable | analytics; leave unset to disable |

Create the two Fly tokens scoped to one app each, and give them a sane expiry
rather than the 20-year default:

```sh
fly tokens create deploy -a keyglide        -x 8760h -n "github actions backend"
fly tokens create deploy -a keyglide-editor -x 8760h -n "github actions editor"
```

A `deploy` token covers a single app. An `org` token would work with one secret
instead of two, but it grants deploy rights to every app in the organisation.

The two `SUPABASE_*` values are public — they ship in the frontend bundle
either way. They are secrets only because that is where the workflow reads
build arguments from.

## Deploying

Pushing to `main` deploys both, editor service first. A manual run through
**Actions → Deploy** can target one of them.

By hand:

```sh
fly deploy --config fly/editor-service.toml --dockerfile editor-service/Dockerfile
fly deploy --config fly/backend.toml --dockerfile Dockerfile \
  --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Things worth knowing

**The frontend is baked into the backend binary.** `rust_embed` compiles
`frontend/dist` into the executable, so the `VITE_*` values are fixed at image
build time. Changing them means rebuilding, not restarting.

**The backend must not scale to zero.** It runs the daily worker that resets
streaks and promotes the top-voted queued challenge at 01:00 UTC. A stopped
machine runs no worker, which is why `auto_stop_machines = false`.

**Sessions are stateful.** Each player holds a websocket open for the length of
their attempt, and the editor service holds a Helix process and a PTY per
session. Scale the editor service on memory before the backend, and expect a
deploy to drop sessions in flight.

**The worker RPCs are service-role only.** `promote_challenge_for_date` and
`reset_streaks_for_missed_day` have `EXECUTE` revoked from `anon` and
`authenticated`, so the backend must have a working `SECRET_KEY` or the daily
worker fails every night while everything else keeps working.
