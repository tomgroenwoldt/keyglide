-- Previously, we only counted top solutions distinct on user_id and challenge
-- date. If other users find out about the solution within the challenge release
-- day (so it's still censored) they should also get a top solution count
-- increment.
-- Also, if users find out about a rank 1 solution after a few days it should of
-- course still be counted.
DROP FUNCTION IF EXISTS public.get_leaderboard(TEXT);

CREATE OR REPLACE FUNCTION public.get_leaderboard(period TEXT)
RETURNS TABLE (
    user_id UUID,
    full_name TEXT,
    user_name TEXT,
    avatar_url TEXT,
    best_dates DATE[],
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
aggregated AS (
    SELECT DISTINCT ON (s.user_id)
        s.user_id,
        p.full_name,
        p.user_name,
        p.avatar_url,
        ARRAY_AGG(DISTINCT rs.date) AS best_dates,
        COUNT(DISTINCT rs.date) AS total_solutions_count
    FROM public.ranked_solutions rs
    JOIN bounds b
      ON rs.date BETWEEN b.period_start AND b.period_end
    JOIN public.scores s ON rs.id = s.solution_id
    JOIN public.profiles p ON p.id = s.user_id
    WHERE rs.place = 1
        -- Count scores if users found out about it while rank 1 solution was censored or rank 1 solutions in general.
        AND rs.date = s.stop_time::date OR rs.place = 1 AND rs.user_id = s.user_id
    GROUP BY s.user_id, p.full_name, p.user_name, p.avatar_url
),
ranked AS (
    SELECT
        a.*,
        RANK() OVER (
            ORDER BY array_length(a.best_dates, 1) DESC
        ) AS rank
    FROM aggregated a
    WHERE array_length(a.best_dates, 1) > 0
)
SELECT * FROM ranked
ORDER BY rank;
$$;
