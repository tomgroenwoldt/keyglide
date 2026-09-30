-- Make user_challenges playable: solutions, scores (via solution_id) and comments
-- can target either a challenges row or a user_challenges row. Promoted user
-- challenges still produce a fresh challenges row whose play state starts empty.

-- Add title/description to challenges (carried over on promotion, rendered in play UI).
ALTER TABLE public.challenges
ADD COLUMN title TEXT,
ADD COLUMN description TEXT;

-- Carry title/description forward when promoting.
CREATE OR REPLACE FUNCTION public.promote_user_challenge_for_date(target_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    selected RECORD;
    new_challenge_id INTEGER;
BEGIN
    SELECT
        uc.id,
        uc.start,
        uc.goal,
        uc.extension,
        uc.title,
        uc.description
    INTO selected
    FROM public.user_challenges uc
    LEFT JOIN public.user_challenge_likes l ON l.user_challenge_id = uc.id
    WHERE uc.promoted_at IS NULL
    GROUP BY uc.id
    ORDER BY (
        COUNT(*) FILTER (WHERE l.reaction = 'up')
        - COUNT(*) FILTER (WHERE l.reaction = 'down')
    ) DESC,
    uc.created_at ASC
    LIMIT 1;

    IF selected.id IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.challenges (date, start, goal, extension, title, description)
    VALUES (
        target_date,
        selected.start,
        selected.goal,
        selected.extension,
        selected.title,
        selected.description
    )
    ON CONFLICT (date) DO NOTHING
    RETURNING id INTO new_challenge_id;

    IF new_challenge_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE public.user_challenges
    SET promoted_at = now(),
        promoted_challenge_id = new_challenge_id
    WHERE id = selected.id;

    RETURN new_challenge_id;
END;
$$;

-- Solutions can attach to a challenge OR a user_challenge (exactly one).
ALTER TABLE public.solutions
ALTER COLUMN challenge_id DROP NOT NULL,
ADD COLUMN user_challenge_id BIGINT REFERENCES public.user_challenges(id) ON DELETE CASCADE,
ADD CONSTRAINT solutions_target_xor CHECK (
    (challenge_id IS NULL) <> (user_challenge_id IS NULL)
);

CREATE UNIQUE INDEX solutions_unique_per_user_challenge
ON public.solutions (keys, user_challenge_id)
WHERE user_challenge_id IS NOT NULL;

-- Comments: same dual-FK pattern.
ALTER TABLE public.challenge_comments
ALTER COLUMN challenge_id DROP NOT NULL,
ADD COLUMN user_challenge_id BIGINT REFERENCES public.user_challenges(id) ON DELETE CASCADE,
ADD CONSTRAINT challenge_comments_target_xor CHECK (
    (challenge_id IS NULL) <> (user_challenge_id IS NULL)
);

-- Comments listing for user challenges (mirrors get_challenge_comments).
CREATE OR REPLACE FUNCTION public.get_user_challenge_comments(p_user_challenge_id INTEGER)
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
    WHERE c.user_challenge_id = p_user_challenge_id
    GROUP BY c.id, c.content, c.created_at, c.updated_at, c.user_id, p.user_name, p.avatar_url
    ORDER BY c.created_at DESC;
$$;

-- Ranked solutions for a single user_challenge (mirrors ranked_solutions shape).
CREATE OR REPLACE FUNCTION public.get_ranked_user_challenge_solutions(p_user_challenge_id BIGINT)
RETURNS TABLE (
    id INTEGER,
    full_name TEXT,
    user_id UUID,
    user_name TEXT,
    avatar_url TEXT,
    streak INTEGER,
    user_challenge_id BIGINT,
    keys TEXT[],
    place INTEGER
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
SELECT
    sol.id,
    p.full_name,
    p.id AS user_id,
    p.user_name,
    p.avatar_url,
    p.streak,
    sol.user_challenge_id,
    sol.keys,
    DENSE_RANK() OVER (
        PARTITION BY sol.user_challenge_id
        ORDER BY COALESCE(array_length(sol.keys, 1), 0) ASC
    )::INTEGER AS place
FROM public.solutions sol
JOIN public.profiles p ON sol.user_id = p.id
WHERE sol.user_challenge_id = p_user_challenge_id;
$$;
