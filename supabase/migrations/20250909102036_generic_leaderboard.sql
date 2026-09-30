DROP VIEW IF EXISTS public.weekly_leaderboard;
DROP FUNCTION IF EXISTS public.get_weekly_leaderboard();

CREATE OR REPLACE FUNCTION public.get_leaderboard(period TEXT)
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
SECURITY INVOKER
SET search_path = ''
AS $$
WITH bounds AS (
    SELECT
        CASE
            WHEN lower(period) = 'week' THEN date_trunc('week', timezone('UTC', now()))::date
            WHEN lower(period) = 'month' THEN date_trunc('month', timezone('UTC', now()))::date
            WHEN lower(period) = 'year' THEN date_trunc('year', timezone('UTC', now()))::date
        END AS period_start,
        CASE
            WHEN lower(period) = 'week' THEN (date_trunc('week', timezone('UTC', now())) + interval '7 days - 1 second')::date
            WHEN lower(period) = 'month' THEN (date_trunc('month', timezone('UTC', now())) + interval '1 month - 1 second')::date
            WHEN lower(period) = 'year' THEN (date_trunc('year', timezone('UTC', now())) + interval '1 year - 1 second')::date
        END AS period_end
),
period_solutions AS (
    SELECT rs.*
    FROM public.ranked_solutions rs
    JOIN bounds b ON rs.date BETWEEN b.period_start AND b.period_end
),
aggregated AS (
    SELECT
        ps.user_id,
        MAX(ps.full_name) AS full_name,
        MAX(ps.user_name) AS user_name,
        MAX(ps.avatar_url) AS avatar_url,
        ARRAY_AGG(ps.id) FILTER (WHERE ps.place = 1) AS best_solution_ids,
        COUNT(*) AS total_solutions_count
    FROM period_solutions ps
    WHERE ps.user_id IS NOT NULL
    GROUP BY ps.user_id
),
ranked AS (
    SELECT
        a.*,
        RANK() OVER (
            ORDER BY array_length(a.best_solution_ids, 1) DESC
        ) AS rank
    FROM aggregated a
    WHERE array_length(a.best_solution_ids, 1) > 0
)
SELECT * FROM ranked
ORDER BY rank;
$$;
