-- Merge `user_challenges` into `challenges`.
--
-- Submissions and daily challenges were never two kinds of thing: promotion
-- copied a submission's content into a new `challenges` row, and the
-- submission's URL then redirected to the daily one. That left two tables with
-- identical content columns, two like tables, two browse RPCs, two solution
-- masking functions, and a `solutions` row that pointed at one table or the
-- other through an XOR constraint.
--
-- One table instead, with `date` carrying the lifecycle:
--
--     date IS NULL      queued, collecting votes
--     date = today      live
--     date < today      settled, keys revealed
--
-- Promotion becomes "set the date", so no content is copied and no solution
-- ever has to move between tables again.

BEGIN;

-- ---------------------------------------------------------------- schema

ALTER TABLE public.challenges
    ADD COLUMN author_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL
        DEFAULT auth.uid(),
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ALTER COLUMN date DROP NOT NULL;

COMMENT ON COLUMN public.challenges.date IS
    'NULL while the challenge is queued for votes; set when it becomes the daily challenge for that day.';
COMMENT ON COLUMN public.challenges.author_id IS
    'Who submitted it. NULL for the challenges that predate user submissions.';

-- --------------------------------------------------- carry over authorship

UPDATE public.challenges c
SET author_id  = uc.author_id,
    created_at = uc.created_at
FROM public.user_challenges uc
WHERE uc.promoted_challenge_id = c.id;

-- Any submission still waiting becomes a dateless challenge. (None exist at
-- the time of writing, but the migration must not depend on that.)
INSERT INTO public.challenges
    (date, start, goal, extension, title, description, author_id, created_at)
SELECT NULL, uc.start, uc.goal, uc.extension, uc.title, uc.description,
       uc.author_id, uc.created_at
FROM public.user_challenges uc
WHERE uc.promoted_at IS NULL;

-- Map every submission to its challenges row, promoted or freshly inserted.
CREATE TEMP TABLE uc_map ON COMMIT DROP AS
SELECT uc.id AS user_challenge_id,
       COALESCE(
           uc.promoted_challenge_id,
           (SELECT c.id FROM public.challenges c
             WHERE c.date IS NULL
               AND c.author_id  = uc.author_id
               AND c.created_at = uc.created_at
               AND c.start      = uc.start
               AND c.goal       = uc.goal
             LIMIT 1)
       ) AS challenge_id
FROM public.user_challenges uc;

DO $$
DECLARE unmapped INTEGER;
BEGIN
    SELECT count(*) INTO unmapped FROM uc_map WHERE challenge_id IS NULL;
    IF unmapped > 0 THEN
        RAISE EXCEPTION 'aborting: % user_challenges could not be mapped to a challenge', unmapped;
    END IF;
END $$;

-- ------------------------------------------------- resolve parked duplicates
--
-- `20260505000001` re-attached preview-play solutions on promotion but skipped
-- any whose key sequence already existed on the target challenge, leaving
-- those parked on the submission. They are genuine duplicates of a daily
-- solution, so fold their scores into the row that survives and drop them.

CREATE TEMP TABLE dup_solutions ON COMMIT DROP AS
SELECT s.id AS dup_id, keep.id AS keep_id
FROM public.solutions s
JOIN uc_map m       ON m.user_challenge_id = s.user_challenge_id
JOIN public.solutions keep
     ON keep.challenge_id = m.challenge_id
    AND keep.keys = s.keys
WHERE s.user_challenge_id IS NOT NULL;

-- A user who already scored the surviving solution keeps that score; their
-- duplicate is redundant. `scores` is UNIQUE (user_id, solution_id).
DELETE FROM public.scores sc
USING dup_solutions d
WHERE sc.solution_id = d.dup_id
  AND EXISTS (
      SELECT 1 FROM public.scores keep
      WHERE keep.solution_id = d.keep_id
        AND keep.user_id = sc.user_id
  );

UPDATE public.scores sc
SET solution_id = d.keep_id
FROM dup_solutions d
WHERE sc.solution_id = d.dup_id;

DELETE FROM public.solutions s
USING dup_solutions d
WHERE s.id = d.dup_id;

-- Everything still on a submission has no daily twin, so it can move across.
UPDATE public.solutions s
SET challenge_id = m.challenge_id,
    user_challenge_id = NULL
FROM uc_map m
WHERE s.user_challenge_id = m.user_challenge_id;

DO $$
DECLARE stranded INTEGER;
BEGIN
    SELECT count(*) INTO stranded FROM public.solutions WHERE user_challenge_id IS NOT NULL;
    IF stranded > 0 THEN
        RAISE EXCEPTION 'aborting: % solutions still reference a user_challenge', stranded;
    END IF;
    SELECT count(*) INTO stranded FROM public.solutions WHERE challenge_id IS NULL;
    IF stranded > 0 THEN
        RAISE EXCEPTION 'aborting: % solutions have no challenge', stranded;
    END IF;
