-- Create function
CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard()
RETURNS TABLE (
    user_id UUID,
    full_name TEXT,
    user_name TEXT,
    avatar_url TEXT,
    best_solution_ids INTEGER[],
    total_solutions_count INTEGER,
    rank INTEGER
)
LANGUAGE sql
AS $$
WITH week_bounds AS (
    SELECT
        date_trunc('week', timezone('UTC', now()))::date AS week_start,
        (date_trunc('week', timezone('UTC', now())) + interval '7 days - 1 second')::date AS week_end
),
weekly_solutions AS (
    SELECT rs.*
    FROM public.ranked_solutions rs
    JOIN week_bounds wb ON rs.date BETWEEN wb.week_start AND wb.week_end
),
aggregated AS (
    SELECT
        ws.user_id,
        MAX(ws.full_name) AS full_name,
        MAX(ws.user_name) AS user_name,
        MAX(ws.avatar_url) AS avatar_url,
        ARRAY_AGG(ws.id) FILTER (WHERE ws.place = 1) AS best_solution_ids,
        COUNT(*) AS total_solutions_count
    FROM weekly_solutions ws
    WHERE ws.user_id IS NOT NULL
    GROUP BY ws.user_id
),
ranked AS (
    SELECT
        a.*,
        RANK() OVER (
            ORDER BY array_length(a.best_solution_ids, 1) DESC
        ) AS rank
    FROM aggregated a
    WHERE array_length(a.best_solution_ids, 1) > 0  -- filter out users with no best solutions
)
SELECT * FROM ranked
ORDER BY rank;
$$;

-- Create view
CREATE OR REPLACE VIEW public.weekly_leaderboard AS
SELECT * FROM public.get_weekly_leaderboard();

-- Drop security definer of old function
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
    place INTEGER
)
LANGUAGE sql
AS $$
SELECT
    sol.id,
    p.full_name,
    p.id AS user_id,
    p.user_name,
    p.avatar_url,
    c.date,
    sol.keys,
    DENSE_RANK() OVER (
        PARTITION BY sol.challenge_id
        ORDER BY COALESCE(array_length(sol.keys, 1), 0) ASC
    ) AS place
FROM solutions sol
FULL OUTER JOIN profiles p ON sol.user_id = p.id
JOIN challenges c ON sol.challenge_id = c.id;
$$;

CREATE OR REPLACE VIEW public.ranked_solutions AS
SELECT * FROM public.get_ranked_solutions();

