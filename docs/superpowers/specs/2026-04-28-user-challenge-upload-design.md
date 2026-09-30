# User Challenge Upload — Design

**Date:** 2026-04-28
**Status:** Approved for implementation planning

## Goal

Let authenticated users submit their own keybinding-puzzle challenges and have the community promote them, via likes/dislikes, into the daily `challenges` rotation. Provide a public browse view of all submissions and a per-author management view.

## Summary

- New `user_challenges` table holds submissions; new `user_challenge_likes` table holds votes.
- A backend HTTP endpoint validates uploads (size, line count, line length, UTF-8, start ≠ goal, etc.) and inserts via PostgREST under the user's JWT.
- A daily background worker (extending the existing `daily_worker`) picks the highest net-voted unpromoted user_challenge for the new day and inserts it into `challenges`.
- Three new frontend routes: upload form (`/user-challenges/new`), public browse (`/user-challenges`), author dashboard (`/user-challenges/mine`).
- Monaco preview only — no live editor-service preview during authoring.

## Non-goals

- No moderation tooling. Promotion is purely vote-driven.
- No notifications when a user's challenge is promoted (author sees it on their dashboard).
- No editing after submit. Authors must delete and resubmit.
- No `submitted_by` column on `challenges`. Daily challenges remain anonymous as today.
- No file upload from disk. Authors paste/type directly into Monaco.
- No live editor-service WebSocket preview during authoring (Monaco read-only preview only).

## Data model

### Table: `user_challenges`

```sql
CREATE TABLE public.user_challenges (
  id SERIAL PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  start TEXT NOT NULL,
  goal TEXT NOT NULL,
  extension prog_extension NOT NULL CHECK (extension <> 'unknown'),
  title TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_at TIMESTAMPTZ,
  promoted_challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,

  CHECK (start <> goal),
  CHECK (length(start) <= 1024 AND length(goal) <= 1024),
  CHECK (length(coalesce(title, '')) <= 80),
  CHECK (length(coalesce(description, '')) <= 500)
);

ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
```

### RLS for `user_challenges`

- `SELECT`: `TO authenticated, anon USING (true)` — public browse.
- `INSERT`: `WITH CHECK (auth.uid() = author_id)` — authenticated authors only.
- `DELETE`: `USING (auth.uid() = author_id AND promoted_at IS NULL)` — locked after promotion.
- No `UPDATE` policy (immutable; promotion happens via a `SECURITY DEFINER` function that bypasses RLS).

### Table: `user_challenge_likes`

Mirrors `challenge_likes` exactly. Reuses the existing `public.challenge_like` enum (`up`/`down`).

```sql
CREATE TABLE public.user_challenge_likes (
  id SERIAL PRIMARY KEY,
  user_challenge_id INTEGER NOT NULL REFERENCES public.user_challenges ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) DEFAULT auth.uid() NOT NULL,
  reaction public.challenge_like NOT NULL,
  CONSTRAINT user_challenge_likes_unique UNIQUE (user_challenge_id, user_id)
);

ALTER TABLE public.user_challenge_likes ENABLE ROW LEVEL SECURITY;
```

RLS mirrors `challenge_likes`: insert/delete gated on `auth.uid() = user_id`, select open to all.

Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.user_challenge_likes;`.

### RPCs

- **`toggle_user_challenge_reaction(p_user_challenge_id INTEGER, p_reaction public.challenge_like) RETURNS VOID`** — `SECURITY DEFINER`. Same toggle-or-upsert behavior as the existing `toggle_challenge_reaction`.
- **`get_user_challenge_reaction_state(p_user_challenge_id INTEGER) RETURNS TABLE(up_count BIGINT, down_count BIGINT, my_reaction public.challenge_like)`** — mirrors existing `get_challenge_reaction_state`.
- **`get_user_challenges(filter user_challenge_filter, status user_challenge_status, ext prog_extension)` paginated list RPC**:
  - Returns: `id`, `author_id`, `author_username`, `title`, `description`, `extension`, `created_at`, `promoted_at`, `promoted_challenge_id`, `up_count`, `down_count`, `my_reaction`.
  - New enums:
    - `user_challenge_filter`: `most_recent`, `most_liked`, `most_disliked`, `liked_by_me`, `not_liked_by_me`.
    - `user_challenge_status`: `all`, `pending`, `promoted`.
  - `ext` may be `NULL` for "any extension".
  - Order: per `filter`; tie-break by `created_at DESC`.
- **`get_my_user_challenges() RETURNS TABLE(...)`** — author-scoped variant via `auth.uid()`. No filters needed (small N).
- **`promote_user_challenge_for_date(target_date DATE) RETURNS INTEGER`** — `SECURITY DEFINER`. Single transaction:
  1. If a row already exists in `challenges` for `target_date`, return `NULL`.
  2. Pick the top-ranked `user_challenges` row WHERE `promoted_at IS NULL`. Rank is computed by left-joining `user_challenge_likes` and aggregating: `ORDER BY (COUNT(*) FILTER (WHERE reaction='up') - COUNT(*) FILTER (WHERE reaction='down')) DESC, user_challenges.created_at ASC`.
  3. If none exists, return `NULL`.
  4. Insert into `challenges (date, start, goal, extension)` with the picked row's content.
  5. Update the picked `user_challenges` row: `promoted_at = now()`, `promoted_challenge_id = <new challenges.id>`.
  6. Return the new `challenges.id`.

## Backend (Rust)

### File layout

```
backend/src/
  routes/user_challenges.rs           # router + module exports
  routes/user_challenges/
    create.rs                          # POST /api/user_challenges
  schema/user_challenge.rs            # request/response/error types
  storage/user_challenges.rs          # postgrest insert helper