END $$;

ALTER TABLE public.solutions
    DROP CONSTRAINT solutions_target_xor,
    ALTER COLUMN challenge_id SET NOT NULL;
DROP INDEX IF EXISTS public.solutions_unique_per_user_challenge;
ALTER TABLE public.solutions DROP COLUMN user_challenge_id;

-- --------------------------------------------------------- merge comments
--
-- Comments were split the same way as solutions. No uniqueness to worry
-- about here, so they simply move across.

UPDATE public.challenge_comments cc
SET challenge_id = m.challenge_id,
    user_challenge_id = NULL
FROM uc_map m
WHERE cc.user_challenge_id = m.user_challenge_id;

DO $$
DECLARE stranded INTEGER;
BEGIN
    SELECT count(*) INTO stranded FROM public.challenge_comments WHERE user_challenge_id IS NOT NULL;
    IF stranded > 0 THEN
        RAISE EXCEPTION 'aborting: % comments still reference a user_challenge', stranded;
    END IF;
END $$;

ALTER TABLE public.challenge_comments
    DROP CONSTRAINT challenge_comments_target_xor,
    ALTER COLUMN challenge_id SET NOT NULL,
    DROP COLUMN user_challenge_id;

-- ------------------------------------------------------------ merge votes
--
-- A voter may have reacted to both the submission and the daily challenge it
-- became; the earlier reaction on the daily row wins.

INSERT INTO public.challenge_likes (challenge_id, user_id, reaction)
SELECT m.challenge_id, ucl.user_id, ucl.reaction
FROM public.user_challenge_likes ucl
JOIN uc_map m ON m.user_challenge_id = ucl.user_challenge_id
ON CONFLICT (challenge_id, user_id) DO NOTHING;

-- -------------------------------------------------------------- promotion

DROP FUNCTION IF EXISTS public.promote_user_challenge_for_date(DATE);

CREATE OR REPLACE FUNCTION public.promote_challenge_for_date(target_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    winner_id INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM public.challenges WHERE date = target_date) THEN
        RETURN NULL;
    END IF;

    SELECT c.id INTO winner_id
    FROM public.challenges c
    LEFT JOIN public.challenge_likes l ON l.challenge_id = c.id
    WHERE c.date IS NULL
    GROUP BY c.id, c.created_at
    ORDER BY (
        count(*) FILTER (WHERE l.reaction = 'up')
        - count(*) FILTER (WHERE l.reaction = 'down')
    ) DESC,
    c.created_at ASC
    LIMIT 1;

    IF winner_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE public.challenges SET date = target_date WHERE id = winner_id;
    RETURN winner_id;
END $$;

-- ----------------------------------------------------------------- masking
--
-- One rule now. A queued challenge has no date, so it stays masked for
-- everyone but its solver until it is promoted and its day has passed.

-- The daily-challenge equivalents are date-agnostic, so they now serve
-- queued challenges too and these twins are redundant.
-- The return type gains `challenge_id`, so the function cannot simply be
-- replaced; the view that depends on it has to come down first and is
-- recreated below.
DROP VIEW IF EXISTS public.ranked_solutions;
DROP FUNCTION IF EXISTS public.get_ranked_solutions();
DROP FUNCTION IF EXISTS public.get_ranked_user_challenge_solutions(BIGINT);
DROP FUNCTION IF EXISTS public.get_user_challenge_comments(INTEGER);
DROP FUNCTION IF EXISTS public.get_user_challenge_reaction_state(INTEGER);
DROP FUNCTION IF EXISTS public.toggle_user_challenge_reaction(INTEGER, public.challenge_like);
DROP FUNCTION IF EXISTS public.get_my_user_challenges();

