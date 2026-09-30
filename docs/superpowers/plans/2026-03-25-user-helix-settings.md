# User-Based Helix Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated users toggle relative line numbers (and future editor settings) via a Settings page, persisted in Supabase and applied per-session when the helix editor spawns.

**Architecture:** New `user_settings` table in Supabase. Frontend Settings page reads/writes via Supabase client. Backend fetches settings via PostgREST and passes them as query params to the editor-service, which generates a per-session `config.toml` in its existing TempDir.

**Tech Stack:** Supabase (PostgreSQL + RLS), Rust/Axum backend, Rust editor-service, React/TypeScript frontend with Radix UI components.

---

## File Structure

**Create:**
- `supabase/migrations/<timestamp>_add_user_settings.sql` — migration for table + RLS
- `backend/src/storage/user_settings.rs` — PostgREST fetch for user settings
- `backend/src/schema/user_settings.rs` — UserSettings struct
- `frontend/src/routes/settings.tsx` — Settings page component

**Modify:**
- `backend/src/storage.rs` — add `user_settings` module declaration
- `backend/src/schema.rs` — add `user_settings` module declaration
- `backend/src/routes/editor_service.rs` — fetch settings, pass to editor-service URL
- `editor-service/src/editor.rs` — accept `line_number` param, generate config, update bwrap binds
- `frontend/src/main.tsx` — add `/settings` route
- `frontend/src/components/header.tsx` — add Settings item to profile dropdown
- `frontend/src/database.types.ts` — regenerate after migration

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/<timestamp>_add_user_settings.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Create user_settings table
CREATE TABLE user_settings (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    line_number TEXT NOT NULL DEFAULT 'absolute'
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Users can read their own settings
CREATE POLICY "Users can read own settings"
    ON user_settings FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own settings
CREATE POLICY "Users can insert own settings"
    ON user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own settings
CREATE POLICY "Users can update own settings"
    ON user_settings FOR UPDATE
    USING (auth.uid() = user_id);
```

Use the current timestamp for the filename, following the existing pattern (e.g., `20260325210000_add_user_settings.sql`).

- [ ] **Step 2: Apply migration locally**

Run: `supabase db reset` or `supabase migration up` (depending on local setup)
Expected: Migration applies without errors.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `supabase gen types typescript --local > frontend/src/database.types.ts`
Expected: `database.types.ts` now contains a `user_settings` table definition with `user_id: string` and `line_number: string`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_add_user_settings.sql frontend/src/database.types.ts
git commit -m "feat: add user_settings table with RLS policies"
```

---

### Task 2: Backend Schema and Storage

**Files:**
- Create: `backend/src/schema/user_settings.rs`
- Create: `backend/src/storage/user_settings.rs`
- Modify: `backend/src/schema.rs`
- Modify: `backend/src/storage.rs`

- [ ] **Step 1: Create the UserSettings schema struct**

Create `backend/src/schema/user_settings.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct UserSettings {
    pub user_id: String,
    pub line_number: String,
}
```

- [ ] **Step 2: Register the schema module**

In `backend/src/schema.rs`, add:

```rust
pub(super) mod user_settings;
```

- [ ] **Step 3: Create the storage module for fetching settings**

Create `backend/src/storage/user_settings.rs`:

```rust
use anyhow::Error;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use log::warn;

use crate::{
    schema::{claims::Claims, user_settings::UserSettings},
    state::AppState,
};

/// Fetches user settings for the authenticated user.
/// Returns None if no settings row exists (user uses defaults).
pub async fn select_by_token(state: &AppState, token: &str) -> Result<Option<UserSettings>, Error> {
    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_audience(["authenticated"].as_ref());
    let decoding_key = DecodingKey::from_ec_components(&state.config.x, &state.config.y)?;
    let verified_token = decode::<Claims>(token, &decoding_key, &validation)?;

    let response = state
        .postgrest
        .clone()
        .insert_header("Authorization", token)
        .from("user_settings")
        .auth(token)
        .select("user_id, line_number")
        .eq("user_id", verified_token.claims.sub)
        .execute()
        .await?;

    if response.status() != 200 {
        warn!("Error fetching user settings: {response:?}");
        return Ok(None);
    }

    let settings: Vec<UserSettings> = serde_json::from_str(&response.text().await?)?;
    Ok(settings.into_iter().next())
}
```

- [ ] **Step 4: Register the storage module**

In `backend/src/storage.rs`, add:

```rust
pub(super) mod user_settings;
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo check -p backend`
Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/schema/user_settings.rs backend/src/storage/user_settings.rs backend/src/schema.rs backend/src/storage.rs
git commit -m "feat: add user_settings schema and storage module"
```

---

### Task 3: Backend Passes Settings to Editor-Service

**Files:**
- Modify: `backend/src/routes/editor_service.rs`

- [ ] **Step 1: Add user_settings import**

At the top of `backend/src/routes/editor_service.rs`, add to the `crate` use block:

```rust
use crate::{
    schema::{
        scores::ScoreCreate,
        solutions::{Solution, SolutionCreate},
    },
    state::AppState,
    storage::{challenges, scores, solutions, user_settings},
};
```

- [ ] **Step 2: Fetch settings and append to editor-service URL**

In the `handle_editor_service_ws` function, after the future date check (after line 107) and before building the editor-service WebSocket URL (line 109), add the settings fetch. Then modify the URL construction to include the setting.

Replace lines 109-116 (the URL construction block):

```rust
    let encoded_start = general_purpose::URL_SAFE.encode(serde_json::to_string(&challenge.start)?);
    let encoded_goal = general_purpose::URL_SAFE.encode(serde_json::to_string(&challenge.goal)?);
    let extension = &challenge.extension;
    let request = format!(
        "ws://{}/{mode}?start={encoded_start}&goal={encoded_goal}&extension={extension}",
        state.config.editor_service_addr,
    )
    .into_client_request()?;
```

With:

```rust
    let encoded_start = general_purpose::URL_SAFE.encode(serde_json::to_string(&challenge.start)?);
    let encoded_goal = general_purpose::URL_SAFE.encode(serde_json::to_string(&challenge.goal)?);
    let extension = &challenge.extension;

    // Fetch user settings if authenticated
    let mut extra_params = String::new();
    if let Some(token) = &params.token {
        if let Ok(Some(settings)) = user_settings::select_by_token(&state, token).await {
            if settings.line_number != "absolute" {
                extra_params.push_str(&format!("&line_number={}", settings.line_number));
            }
        }
    }

    let request = format!(
        "ws://{}/{mode}?start={encoded_start}&goal={encoded_goal}&extension={extension}{extra_params}",
        state.config.editor_service_addr,
    )
    .into_client_request()?;
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p backend`
Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/editor_service.rs
git commit -m "feat: pass user settings to editor-service via query params"
```

---

### Task 4: Editor-Service Config Generation

**Files:**
- Modify: `editor-service/src/editor.rs`

- [ ] **Step 1: Add `line_number` to Params struct**

In `editor-service/src/editor.rs`, change the `Params` struct (lines 21-26):

```rust
#[derive(Deserialize, Debug)]
pub struct Params {
    pub start: String,
    pub goal: String,
    pub extension: String,
    pub line_number: Option<String>,
}
```

- [ ] **Step 2: Add config generation function**

Add this function to `editor-service/src/editor.rs`, before the `handle_editor_ws` function:

```rust
fn generate_config(line_number: &Option<String>) -> String {
    let line_number_setting = match line_number.as_deref() {
        Some("relative") => "\nline-number = \"relative\"",
        _ => "",
    };

    format!(
        r#"theme = "custom"

[editor]
true-color = true
insert-final-newline = false{line_number_setting}

[editor.whitespace]
render = "all"

[editor.whitespace.characters]
space = "·"
nbsp = "⍽"
nnbsp = "␣"
tab = "→"
newline = "⏎"
tabpad = "·"

[editor.auto-save.after-delay]
enable = true
timeout = 250
"#
    )
}
```

- [ ] **Step 3: Write config to TempDir and update bwrap binds**

In `handle_editor_ws`, after writing the start file (after line 53 `let file_path_str = ...`), add config generation:

```rust
    // Generate per-session helix config
    let config_path = tmp_dir.path().join("config.toml");
    let mut config_file = File::create(config_path.clone())?;
    config_file.write_all(generate_config(&params.line_number).as_bytes())?;
    let config_path_str = config_path
        .to_str()
        .expect("Unable to convert config path to string");
```

Then replace the bwrap command construction (lines 56-87) to use the per-session config instead of the static one:

```rust
    // Start bubblewrapped helix for the user.
    let mut cmd = Command::new("bwrap");
    cmd.args([
        "--ro-bind",
        "/usr/bin/helix",
        "/usr/bin/helix",
        "--ro-bind",
        "/lib/x86_64-linux-gnu",
        "/lib/x86_64-linux-gnu",
        "--ro-bind",
        "/lib64",
        "/lib64",
        "--proc",
        "/proc",
        "--die-with-parent",
        "--clearenv",
        "--tmpfs",
        "/home",
        "--setenv",
        "HOME",
        "/home/user",
        "--setenv",
        "TERM",
        "xterm",
        "--ro-bind",
        config_path_str,
        "/home/user/.config/helix/config.toml",
        "--ro-bind",
        "/root/.config/helix/themes",
        "/home/user/.config/helix/themes",
        "--bind",
        file_path_str,
        &format!("/home/user/start.{}", params.extension),
        "/usr/bin/helix",
        &format!("start.{}", params.extension),
    ]);
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p editor-service`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add editor-service/src/editor.rs
git commit -m "feat: generate per-session helix config with user settings"
```

---

### Task 5: Frontend Settings Page

**Files:**
- Create: `frontend/src/routes/settings.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Create the Settings page component**

Create `frontend/src/routes/settings.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/store";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
    const { user, supabase } = useAppStore();
    const navigate = useNavigate();
    const [relativeLineNumbers, setRelativeLineNumbers] = useState(false);
    const [loading, setLoading] = useState(true);

    // Redirect unauthenticated users
    useEffect(() => {
        if (!user) {
            navigate("/login");
        }
    }, [user, navigate]);

    // Fetch current settings
    useEffect(() => {
        if (!user) return;

        supabase
            .from("user_settings")
            .select("line_number")
            .eq("user_id", user.id)
            .maybeSingle()
            .then(({ data }) => {
                if (data) {
                    setRelativeLineNumbers(data.line_number === "relative");
                }
                setLoading(false);
            });
    }, [user, supabase]);

    const handleToggle = async (checked: boolean) => {
        if (!user) return;

        setRelativeLineNumbers(checked);
        const lineNumber = checked ? "relative" : "absolute";

        await supabase
            .from("user_settings")
            .upsert(
                { user_id: user.id, line_number: lineNumber },
                { onConflict: "user_id" },
            );
    };

    if (!user) return null;

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6">
                <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                    {"Settings"}
                </h1>
                <p className="max-w-2xl pt-2 pb-4 text-foreground">
                    {"Customize your editor experience. Changes apply to your next editor session."}
                </p>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            {"Editor"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="relative-line-numbers">
                                    {"Relative line numbers"}
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    {"Show line numbers relative to the cursor position"}
                                </p>
                            </div>
                            <Switch
                                id="relative-line-numbers"
                                checked={relativeLineNumbers}
                                onCheckedChange={handleToggle}
                                disabled={loading}
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Add the route to the router**

In `frontend/src/main.tsx`, add the import at the top:

```tsx
import Settings from "./routes/settings.tsx";
```

Then add the route inside the `children` array (before the closing `]`):

```tsx
            {
                path: "/settings",
                element: <Settings />,
            },
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && pnpm build`
Expected: Builds without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/settings.tsx frontend/src/main.tsx
git commit -m "feat: add settings page with relative line numbers toggle"
```