```

Wire the new router in `routes.rs` alongside `editor_service` and `duel`.

### `POST /api/user_challenges`

- Multipart form fields: `startFile` (bytes), `goalFile` (bytes), `extension` (text), `title` (text, optional), `description` (text, optional).
- Requires `Authorization: Bearer <jwt>`. Decode via existing `Claims` schema; reject `401` if missing/invalid.
- Validation pipeline (each step short-circuits with a typed error):
  1. JWT decode → user UUID.
  2. For each of `startFile`, `goalFile`:
     - ≤ 1024 bytes → `FileTooLarge`.
     - Valid UTF-8 → `InvalidEncoding`.
     - Line count ≤ 50 → `TooManyLines`.
     - Each line ≤ 200 chars → `LineTooLong`.
     - Trimmed content non-empty → `EmptyFile` / `WhitespaceOnly`.
  3. `start != goal` → `StartEqualsGoal`.
  4. `extension` parses to `prog_extension` and is not `unknown` → `InvalidExtension`.
  5. `title.len() <= 80` → `TitleTooLong` (if present).
  6. `description.len() <= 500` → `DescriptionTooLong` (if present).
- Insert via PostgREST using the user's JWT (RLS enforces `author_id = auth.uid()`). Return `201 Created` with `{ "id": <new_id> }`.

### Error response shape

All validation errors serialize as:

```json
{
  "error": "FileTooLarge",
  "message": "Start file exceeds 1KB size limit",
  "field": "startFile"
}
```

Status codes:
- `MissingField`, `InvalidEncoding`, `InvalidExtension` → `400 Bad Request`.
- `FileTooLarge`, `TooManyLines`, `LineTooLong`, `EmptyFile`, `WhitespaceOnly`, `StartEqualsGoal`, `TitleTooLong`, `DescriptionTooLong` → `422 Unprocessable Entity`.
- Missing/invalid JWT → `401 Unauthorized`.
- PostgREST insert failure → `500 Internal Server Error` (logged with details, generic message returned).

### Worker hook

In `backend/src/workers.rs`:
- After the existing `reset_streaks` call inside `daily_worker`, call a new helper `promote_user_challenge(state, today)` that RPCs `promote_user_challenge_for_date(today)` with `state.config.secret_key`. `today` is `Utc::now().date_naive()`.
- Logs the chosen `challenges.id` at `info!` (or `"queue empty for {date}, skipping"`).
- Errors are logged, not propagated — same pattern as `reset_streaks`.
- Idempotency: the function checks for an existing `challenges` row before inserting, so re-runs are no-ops. This is important because the existing `daily_worker` loop body sleeps only 5 seconds between iterations (a pre-existing condition; not in scope for this design); the promote call must therefore be safe to invoke many times per day.

### Storage helper

`storage/user_challenges.rs::insert(state, jwt, payload)` — calls `postgrest.from("user_challenges").auth(jwt).insert(json).select("id").execute()`. Parses the `id` from the returned row.

## Frontend (React)

### Routes (registered in `main.tsx`)

- `/user-challenges` — public browse list.
- `/user-challenges/new` — upload form. Auth-gated: redirect to `/login?returnTo=/user-challenges/new` if signed out.
- `/user-challenges/mine` — author dashboard. Auth-gated.

### New components

```
frontend/src/components/
  user-challenge-form.tsx         # upload form with dual Monaco editors
  user-challenge-list.tsx         # shared table for browse + mine
  user-challenge-likes.tsx        # up/down vote control
  user-challenge-preview.tsx      # Monaco read-only preview dialog
