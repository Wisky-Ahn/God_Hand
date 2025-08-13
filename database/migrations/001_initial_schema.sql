-- Migration: 001_initial_schema.sql
-- Description: Initial database schema setup for GodHand Discord Bot
-- Created: 2024-01-XX
-- Version: 1.0

-- Execute the main schema file
\i '../schema.sql'

-- Execute the indexes file  
\i '../indexes.sql'

-- Insert initial data
INSERT INTO guilds (guild_id, name, settings) VALUES 
('000000000000000000', 'Default Server', '{"timezone": "UTC", "season_length_days": 14}')
ON CONFLICT (guild_id) DO NOTHING;

-- Insert initial season (placeholder)
INSERT INTO seasons (guild_id, name, season_number, start_date, end_date, status)
SELECT 
  id, 
  'Season 1', 
  1, 
  NOW(), 
  NOW() + INTERVAL '14 days',
  'active'
FROM guilds 
WHERE guild_id = '000000000000000000'
ON CONFLICT (guild_id, season_number) DO NOTHING;

-- Migration metadata
INSERT INTO schema_migrations (version, applied_at) VALUES 
('001', NOW())
ON CONFLICT (version) DO NOTHING; 