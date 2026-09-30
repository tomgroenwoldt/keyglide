DROP VIEW IF EXISTS public.ranked_solutions;
DROP FUNCTION IF EXISTS public.get_ranked_solutions();

CREATE OR REPLACE FUNCTION public.get_ranked_solutions()
RETURNS TABLE (
    id INTEGER,
    full_name TEXT,
    user_id UUID,
    user_name TEXT,
    avatar_url TEXT,
    date DATE,
    keys TEXT[],
    place INTEGER,
    hidden_today BOOLEAN
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

CREATE OR REPLACE VIEW public.ranked_solutions
WITH(security_invoker = true)
AS SELECT * FROM public.get_ranked_solutions();
