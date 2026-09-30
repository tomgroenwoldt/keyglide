-- Migrate currently happening streaks based on scores.
WITH played_days AS (
  SELECT DISTINCT
    s.user_id,
    c.date AS challenge_date
  FROM public.scores s
  JOIN public.solutions sol ON sol.id = s.solution_id
  JOIN public.challenges c ON c.id = sol.challenge_id
  WHERE DATE(s.start_time) = c.date  -- ✅ played on same day
),
numbered AS (
  SELECT
    user_id,
    challenge_date,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY challenge_date) AS rn
  FROM played_days
),
grouped AS (
  SELECT
    user_id,
    challenge_date,
    rn - EXTRACT(EPOCH FROM challenge_date::timestamp)/86400 AS grp
  FROM numbered
),
streak_segments AS (
  SELECT
    user_id,
    MIN(challenge_date) AS start_day,
    MAX(challenge_date) AS end_day,
    COUNT(*) AS streak_length
  FROM grouped
  GROUP BY user_id, grp
),
latest_streak AS (
  SELECT DISTINCT ON (user_id)
    s.user_id,
    s.end_day,
    s.streak_length
  FROM streak_segments s
  JOIN (
    SELECT user_id, MAX(challenge_date) AS last_play
    FROM played_days
    GROUP BY user_id
  ) lp ON lp.user_id = s.user_id AND s.end_day = lp.last_play
  ORDER BY s.user_id, s.end_day DESC
)
UPDATE public.profiles p
SET streak =
  CASE
    WHEN ls.end_day >= CURRENT_DATE - INTERVAL '1 day' THEN COALESCE(ls.streak_length, 0)
    ELSE 0  -- 🔥 reset streak if last played not yesterday/today
  END
FROM latest_streak ls
WHERE p.id = ls.user_id;

