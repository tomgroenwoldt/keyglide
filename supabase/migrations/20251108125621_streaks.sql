ALTER TABLE profiles
ADD COLUMN streak INTEGER DEFAULT 0;

DROP VIEW IF EXISTS public.ranked_solutions;
DROP FUNCTION IF EXISTS public.get_ranked_solutions();

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
    c.date,
    CASE 
        WHEN c.date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
            AND (auth.uid() IS NULL OR p.id <> auth.uid())
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

DROP FUNCTION IF EXISTS public.get_leaderboard(period TEXT);

CREATE OR REPLACE FUNCTION public.get_leaderboard(period TEXT)
RETURNS TABLE (
    user_id UUID,
    full_name TEXT,
    user_name TEXT,
    avatar_url TEXT,
    streak INTEGER,
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
        MAX(ps.streak) AS streak,
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

CREATE POLICY "Authenticated users can update their own profiles."
ON profiles FOR UPDATE
TO authenticated
USING (id = auth.uid());

CREATE OR REPLACE FUNCTION public.increment_streak_on_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  challenge_date DATE;
  already_played BOOLEAN;
BEGIN
  -- Get the challenge date for this score
  SELECT c.date INTO challenge_date
  FROM public.challenges c
  JOIN public.solutions sol ON sol.challenge_id = c.id
  WHERE sol.id = NEW.solution_id;

  -- Only proceed if the challenge date is today
  IF challenge_date = CURRENT_DATE THEN

    -- Check if the user already played this challenge today
    SELECT EXISTS (
      SELECT 1
      FROM public.scores s
      JOIN public.solutions sol2 ON sol2.id = s.solution_id
      JOIN public.challenges c2 ON c2.id = sol2.challenge_id
      WHERE s.user_id = NEW.user_id
        AND c2.date = CURRENT_DATE
        AND s.id <> NEW.id
    ) INTO already_played;

    -- Increment streak only if they haven't played yet
    IF NOT already_played THEN
      UPDATE public.profiles
      SET streak = COALESCE(streak, 0) + 1
      WHERE id = NEW.user_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_increment_streak ON public.scores;

CREATE TRIGGER trigger_increment_streak
AFTER INSERT ON public.scores
FOR EACH ROW
EXECUTE FUNCTION public.increment_streak_on_score();

-- Enable realtime on the profiles table
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
