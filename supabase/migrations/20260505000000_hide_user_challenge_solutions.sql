-- Solutions submitted by playing a user_challenge (preview plays, before any
-- promotion to daily) leaked everyone's keystrokes to everyone else. Mask them
-- the same way `get_ranked_solutions` masks today's daily-challenge keys: show
-- the viewer's own solution; replace others' keys with '?'. Once the
-- user_challenge is promoted, new plays land on the resulting `challenges` row
-- and `get_ranked_solutions` handles unmasking after the daily date passes.

DROP FUNCTION IF EXISTS public.get_ranked_user_challenge_solutions(BIGINT);

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
    place INTEGER,
    hidden BOOLEAN
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
    CASE
        WHEN auth.uid() IS NULL OR p.id <> auth.uid()
        THEN array_fill('?'::text, ARRAY[COALESCE(array_length(sol.keys, 1), 0)])
        ELSE sol.keys
    END AS keys,
    DENSE_RANK() OVER (
        PARTITION BY sol.user_challenge_id
        ORDER BY COALESCE(array_length(sol.keys, 1), 0) ASC
    )::INTEGER AS place,
    (auth.uid() IS NULL OR p.id <> auth.uid()) AS hidden
FROM public.solutions sol
JOIN public.profiles p ON sol.user_id = p.id
WHERE sol.user_challenge_id = p_user_challenge_id;
$$;
