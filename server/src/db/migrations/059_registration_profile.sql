ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS stage_name TEXT;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_full_name_length CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT user_profiles_stage_name_length CHECK (stage_name IS NULL OR char_length(btrim(stage_name)) BETWEEN 1 AND 100);
