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
