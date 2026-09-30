# User Challenge Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated users submit their own challenges (start + goal files), have them voted on by the community, and have a daily background worker promote the highest-voted entry into the daily `challenges` rotation.

**Architecture:** New `user_challenges` + `user_challenge_likes` tables with RLS. A Rust HTTP endpoint validates uploads (size, line count, line length, UTF-8, etc.) and inserts via PostgREST under the user's JWT. The existing `daily_worker` calls a Postgres `SECURITY DEFINER` function once per loop iteration to promote the top-ranked unpromoted entry into the `challenges` table for today's date (idempotent — no-op if a challenge already exists). Three new frontend routes: upload form (`/user-challenges/new`), public browse (`/user-challenges`), author dashboard (`/user-challenges/mine`).

**Tech Stack:** PostgreSQL (Supabase), Rust (axum, postgrest, jsonwebtoken), React, TypeScript, Supabase JS client, `@monaco-editor/react`, lucide-react, Radix UI / shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-28-user-challenge-upload-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260428000000_user_challenges.sql` | Tables, enums, RLS, RPC functions, realtime publication |
| Modify | `frontend/src/database.types.ts` | Add tables, RPC, and enum types |
| Create | `backend/src/schema/user_challenge.rs` | Request/response/validation-error types |
| Modify | `backend/src/schema.rs` | Register the new module |
| Create | `backend/src/storage/user_challenges.rs` | PostgREST insert helper (uses user JWT) |
| Modify | `backend/src/storage.rs` | Register the new module |
| Create | `backend/src/routes/user_challenges.rs` | Router + module exports |
| Create | `backend/src/routes/user_challenges/create.rs` | `POST /api/user_challenges` handler + validation |
| Modify | `backend/src/routes.rs` | Mount the new router |
| Modify | `backend/src/workers.rs` | Call `promote_user_challenge_for_date` after `reset_streaks` |
| Create | `frontend/src/components/user-challenge-likes.tsx` | Up/down vote control |
| Create | `frontend/src/components/user-challenge-preview.tsx` | Monaco read-only preview dialog |
| Create | `frontend/src/components/user-challenge-form.tsx` | Upload form (dual Monaco editors + metadata + submit) |
| Create | `frontend/src/components/user-challenge-list.tsx` | Shared table for browse and manage views |
| Create | `frontend/src/routes/user-challenges.tsx` | Public browse route |
| Create | `frontend/src/routes/user-challenges-new.tsx` | Upload route (auth-gated) |
| Create | `frontend/src/routes/user-challenges-mine.tsx` | Author dashboard route (auth-gated) |
| Modify | `frontend/src/main.tsx` | Register the three new routes |
| Modify | `frontend/src/components/header.tsx` | Add "User challenges" nav link |

---

### Task 1: Database Migration — Tables

**Files:**
- Create: `supabase/migrations/20260428000000_user_challenges.sql`

- [ ] **Step 1: Create migration file with the `user_challenges` table**

```sql
-- New enums for the browse RPC
CREATE TYPE public.user_challenge_filter AS ENUM (
    'most_recent',
    'most_liked',
    'most_disliked',
    'liked_by_me',
    'not_liked_by_me'
);

CREATE TYPE public.user_challenge_status AS ENUM (
    'all',
    'pending',
    'promoted'
);

-- User submissions
CREATE TABLE public.user_challenges (
    id SERIAL PRIMARY KEY,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
    start TEXT NOT NULL,
    goal TEXT NOT NULL,
    extension public.prog_extension NOT NULL CHECK (extension <> 'unknown'),
    title TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    promoted_at TIMESTAMPTZ,
    promoted_challenge_id INTEGER REFERENCES public.challenges(id) ON DELETE SET NULL,

    CHECK (start <> goal),
    CHECK (length(start) <= 1024 AND length(goal) <= 1024),
    CHECK (length(coalesce(title, '')) <= 80),
    CHECK (length(coalesce(description, '')) <= 500)
);

ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_challenges are visible to everyone."
ON public.user_challenges FOR SELECT
TO authenticated, anon
USING (TRUE);

CREATE POLICY "users can insert their own user_challenges"
ON public.user_challenges FOR INSERT
WITH CHECK (auth.uid() = author_id);

CREATE POLICY "users can delete their own unpromoted user_challenges"
ON public.user_challenges FOR DELETE
USING (auth.uid() = author_id AND promoted_at IS NULL);
```

- [ ] **Step 2: Add the `user_challenge_likes` table to the same migration file**

Append:

```sql
-- Likes on user submissions (mirrors challenge_likes structure)
CREATE TABLE public.user_challenge_likes (
    id SERIAL PRIMARY KEY,
    user_challenge_id INTEGER NOT NULL REFERENCES public.user_challenges(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) DEFAULT auth.uid() NOT NULL,
    reaction public.challenge_like NOT NULL,

    CONSTRAINT user_challenge_likes_unique UNIQUE (user_challenge_id, user_id)
);

ALTER TABLE public.user_challenge_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can like user_challenges"
ON public.user_challenge_likes FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can unlike their own likes"
ON public.user_challenge_likes FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "anyone can view user_challenge likes"
ON public.user_challenge_likes FOR SELECT
USING (TRUE);

