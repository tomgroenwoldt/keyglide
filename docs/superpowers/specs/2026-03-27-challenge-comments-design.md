# Challenge Comments Design

## Overview

Add user comments to challenges on the main editor page (`/` route). Comments are independent (no replies/threading). Each comment can be upvoted or downvoted with a Reddit-style net score. Users can edit and delete their own comments.

Comments are hidden by default and revealed via a toggle button in the editor card footer.

## Database

### Tables

**`challenge_comments`**

| Column       | Type                     | Constraints                                      |
|--------------|--------------------------|--------------------------------------------------|
| id           | SERIAL                   | PRIMARY KEY                                      |
| challenge_id | INTEGER                  | NOT NULL, FK → challenges                        |
| user_id      | UUID                     | NOT NULL, FK → profiles(id), DEFAULT auth.uid()  |
| content      | TEXT                     | NOT NULL, CHECK(length BETWEEN 1 AND 500)        |
| created_at   | TIMESTAMPTZ              | NOT NULL, DEFAULT now()                          |
| updated_at   | TIMESTAMPTZ              | NULL (set on edit)                               |

**`challenge_comment_votes`**

| Column     | Type     | Constraints                                               |
|------------|----------|-----------------------------------------------------------|
| id         | SERIAL   | PRIMARY KEY                                               |
| comment_id | INTEGER  | NOT NULL, FK → challenge_comments(id) ON DELETE CASCADE   |
| user_id    | UUID     | NOT NULL, FK → profiles(id), DEFAULT auth.uid()           |
| vote       | SMALLINT | NOT NULL, CHECK(vote IN (1, -1))                          |

- UNIQUE constraint on (comment_id, user_id)

### RLS Policies

**challenge_comments:**
- SELECT: anyone (TRUE)
- INSERT: authenticated, WHERE auth.uid() = user_id
- UPDATE: authenticated, WHERE auth.uid() = user_id (content and updated_at only)
- DELETE: authenticated, WHERE auth.uid() = user_id

**challenge_comment_votes:**
- SELECT: anyone (TRUE)
- INSERT: authenticated, WHERE auth.uid() = user_id
- UPDATE: authenticated, WHERE auth.uid() = user_id
- DELETE: authenticated, WHERE auth.uid() = user_id

### RPC Functions

**`get_challenge_comments(p_challenge_id INTEGER)`**

Returns comments for a challenge with author info and vote state:
- comment id, content, created_at, updated_at
- author user_name, avatar_url
- net_score (SUM of votes)
- my_vote (current user's vote: 1, -1, or NULL)

Ordered by created_at DESC (newest first).

**`toggle_comment_vote(p_comment_id INTEGER, p_vote SMALLINT)`**

Same toggle pattern as `toggle_challenge_reaction`:
1. If user has same vote on this comment → DELETE (toggle off)
2. Otherwise → UPSERT (insert or switch vote)

**`update_comment(p_comment_id INTEGER, p_content TEXT)`**

Updates comment content and sets updated_at = now(). Only succeeds if auth.uid() matches the comment's user_id. Validates content length (1-500).

**`delete_comment(p_comment_id INTEGER)`**

Deletes comment. Only succeeds if auth.uid() matches the comment's user_id. Cascade deletes associated votes.

### Realtime

Both tables added to `supabase_realtime` publication for live updates.

## Frontend

### Component: `ChallengeComments`

**Location:** `frontend/src/components/challenge-comments.tsx`

**Props:**
- `challengeId: number`

**Placement:** Root page (`routes/root.tsx`), below the editor card section but above the solution board. A toggle button is added to the editor card footer next to `ChallengeLikes`.

### UI Structure

**Toggle button (in card footer):**
- Button with chat/message icon and comment count label (e.g., "Comments (7)")
- Placed next to the existing `ChallengeLikes` component
- Toggles visibility of the comments section below

**Comments section (when expanded):**
- New comment input at the top: textarea with character counter (x/500) and submit button
  - Only visible to authenticated users
  - Disabled when empty or exceeds 500 characters
- Comment list ordered newest first, each comment showing:
  - Author avatar + username
  - Relative timestamp (e.g., "2h ago"), with "(edited)" indicator if updated_at is set
  - Comment content (plain text)
  - Vote controls: up arrow, net score number, down arrow
    - Active vote highlighted (similar to challenge likes pattern)
    - Disabled for unauthenticated users
  - Edit/delete buttons visible only to the comment author
    - Edit: replaces content with inline textarea + save/cancel buttons
    - Delete: immediate deletion (no confirmation modal)

### State Management

All state is local to the component via `useState`:
- `comments` — fetched comment list
- `isOpen` — toggle state
- `newComment` — textarea value
- `editingId` / `editContent` — inline edit state

No changes to the Zustand global store.

### Real-time Updates

Subscribe to Supabase Realtime on both `challenge_comments` and `challenge_comment_votes` tables (filtered by challenge_id where possible). On any change event, re-fetch via `get_challenge_comments` RPC — same pattern as `ChallengeLikes`.

### Authentication Handling

- Unauthenticated users can view comments and scores
- Comment input hidden for unauthenticated users
- Vote buttons disabled with tooltip for unauthenticated users (same pattern as challenge likes)

## Scope Exclusions

- No reply/threading functionality
- No markdown or rich text formatting — plain text only
- No moderation tools beyond self-edit/delete
- No pagination of comments (acceptable for initial implementation)
- No backend (Rust) changes required
