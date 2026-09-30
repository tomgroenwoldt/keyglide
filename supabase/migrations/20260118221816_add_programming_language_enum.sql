CREATE TYPE prog_extension AS ENUM (
  'js', 
  'ts', 
  'py', 
  'cpp', 
  'java', 
  'rb', 
  'go', 
  'rs', 
  'php', 
  'swift',
  'unknown'
);

ALTER TABLE public.challenges 
ADD COLUMN extension prog_extension NOT NULL DEFAULT 'unknown';
