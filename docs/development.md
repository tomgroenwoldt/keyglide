# Development setup

This walks through running the whole stack locally: Supabase, the backend, the
editor service and the frontend. Expect the first run to take a while, mostly
because of Rust compile times and the Helix build.

## Prerequisites

| Tool | Why |
|---|---|
| [Rust](https://rustup.rs/) (stable) | `backend`, `editor-service`, `common` |
| [Node](https://nodejs.org/) 23 + pnpm | the frontend. `corepack enable` gives you pnpm |
| [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) | local Postgres, auth and PostgREST |
| [just](https://github.com/casey/just) | the per-crate task runners |
| [Docker](https://docs.docker.com/get-docker/) | Supabase runs in containers; also the easiest way to run the editor service |
| `bubblewrap` (`bwrap`) | sandboxing the Helix processes. Linux only |
| [mkcert](https://github.com/FiloSottile/mkcert) | optional, only if you want local TLS |

The editor service also needs a `helix` binary on `PATH`. See
[Editor service](#editor-service) below — running it in Docker is the path of
least resistance, since the image builds the required fork for you.

## 1. Supabase

Run all of these from the repository root — the Supabase CLI looks for
`supabase/config.toml` relative to the current directory.

Generate a JWT signing key. The CLI writes `supabase/signing_key.json` itself,
but it needs the file to exist first, so seed it with an empty array:

```sh
echo '[]' > supabase/signing_key.json
just -f supabase/Justfile generate-signing-key
```

The result is a JSON array holding one ES256 key. Its `x` and `y` values are
what the backend needs in the next step.

Copy `supabase/.env.example` to `supabase/.env` and fill in a GitHub OAuth app's
credentials — create one at
<https://github.com/settings/developers> with:

- **Homepage URL**: `http://localhost:5173`
- **Authorization callback URL**: `http://127.0.0.1:54321/auth/v1/callback`

```sh
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Then start the stack and apply the migrations and seed data:

```sh
supabase start
supabase db reset
```

`supabase start` prints the API URL, the publishable (anon) key and the secret
(service role) key. Keep that output around — the next step needs it. Supabase
Studio is at <http://127.0.0.1:54323>.

`supabase db reset` applies everything in `supabase/migrations/` and then
`supabase/seed.sql`, which inserts one trivial challenge for today so the app has
something to show.

## 2. Backend

```sh
cp backend/.env.example backend/.env
```

Fill in:

- `PUBLISHABLE_KEY` and `SECRET_KEY` — from the `supabase start` output.
- `JWT_PUBLIC_KEY_X` / `JWT_PUBLIC_KEY_Y` — the `x` and `y` components of the
  ES256 public key. These are public, not secret. Read them from the local JWKS
  endpoint, or straight out of `supabase/signing_key.json`:

  ```sh
  curl -s http://127.0.0.1:54321/auth/v1/.well-known/jwks.json | jq '.keys[0] | {x, y}'
  ```

> **The backend does not compile until the frontend has been built at least
> once.** It embeds `frontend/dist/` into the binary with `rust_embed`, and that
> directory has to exist at compile time. Run `just -f frontend/Justfile install`
> and `just -f frontend/Justfile build` first, or you will get
> `no associated function named 'get' found for struct 'Frontend'`.

```sh
just -f backend/Justfile run    # :3000
```

## 3. Editor service

The editor service spawns Helix inside a `bwrap` sandbox. It needs both `bwrap`
and a `helix` binary built from the
[`also-auto-save-in-insert-mode` fork](https://github.com/tomgroenwoldt/helix),
which saves in insert mode so progress can be tracked as you type.

The reliable way to get both is the container, which builds the fork for you:

```sh
just build-editor-service              # from the repository root
just -f editor-service/Justfile start-container
```

To run it natively instead, build that Helix fork yourself, put the binary on
`PATH`, and:

```sh
just -f editor-service/Justfile run    # :3001
```

Note that `bwrap` is Linux-only. On macOS and Windows, use the container.

## 4. Frontend

```sh
cp frontend/.env.example frontend/.env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the
`supabase start` output. Leave `VITE_GA_MEASUREMENT_ID` empty — analytics stay
off entirely when it is unset.

```sh
just -f frontend/Justfile install
just -f frontend/Justfile run          # :5173
```

Open <http://localhost:5173>. The dev server proxies `/api` to the backend on
`:3000`, including WebSocket upgrades, so you do not need to hit `:3000`
directly.

## Everyday commands

```sh
just -f frontend/Justfile lint         # eslint
just -f frontend/Justfile format       # prettier, writes in place
just -f backend/Justfile lint          # cargo clippy
just -f editor-service/Justfile lint   # cargo clippy
```

Tests live in `editor-service/tests/`:

```sh
cd editor-service && cargo test
```

## Database changes

Never edit an existing migration — it has already run on production. Add a new
one:

```sh
supabase migration new describe_your_change
```

Write the SQL, then `supabase db reset` to re-apply everything from scratch and
confirm it works on a clean database.

Every table must have row level security enabled with explicit policies. Look at
`supabase/migrations/20260428000000_user_challenges.sql` for the shape we use —
though note that table has since been merged into `challenges`; see
`20260930000001_merge_user_challenges.sql`.

After changing the schema, regenerate the TypeScript types the frontend reads:

```sh
supabase gen types typescript --local > frontend/src/database.types.ts
```

## Troubleshooting

**`no associated function named 'get' found for struct 'Frontend'`** — you have
not built the frontend yet. See the note in [Backend](#2-backend).

**Auth redirects to the wrong place** — `site_url` and
`additional_redirect_urls` in `supabase/config.toml` both expect
`http://localhost:5173`. If you run the frontend on another port, update both
and restart with `supabase stop && supabase start`.

**The editor pane stays blank** — the editor service is not reachable on `:3001`,
or `bwrap` is missing. Check `EDITOR_SERVICE_ADDR` in `backend/.env` and the
editor service logs.

**`bwrap: Creating new namespace failed`** or **`bwrap: pivot_root: Operation
not permitted`** — the sandbox needs two things the default container settings
withhold: `CAP_SYS_ADMIN` to create its namespace, and a seccomp profile that
permits `pivot_root`. `just -f editor-service/Justfile start-container` passes
both. Neither alone is sufficient, and `--privileged` is not needed.