```

### Upload form (`user-challenge-form.tsx`)

- Two side-by-side `@monaco-editor/react` instances (start + goal), height ~400px each, `theme="vs-dark"`. Syntax highlighted by selected extension; remount on extension change to refresh language mode.
- Extension `<Select>`: populated from `Database["public"]["Enums"]["prog_extension"]`, filtered to exclude `unknown`.
- Optional title `<Input>` (max 80 chars, live counter).
- Optional description `<Textarea>` (max 500 chars, live counter).
- Client-side validation: same rules as backend, run on blur and on submit. Inline error messages on the offending field. Submit button disabled while form invalid.
- Submit: `POST /api/user_challenges` as `FormData` with `Authorization: Bearer <jwt>` header (JWT pulled from `useAppStore`).
- Backend errors: parse JSON `{ error, message, field }`. Map `field` to the input and render `message` inline. Unattributed errors fall back to a toast. Form state preserved on failure.
- On `201`: success toast + redirect to `/user-challenges/mine`.

### Browse list (`/user-challenges`)

- Header text + three `<Select>`s on the right: sort (most recent / most liked / most disliked / liked by me / not liked by me), status (all / pending / promoted), extension (any / `js` / `ts` / …).
- Table columns: Title (or `—` if none), Author, Extension badge, Created, Up votes, Down votes, Status (`Pending` or `Promoted YYYY-MM-DD`), Actions.
- Actions: Preview (opens Monaco read-only dialog), Vote (up/down toggle), Play (only if promoted; links to `/{date}`).
- Pagination identical to existing `Challenges` page (10 per page, prev/next + "X/Y" indicator).
- Data source: `supabase.rpc("get_user_challenges", { filter, status, ext })`.
- Realtime subscription on `user_challenge_likes` to refresh visible vote counts. Same pattern as `challenge-likes.tsx`.

### My dashboard (`/user-challenges/mine`)

- Reuses `user-challenge-list.tsx` with no filter dropdowns and an extra Delete column.
- Delete button is enabled only when `promoted_at IS NULL`; disabled with a tooltip explaining "promoted challenges are locked" otherwise.
- A "New challenge" button at the top routes to `/user-challenges/new`.
- Data source: `supabase.rpc("get_my_user_challenges")`.

### Header nav

Add a "User challenges" link in `components/header.tsx` pointing to `/user-challenges`.

### State

- No new zustand additions. JWT and supabase client come from existing `useAppStore`.
- Component-local state holds challenge lists, current page, current filters, dialog open state.

## Error handling matrix

| Layer | Behavior |
|---|---|
| Frontend client validation | Inline per-field errors on blur/submit; submit disabled while invalid; no HTTP request. |
| Backend `400` (`MissingField`, `InvalidEncoding`, `InvalidExtension`) | Toast "Couldn't process your submission" + inline error on the field if `field` was set. |
| Backend `401` | Redirect to `/login?returnTo=/user-challenges/new` + toast "Please sign in to submit a challenge." |
| Backend `422` validation | Inline error on the `field` (no toast). |
| Backend `500` / network | Toast "Server error — please try again." Form input preserved. |
| RLS rejection on delete | Toast "This challenge has been promoted and can no longer be deleted." |
| Worker promotion failure | `error!` logged. Worker loop continues. Next day retries. |
| Empty queue on promotion day | `info!` logged. Date stays empty in `challenges`. |

## Testing strategy

### Postgres

A SQL test (style of existing migrations, run via `supabase db reset` + a seed-test pattern) that:
1. Inserts two `user_challenges` for the same hypothetical "next day" target.
2. Adds 3 up-likes to one and 1 to the other (different users).
3. Calls `promote_user_challenge_for_date(<date>)`.
4. Asserts: top entry has `promoted_at` set, low entry does not, `challenges` row exists with matching content.
5. Re-runs the function for the same date; asserts no second insert.
6. Calls the function with an empty queue; asserts return is `NULL`.

### Backend

Unit tests for the validation pipeline as a pure helper (not behind axum). Table-driven cases: oversized file, too many lines, line too long, empty/whitespace, start==goal, bad extension, missing field, title too long, description too long, happy path.

Integration test for `POST /api/user_challenges` with a mock JWT (using existing test scaffolding if present in the repo; otherwise unit tests on the validation helper are sufficient for the first cut).

### Frontend

Manual QA pass (no formal frontend test infra in the repo). Coverage:
- Happy-path submit → redirect → row visible in `/mine`.
- Each validation error path renders the correct inline message.
- Vote toggle updates counts live.
- Each sort × status × extension combination returns sensible results.
- Delete button disabled on promoted rows.
- Auth redirect from `/user-challenges/new` when signed out.

## Migration plan

A single new migration file: `supabase/migrations/<timestamp>_user_challenges.sql`. Contains:
1. New enums (`user_challenge_filter`, `user_challenge_status`).
2. `user_challenges` table + RLS policies.
3. `user_challenge_likes` table + RLS policies + realtime publication.
4. RPCs: `toggle_user_challenge_reaction`, `get_user_challenge_reaction_state`, `get_user_challenges`, `get_my_user_challenges`, `promote_user_challenge_for_date`.

No data backfill required. No changes to existing tables.

## Open questions

None at design time. All clarified during brainstorming:
- Promotion: daily worker, no minimum threshold, oldest tie-break.
- Likes: separate table, not transferred on promotion.
- Lifecycle: user_challenges row stays after promotion with `promoted_at`/`promoted_challenge_id`.
- Mutability: submit-only; delete only allowed before promotion.
- Validation: 1 KB, ≤ 50 lines, ≤ 200 chars/line, non-empty, non-whitespace, start ≠ goal, extension ≠ unknown.
- Browse sort: most recent / most liked / most disliked / liked by me / not liked by me, with status + extension filters.
- Upload UX: paste into Monaco only.
- Metadata: optional title + optional description.
