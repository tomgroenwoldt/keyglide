CREATE TABLE profiles (
    id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    full_name TEXT,
    user_name TEXT NOT NULL,
    avatar_url TEXT,
    PRIMARY KEY(id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are visible to everyone."
ON profiles FOR SELECT
TO authenticated, anon
USING ( true );
