CREATE TABLE challenges (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    start TEXT NOT NULL,
    goal TEXT NOT NULL
);

ALTER TABLE challenges
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Challenges are visible to everyone."
ON challenges FOR SELECT
TO authenticated, anon
USING ( true );