CREATE OR REPLACE FUNCTION public.get_ranked_solutions()
RETURNS TABLE (
    id INTEGER,
    full_name TEXT,
    user_id UUID,
    user_name TEXT,
    avatar_url TEXT,
    streak INTEGER,
    challenge_id INTEGER,
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
    sol.challenge_id,
    c.date,
    CASE
        WHEN (c.date IS NULL OR c.date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date)
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
    (c.date IS NULL OR c.date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) AS hidden_today
FROM public.solutions sol
FULL OUTER JOIN public.profiles p ON sol.user_id = p.id
JOIN public.challenges c ON sol.challenge_id = c.id;
$$;

CREATE VIEW public.ranked_solutions
WITH (security_invoker = true)
AS SELECT * FROM public.get_ranked_solutions();

-- ------------------------------------------------------------------ browse

CREATE TYPE public.challenge_status AS ENUM ('all', 'queued', 'live', 'past');

DROP FUNCTION IF EXISTS public.get_user_challenges(public.user_challenge_filter, public.user_challenge_status, public.prog_extension);
DROP FUNCTION IF EXISTS public.get_challenges(public.challenge_filter);

CREATE OR REPLACE FUNCTION public.get_challenges(
    filter_type      public.challenge_filter   DEFAULT 'most_recent',
    status_filter    public.challenge_status   DEFAULT 'all',
    extension_filter public.prog_extension     DEFAULT NULL,
    author_filter    UUID                      DEFAULT NULL
)
RETURNS TABLE (
    id           INTEGER,
    date         DATE,
    start        TEXT,
    goal         TEXT,
    extension    public.prog_extension,
    title        TEXT,
    description  TEXT,
    author_id    UUID,
    author_name  TEXT,
    created_at   TIMESTAMPTZ,
    play_count   BIGINT,
    like_count   BIGINT,
    up_count     BIGINT,
    down_count   BIGINT,
    played_by_me BOOLEAN,
    queue_place  INTEGER
)
LANGUAGE sql
SET search_path = ''
AS $$
WITH stats AS (
    SELECT
        c.id, c.date, c.start, c.goal, c.extension, c.title, c.description,
        c.author_id, p.user_name AS author_name, c.created_at,
        count(DISTINCT sc.id) AS play_count,
        count(DISTINCT cl.id) FILTER (WHERE cl.reaction = 'up') AS up_count,
        count(DISTINCT cl.id) FILTER (WHERE cl.reaction = 'down') AS down_count,
        count(DISTINCT cl.id) FILTER (WHERE cl.reaction = 'up')
          - count(DISTINCT cl.id) FILTER (WHERE cl.reaction = 'down') AS like_count,
        EXISTS (
            SELECT 1 FROM public.solutions s2
            WHERE s2.challenge_id = c.id AND s2.user_id = auth.uid()
        ) OR EXISTS (
            SELECT 1 FROM public.scores sc2
            JOIN public.solutions s3 ON s3.id = sc2.solution_id
            WHERE s3.challenge_id = c.id AND sc2.user_id = auth.uid()
        ) AS played_by_me
    FROM public.challenges c
    LEFT JOIN public.profiles p        ON p.id = c.author_id
    LEFT JOIN public.solutions s       ON s.challenge_id = c.id
    LEFT JOIN public.scores sc         ON sc.solution_id = s.id
    LEFT JOIN public.challenge_likes cl ON cl.challenge_id = c.id
    WHERE c.date IS NULL OR c.date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
    GROUP BY c.id, p.user_name
),
ranked AS (
    SELECT s.*,
           CASE WHEN s.date IS NULL THEN
               RANK() OVER (
                   PARTITION BY (s.date IS NULL)
                   ORDER BY s.like_count DESC, s.created_at ASC
               )::INTEGER
           END AS queue_place
    FROM stats s
)
SELECT * FROM ranked r
WHERE (CASE
         WHEN status_filter = 'queued' THEN r.date IS NULL
         WHEN status_filter = 'live'   THEN r.date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
         WHEN status_filter = 'past'   THEN r.date < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
         ELSE TRUE
       END)
  AND (extension_filter IS NULL OR r.extension = extension_filter)
  AND (author_filter IS NULL OR r.author_id = author_filter)
  AND (CASE
         WHEN filter_type = 'played_by_me'     THEN r.played_by_me
         WHEN filter_type = 'not_played_by_me' THEN NOT r.played_by_me
         ELSE TRUE
       END)
ORDER BY
    CASE WHEN filter_type = 'most_played' THEN r.play_count END DESC,
    CASE WHEN filter_type = 'most_liked'  THEN r.like_count END DESC,
    r.queue_place ASC NULLS LAST,
    r.date DESC NULLS FIRST;
$$;

-- --------------------------------------------------------------------- RLS
--
-- Replaces the policies that lived on `user_challenges`: authors may submit a
-- queued challenge and withdraw it, but not once it has a date.

CREATE POLICY "Authors can submit queued challenges."
ON public.challenges FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = author_id AND date IS NULL);

CREATE POLICY "Authors can withdraw their queued challenges."
ON public.challenges FOR DELETE
TO authenticated
USING (auth.uid() = author_id AND date IS NULL);

-- ------------------------------------------------------------------- drops

DROP TABLE public.user_challenge_likes;
DROP TABLE public.user_challenges;
DROP TYPE public.user_challenge_filter;
DROP TYPE public.user_challenge_status;

COMMIT;
