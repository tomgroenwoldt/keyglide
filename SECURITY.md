# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/tomgroenwoldt/keyglide/security/advisories/new),
or by email to the address on the maintainer's
[GitHub profile](https://github.com/tomgroenwoldt).

Please include what you were able to do, the steps to reproduce it, and which
component is affected. A proof of concept helps a lot. You will get an
acknowledgement within a few days, and credit in the advisory unless you would
rather stay anonymous.

This is a hobby project run by one person, so please be patient with timelines.

## Where the interesting parts are

Keyglide runs a real editor process on behalf of anonymous users, which makes it
a more interesting target than the feature set suggests. The areas most worth
attention:

- **Sandbox escape.** `editor-service` spawns Helix inside a `bubblewrap`
  sandbox (`editor-service/src/editor.rs`, `editor-service/src/viewer.rs`).
  Anything that reads or writes outside the sandbox, reaches the network, or
  survives the session is a serious finding.
- **PTY and terminal handling.** Input travels from the browser through a
  WebSocket into a PTY (`editor-service/src/pty.rs`,
  `editor-service/src/terminal.rs`). Escape sequence injection and control
  character handling matter here.
- **Resource exhaustion.** Each session is a process. Anything that lets one
  client spawn unbounded sessions, pin a CPU, or fill the disk counts.
- **Authorization.** All token verification goes through `verify_token` in
  `backend/src/schema/claims.rs`. Reading another user's solutions before the
  day closes, or writing to another user's rows, is in scope.
- **Row level security and column grants.** Policies live in
  `supabase/migrations/`. Today's solutions are hidden by masking inside
  `get_ranked_solutions`, and `solutions.keys` is withheld from `anon` and
  `authenticated` by a column-level grant so the masking cannot be stepped
  around by reading the table directly. Any route to another player's live
  keystrokes is in scope.

## Out of scope

- Missing security headers or cookie flags with no demonstrated impact
- Rate limiting on endpoints with no state-changing effect
- Automated scanner output without a working proof of concept
- Anything requiring a compromised user device or a self-hosted instance you
  control