ALTER PUBLICATION supabase_realtime ADD TABLE public.user_challenge_likes;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428000000_user_challenges.sql
git commit -m "feat: add user_challenges and user_challenge_likes tables"
```

---

### Task 2: Database Migration — RPCs

**Files:**
- Modify: `supabase/migrations/20260428000000_user_challenges.sql` (append)

- [ ] **Step 1: Add the toggle/state RPCs (mirror existing challenge_likes pattern)**

Append to the same migration file:

```sql
CREATE OR REPLACE FUNCTION public.toggle_user_challenge_reaction(
    p_user_challenge_id INTEGER,
    p_reaction public.challenge_like
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Same reaction → toggle off
    DELETE FROM public.user_challenge_likes
    WHERE user_challenge_id = p_user_challenge_id
      AND user_id = auth.uid()
      AND reaction = p_reaction;

    IF FOUND THEN
        RETURN;
    END IF;

    -- Different reaction or none → upsert
    INSERT INTO public.user_challenge_likes (user_challenge_id, reaction)
    VALUES (p_user_challenge_id, p_reaction)
    ON CONFLICT (user_challenge_id, user_id)
    DO UPDATE SET reaction = EXCLUDED.reaction;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_challenge_reaction_state(
    p_user_challenge_id INTEGER
)
RETURNS TABLE (
    up_count BIGINT,
    down_count BIGINT,
    my_reaction public.challenge_like
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        COUNT(*) FILTER (WHERE reaction = 'up')   AS up_count,
        COUNT(*) FILTER (WHERE reaction = 'down') AS down_count,
        MAX(
            CASE
                WHEN user_id = auth.uid() THEN reaction
                ELSE NULL
            END
        ) AS my_reaction
    FROM public.user_challenge_likes
    WHERE user_challenge_id = p_user_challenge_id;
$$;
```

- [ ] **Step 2: Add the public browse RPC `get_user_challenges`**

Append:

```sql
CREATE OR REPLACE FUNCTION public.get_user_challenges(
    filter_type public.user_challenge_filter DEFAULT 'most_recent',
    status_filter public.user_challenge_status DEFAULT 'all',
    extension_filter public.prog_extension DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER,
    author_id UUID,
    author_username TEXT,
    title TEXT,
    description TEXT,
    extension public.prog_extension,
    created_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    promoted_challenge_id INTEGER,
    promoted_challenge_date DATE,
    up_count BIGINT,
    down_count BIGINT,
    my_reaction public.challenge_like
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH stats AS (
        SELECT
            uc.id,
            uc.author_id,
            p.user_name AS author_username,
            uc.title,
            uc.description,
            uc.extension,
            uc.created_at,
            uc.promoted_at,
            uc.promoted_challenge_id,
            c.date AS promoted_challenge_date,
            COUNT(*) FILTER (WHERE l.reaction = 'up')   AS up_count,
            COUNT(*) FILTER (WHERE l.reaction = 'down') AS down_count,
            MAX(
                CASE
                    WHEN l.user_id = auth.uid() THEN l.reaction
                    ELSE NULL
                END
            ) AS my_reaction
        FROM public.user_challenges uc
        JOIN public.profiles p ON p.id = uc.author_id
        LEFT JOIN public.user_challenge_likes l ON l.user_challenge_id = uc.id
        LEFT JOIN public.challenges c ON c.id = uc.promoted_challenge_id
        GROUP BY uc.id, p.user_name, c.date
    )
    SELECT *
    FROM stats s
    WHERE
        CASE
            WHEN status_filter = 'pending'  THEN s.promoted_at IS NULL
            WHEN status_filter = 'promoted' THEN s.promoted_at IS NOT NULL
            ELSE TRUE
        END
        AND (extension_filter IS NULL OR s.extension = extension_filter)
        AND CASE
            WHEN filter_type = 'liked_by_me'     THEN s.my_reaction = 'up'
            WHEN filter_type = 'not_liked_by_me' THEN s.my_reaction IS DISTINCT FROM 'up'
            ELSE TRUE
        END
    ORDER BY
        CASE WHEN filter_type = 'most_liked'    THEN s.up_count   END DESC NULLS LAST,
        CASE WHEN filter_type = 'most_disliked' THEN s.down_count END DESC NULLS LAST,
        s.created_at DESC;
$$;
```

- [ ] **Step 3: Add the author dashboard RPC `get_my_user_challenges`**

Append:

```sql
CREATE OR REPLACE FUNCTION public.get_my_user_challenges()
RETURNS TABLE (
    id INTEGER,
    title TEXT,
    description TEXT,
    extension public.prog_extension,
    created_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    promoted_challenge_id INTEGER,
    promoted_challenge_date DATE,
    up_count BIGINT,
    down_count BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        uc.id,
        uc.title,
        uc.description,
        uc.extension,
        uc.created_at,
        uc.promoted_at,
        uc.promoted_challenge_id,
        c.date AS promoted_challenge_date,
        COUNT(*) FILTER (WHERE l.reaction = 'up')   AS up_count,
        COUNT(*) FILTER (WHERE l.reaction = 'down') AS down_count
    FROM public.user_challenges uc
    LEFT JOIN public.user_challenge_likes l ON l.user_challenge_id = uc.id
    LEFT JOIN public.challenges c ON c.id = uc.promoted_challenge_id
    WHERE uc.author_id = auth.uid()
    GROUP BY uc.id, c.date
    ORDER BY uc.created_at DESC;
$$;
```

- [ ] **Step 4: Add the promotion RPC `promote_user_challenge_for_date`**

Append:

```sql
CREATE OR REPLACE FUNCTION public.promote_user_challenge_for_date(
    target_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    picked_id INTEGER;
    picked_start TEXT;
    picked_goal TEXT;
    picked_extension public.prog_extension;
    new_challenge_id INTEGER;
BEGIN
    -- Pick the top-ranked unpromoted user_challenge
    SELECT
        uc.id,
        uc.start,
        uc.goal,
        uc.extension
    INTO
        picked_id,
        picked_start,
        picked_goal,
        picked_extension
    FROM public.user_challenges uc
    LEFT JOIN public.user_challenge_likes l ON l.user_challenge_id = uc.id
    WHERE uc.promoted_at IS NULL
    GROUP BY uc.id
    ORDER BY
        (COUNT(*) FILTER (WHERE l.reaction = 'up')
         - COUNT(*) FILTER (WHERE l.reaction = 'down')) DESC,
        uc.created_at ASC
    LIMIT 1;

    -- Queue empty
    IF picked_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Insert into challenges atomically — if a row already exists for
    -- target_date, ON CONFLICT skips the insert and we return NULL.
    INSERT INTO public.challenges (date, start, goal, extension)
    VALUES (target_date, picked_start, picked_goal, picked_extension)
    ON CONFLICT (date) DO NOTHING
    RETURNING id INTO new_challenge_id;

    IF new_challenge_id IS NULL THEN
        -- Another caller already promoted for this date.
        RETURN NULL;
    END IF;

    -- Mark the user_challenge as promoted
    UPDATE public.user_challenges
    SET promoted_at = now(),
        promoted_challenge_id = new_challenge_id
    WHERE id = picked_id;

    RETURN new_challenge_id;
END;
$$;
```

- [ ] **Step 5: Apply the migration locally**

Run: `cd /home/tom/keyglide-rewrite/supabase && supabase db reset`
Expected: Migration applies cleanly without errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260428000000_user_challenges.sql
git commit -m "feat: add user_challenges RPCs (toggle, state, browse, mine, promote)"
```

---

### Task 3: Manual Verification of the Promotion RPC

**Files:** none — this task only runs SQL against the local database.

- [ ] **Step 1: Insert two test user_challenges as different authors**

Run via the supabase SQL editor or `psql`:

```sql
-- Use seed users; tweak the UUIDs to match your local seed if different.
INSERT INTO public.user_challenges (author_id, start, goal, extension)
VALUES
    ((SELECT id FROM public.profiles LIMIT 1), 'a', 'b', 'js'),
    ((SELECT id FROM public.profiles LIMIT 1), 'c', 'd', 'js');
```

- [ ] **Step 2: Add 3 up-votes to one and 1 to the other (using different users)**

Mock by directly inserting into `user_challenge_likes` (RLS would normally block; bypass via `set role postgres`):

```sql
SET ROLE postgres;
-- Pick the lower id as the favorite
INSERT INTO public.user_challenge_likes (user_challenge_id, user_id, reaction)
SELECT (SELECT MIN(id) FROM public.user_challenges), id, 'up'
FROM public.profiles LIMIT 3;

INSERT INTO public.user_challenge_likes (user_challenge_id, user_id, reaction)
SELECT (SELECT MAX(id) FROM public.user_challenges), id, 'up'
FROM public.profiles LIMIT 1;
RESET ROLE;
```

- [ ] **Step 3: Run the promotion function for a fresh date**

```sql
SELECT public.promote_user_challenge_for_date('2099-01-01');
```

Expected: returns a non-null `INTEGER` (the new challenges.id). The favourite (lower id) row is the one promoted.

- [ ] **Step 4: Verify the database state**

```sql
SELECT id, promoted_at, promoted_challenge_id FROM public.user_challenges;
SELECT id, date FROM public.challenges WHERE date = '2099-01-01';
```

Expected: the favourite has `promoted_at` set and `promoted_challenge_id` set, the other has both `NULL`. A `challenges` row exists for `2099-01-01`.

- [ ] **Step 5: Run the function a second time for the same date**

```sql
SELECT public.promote_user_challenge_for_date('2099-01-01');
```

Expected: returns `NULL`. No new `challenges` row inserted. The other `user_challenge` is still unpromoted.

- [ ] **Step 6: Reset the database (do not commit fixture data)**

```bash
cd /home/tom/keyglide-rewrite/supabase && supabase db reset
```

No commit for this task — verification only.

---

### Task 4: TypeScript Database Types

**Files:**
- Modify: `frontend/src/database.types.ts`

- [ ] **Step 1: Add `user_challenges` table type**

Inside `public.Tables` (alphabetical order matters in this file — insert after the existing `solutions` block, before `user_settings`). The exact insertion line will depend on the file state; place it alphabetically.

```typescript
      user_challenges: {
        Row: {
          id: number
          author_id: string
          start: string
          goal: string
          extension: Database["public"]["Enums"]["prog_extension"]
          title: string | null
          description: string | null
          created_at: string
          promoted_at: string | null
          promoted_challenge_id: number | null
        }
        Insert: {
          id?: number
          author_id?: string
          start: string
          goal: string
          extension: Database["public"]["Enums"]["prog_extension"]
          title?: string | null
          description?: string | null
          created_at?: string
          promoted_at?: string | null
          promoted_challenge_id?: number | null
        }
        Update: {
          id?: number
          author_id?: string
          start?: string
          goal?: string
          extension?: Database["public"]["Enums"]["prog_extension"]
          title?: string | null
          description?: string | null
          created_at?: string
          promoted_at?: string | null
          promoted_challenge_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_challenges_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_challenges_promoted_challenge_id_fkey"
            columns: ["promoted_challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 2: Add `user_challenge_likes` table type**

Adjacent to the `user_challenges` block:

```typescript
      user_challenge_likes: {
        Row: {
          id: number
          user_challenge_id: number
          user_id: string
          reaction: Database["public"]["Enums"]["challenge_like"]
        }
        Insert: {
          id?: number
          user_challenge_id: number
          user_id?: string
          reaction: Database["public"]["Enums"]["challenge_like"]
        }
        Update: {
          id?: number
          user_challenge_id?: number
          user_id?: string
          reaction?: Database["public"]["Enums"]["challenge_like"]
        }
        Relationships: [
          {
            foreignKeyName: "user_challenge_likes_user_challenge_id_fkey"
            columns: ["user_challenge_id"]
            isOneToOne: false
            referencedRelation: "user_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_challenge_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 3: Add the four new RPC types**

In the `Functions` section (alphabetically placed):

```typescript
      get_my_user_challenges: {
        Args: never
        Returns: {
          id: number
          title: string | null
          description: string | null
          extension: Database["public"]["Enums"]["prog_extension"]
          created_at: string
          promoted_at: string | null
          promoted_challenge_id: number | null
          promoted_challenge_date: string | null
          up_count: number
          down_count: number
        }[]
      }
      get_user_challenge_reaction_state: {
        Args: { p_user_challenge_id: number }
        Returns: {
          up_count: number
          down_count: number
          my_reaction: Database["public"]["Enums"]["challenge_like"] | null
        }[]
      }
      get_user_challenges: {
        Args: {
          filter_type?: Database["public"]["Enums"]["user_challenge_filter"]
          status_filter?: Database["public"]["Enums"]["user_challenge_status"]
          extension_filter?: Database["public"]["Enums"]["prog_extension"] | null
        }
        Returns: {
          id: number
          author_id: string
          author_username: string
          title: string | null
          description: string | null
          extension: Database["public"]["Enums"]["prog_extension"]
          created_at: string
          promoted_at: string | null
          promoted_challenge_id: number | null
          promoted_challenge_date: string | null
          up_count: number
          down_count: number
          my_reaction: Database["public"]["Enums"]["challenge_like"] | null
        }[]
      }
      promote_user_challenge_for_date: {
        Args: { target_date: string }
        Returns: number | null
      }
      toggle_user_challenge_reaction: {
        Args: {
          p_user_challenge_id: number
          p_reaction: Database["public"]["Enums"]["challenge_like"]
        }
        Returns: undefined
      }
```

- [ ] **Step 4: Add the two new enums in the `Enums` block**

```typescript
      user_challenge_filter:
        | "most_recent"
        | "most_liked"
        | "most_disliked"
        | "liked_by_me"
        | "not_liked_by_me"
      user_challenge_status: "all" | "pending" | "promoted"
```

And add the matching arrays in the bottom `Constants`/enum-values block (search for `prog_extension: [`); add:

```typescript
      user_challenge_filter: [
        "most_recent",
        "most_liked",
        "most_disliked",
        "liked_by_me",
        "not_liked_by_me",
      ],
      user_challenge_status: ["all", "pending", "promoted"],
```

- [ ] **Step 5: Verify the file compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No new errors related to `database.types.ts`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/database.types.ts
git commit -m "feat: add typescript types for user_challenges tables, enums, and RPCs"
```

---

### Task 5: Backend Schema Types

**Files:**
- Create: `backend/src/schema/user_challenge.rs`
- Modify: `backend/src/schema.rs`

- [ ] **Step 1: Create the schema file**

```rust
use serde::{Deserialize, Serialize};

/// Validation rules — keep in sync with the migration's CHECK constraints
/// and the frontend client-side validator.
pub const MAX_FILE_BYTES: usize = 1024;
pub const MAX_LINES: usize = 50;
pub const MAX_LINE_CHARS: usize = 200;
pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_DESCRIPTION_CHARS: usize = 500;

/// Allowed `prog_extension` values, excluding `unknown`.
pub const ALLOWED_EXTENSIONS: &[&str] = &[
    "js", "ts", "py", "cpp", "java", "rb", "go", "rs", "php", "swift",
];

#[derive(Debug, Clone, Serialize)]
pub struct CreateUserChallengeResponse {
    pub id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserChallengeInsert<'a> {
    pub author_id: &'a str,
    pub start: &'a str,
    pub goal: &'a str,
    pub extension: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<&'a str>,
}

/// Field that triggered the validation error, used by the frontend
/// to highlight the right input.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorField {
    StartFile,
    GoalFile,
    Extension,
    Title,
    Description,
    Auth,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub enum ErrorCode {
    MissingField,
    InvalidEncoding,
    InvalidExtension,
    FileTooLarge,
    TooManyLines,
    LineTooLong,
    EmptyFile,
    WhitespaceOnly,
    StartEqualsGoal,
    TitleTooLong,
    DescriptionTooLong,
    Unauthorized,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationErrorBody {
    pub error: ErrorCode,
    pub message: String,
    pub field: ErrorField,
}
```

- [ ] **Step 2: Register the module**

In `backend/src/schema.rs`, add:

```rust
pub mod user_challenge;
```

(Sorted alphabetically with the existing entries.)

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/backend && cargo check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/schema/user_challenge.rs backend/src/schema.rs
git commit -m "feat: add user_challenge schema types and validation constants"
```

---

### Task 6: Backend Validation Helper — TDD

**Files:**
- Create: `backend/src/routes/user_challenges.rs` (router skeleton + helper)
- Modify: `backend/src/routes/user_challenges.rs` (add tests + helper body)

- [ ] **Step 1: Create the router file with module skeleton and a stub validator**

```rust
use axum::{routing::post, Router};

use crate::state::AppState;

pub mod create;

pub(super) fn router(state: AppState) -> Router {
    Router::new()
        .route("/user_challenges", post(create::create_user_challenge))
        .with_state(state)
}

/// Result of validating a single uploaded file's content.
/// Public for unit testing.
pub fn validate_file_content(
    bytes: &[u8],
) -> Result<String, FileValidationError> {
    use crate::schema::user_challenge::{MAX_FILE_BYTES, MAX_LINES, MAX_LINE_CHARS};

    if bytes.len() > MAX_FILE_BYTES {
        return Err(FileValidationError::FileTooLarge);
    }

    let s = std::str::from_utf8(bytes)
        .map_err(|_| FileValidationError::InvalidEncoding)?;

    let trimmed = s.trim();
    if trimmed.is_empty() {
        // Empty bytes vs whitespace-only: both rejected, but with different codes.
        return if s.is_empty() {
            Err(FileValidationError::EmptyFile)
        } else {
            Err(FileValidationError::WhitespaceOnly)
        };
    }

    let lines: Vec<&str> = s.lines().collect();
    if lines.len() > MAX_LINES {
        return Err(FileValidationError::TooManyLines);
    }
    for line in &lines {
        if line.chars().count() > MAX_LINE_CHARS {
            return Err(FileValidationError::LineTooLong);
        }
    }

    Ok(s.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub enum FileValidationError {
    FileTooLarge,
    InvalidEncoding,
    EmptyFile,
    WhitespaceOnly,
    TooManyLines,
    LineTooLong,
}
```

The `pub mod create;` declaration references `create.rs`, which we'll create in Task 7. Until then, `cargo check` will fail; we'll add a stub at the end of this step so tests compile.

Create `backend/src/routes/user_challenges/create.rs` with a placeholder so the module resolves:

```rust
use axum::response::IntoResponse;
use http::StatusCode;

pub async fn create_user_challenge() -> impl IntoResponse {
    StatusCode::NOT_IMPLEMENTED
}
```

- [ ] **Step 2: Write the failing tests for `validate_file_content`**

Append to `backend/src/routes/user_challenges.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_files_over_1kb() {
        let big = vec![b'a'; 1025];
        assert_eq!(
            validate_file_content(&big),
            Err(FileValidationError::FileTooLarge)
        );
    }

    #[test]
    fn rejects_invalid_utf8() {
        let bytes = vec![0xff, 0xfe, 0xfd];
        assert_eq!(
            validate_file_content(&bytes),
            Err(FileValidationError::InvalidEncoding)
        );
    }

    #[test]
    fn rejects_empty_file() {
        assert_eq!(
            validate_file_content(b""),
            Err(FileValidationError::EmptyFile)
        );
    }

    #[test]
    fn rejects_whitespace_only() {
        assert_eq!(
            validate_file_content(b"   \n  \t\n"),
            Err(FileValidationError::WhitespaceOnly)
        );
    }

    #[test]
    fn rejects_too_many_lines() {
        // 51 newlines → 52 elements after split, all empty after first
        let mut content = String::new();
        for i in 0..51 {
            content.push_str(&format!("line {i}\n"));
        }
        assert_eq!(
            validate_file_content(content.as_bytes()),
            Err(FileValidationError::TooManyLines)
        );
    }

    #[test]
    fn rejects_line_too_long() {
        let line = "a".repeat(201);
        assert_eq!(
            validate_file_content(line.as_bytes()),
            Err(FileValidationError::LineTooLong)
        );
    }

    #[test]
    fn accepts_a_valid_short_file() {
        let content = b"const x = 1;\nconst y = 2;\n";
        assert!(validate_file_content(content).is_ok());
    }

    #[test]
    fn accepts_exactly_at_limits() {
        // exactly 1024 bytes, exactly 50 lines, exactly 200 chars per line
        let mut content = String::new();
        // 50 lines of "x" (1 char + newline = 2 bytes per line, 100 bytes total)
        for _ in 0..50 {
            content.push_str("x\n");
        }
        assert!(validate_file_content(content.as_bytes()).is_ok());

        let mut at_max = "a".repeat(200);
        at_max.push('\n');
        assert!(validate_file_content(at_max.as_bytes()).is_ok());
    }
}
```

- [ ] **Step 3: Register the new route module**

In `backend/src/routes.rs`, after the existing `pub(crate) mod duel;` line, add:

```rust
pub(crate) mod user_challenges;
```

- [ ] **Step 4: Run the tests**

Run: `cd /home/tom/keyglide-rewrite/backend && cargo test --lib routes::user_challenges`
Expected: All eight tests pass. (The validator implementation in Step 1 is already complete; this is a "test the working code" check.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/user_challenges.rs backend/src/routes/user_challenges/create.rs backend/src/routes.rs
git commit -m "feat: add user_challenges module skeleton with validation tests"
```

---

### Task 7: Backend Storage Helper

**Files:**
- Create: `backend/src/storage/user_challenges.rs`
- Modify: `backend/src/storage.rs`

- [ ] **Step 1: Create the storage helper**

```rust
use anyhow::{anyhow, Error};
use log::error;
use serde::Deserialize;

use crate::{schema::user_challenge::UserChallengeInsert, state::AppState};

#[derive(Deserialize)]
struct InsertedRow {
    id: i64,
}

/// Insert a new user_challenge using the user's JWT so RLS enforces
/// `auth.uid() = author_id`.
pub async fn insert(
    state: &AppState,
    jwt: &str,
    payload: UserChallengeInsert<'_>,
) -> Result<i64, Error> {
    let body = serde_json::to_string(&payload)?;

    let response = state
        .postgrest
        .clone()
        .from("user_challenges")
        .auth(jwt)
        .insert(body)
        .single()
        .execute()
        .await?;

    let status = response.status();
    let text = response.text().await?;

    if !status.is_success() {
        error!("Error inserting user_challenge ({status}): {text}");
        return Err(anyhow!("postgrest insert failed: {status}"));
    }

    let row: InsertedRow = serde_json::from_str(&text)
        .map_err(|e| anyhow!("could not parse insert response: {e} body={text}"))?;
    Ok(row.id)
}
```

- [ ] **Step 2: Register the module**

In `backend/src/storage.rs`, add `pub mod user_challenges;` (alphabetically with the existing entries).

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/backend && cargo check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/storage/user_challenges.rs backend/src/storage.rs
git commit -m "feat: add storage helper for inserting user_challenges with user JWT"
```

---

### Task 8: Backend POST Route — `create_user_challenge`

**Files:**
- Modify: `backend/src/routes/user_challenges/create.rs` (replace stub)

- [ ] **Step 1: Replace the stub with the full handler**

Replace the entire contents of `backend/src/routes/user_challenges/create.rs`:

```rust
use axum::{
    extract::{Multipart, State},
    response::IntoResponse,
    Json,
};
use http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use log::{error, warn};

use crate::{
    routes::user_challenges::{validate_file_content, FileValidationError},
    schema::{
        claims::Claims,
        user_challenge::{
            CreateUserChallengeResponse, ErrorCode, ErrorField, UserChallengeInsert,
            ValidationErrorBody, ALLOWED_EXTENSIONS, MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS,
        },
    },
    state::AppState,
    storage,
};

fn err_response(
    status: StatusCode,
    code: ErrorCode,
    message: &str,
    field: ErrorField,
) -> axum::response::Response {
    let body = ValidationErrorBody {
        error: code,
        message: message.to_string(),
        field,
    };
    (status, Json(body)).into_response()
}

fn extract_jwt(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn map_file_err(err: FileValidationError, field: ErrorField, label: &str) -> axum::response::Response {
    let (code, message, status) = match err {
        FileValidationError::FileTooLarge => (
            ErrorCode::FileTooLarge,
            format!("{label} file exceeds 1KB size limit"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::InvalidEncoding => (
            ErrorCode::InvalidEncoding,
            format!("{label} file is not valid UTF-8"),
            StatusCode::BAD_REQUEST,
        ),
        FileValidationError::EmptyFile => (
            ErrorCode::EmptyFile,
            format!("{label} file is empty"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::WhitespaceOnly => (
            ErrorCode::WhitespaceOnly,
            format!("{label} file contains only whitespace"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::TooManyLines => (
            ErrorCode::TooManyLines,
            format!("{label} file exceeds 50 lines"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        FileValidationError::LineTooLong => (
            ErrorCode::LineTooLong,
            format!("{label} file has a line longer than 200 characters"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    };
    err_response(status, code, &message, field)
}

pub async fn create_user_challenge(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // 1. Extract and verify JWT
    let token = match extract_jwt(&headers) {
        Some(t) => t,
        None => {
            return err_response(
                StatusCode::UNAUTHORIZED,
                ErrorCode::Unauthorized,
                "Missing or malformed Authorization header",
                ErrorField::Auth,
            );
        }
    };

    let user_id = {
        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_audience(["authenticated"].as_ref());
        let decoding_key = match DecodingKey::from_ec_components(&state.config.x, &state.config.y) {
            Ok(k) => k,
            Err(e) => {
                error!("Invalid decoding key components: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Server configuration error")
                    .into_response();
            }
        };
        match decode::<Claims>(&token, &decoding_key, &validation) {
            Ok(t) => t.claims.sub,
            Err(e) => {
                warn!("JWT verification failed: {e}");
                return err_response(
                    StatusCode::UNAUTHORIZED,
                    ErrorCode::Unauthorized,
                    "Invalid authentication token",
                    ErrorField::Auth,
                );
            }
        }
    };

    // 2. Pull multipart fields
    let mut start_bytes: Option<Vec<u8>> = None;
    let mut goal_bytes: Option<Vec<u8>> = None;
    let mut extension: Option<String> = None;
    let mut title: Option<String> = None;
    let mut description: Option<String> = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                warn!("Multipart parsing error: {e}");
                return err_response(
                    StatusCode::BAD_REQUEST,
                    ErrorCode::MissingField,
                    "Malformed multipart body",
                    ErrorField::StartFile,
                );
            }
        };
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "startFile" => match field.bytes().await {
                Ok(b) => start_bytes = Some(b.to_vec()),
                Err(_) => {
                    return err_response(
                        StatusCode::BAD_REQUEST,
                        ErrorCode::MissingField,
                        "Could not read startFile bytes",
                        ErrorField::StartFile,
                    );
                }
            },
            "goalFile" => match field.bytes().await {
                Ok(b) => goal_bytes = Some(b.to_vec()),
                Err(_) => {
                    return err_response(
                        StatusCode::BAD_REQUEST,
                        ErrorCode::MissingField,
                        "Could not read goalFile bytes",
                        ErrorField::GoalFile,
                    );
                }
            },
            "extension" => extension = field.text().await.ok(),
            "title" => title = field.text().await.ok(),
            "description" => description = field.text().await.ok(),
            _ => {}
        }
    }

    // 3. Validate required fields presence
    let start_bytes = match start_bytes {
        Some(b) => b,
        None => {
            return err_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::MissingField,
                "Start file is required",
                ErrorField::StartFile,
            );
        }
    };
    let goal_bytes = match goal_bytes {
        Some(b) => b,
        None => {
            return err_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::MissingField,
                "Goal file is required",
                ErrorField::GoalFile,
            );
        }
    };
    let extension = match extension.as_deref().map(str::trim) {
        Some(e) if !e.is_empty() => e.to_string(),
        _ => {
            return err_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::MissingField,
                "Extension is required",
                ErrorField::Extension,
            );
        }
    };

    // 4. Validate extension whitelist
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return err_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidExtension,
            "Extension is not in the allowed list",
            ErrorField::Extension,
        );
    }

    // 5. Validate file contents
    let start_str = match validate_file_content(&start_bytes) {
        Ok(s) => s,
        Err(e) => return map_file_err(e, ErrorField::StartFile, "Start"),
    };
    let goal_str = match validate_file_content(&goal_bytes) {
        Ok(s) => s,
        Err(e) => return map_file_err(e, ErrorField::GoalFile, "Goal"),
    };

    // 6. Cross-file rule
    if start_str == goal_str {
        return err_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::StartEqualsGoal,
            "Start and goal must be different",
            ErrorField::GoalFile,
        );
    }

    // 7. Validate optional metadata
    let title = title.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(t) = &title {
        if t.chars().count() > MAX_TITLE_CHARS {
            return err_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::TitleTooLong,
                "Title exceeds 80 characters",
                ErrorField::Title,
            );
        }
    }
    let description = description.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(d) = &description {
        if d.chars().count() > MAX_DESCRIPTION_CHARS {
            return err_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::DescriptionTooLong,
                "Description exceeds 500 characters",
                ErrorField::Description,
            );
        }
    }

    // 8. Insert via PostgREST
    let payload = UserChallengeInsert {
        author_id: &user_id,
        start: &start_str,
        goal: &goal_str,
        extension: &extension,
        title: title.as_deref(),
        description: description.as_deref(),
    };

    match storage::user_challenges::insert(&state, &token, payload).await {
        Ok(id) => (StatusCode::CREATED, Json(CreateUserChallengeResponse { id })).into_response(),
        Err(e) => {
            error!("Failed to insert user_challenge: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save challenge").into_response()
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/backend && cargo check`
Expected: No errors.

- [ ] **Step 3: Run the existing test suite**

Run: `cd /home/tom/keyglide-rewrite/backend && cargo test --lib`
Expected: All eight validator tests still pass; nothing else broken.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/user_challenges/create.rs
git commit -m "feat: add POST /api/user_challenges handler with full validation"
```

---

### Task 9: Mount the New Router

**Files:**
- Modify: `backend/src/routes.rs`

- [ ] **Step 1: Mount `user_challenges::router` alongside the existing routers**

In `backend/src/routes.rs`, change the `Router::new().nest_service(...)` block. The current code:

```rust
Router::new()
    .nest_service(
        "/api",
        editor_service::router(state.clone()).merge(duel::router(state)),
    )
    .fallback(frontend_handler)
```

Replace with:

```rust
Router::new()
    .nest_service(
        "/api",
        editor_service::router(state.clone())
            .merge(duel::router(state.clone()))
            .merge(user_challenges::router(state)),
    )
    .fallback(frontend_handler)
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/backend && cargo check`
Expected: No errors.

- [ ] **Step 3: Smoke test the endpoint**

Run the backend in one shell: `cd /home/tom/keyglide-rewrite/backend && cargo run`

In another shell, hit the unauthenticated endpoint:
```bash
curl -i -X POST http://localhost:3000/api/user_challenges
```
Expected: HTTP 401 with the JSON `{"error":"Unauthorized","message":"Missing or malformed Authorization header","field":"auth"}`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes.rs
git commit -m "feat: mount user_challenges router under /api"
```

---

### Task 10: Wire Promotion Into the Daily Worker

**Files:**
- Modify: `backend/src/workers.rs`

- [ ] **Step 1: Add the helper that calls the promotion RPC**

Append to `backend/src/workers.rs`:

```rust
async fn promote_user_challenge(state: &AppState) -> anyhow::Result<()> {
    let today = Utc::now().date_naive();
    let body = json!({ "target_date": today.to_string() }).to_string();

    let response = state
        .postgrest
        .rpc("promote_user_challenge_for_date", body)
        .auth(&state.config.secret_key)
        .execute()
        .await?;

    let status = response.status();
    let text = response.text().await?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "promote_user_challenge_for_date failed ({status}): {text}"
        ));
    }

    let trimmed = text.trim();
    if trimmed == "null" || trimmed.is_empty() {
        info!("user_challenge queue empty (or {today} already filled), skipping promotion.");
    } else {
        info!("Promoted user_challenge into challenges row id={trimmed} for {today}.");
    }
    Ok(())
}
```

- [ ] **Step 2: Call it after `reset_streaks` inside the loop**

In the `daily_worker` function, after the existing block:
```rust
        if let Err(e) = reset_streaks(&state).await {
            error!("Error running streak reset worker: {e}");
        }
```
Add:
```rust
        if let Err(e) = promote_user_challenge(&state).await {
            error!("Error running user_challenge promotion: {e}");
        }
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/backend && cargo check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/workers.rs
git commit -m "feat: promote top-voted user_challenge from daily worker"
```

---

### Task 11: Frontend — User Challenge Likes Component

**Files:**
- Create: `frontend/src/components/user-challenge-likes.tsx`

- [ ] **Step 1: Create the component (mirrors `challenge-likes.tsx`)**

```tsx
import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { useAppStore } from "@/store";
import { Database } from "@/database.types";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./ui/tooltip";

type Reaction = Database["public"]["Enums"]["challenge_like"];

interface UserChallengeLikesProps {
    userChallengeId: number;
}

export function UserChallengeLikes({ userChallengeId }: UserChallengeLikesProps) {
    const { supabase, user } = useAppStore();

    const [likes, setLikes] = useState<number>(0);
    const [dislikes, setDislikes] = useState<number>(0);
    const [userReaction, setUserReaction] = useState<Reaction | null>(null);

    const fetchState = async () => {
        const { data, error } = await supabase.rpc(
            "get_user_challenge_reaction_state",
            { p_user_challenge_id: userChallengeId },
        );

        if (error || !data?.[0]) return;

        setLikes(data[0].up_count);
        setDislikes(data[0].down_count);
        setUserReaction(data[0].my_reaction);
    };

    useEffect(() => {
        fetchState();

        const channel = supabase
            .channel(`user-challenge-likes-${userChallengeId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "user_challenge_likes",
                    filter: `user_challenge_id=eq.${userChallengeId}`,
                },
                fetchState,
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userChallengeId]);

    const toggle = async (reaction: Reaction) => {
        await supabase.rpc("toggle_user_challenge_reaction", {
            p_user_challenge_id: userChallengeId,
            p_reaction: reaction,
        });
    };

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div>
                        <ButtonGroup
                            orientation="horizontal"
                            aria-label="User challenge reactions"
                        >
                            <Button
                                variant={
                                    userReaction === "up"
                                        ? "default"
                                        : "outline"
                                }
                                size="sm"
                                onClick={() => toggle("up")}
                                disabled={user === null}
                            >
                                <ThumbsUp />
                                {likes}
                            </Button>

                            <Button
                                variant={
                                    userReaction === "down"
                                        ? "destructive"
                                        : "outline"
                                }
                                size="sm"
                                onClick={() => toggle("down")}
                                disabled={user === null}
                            >
                                <ThumbsDown />
                                {dislikes}
                            </Button>
                        </ButtonGroup>
                    </div>
                </TooltipTrigger>
                {!user && (
                    <TooltipContent>
                        <span>{"You need to login to vote."}</span>
                    </TooltipContent>
                )}
            </Tooltip>
        </TooltipProvider>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to `user-challenge-likes.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/user-challenge-likes.tsx
git commit -m "feat: add UserChallengeLikes voting component"
```

---

### Task 12: Frontend — Preview Dialog Component

**Files:**
- Create: `frontend/src/components/user-challenge-preview.tsx`

- [ ] **Step 1: Create the component**

```tsx
import Editor from "@monaco-editor/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Database } from "@/database.types";

type Extension = Database["public"]["Enums"]["prog_extension"];

const EXT_TO_LANGUAGE: Record<Extension, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    cpp: "cpp",
    java: "java",
    rb: "ruby",
    go: "go",
    rs: "rust",
    php: "php",
    swift: "swift",
    unknown: "plaintext",
};

interface UserChallengePreviewProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    start: string;
    goal: string;
    extension: Extension;
    title?: string | null;
}

export function UserChallengePreview(props: UserChallengePreviewProps) {
    const language = EXT_TO_LANGUAGE[props.extension] ?? "plaintext";

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-7xl">
                <DialogHeader>
                    <DialogTitle>
                        {props.title || "User challenge preview"}
                    </DialogTitle>
                    <DialogDescription>
                        {
                            "Preview the start and goal files of this user-submitted challenge."
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 h-[500px]">
                    <div className="flex flex-col border rounded-md overflow-hidden">
                        <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                            {"Start"}
                        </div>
                        <Editor
                            height="100%"
                            language={language}
                            value={props.start}
                            theme="vs-dark"
                            options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                fontSize: 14,
                                scrollBeyondLastLine: false,
                            }}
                        />
                    </div>
                    <div className="flex flex-col border rounded-md overflow-hidden">
                        <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                            {"Goal"}
                        </div>
                        <Editor
                            height="100%"
                            language={language}
                            value={props.goal}
                            theme="vs-dark"
                            options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                fontSize: 14,
                                scrollBeyondLastLine: false,
                            }}
                        />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { EXT_TO_LANGUAGE };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to `user-challenge-preview.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/user-challenge-preview.tsx
git commit -m "feat: add UserChallengePreview Monaco read-only dialog"
```

---

### Task 13: Frontend — Upload Form Component

**Files:**
- Create: `frontend/src/components/user-challenge-form.tsx`

- [ ] **Step 1: Add a Textarea primitive if it does not exist**

Check whether `frontend/src/components/ui/textarea.tsx` exists. If it doesn't (`ls frontend/src/components/ui/textarea.tsx` errors), create it:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
    return (
        <textarea
            className={cn(
                "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
                className,
            )}
            ref={ref}
            {...props}
        />
    );
});
Textarea.displayName = "Textarea";

export { Textarea };
```

If it already exists, skip creation.

- [ ] **Step 2: Create the form component**

```tsx
import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { Database, Constants } from "@/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { EXT_TO_LANGUAGE } from "./user-challenge-preview";

type Extension = Database["public"]["Enums"]["prog_extension"];

const MAX_FILE_BYTES = 1024;
const MAX_LINES = 50;
const MAX_LINE_CHARS = 200;
const MAX_TITLE_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 500;

const ALLOWED_EXTENSIONS: Extension[] = (Constants.public.Enums.prog_extension as Extension[])
    .filter((e) => e !== "unknown");

type FieldKey = "startFile" | "goalFile" | "extension" | "title" | "description";

type FormErrors = Partial<Record<FieldKey, string>>;

function byteLength(s: string): number {
    return new TextEncoder().encode(s).length;
}

function validateFile(content: string): string | null {
    if (byteLength(content) > MAX_FILE_BYTES) return "File exceeds 1KB";
    if (content.trim().length === 0) return "File cannot be empty or whitespace only";
    const lines = content.split("\n");
    if (lines.length > MAX_LINES) return `File exceeds ${MAX_LINES} lines`;
    if (lines.some((line) => Array.from(line).length > MAX_LINE_CHARS))
        return `Some line exceeds ${MAX_LINE_CHARS} characters`;
    return null;
}

interface UserChallengeFormProps {
    onSuccess?: (id: number) => void;
}

export function UserChallengeForm({ onSuccess }: UserChallengeFormProps) {
    const { supabase } = useAppStore();
    const navigate = useNavigate();

    const [startContent, setStartContent] = useState("");
    const [goalContent, setGoalContent] = useState("");
    const [extension, setExtension] = useState<Extension>("js");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");

    const [errors, setErrors] = useState<FormErrors>({});
    const [submitting, setSubmitting] = useState(false);
    const [topLevelError, setTopLevelError] = useState<string | null>(null);

    const language = EXT_TO_LANGUAGE[extension] ?? "plaintext";

    const localValid = useMemo<FormErrors>(() => {
        const errs: FormErrors = {};
        const startErr = validateFile(startContent);
        if (startErr) errs.startFile = startErr;
        const goalErr = validateFile(goalContent);
        if (goalErr) errs.goalFile = goalErr;
        if (!errs.startFile && !errs.goalFile && startContent === goalContent) {
            errs.goalFile = "Start and goal must be different";
        }
        if (title.length > MAX_TITLE_CHARS) errs.title = `Title exceeds ${MAX_TITLE_CHARS} characters`;
        if (description.length > MAX_DESCRIPTION_CHARS)
            errs.description = `Description exceeds ${MAX_DESCRIPTION_CHARS} characters`;
        return errs;
    }, [startContent, goalContent, title, description]);

    const isValid = Object.keys(localValid).length === 0
        && startContent.length > 0
        && goalContent.length > 0;

    const handleSubmit = async () => {
        if (!isValid || submitting) return;
        setSubmitting(true);
        setErrors({});
        setTopLevelError(null);

        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) {
            navigate("/login");
            return;
        }

        const fd = new FormData();
        fd.append("startFile", new Blob([startContent], { type: "text/plain" }), "start");
        fd.append("goalFile", new Blob([goalContent], { type: "text/plain" }), "goal");
        fd.append("extension", extension);
        if (title.trim()) fd.append("title", title.trim());
        if (description.trim()) fd.append("description", description.trim());

        try {
            const res = await fetch("/api/user_challenges", {
                method: "POST",
                body: fd,
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.status === 201) {
                const body: { id: number } = await res.json();
                onSuccess?.(body.id);
                navigate("/user-challenges/mine");
                return;
            }

            if (res.status === 401) {
                navigate("/login");
                return;
            }

            // Try to parse a structured error
            try {
                const body: { error: string; message: string; field: string } = await res.json();
                const fieldKey = body.field as FieldKey;
                if (fieldKey) {
                    setErrors({ [fieldKey]: body.message });
                } else {
                    setTopLevelError(body.message);
                }
            } catch {
                setTopLevelError("Server error — please try again.");
            }
        } catch (e) {
            setTopLevelError("Network error — please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const startErr = errors.startFile ?? localValid.startFile;
    const goalErr = errors.goalFile ?? localValid.goalFile;
    const titleErr = errors.title ?? localValid.title;
    const descriptionErr = errors.description ?? localValid.description;
    const extensionErr = errors.extension;

    return (
        <div className="flex flex-col gap-4">
            {topLevelError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {topLevelError}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">{"Title (optional)"}</label>
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={MAX_TITLE_CHARS + 20}
                        placeholder="e.g. Refactor this for-loop"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{titleErr ?? ""}</span>
                        <span>{`${title.length}/${MAX_TITLE_CHARS}`}</span>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">{"Extension"}</label>
                    <Select value={extension} onValueChange={(v) => setExtension(v as Extension)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ALLOWED_EXTENSIONS.map((e) => (
                                <SelectItem key={e} value={e}>{e}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {extensionErr && (
                        <span className="text-xs text-destructive">{extensionErr}</span>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">{"Description (optional)"}</label>
                <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={MAX_DESCRIPTION_CHARS + 50}
                    placeholder="What should the player learn or practice?"
                    className="resize-none"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{descriptionErr ?? ""}</span>
                    <span>{`${description.length}/${MAX_DESCRIPTION_CHARS}`}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-[400px]">
                <div className="flex flex-col border rounded-md overflow-hidden">
                    <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                        {"Start file"}
                    </div>
                    <Editor
                        height="100%"
                        language={language}
                        value={startContent}
                        onChange={(v) => setStartContent(v ?? "")}
                        theme="vs-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            scrollBeyondLastLine: false,
                        }}
                    />
                </div>
                <div className="flex flex-col border rounded-md overflow-hidden">
                    <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                        {"Goal file"}
                    </div>
                    <Editor
                        height="100%"
                        language={language}
                        value={goalContent}
                        onChange={(v) => setGoalContent(v ?? "")}
                        theme="vs-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            scrollBeyondLastLine: false,
                        }}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="text-destructive">{startErr}</div>
                <div className="text-destructive">{goalErr}</div>
            </div>

            <div className="flex justify-end">
                <Button onClick={handleSubmit} disabled={!isValid || submitting}>
                    {submitting ? "Submitting…" : "Submit challenge"}
                </Button>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to `user-challenge-form.tsx`. If `Constants` import fails, replace `import { Database, Constants } from "@/database.types";` with hard-coded `const ALLOWED_EXTENSIONS: Extension[] = ["js","ts","py","cpp","java","rb","go","rs","php","swift"];` (the generated `Constants` export name varies by supabase-cli version).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/textarea.tsx frontend/src/components/user-challenge-form.tsx
git commit -m "feat: add UserChallengeForm with Monaco editors and live validation"
```

---

### Task 14: Frontend — Shared List Component

**Files:**
- Create: `frontend/src/components/user-challenge-list.tsx`

- [ ] **Step 1: Create the list component**

```tsx
import { Check, Play, Search, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Database } from "@/database.types";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { UserChallengeLikes } from "@/components/user-challenge-likes";
import { UserChallengePreview } from "@/components/user-challenge-preview";

type Extension = Database["public"]["Enums"]["prog_extension"];

export interface UserChallengeRow {
    id: number;
    title: string | null;
    description: string | null;
    extension: Extension;
    created_at: string;
    promoted_at: string | null;
    promoted_challenge_id: number | null;
    promoted_challenge_date: string | null;
    up_count: number;
    down_count: number;
    // Browse-only fields:
    author_username?: string;
    // For preview only — fetched on demand by parent.
    start?: string;
    goal?: string;
}

interface UserChallengeListProps {
    rows: UserChallengeRow[] | null;
    showAuthor: boolean;
    showLikes: boolean; // false on the "mine" view
    showDelete: boolean;
    onDelete?: (id: number) => Promise<void> | void;
    onPreview: (row: UserChallengeRow) => Promise<void> | void;
}

export function UserChallengeList(props: UserChallengeListProps) {
    const [previewRow, setPreviewRow] = useState<UserChallengeRow | null>(null);

    const openPreview = async (row: UserChallengeRow) => {
        await props.onPreview(row);
        setPreviewRow(row);
    };

    return (
        <>
            {previewRow && previewRow.start !== undefined && previewRow.goal !== undefined && (
                <UserChallengePreview
                    open={true}
                    onOpenChange={(o) => !o && setPreviewRow(null)}
                    start={previewRow.start}
                    goal={previewRow.goal}
                    extension={previewRow.extension}
                    title={previewRow.title}
                />
            )}

            <Table className="border rounded-lg">
                <TableCaption>{"User-submitted challenges."}</TableCaption>
                <TableHeader>
                    <TableRow>
                        <TableHead>{"Title"}</TableHead>
                        {props.showAuthor && <TableHead>{"Author"}</TableHead>}
                        <TableHead className="w-[80px]">{"Ext"}</TableHead>
                        <TableHead className="w-[120px]">{"Created"}</TableHead>
                        <TableHead className="w-[80px]">{"Up"}</TableHead>
                        <TableHead className="w-[80px]">{"Down"}</TableHead>
                        <TableHead className="w-[160px]">{"Status"}</TableHead>
                        <TableHead className="w-[280px]">{"Actions"}</TableHead>
                    </TableRow>
                </TableHeader>
                {props.rows === null ? (
                    <TableSkeleton
                        className="h-8 w-[150px]"
                        rows={5}
                        columns={props.showAuthor ? 8 : 7}
                    />
                ) : (
                    <TableBody>
                        {props.rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell>
                                    {row.title ? (
                                        row.title
                                    ) : (
                                        <span className="text-muted-foreground">{"—"}</span>
                                    )}
                                </TableCell>
                                {props.showAuthor && (
                                    <TableCell>{row.author_username ?? "—"}</TableCell>
                                )}
                                <TableCell>{row.extension}</TableCell>
                                <TableCell>
                                    {new Date(row.created_at).toLocaleDateString()}
                                </TableCell>
                                <TableCell>{row.up_count}</TableCell>
                                <TableCell>{row.down_count}</TableCell>
                                <TableCell>
                                    {row.promoted_at ? (
                                        <span className="text-green-600 inline-flex items-center gap-1">
                                            <Check className="h-4 w-4" />
                                            {`Promoted ${row.promoted_challenge_date ?? ""}`.trim()}
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground inline-flex items-center gap-1">
                                            <X className="h-4 w-4" />
                                            {"Pending"}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-2 items-center">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => openPreview(row)}
                                        >
                                            <Search />
                                            <span>{"Preview"}</span>
                                        </Button>
                                        {props.showLikes && (
                                            <UserChallengeLikes userChallengeId={row.id} />
                                        )}
                                        {row.promoted_at && row.promoted_challenge_date && (
                                            <Button asChild variant="outline" size="sm">
                                                <a
                                                    href={`/${row.promoted_challenge_date}`}
                                                    target="_blank"
                                                >
                                                    <Play />
                                                    <span>{"Play"}</span>
                                                </a>
                                            </Button>
                                        )}
                                        {props.showDelete && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={row.promoted_at !== null}
                                                onClick={() => props.onDelete?.(row.id)}
                                            >
                                                <Trash2 />
                                                <span>{"Delete"}</span>
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                )}
            </Table>
        </>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to `user-challenge-list.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/user-challenge-list.tsx
git commit -m "feat: add shared UserChallengeList table for browse and manage views"
```

---

### Task 15: Frontend — Public Browse Route

**Files:**
- Create: `frontend/src/routes/user-challenges.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useAppStore } from "@/store";
import { Database } from "@/database.types";
import { Button } from "@/components/ui/button";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "@/components/ui/pagination";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    UserChallengeList,
    UserChallengeRow,
} from "@/components/user-challenge-list";
import { useNavigate } from "react-router-dom";

type Filter = Database["public"]["Enums"]["user_challenge_filter"];
type Status = Database["public"]["Enums"]["user_challenge_status"];
type Extension = Database["public"]["Enums"]["prog_extension"];

const PAGE_SIZE = 10;
const EXTENSIONS: Extension[] = [
    "js", "ts", "py", "cpp", "java", "rb", "go", "rs", "php", "swift",
];

export function UserChallenges() {
    const { supabase, user } = useAppStore();
    const navigate = useNavigate();

    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<Filter>("most_recent");
    const [status, setStatus] = useState<Status>("all");
    const [extension, setExtension] = useState<Extension | "all">("all");

    const [rows, setRows] = useState<UserChallengeRow[] | null>(null);
    const [totalCount, setTotalCount] = useState(0);

    const fetchPage = async () => {
        setRows(null);
        const args = {
            filter_type: filter,
            status_filter: status,
            extension_filter: extension === "all" ? null : extension,
        };
        const dataQuery = supabase
            .rpc("get_user_challenges", args)
            .range(PAGE_SIZE * (page - 1), PAGE_SIZE * page - 1);
        const countQuery = supabase.rpc("get_user_challenges", args, { count: "exact" });
        const [dataRes, countRes] = await Promise.all([dataQuery, countQuery]);
        setRows((dataRes.data ?? []) as UserChallengeRow[]);
        setTotalCount(countRes.count ?? 0);
    };

    useEffect(() => {
        fetchPage();
    }, [page, filter, status, extension]);

    useEffect(() => {
        setPage(1);
    }, [filter, status, extension]);

    const handlePreview = async (row: UserChallengeRow) => {
        if (row.start !== undefined && row.goal !== undefined) return;
        const { data } = await supabase
            .from("user_challenges")
            .select("start, goal")
            .eq("id", row.id)
            .single();
        if (data) {
            row.start = data.start;
            row.goal = data.goal;
        }
    };

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6 flex flex-col gap-4">
                <div className="flex flex-wrap justify-between items-end gap-3">
                    <div>
                        <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                            {"User challenges"}
                        </h1>
                        <p className="max-w-2xl pt-2 pb-2 text-foreground">
                            {"Browse community-submitted challenges. The highest-voted unpromoted entry becomes the next day's daily challenge."}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {user && (
                            <Button onClick={() => navigate("/user-challenges/new")}>
                                {"Submit new"}
                            </Button>
                        )}
                        {user && (
                            <Button variant="outline" onClick={() => navigate("/user-challenges/mine")}>
                                {"My submissions"}
                            </Button>
                        )}
                        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                            <SelectTrigger className="w-44">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="most_recent">{"Most recent"}</SelectItem>
                                <SelectItem value="most_liked">{"Most liked"}</SelectItem>
                                <SelectItem value="most_disliked">{"Most disliked"}</SelectItem>
                                <SelectItem value="liked_by_me">{"Liked by me"}</SelectItem>
                                <SelectItem value="not_liked_by_me">{"Not liked by me"}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{"All"}</SelectItem>
                                <SelectItem value="pending">{"Pending"}</SelectItem>
                                <SelectItem value="promoted">{"Promoted"}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={extension}
                            onValueChange={(v) => setExtension(v as Extension | "all")}
                        >
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{"Any ext"}</SelectItem>
                                {EXTENSIONS.map((e) => (
                                    <SelectItem key={e} value={e}>{e}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <UserChallengeList
                    rows={rows}
                    showAuthor={true}
                    showLikes={true}
                    showDelete={false}
                    onPreview={handlePreview}
                />

                <Pagination className="flex justify-end">
                    <PaginationContent>
                        <PaginationItem>
                            <Button
                                size="sm"
                                onClick={() => setPage(page - 1)}
                                disabled={page <= 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                        </PaginationItem>
                        <PaginationItem>
                            <div className="h-10 w-10 flex justify-center items-center">
                                {page}
                                {"/"}
                                {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
                            </div>
                        </PaginationItem>
                        <PaginationItem>
                            <Button
                                size="sm"
                                disabled={page * PAGE_SIZE >= totalCount}
                                onClick={() => setPage(page + 1)}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to `user-challenges.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/user-challenges.tsx
git commit -m "feat: add public /user-challenges browse route"
```

---

### Task 16: Frontend — Upload Route

**Files:**
- Create: `frontend/src/routes/user-challenges-new.tsx`

- [ ] **Step 1: Create the auth-gated route**

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { UserChallengeForm } from "@/components/user-challenge-form";

export function UserChallengesNew() {
    const { user } = useAppStore();
    const navigate = useNavigate();

    useEffect(() => {
        if (user === null) {
            navigate("/login");
        }
    }, [user, navigate]);

    if (user === null) return null;

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6 flex flex-col gap-4">
                <div>
                    <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                        {"Submit a challenge"}
                    </h1>
                    <p className="max-w-2xl pt-2 pb-2 text-foreground">
                        {"Create a start and goal file. The community votes; the highest-voted entry becomes the next day's daily challenge."}
                    </p>
                </div>
                <UserChallengeForm />
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to `user-challenges-new.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/user-challenges-new.tsx
git commit -m "feat: add /user-challenges/new upload route"
```

---

### Task 17: Frontend — Author Dashboard Route

**Files:**
- Create: `frontend/src/routes/user-challenges-mine.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { Button } from "@/components/ui/button";
import {
    UserChallengeList,
    UserChallengeRow,
} from "@/components/user-challenge-list";

export function UserChallengesMine() {
    const { supabase, user } = useAppStore();
    const navigate = useNavigate();

    const [rows, setRows] = useState<UserChallengeRow[] | null>(null);

    const fetchMine = async () => {
        const { data } = await supabase.rpc("get_my_user_challenges");
        setRows((data ?? []) as UserChallengeRow[]);
    };

    useEffect(() => {
        if (user === null) {
            navigate("/login");
            return;
        }
        fetchMine();
    }, [user]);

    const handleDelete = async (id: number) => {
        const { error } = await supabase
            .from("user_challenges")
            .delete()
            .eq("id", id);
        if (error) {
            alert("Could not delete: " + error.message);
            return;
        }
        await fetchMine();
    };

    const handlePreview = async (row: UserChallengeRow) => {
        if (row.start !== undefined && row.goal !== undefined) return;
        const { data } = await supabase
            .from("user_challenges")
            .select("start, goal")
            .eq("id", row.id)
            .single();
        if (data) {
            row.start = data.start;
            row.goal = data.goal;
        }
    };

    if (user === null) return null;

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6 flex flex-col gap-4">
                <div className="flex justify-between items-end gap-3">
                    <div>
                        <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                            {"My challenges"}
                        </h1>
                        <p className="max-w-2xl pt-2 pb-2 text-foreground">
                            {"Manage your submitted challenges. Delete is only available for entries that have not yet been promoted."}
                        </p>
                    </div>
                    <Button onClick={() => navigate("/user-challenges/new")}>
                        {"Submit new"}
                    </Button>
                </div>

                <UserChallengeList
                    rows={rows}
                    showAuthor={false}
                    showLikes={false}
                    showDelete={true}
                    onDelete={handleDelete}
                    onPreview={handlePreview}
                />
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to `user-challenges-mine.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/user-challenges-mine.tsx
git commit -m "feat: add /user-challenges/mine author dashboard route"
```

---

### Task 18: Register New Routes and Header Link

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/header.tsx`

- [ ] **Step 1: Register the three new routes in `main.tsx`**

Add the imports near the top alongside the existing route imports:
```typescript
import { UserChallenges } from "./routes/user-challenges.tsx";
import { UserChallengesNew } from "./routes/user-challenges-new.tsx";
import { UserChallengesMine } from "./routes/user-challenges-mine.tsx";
```

Add the route entries inside the `children` array of the Layout route:
```tsx
            {
                path: "/user-challenges",
                element: <UserChallenges />,
            },
            {
                path: "/user-challenges/new",
                element: <UserChallengesNew />,
            },
            {
                path: "/user-challenges/mine",
                element: <UserChallengesMine />,
            },
```

- [ ] **Step 2: Add a "User challenges" nav button in `header.tsx`**

After the existing Challenges button (around the line with `{"Challenges"}`), add:

```tsx
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("/user-challenges")}
                    >
                        {"User challenges"}
                    </Button>
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.tsx frontend/src/components/header.tsx
git commit -m "feat: register user-challenge routes and nav link"
```

---

### Task 19: End-to-End Manual QA

**Files:** none — manual smoke test with frontend dev server + backend running.

- [ ] **Step 1: Start the stack locally**

In three separate shells:
```bash
cd /home/tom/keyglide-rewrite/supabase && supabase start
cd /home/tom/keyglide-rewrite/backend && cargo run
cd /home/tom/keyglide-rewrite/frontend && pnpm dev
```

- [ ] **Step 2: Sign in (use a seed user)**

Open the dev URL, click Login, sign in with one of the seeded accounts.

- [ ] **Step 3: Test happy-path submission**

1. Click "User challenges" in the header → `/user-challenges` loads, empty.
2. Click "Submit new" → `/user-challenges/new` loads.
3. Type a short title, pick `js`, paste different content into start and goal, leave description empty. The submit button should enable.
4. Click "Submit challenge" → 201, redirected to `/user-challenges/mine`. The new row appears with status "Pending".

- [ ] **Step 4: Test client-side validation**

1. Go to `/user-challenges/new`.
2. Paste 51 lines into start. Inline error appears.
3. Paste a 1100-byte string. Inline error appears.
4. Make start and goal identical. Inline error appears on goal.
5. Type 81 characters into title. Inline error appears.
6. Submit button is disabled the whole time.

- [ ] **Step 5: Test server-side validation**

Sneak around client-side validation by editing a request from devtools:
1. Open the network tab.
2. Submit a valid challenge.
3. Edit the request, replace start with 51 newlines, replay.
4. Expected: 422 response with JSON `{ error: "TooManyLines", field: "startFile" }`. Form shows inline error.

- [ ] **Step 6: Test browse list**

1. Sign out, navigate to `/user-challenges`.
2. The just-submitted challenge appears with author username, vote buttons disabled with login tooltip.
3. Click Preview → both Monaco editors show the content read-only.
4. Sign in with a different user. Vote up — count increments live.

- [ ] **Step 7: Test promotion**

1. As `postgres`, run: `SELECT public.promote_user_challenge_for_date(CURRENT_DATE);`.
2. The function returns the new `challenges.id`.
3. The user_challenges row now shows status "Promoted YYYY-MM-DD" in the browse list.
4. Click Play → opens `/{date}` in the daily challenge editor with the submitted content.

- [ ] **Step 8: Test delete and locked-after-promotion**

1. Sign in as the original author, go to `/user-challenges/mine`.
2. Submit a second challenge.
3. Delete it — disappears from the list.
4. Try to delete the promoted one — Delete button is disabled.

- [ ] **Step 9: Test auth gate**

1. Sign out.
2. Visit `/user-challenges/new` → redirected to `/login`.
3. Visit `/user-challenges/mine` → redirected to `/login`.

- [ ] **Step 10: If issues found, fix and commit**

```bash
git add -A
git commit -m "fix: address issues found during manual QA"
```

---

## Self-Review Checklist

The plan was reviewed against the spec:

- **Spec coverage:**
  - Database schema (user_challenges, user_challenge_likes, RPCs, RLS, realtime) → Tasks 1, 2.
  - Backend HTTP endpoint with multipart + validation + JWT → Tasks 5, 6, 7, 8, 9.
  - Daily worker promotion → Task 10.
  - Frontend upload form (Monaco only, paste-style) → Tasks 12, 13.
  - Frontend browse + filter/sort/status → Task 15.
  - Frontend author dashboard with delete → Task 17.
  - Header nav and route registration → Task 18.
  - Postgres promotion verification → Task 3.
  - Backend validation tests → Task 6.
  - Manual frontend QA → Task 19.

- **Placeholder scan:** None. All code blocks are complete.

- **Type consistency:** `UserChallengeRow` is defined once in `user-challenge-list.tsx` and reused in routes. RPC names (`toggle_user_challenge_reaction`, `get_user_challenge_reaction_state`, `get_user_challenges`, `get_my_user_challenges`, `promote_user_challenge_for_date`) match across SQL, types file, frontend, and worker. Field name `userChallengeId` is consistent in the likes component and its prop interface.
