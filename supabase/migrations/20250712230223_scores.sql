CREATE TABLE scores (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) DEFAULT auth.uid(),
    challenge_id INTEGER NOT NULL REFERENCES public.challenges,
    keys TEXT[] NOT NULL,
    start_time TIMESTAMP NOT NULL,
    stop_time TIMESTAMP NOT NULL
);

ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

ALTER TABLE scores
ADD CONSTRAINT unique_user_challenge UNIQUE (user_id, challenge_id);

CREATE POLICY "Authenticated users can create their own scores."
ON scores FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can delete their own scores."
ON scores FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_user_specific_scores(current_uid UUID)
RETURNS TABLE (
    id INTEGER,
    start_time TIMESTAMP,
    stop_time TIMESTAMP,
    full_name TEXT,
    user_name TEXT,
    avatar_url TEXT,
    date DATE,
    keys TEXT[],
    place INTEGER,
    user_id UUID
)
LANGUAGE sql
SECURITY DEFINER
AS $$
SELECT
    s.id,
    s.start_time,
    s.stop_time,
    p.full_name,
    p.user_name,
    p.avatar_url,
    c.date,
    CASE
        WHEN s.user_id = current_uid THEN s.keys -- allow own keys
        WHEN EXISTS (
            SELECT 1 FROM scores s2
            WHERE s2.user_id = current_uid AND s2.challenge_id = s.challenge_id
        )
        THEN s.keys -- allow if user played same challenge
        ELSE array_fill('?'::text, ARRAY[COALESCE(array_length(s.keys, 1), 0)]) -- censor
    END AS keys,
    DENSE_RANK() OVER (
        PARTITION BY s.challenge_id
        ORDER BY COALESCE(array_length(s.keys, 1), 0) ASC
    ) AS place,
    s.user_id
FROM scores s
FULL OUTER JOIN profiles p ON s.user_id = p.id
JOIN challenges c ON s.challenge_id = c.id;
$$;

CREATE OR REPLACE VIEW public.censored_scores AS
SELECT * FROM public.get_user_specific_scores(auth.uid());

CREATE OR REPLACE VIEW public.challenge_participation AS
SELECT DISTINCT user_id, challenge_id
FROM public.scores;

CREATE POLICY "Scores are visible to everyone who played the challenge."
ON scores
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid() OR 
    EXISTS (
        SELECT 1
        FROM public.challenge_participation p
        WHERE p.user_id = auth.uid()
          AND p.challenge_id = scores.challenge_id
    )
);
