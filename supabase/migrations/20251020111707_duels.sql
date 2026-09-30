CREATE TYPE duel_status AS ENUM (
    'Waiting',
    'Starting',
    'InProgress',
    'Closing',
    'Finished'
);

-- Create table with UUID primary key
CREATE TABLE public.duels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status duel_status DEFAULT 'Waiting',
    owner UUID
);

-- Enable row level security
ALTER TABLE public.duels ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read
CREATE POLICY "Duels are visible to everyone."
ON public.duels FOR SELECT
TO authenticated, anon
USING ( true );

-- Enable realtime on the duels table
ALTER PUBLICATION supabase_realtime ADD TABLE public.duels;
