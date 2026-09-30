CREATE TABLE solutions (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) DEFAULT auth.uid(),
    challenge_id INTEGER NOT NULL REFERENCES public.challenges,
    keys TEXT[] NOT NULL
);

ALTER TABLE solutions
ADD CONSTRAINT unique_solution UNIQUE (keys, challenge_id);

ALTER TABLE solutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Solutions are visible to everyone."
ON solutions FOR SELECT
TO authenticated, anon
USING ( true );

CREATE POLICY "Authenticated users can create solutions."
ON solutions FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can delete their own solutions."
ON solutions FOR DELETE
TO authenticated
USING (user_id = auth.uid());

ALTER TABLE scores
ADD COLUMN solution_id INTEGER REFERENCES public.solutions ON DELETE CASCADE;

INSERT INTO solutions (user_id, challenge_id, keys)
SELECT DISTINCT ON (s.challenge_id, s.keys)
    s.user_id,
    s.challenge_id,
    s.keys
FROM scores s
LEFT JOIN solutions sol
    ON sol.challenge_id = s.challenge_id
    AND sol.keys = s.keys
WHERE sol.id IS NULL
ORDER BY s.challenge_id, s.keys, s.stop_time ASC;

UPDATE scores sc
SET solution_id = sol.id
FROM solutions sol
WHERE sol.challenge_id = sc.challenge_id
    AND sol.keys = sc.keys;

ALTER TABLE scores DROP CONSTRAINT unique_user_challenge;

ALTER TABLE scores
ADD CONSTRAINT unique_scores_per_solution UNIQUE (user_id, solution_id);

DROP POLICY IF EXISTS "Scores are visible to everyone who played the challenge." ON scores;
DROP VIEW IF EXISTS public.challenge_participation;

ALTER TABLE scores
DROP COLUMN challenge_id,
DROP COLUMN keys;

CREATE POLICY "Scores are visible to everyone."
ON scores FOR SELECT
TO authenticated, anon
USING ( true );

DROP VIEW IF EXISTS public.censored_scores;

DROP FUNCTION IF EXISTS public.get_user_specific_scores(UUID);

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
SECURITY DEFINER
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

ALTER
  PUBLICATION supabase_realtime ADD TABLE solutions;
