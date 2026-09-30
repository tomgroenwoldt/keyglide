# User-Based Helix Settings

Per-user helix editor configuration, starting with relative line numbers. Authenticated users can toggle editor options from a Settings page; the backend passes these to the editor-service at session spawn time.

## Database

New `user_settings` table:

```sql
CREATE TABLE user_settings (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    line_number TEXT NOT NULL DEFAULT 'absolute'
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
    ON user_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
    ON user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
    ON user_settings FOR UPDATE
    USING (auth.uid() = user_id);
```

- One row per user, created on first settings change.
- `line_number` stores `'absolute'` or `'relative'` (matching helix config values).
- If no row exists, all defaults apply.
- Future columns added directly to this table (e.g., `theme TEXT DEFAULT 'custom'`).

## Backend (Axum)

### Settings fetch during editor proxy

In `backend/src/routes/editor_service.rs`, when an authenticated user connects:

1. Use the user's JWT to fetch their `user_settings` row via PostgREST.
2. Append settings as query params to the editor-service WebSocket URL:
   ```
   ws://{editor_service_addr}/edit?start=...&goal=...&extension=...&line_number=relative
   ```
3. If no settings row exists or the user is a guest, omit the param. The editor-service falls back to defaults.

### New storage module

Add `backend/src/storage/user_settings.rs` with a function to fetch settings by user JWT via PostgREST, returning an `Option<UserSettings>` struct.

## Editor-Service

### Config generation

In `editor-service/src/editor.rs`:

1. Add optional `line_number: Option<String>` to the `Params` struct.
2. Before spawning helix, generate `config.toml` content:
   - Start from a hardcoded base config string (the current static values: theme, true-color, insert-final-newline, whitespace, auto-save).
   - If `line_number` is provided, insert `line-number = "{value}"` under the `[editor]` section.
3. Write the generated config to `tmp_dir.path().join("config.toml")`.
4. Update the bwrap bind mounts:
   - `tmp_dir/config.toml` → `/home/user/.config/helix/config.toml` (read-only)
   - Static themes dir → `/home/user/.config/helix/themes` (read-only, unchanged)

This replaces the current single `--ro-bind` of the entire `/root/.config/helix` directory with two separate binds.

### Temp file lifecycle

The generated config lives in the existing `TempDir` that the editor-service already creates per session. It is cleaned up automatically when the session ends and `TempDir` is dropped.

## Frontend

### New route: `/settings`

Added to the router in `frontend/src/main.tsx`.

### Settings page component

Simple card layout:

- Page heading: "Settings"
- Card titled "Editor" containing:
  - A row with label "Relative line numbers", description "Show line numbers relative to the cursor position", and a Radix UI Switch toggle.
- On mount: fetch `user_settings` from Supabase for `auth.uid()`. If no row, show defaults (toggle off).
- On toggle: upsert the `user_settings` row via Supabase client. No save button — changes persist immediately on toggle.

### Header dropdown

In `frontend/src/components/header.tsx`, add a "Settings" item with a gear icon (`Settings` from lucide-react) to the existing `DropdownMenuContent`, placed above the "Log out" item. Clicking navigates to `/settings`.

Only visible to authenticated users (the dropdown already only renders when `user` is truthy).

### No global state needed

Settings are only relevant on the settings page (for display/editing) and at editor spawn time (backend fetches them server-side). No Zustand store changes required.

## Data Flow Summary

```
User toggles setting on /settings
        │
        ▼
Frontend upserts user_settings row in Supabase
        │
        ▼
User opens editor (new session)
        │
        ▼
Frontend connects to /api/editor_service/edit?date=...&token=...
        │
        ▼
Backend decodes JWT, fetches user_settings via PostgREST
        │
        ▼
Backend connects to editor-service: ws://editor-service/edit?start=...&goal=...&extension=...&line_number=relative
        │
        ▼
Editor-service generates config.toml in TempDir, bind-mounts into sandbox
        │
        ▼
Helix spawns with user's config
```

## Files to Create or Modify

**Create:**
- `supabase/migrations/<timestamp>_add_user_settings.sql` — migration for new table + RLS
- `frontend/src/routes/settings.tsx` — settings page component
- `backend/src/storage/user_settings.rs` — PostgREST fetch for user settings

**Modify:**
- `frontend/src/main.tsx` — add `/settings` route
- `frontend/src/components/header.tsx` — add Settings item to dropdown
- `frontend/src/database.types.ts` — regenerate after migration
- `backend/src/routes/editor_service.rs` — fetch settings, pass to editor-service URL
- `backend/src/storage/mod.rs` — add `user_settings` module
- `editor-service/src/editor.rs` — accept `line_number` param, generate config, update bwrap binds

## Extensibility

Adding a new user setting (e.g., theme) involves:
1. Add a column to `user_settings` with a default value.
2. Add a toggle/select to the Settings page UI.
3. Add the param to the editor-service URL in the backend.
4. Handle the param in editor-service config generation.

No structural changes needed — the pattern scales linearly.
