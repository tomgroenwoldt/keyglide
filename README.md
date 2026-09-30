<div align="center">

<img src="keyglide.png" alt="Keyglide" width="120" />

# Keyglide

**A daily keybinding puzzle for [Helix](https://helix-editor.com/).**

[keygli.de](https://keygli.de) · [Report a bug](https://github.com/tomgroenwoldt/keyglide/issues)

</div>

---

Every day you get two files: a `start` buffer and a `goal` buffer. Your job is to
turn one into the other in as few keystrokes as possible, inside a real Helix
instance running in your browser. Your keystroke count goes on the leaderboard,
and you can watch how everyone else solved it once the day is over.

Anyone can submit a challenge. Submissions sit in a queue and the community
votes; the highest voted becomes the next day's challenge. Solve one every day
and you build a streak.

## How it works

The editor in the browser is not a simulation. Each session spawns a real Helix
process in a PTY on the server, sandboxed with
[bubblewrap](https://github.com/containers/bubblewrap), and streams it to
[xterm.js](https://xtermjs.org/) over a WebSocket. A file watcher diffs the
buffer against the goal on every save to compute progress.

## Architecture

```
                    browser
                       │
              ┌────────┴────────┐
              │  frontend       │  React + Vite, served by the backend in
              │  (xterm.js)     │  production, Supabase client for auth/data
              └────────┬────────┘
                       │  /api  (HTTP + WebSocket)
              ┌────────┴────────┐        ┌──────────────────┐
              │  backend :3000  ├────────┤ editor-service   │
              │  (Axum)         │   ws   │ :3001 (Axum)     │
              └────────┬────────┘        │  bwrap → helix   │
                       │                 │  in a PTY        │
                       │ PostgREST       └──────────────────┘
              ┌────────┴────────┐
              │    Supabase     │  Postgres + auth + RLS
              └─────────────────┘
```

| Directory | What it is |
|---|---|
| `frontend/` | React 18, Vite, Tailwind and shadcn/ui. Talks to Supabase directly for auth and reads, and to the backend over `/api` for anything involving a live editor. |
| `backend/` | Axum on `:3000`. Serves the embedded frontend build, proxies the editor websockets, verifies Supabase ES256 JWTs, reaches Postgres through PostgREST, and runs a daily worker that resets streaks and gives the top-voted queued challenge a date. |
| `editor-service/` | Axum on `:3001`. Spawns Helix under `bwrap` in a PTY and streams terminal output over a WebSocket. Never talks to the database. |
| `common/` | Serde types shared by the two Rust services. |
| `supabase/` | Migrations and local config. Tables: `challenges`, `profiles`, `scores`, `solutions`, `user_settings`, `challenge_likes`, `challenge_comments`, `challenge_comment_votes` — all under row level security. A challenge's `date` carries its lifecycle: `NULL` while queued for votes, set once it becomes that day's challenge. |
| `docs/` | Design specs and implementation plans for larger features. |

Helix is built from [a small fork](https://github.com/tomgroenwoldt/helix) on the
`also-auto-save-in-insert-mode` branch, which saves in insert mode so progress
can be tracked continuously rather than only on explicit writes.

## Getting started

See **[docs/development.md](docs/development.md)** for the full setup. The short
version, once you have Rust, Node, pnpm, the Supabase CLI, `just` and `bwrap`:

```sh
supabase start && supabase db reset   # from the repository root
just -f frontend/Justfile install
just -f frontend/Justfile build       # the backend embeds frontend/dist at compile time
just -f backend/Justfile run          # :3000
just -f editor-service/Justfile run   # :3001
just -f frontend/Justfile run         # :5173, proxies /api to :3000
```

Then open <http://localhost:5173>.

## Deploying

The hosted instance runs as two Fly.io apps plus a hosted Supabase project.
See **[docs/deployment.md](docs/deployment.md)**.

## Contributing

Bug reports, challenge ideas and pull requests are all welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md). For anything security related, please read
[SECURITY.md](SECURITY.md) first and report privately rather than opening an
issue.

## License

[GNU AGPL-3.0-only](LICENSE). If you run a modified version of Keyglide as a
network service, you have to offer your users the source of your modifications.
