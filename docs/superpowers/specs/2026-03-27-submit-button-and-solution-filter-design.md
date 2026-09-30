# Submit Button & Solution Filter Design

## Overview

Two changes to the challenge flow:

1. **Submit button** — Solutions are no longer auto-published when the file matches the goal. The user must explicitly click "Submit" while the file matches. The editor stays open after matching, allowing the user to optimize before submitting.
2. **Solution board filter** — Users can toggle between "All Solutions" and "My Solutions" on the solution board.

## 1. WebSocket Protocol Changes

### New message variant

Add `Submit` to `EditorServiceMessage` in `common/src/lib.rs`:

```rust
pub enum EditorServiceMessage {
    Progress(f64),
    Key(String),
    Submit,
}
```

`Submit` is a client-to-server message. The frontend sends it when the user clicks the Submit button.

### Editor-service (watcher.rs)

No changes. It continues sending `Progress(1.0)` when the file matches the goal and `Progress(<1.0)` when it diverges. It does not close the connection.

### Backend (editor_service.rs)

Changes to `server_to_client` / `handle_text_message`:

- Track `current_progress: f64` alongside `keys` and `start_time`.
- **On `Progress(1.0)`:** Update `current_progress`, forward the message to the client. Do NOT call `handle_finish`. Do NOT send a Close frame.
- **On `Progress(<1.0)`:** Update `current_progress`, forward normally.
- **On `Key`:** Forward as before (keystroke counting).

Changes to `client_to_server`:

- Parse incoming messages. If the message is `{"Submit": null}`:
  - Do NOT forward to the editor-service (it doesn't understand Submit).
  - Instead, signal the `server_to_client` task to run `handle_finish` and close the connection.
  - Use a `tokio::sync::watch` channel to communicate the submit signal from `client_to_server` to `server_to_client`. The `client_to_server` task sends `true` on the channel when Submit is received; `server_to_client` checks the channel after each progress update.
- The submit signal is only honored when `current_progress == 1.0`. If not 1.0, ignore it (the frontend disables the button, but the backend validates too).

`handle_finish` remains unchanged — it creates/finds the solution, records the score, and returns a Close frame with the result message.

## 2. Frontend — Submit Button

### Location

In `root.tsx`, in the `CardDescription` button group alongside Retry and Expand.

### State

- `submitted: boolean` — starts `false`, resets on retry or date change.

### Behavior

- **Disabled** when `progress < 100` or `submitted === true`.
- **Enabled** when `progress === 100` and `submitted === false`.
- On click: sends `{"Submit": null}` over the WebSocket, sets `submitted = true`.
- After submission, the WebSocket closes with the server's close reason (score message) as it does today.

### WebSocket access

The `Editor` component needs to expose a way for `Root` to send a message over the WebSocket. Options:
- Pass a `ref` callback that receives the WebSocket instance.
- Or: pass a `submitRef` (React ref) that `Editor` populates with a submit function.

The `submitRef` approach is cleaner — `Editor` sets `submitRef.current = () => ws.send(...)` on open, and `Root` calls it on Submit click.

### Visual treatment

- Primary/default button variant with a checkmark icon (e.g., `Check` from lucide-react).
- Label: "Submit".
- Once submitted: disabled, label changes to "Submitted".

## 3. Solution Board — Filter Tabs

### Location

In `solution-board.tsx`, between the header text and the solutions table.

### State

- `filter: "all" | "mine"` — defaults to `"all"`.

### UI

A toggle group or tabs using existing Radix UI primitives. Two options:
- "All Solutions" (default)
- "My Solutions" (only visible when user is logged in)

### Query changes

When `filter === "mine"`, add `.eq("user_id", user.id)` to both `solutionQuery` and `solutionCountQuery`.

When `filter === "all"`, queries remain unchanged.

### Side effects

- Pagination resets to page 1 when filter changes.
- Real-time subscriptions stay the same — they already refetch on any solutions/scores change.
- `filter` resets to `"all"` when `selectedDate` changes.

## Summary of files to change

| File | Change |
|------|--------|
| `common/src/lib.rs` | Add `Submit` variant to `EditorServiceMessage` |
| `backend/src/routes/editor_service.rs` | Stop auto-closing on Progress(1.0), handle Submit signal, add inter-task channel |
| `frontend/src/components/editor.tsx` | Expose `submitRef` for parent to trigger submit |
| `frontend/src/routes/root.tsx` | Add Submit button with progress-gated enable/disable |
| `frontend/src/components/solution-board.tsx` | Add filter tabs, modify queries |