---

### Task 6: Header Dropdown Settings Link

**Files:**
- Modify: `frontend/src/components/header.tsx`

- [ ] **Step 1: Add Settings icon import**

In `frontend/src/components/header.tsx`, update the lucide-react import (line 3):

```tsx
import { Lightbulb, LogOut, Settings } from "lucide-react";
```

- [ ] **Step 2: Add Settings menu item to dropdown**

In the `DropdownMenuContent` block, add a Settings item between the second `<DropdownMenuSeparator />` (line 112) and the Log out `<DropdownMenuItem>` (line 113):

```tsx
                                        <DropdownMenuItem
                                            onClick={() => navigate("/settings")}
                                        >
                                            <Settings />
                                            {"Settings"}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && pnpm build`
Expected: Builds without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/header.tsx
git commit -m "feat: add settings link to profile dropdown menu"
```

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Start the local Supabase instance**

Run: `supabase start` (if not already running)
Expected: Supabase services start successfully.

- [ ] **Step 2: Apply migrations**

Run: `supabase db reset`
Expected: All migrations apply, including the new `user_settings` table.

- [ ] **Step 3: Build and test frontend**

Run: `cd frontend && pnpm build`
Expected: Builds without errors.

- [ ] **Step 4: Build backend**

Run: `cargo build -p backend`
Expected: Compiles without errors.

- [ ] **Step 5: Build editor-service**

Run: `cargo build -p editor-service`
Expected: Compiles without errors.

- [ ] **Step 6: Manual verification**

1. Start all services locally.
2. Log in with a GitHub account.
3. Click profile dropdown → verify "Settings" appears.
4. Navigate to `/settings` → verify the toggle shows (off by default).
5. Toggle relative line numbers on.
6. Open a challenge editor → verify helix shows relative line numbers.
7. Toggle off, open new editor → verify absolute line numbers.
8. As a guest (not logged in), open editor → verify defaults (absolute) still work.
