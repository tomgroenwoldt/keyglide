-- Stop `solutions.keys` from being readable directly through PostgREST.
--
-- `get_ranked_solutions` and `get_ranked_user_challenge_solutions` replace
-- other players' keystrokes with '?' while a challenge is still live. That
-- masking was only ever applied inside those functions, while the underlying
-- table kept a blanket `SELECT ... USING (true)` policy and a table-wide
-- SELECT grant for `anon`. So
--
--     GET /rest/v1/solutions?select=keys
--
-- with nothing but the publishable key returned every player's raw
-- keystrokes, today's included, and made the masking decorative.
--
-- The fix is a column-level grant. Note that revoking SELECT on a single
-- column is not enough on its own: a table-level SELECT grant covers every
-- column, so the table-level privilege has to go first and the columns that
-- should stay readable are then granted back explicitly.
--
-- The rows themselves stay visible, so the solution board keeps showing
-- placeholder entries with their rank and keystroke count. Only `keys` is
-- withheld, and the two masking functions become SECURITY DEFINER so they can
-- still read it in order to decide what to reveal.

REVOKE SELECT ON public.solutions FROM anon, authenticated;

GRANT SELECT (id, user_id, challenge_id, user_challenge_id)
ON public.solutions
TO anon, authenticated;

-- Unchanged bodies; SECURITY DEFINER added so the masking can read `keys`.
-- `search_path` stays pinned to '' and every reference is schema-qualified,
-- which is what makes running as the owner safe here.

CREATE OR REPLACE FUNCTION public.get_ranked_solutions()
RETURNS TABLE (
    id INTEGER,
    full_name TEXT,
    user_id UUID,
    user_name TEXT,
    avatar_url TEXT,
    streak INTEGER,
    date DATE,
    keys TEXT[],
    place INTEGER,
    hidden_today BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
SELECT
    sol.id,
    p.full_name,
    p.id AS user_id,
    p.user_name,
    p.avatar_url,
    p.streak,
    c.date,
    CASE
        WHEN c.date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
            AND (
                auth.uid() IS NULL
                OR (
                    p.id <> auth.uid()
                    AND NOT EXISTS (
                        SELECT 1
                        FROM public.scores s
                        WHERE s.solution_id = sol.id
                          AND s.user_id = auth.uid()
                    )
                )
            )
        THEN
            array_fill('?'::text, ARRAY[COALESCE(array_length(sol.keys, 1), 0)])
        ELSE
            sol.keys
    END AS keys,
    DENSE_RANK() OVER (
        PARTITION BY sol.challenge_id
        ORDER BY COALESCE(array_length(sol.keys, 1), 0) ASC
    ) AS place,
    (c.date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) AS hidden_today
FROM public.solutions sol
FULL OUTER JOIN public.profiles p ON sol.user_id = p.id
JOIN public.challenges c ON sol.challenge_id = c.id;
$$;

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
SECURITY DEFINER
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
