# Challenge Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user comments with Reddit-style voting to challenges on the main editor page.

**Architecture:** Supabase-only approach — a database migration creates tables, RLS policies, and RPC functions. A single React component (`ChallengeComments`) handles the UI with real-time updates via Supabase Realtime. No backend (Rust) changes.

**Tech Stack:** PostgreSQL (Supabase), React, TypeScript, Supabase JS client, date-fns, lucide-react, Radix UI

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260327220000_challenge_comments.sql` | Tables, RLS, RPC functions, realtime |
| Create | `frontend/src/components/challenge-comments.tsx` | Comments UI component |
| Create | `frontend/src/components/ui/textarea.tsx` | Textarea primitive (doesn't exist yet) |
| Modify | `frontend/src/database.types.ts` | Add types for new tables and functions |
| Modify | `frontend/src/routes/root.tsx:75-218` | Integrate ChallengeComments + toggle button |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260327220000_challenge_comments.sql`

- [ ] **Step 1: Create the migration file with tables**

```sql
-- Challenge comments table
CREATE TABLE public.challenge_comments (
    id SERIAL PRIMARY KEY,
    challenge_id INTEGER NOT NULL REFERENCES public.challenges(id),
    user_id UUID NOT NULL REFERENCES public.profiles(id) DEFAULT auth.uid(),
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- Comment votes table
CREATE TABLE public.challenge_comment_votes (
    id SERIAL PRIMARY KEY,
    comment_id INTEGER NOT NULL REFERENCES public.challenge_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) DEFAULT auth.uid(),
    vote SMALLINT NOT NULL CHECK (vote IN (1, -1)),
    CONSTRAINT challenge_comment_votes_unique UNIQUE (comment_id, user_id)
);
```

- [ ] **Step 2: Add RLS policies**

Append to the same migration file:

```sql
-- Enable RLS
ALTER TABLE public.challenge_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_comment_votes ENABLE ROW LEVEL SECURITY;

-- challenge_comments policies
CREATE POLICY "anyone can view comments"
ON public.challenge_comments FOR SELECT USING (TRUE);

CREATE POLICY "authenticated users can create comments"
ON public.challenge_comments FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update own comments"
ON public.challenge_comments FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can delete own comments"
ON public.challenge_comments FOR DELETE
USING (auth.uid() = user_id);

-- challenge_comment_votes policies
CREATE POLICY "anyone can view comment votes"
ON public.challenge_comment_votes FOR SELECT USING (TRUE);

CREATE POLICY "authenticated users can vote"
ON public.challenge_comment_votes FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update own votes"
ON public.challenge_comment_votes FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can delete own votes"
ON public.challenge_comment_votes FOR DELETE
USING (auth.uid() = user_id);
```

- [ ] **Step 3: Add RPC functions**

Append to the same migration file:

```sql
-- Get comments for a challenge with author info and vote state
CREATE OR REPLACE FUNCTION public.get_challenge_comments(p_challenge_id INTEGER)
RETURNS TABLE (
    id INTEGER,
    content TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    user_id UUID,
    user_name TEXT,
    avatar_url TEXT,
    net_score BIGINT,
    my_vote SMALLINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        c.id,
        c.content,
        c.created_at,
        c.updated_at,
        c.user_id,
        p.user_name,
        p.avatar_url,
        COALESCE(SUM(v.vote), 0)::BIGINT AS net_score,
        MAX(CASE WHEN v.user_id = auth.uid() THEN v.vote ELSE NULL END)::SMALLINT AS my_vote
    FROM public.challenge_comments c
    JOIN public.profiles p ON p.id = c.user_id
    LEFT JOIN public.challenge_comment_votes v ON v.comment_id = c.id
    WHERE c.challenge_id = p_challenge_id
    GROUP BY c.id, c.content, c.created_at, c.updated_at, c.user_id, p.user_name, p.avatar_url
    ORDER BY c.created_at DESC;
$$;

-- Toggle a vote on a comment (same pattern as toggle_challenge_reaction)
CREATE OR REPLACE FUNCTION public.toggle_comment_vote(p_comment_id INTEGER, p_vote SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Same vote → delete (toggle off)
    DELETE FROM public.challenge_comment_votes
    WHERE comment_id = p_comment_id
      AND user_id = auth.uid()
      AND vote = p_vote;

    IF FOUND THEN
        RETURN;
    END IF;

    -- Different vote or none → upsert
    INSERT INTO public.challenge_comment_votes (comment_id, user_id, vote)
    VALUES (p_comment_id, auth.uid(), p_vote)
    ON CONFLICT (comment_id, user_id)
    DO UPDATE SET vote = EXCLUDED.vote;
END;
$$;

-- Update a comment (owner only)
CREATE OR REPLACE FUNCTION public.update_comment(p_comment_id INTEGER, p_content TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF char_length(p_content) < 1 OR char_length(p_content) > 500 THEN
        RAISE EXCEPTION 'Comment must be between 1 and 500 characters';
    END IF;

    UPDATE public.challenge_comments
    SET content = p_content, updated_at = now()
    WHERE id = p_comment_id AND user_id = auth.uid();
END;
$$;

-- Delete a comment (owner only)
CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.challenge_comments
    WHERE id = p_comment_id AND user_id = auth.uid();
END;
$$;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_comment_votes;
```

- [ ] **Step 4: Apply the migration**

Run: `supabase db push` (or `supabase migration up` depending on local setup)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260327220000_challenge_comments.sql
git commit -m "feat: add challenge_comments and challenge_comment_votes tables with RPC functions"
```

---

### Task 2: Update TypeScript Database Types

**Files:**
- Modify: `frontend/src/database.types.ts`

The generated types file needs to include the new tables and functions. After applying the migration, regenerate types if a generation command is available (`npx supabase gen types typescript`). If not, manually add the types.

- [ ] **Step 1: Add challenge_comments table types**

In `frontend/src/database.types.ts`, inside the `public.Tables` object (after the `challenge_likes` entry around line 72), add:

```typescript
      challenge_comments: {
        Row: {
          id: number
          challenge_id: number
          user_id: string
          content: string
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: number
          challenge_id: number
          user_id?: string
          content: string
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: number
          challenge_id?: number
          user_id?: string
          content?: string
          created_at?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_comments_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 2: Add challenge_comment_votes table types**

Immediately after the `challenge_comments` entry, add:

```typescript
      challenge_comment_votes: {
        Row: {
          id: number
          comment_id: number
          user_id: string
          vote: number
        }
        Insert: {
          id?: number
          comment_id: number
          user_id?: string
          vote: number
        }
        Update: {
          id?: number
          comment_id?: number
          user_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenge_comment_votes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "challenge_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_comment_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 3: Add RPC function types**

In the `Functions` section (around line 255), add these entries alongside the existing functions:

```typescript
      get_challenge_comments: {
        Args: { p_challenge_id: number }
        Returns: {
          id: number
          content: string
          created_at: string
          updated_at: string | null
          user_id: string
          user_name: string
          avatar_url: string | null
          net_score: number
          my_vote: number | null
        }[]
      }
      toggle_comment_vote: {
        Args: { p_comment_id: number; p_vote: number }
        Returns: undefined
      }
      update_comment: {
        Args: { p_comment_id: number; p_content: string }
        Returns: undefined
      }
      delete_comment: {
        Args: { p_comment_id: number }
        Returns: undefined
      }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/database.types.ts
git commit -m "feat: add TypeScript types for challenge comments tables and RPC functions"
```

---

### Task 3: Create Textarea UI Primitive

**Files:**
- Create: `frontend/src/components/ui/textarea.tsx`

The project uses shadcn/ui-style primitives. There is no Textarea component yet.

- [ ] **Step 1: Create the Textarea component**

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

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to textarea.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/textarea.tsx
git commit -m "feat: add Textarea UI primitive component"
```

---

### Task 4: Create ChallengeComments Component

**Files:**
- Create: `frontend/src/components/challenge-comments.tsx`

- [ ] **Step 1: Create the component file with types and state**

```tsx
import { useEffect, useState } from "react";
import {
    ArrowBigDown,
    ArrowBigUp,
    MessageSquare,
    Pencil,
    Trash2,
    X,
    Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/store";

interface Comment {
    id: number;
    content: string;
    created_at: string;
    updated_at: string | null;
    user_id: string;
    user_name: string;
    avatar_url: string | null;
    net_score: number;
    my_vote: number | null;
}

interface ChallengeCommentsProps {
    challengeId: number;
}

export function ChallengeComments({ challengeId }: ChallengeCommentsProps) {
    const { supabase, user } = useAppStore();

    const [comments, setComments] = useState<Comment[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [newComment, setNewComment] = useState("");
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editContent, setEditContent] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const fetchComments = async () => {
        const { data, error } = await supabase.rpc("get_challenge_comments", {
            p_challenge_id: challengeId,
        });
        if (error || !data) return;
        setComments(data);
    };

    useEffect(() => {
        fetchComments();

        const channel = supabase
            .channel(`challenge-comments-${challengeId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "challenge_comments",
                },
                fetchComments,
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "challenge_comment_votes",
                },
                fetchComments,
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [challengeId]);

    const handleSubmit = async () => {
        if (!newComment.trim() || submitting) return;
        setSubmitting(true);
        await supabase
            .from("challenge_comments")
            .insert({ challenge_id: challengeId, content: newComment.trim() });
        setNewComment("");
        setSubmitting(false);
    };

    const handleVote = async (commentId: number, vote: number) => {
        await supabase.rpc("toggle_comment_vote", {
            p_comment_id: commentId,
            p_vote: vote,
        });
    };

    const handleUpdate = async (commentId: number) => {
        if (!editContent.trim()) return;
        await supabase.rpc("update_comment", {
            p_comment_id: commentId,
            p_content: editContent.trim(),
        });
        setEditingId(null);
        setEditContent("");
    };

    const handleDelete = async (commentId: number) => {
        await supabase.rpc("delete_comment", {
            p_comment_id: commentId,
        });
    };

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(!isOpen)}
            >
                <MessageSquare className="h-4 w-4" />
                {`Comments (${comments.length})`}
            </Button>

            {isOpen && (
                <div className="border-grid border-b">
                    <div className="container-wrapper">
                        <div className="container py-6 flex flex-col gap-4">
                            {user && (
                                <div className="flex flex-col gap-2">
                                    <Textarea
                                        placeholder="Write a comment..."
                                        value={newComment}
                                        onChange={(e) =>
                                            setNewComment(e.target.value)
                                        }
                                        maxLength={500}
                                        className="resize-none"
                                    />
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-muted-foreground">
                                            {`${newComment.length}/500`}
                                        </span>
                                        <Button
                                            size="sm"
                                            onClick={handleSubmit}
                                            disabled={
                                                !newComment.trim() ||
                                                submitting ||
                                                newComment.length > 500
                                            }
                                        >
                                            {"Post"}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {comments.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    {"No comments yet. Be the first!"}
                                </p>
                            )}

                            {comments.map((comment) => (
                                <div
                                    key={comment.id}
                                    className="flex gap-3 py-3 border-b last:border-b-0"
                                >
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage
                                            src={comment.avatar_url ?? undefined}
                                        />
                                        <AvatarFallback>
                                            {comment.user_name
                                                .slice(0, 2)
                                                .toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 text-sm">
                                            <span className="font-medium">
                                                {comment.user_name}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {formatDistanceToNow(
                                                    new Date(comment.created_at),
                                                    { addSuffix: true },
                                                )}
                                            </span>
                                            {comment.updated_at && (
                                                <span className="text-muted-foreground">
                                                    {"(edited)"}
                                                </span>
                                            )}
                                        </div>

                                        {editingId === comment.id ? (
                                            <div className="flex flex-col gap-2 mt-1">
                                                <Textarea
                                                    value={editContent}
                                                    onChange={(e) =>
                                                        setEditContent(
                                                            e.target.value,
                                                        )
                                                    }
                                                    maxLength={500}
                                                    className="resize-none min-h-[60px]"
                                                />
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() =>
                                                            handleUpdate(
                                                                comment.id,
                                                            )
                                                        }
                                                        disabled={
                                                            !editContent.trim() ||
                                                            editContent.length >
                                                                500
                                                        }
                                                    >
                                                        <Check className="h-3 w-3" />
                                                        {"Save"}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setEditingId(null);
                                                            setEditContent("");
                                                        }}
                                                    >
                                                        <X className="h-3 w-3" />
                                                        {"Cancel"}
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm mt-1 whitespace-pre-wrap">
                                                {comment.content}
                                            </p>
                                        )}

                                        <div className="flex items-center gap-1 mt-2">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div>
                                                            <Button
                                                                variant={
                                                                    comment.my_vote ===
                                                                    1
                                                                        ? "default"
                                                                        : "ghost"
                                                                }
                                                                size="sm"
                                                                className="h-7 w-7 p-0"
                                                                onClick={() =>
                                                                    handleVote(
                                                                        comment.id,
                                                                        1,
                                                                    )
                                                                }
                                                                disabled={
                                                                    user === null
                                                                }
                                                            >
                                                                <ArrowBigUp className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </TooltipTrigger>
                                                    {!user && (
                                                        <TooltipContent>
                                                            <span>
                                                                {
                                                                    "You need to login to vote."
                                                                }
                                                            </span>
                                                        </TooltipContent>
                                                    )}
                                                </Tooltip>
                                            </TooltipProvider>

                                            <span className="text-sm font-medium min-w-[2ch] text-center">
                                                {comment.net_score}
                                            </span>

                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div>
                                                            <Button
                                                                variant={
                                                                    comment.my_vote ===
                                                                    -1
                                                                        ? "destructive"
                                                                        : "ghost"
                                                                }
                                                                size="sm"
                                                                className="h-7 w-7 p-0"
                                                                onClick={() =>
                                                                    handleVote(
                                                                        comment.id,
                                                                        -1,
                                                                    )
                                                                }
                                                                disabled={
                                                                    user === null
                                                                }
                                                            >
                                                                <ArrowBigDown className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </TooltipTrigger>
                                                    {!user && (
                                                        <TooltipContent>
                                                            <span>
                                                                {
                                                                    "You need to login to vote."
                                                                }
                                                            </span>
                                                        </TooltipContent>
                                                    )}
                                                </Tooltip>
                                            </TooltipProvider>

                                            {user &&
                                                user.id === comment.user_id && (
                                                    <>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 w-7 p-0 ml-2"
                                                            onClick={() => {
                                                                setEditingId(
                                                                    comment.id,
                                                                );
                                                                setEditContent(
                                                                    comment.content,
                                                                );
                                                            }}
                                                        >
                                                            <Pencil className="h-3 w-3" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 w-7 p-0"
                                                            onClick={() =>
                                                                handleDelete(
                                                                    comment.id,
                                                                )
                                                            }
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </>
                                                )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors related to challenge-comments.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/challenge-comments.tsx
git commit -m "feat: add ChallengeComments component with voting and edit/delete"
```

---

### Task 5: Integrate ChallengeComments into Root Page

**Files:**
- Modify: `frontend/src/routes/root.tsx:1-218`

- [ ] **Step 1: Add imports and state**

At the top of `root.tsx`, add the import alongside the existing `ChallengeLikes` import (line 22):

```typescript
import { ChallengeComments } from "@/components/challenge-comments";
```

No new state needed — the toggle state lives inside `ChallengeComments`.

- [ ] **Step 2: Add the comments toggle button in the card footer**

Replace the current `CardFooter` block (lines 199-205):

```tsx
                                <CardFooter className="flex justify-end items-center gap-2">
                                    {challenge && (
                                        <>
                                            <ChallengeComments
                                                challengeId={challenge.id}
                                            />
                                            <ChallengeLikes
                                                challengeId={challenge.id}
                                            />
                                        </>
                                    )}
                                </CardFooter>
```

Note: `ChallengeComments` renders its own toggle button inline, plus the collapsible section is rendered via a fragment (`<>...</>`). The button appears in the footer; the expanded section renders after the button. However, because the expanded comments section needs to appear *below* the card (not inside the footer), we need to restructure slightly.

- [ ] **Step 3: Move comments section below the card**

The `ChallengeComments` component returns a fragment with a `Button` and the expandable `div`. The button goes in the footer, but the section should render below the card. To achieve this cleanly, split the component rendering:

Instead, update the `CardFooter` to only contain the button, and place the expanded section after the card's closing `</div>`. Update `root.tsx` lines 199-208:

```tsx
                                <CardFooter className="flex justify-end items-center gap-2">
                                    {challenge && (
                                        <>
                                            <ChallengeComments
                                                challengeId={challenge.id}
                                            />
                                            <ChallengeLikes
                                                challengeId={challenge.id}
                                            />
                                        </>
                                    )}
                                </CardFooter>
                            </Card>
                        </div>
```

The `ChallengeComments` component already renders the toggle button and the collapsible section together as a fragment. The collapsible section uses `border-grid border-b` and `container-wrapper` classes to match the page's section pattern, so it visually appears as a new page section below the editor card even though it renders within the same parent.

- [ ] **Step 4: Verify it compiles and renders**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: No errors

Run: `cd /home/tom/keyglide-rewrite/frontend && npm run dev`
Expected: Page loads, "Comments (0)" button visible in card footer next to likes, clicking it expands the comments section

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/root.tsx
git commit -m "feat: integrate ChallengeComments into main editor page"
```

---

### Task 6: Manual Testing Checklist

- [ ] **Step 1: Test unauthenticated view**

1. Open the main page without logging in
2. Verify "Comments (0)" button is visible
3. Click it — comments section opens
4. Verify no comment input textarea is shown
5. Verify vote buttons are disabled with tooltip "You need to login to vote."

- [ ] **Step 2: Test comment creation**

1. Log in
2. Click "Comments" to expand
3. Type a comment in the textarea
4. Verify character counter updates (e.g., "42/500")
5. Click "Post" — comment appears in the list
6. Verify the button count updates to "Comments (1)"

- [ ] **Step 3: Test voting**

1. Click upvote on a comment — net score increases, arrow highlights
2. Click upvote again — vote removed, score decreases
3. Click downvote — score decreases, down arrow highlights
4. Click downvote while upvote is active — switches from up to down

- [ ] **Step 4: Test edit and delete**

1. On your own comment, click the pencil icon — inline textarea appears with existing content
2. Modify the text, click "Save" — content updates, "(edited)" label appears
3. Click "Cancel" during edit — reverts to original
4. Click the trash icon on your own comment — comment is removed
5. Verify edit/delete icons do not appear on other users' comments

- [ ] **Step 5: Test real-time updates**

1. Open the same challenge in two browser tabs
2. Post a comment in tab 1 — verify it appears in tab 2 without refresh
3. Vote on a comment in tab 1 — verify score updates in tab 2

- [ ] **Step 6: Commit all work if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
