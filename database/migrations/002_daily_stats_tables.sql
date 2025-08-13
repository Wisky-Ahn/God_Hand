-- Migration: 002_daily_stats_tables.sql
-- Description: Add tables for daily statistics aggregation system
-- Date: 2025-01-28

-- Daily statistics aggregation table
-- This table stores pre-calculated daily statistics for each user
CREATE TABLE IF NOT EXISTS daily_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    guild_id VARCHAR(255) NOT NULL,
    
    -- Voice activity stats
    voice_score DECIMAL(10,2) DEFAULT 0,
    voice_time INTEGER DEFAULT 0, -- seconds
    voice_sessions INTEGER DEFAULT 0,
    
    -- Message activity stats  
    message_score DECIMAL(10,2) DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    
    -- Reaction stats
    reaction_given_score DECIMAL(10,2) DEFAULT 0,
    reaction_given_count INTEGER DEFAULT 0,
    reaction_received_score DECIMAL(10,2) DEFAULT 0,
    reaction_received_count INTEGER DEFAULT 0,
    
    -- Streaming stats
    streaming_score DECIMAL(10,2) DEFAULT 0,
    streaming_time INTEGER DEFAULT 0, -- seconds
    
    -- Other activity stats
    other_score DECIMAL(10,2) DEFAULT 0,
    other_count INTEGER DEFAULT 0,
    
    -- Totals
    total_score DECIMAL(10,2) DEFAULT 0,
    total_activities INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint to prevent duplicate entries
    UNIQUE(date, user_id, guild_id)
);

-- Guild daily summary table
-- This table stores guild-wide daily statistics
CREATE TABLE IF NOT EXISTS guild_daily_summary (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    guild_id VARCHAR(255) NOT NULL,
    
    -- Summary statistics
    active_users INTEGER DEFAULT 0,
    total_score DECIMAL(12,2) DEFAULT 0,
    total_activities INTEGER DEFAULT 0,
    avg_score_per_user DECIMAL(10,2) DEFAULT 0,
    
    -- Top performer info
    top_user_id VARCHAR(255),
    top_user_score DECIMAL(10,2) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(date, guild_id)
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_daily_stats_date_user ON daily_stats(date, user_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date_guild ON daily_stats(date, guild_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date_range ON daily_stats(user_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_guild_date_range ON daily_stats(guild_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_total_score ON daily_stats(total_score DESC);

CREATE INDEX IF NOT EXISTS idx_guild_summary_date_guild ON guild_daily_summary(date, guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_summary_guild_date_range ON guild_daily_summary(guild_id, date);

-- Add updated_at triggers for both tables
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to daily_stats table
DROP TRIGGER IF EXISTS update_daily_stats_updated_at ON daily_stats;
CREATE TRIGGER update_daily_stats_updated_at
    BEFORE UPDATE ON daily_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to guild_daily_summary table  
DROP TRIGGER IF EXISTS update_guild_summary_updated_at ON guild_daily_summary;
CREATE TRIGGER update_guild_summary_updated_at
    BEFORE UPDATE ON guild_daily_summary
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add foreign key constraints (optional, but recommended)
-- Note: Uncomment these if you want strict referential integrity
-- ALTER TABLE daily_stats 
--     ADD CONSTRAINT fk_daily_stats_guild 
--     FOREIGN KEY (guild_id) REFERENCES guilds(discord_id) ON DELETE CASCADE;

-- Create a view for easy querying of recent daily stats
CREATE OR REPLACE VIEW recent_daily_stats AS
SELECT 
    ds.*,
    u.display_name,
    u.current_score as current_user_score,
    RANK() OVER (PARTITION BY ds.date, ds.guild_id ORDER BY ds.total_score DESC) as daily_rank
FROM daily_stats ds
LEFT JOIN users u ON ds.user_id = u.discord_id
WHERE ds.date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY ds.date DESC, ds.total_score DESC;

-- Create a view for guild performance trends
CREATE OR REPLACE VIEW guild_performance_trends AS
SELECT 
    guild_id,
    date,
    active_users,
    total_score,
    avg_score_per_user,
    LAG(active_users) OVER (PARTITION BY guild_id ORDER BY date) as prev_active_users,
    LAG(total_score) OVER (PARTITION BY guild_id ORDER BY date) as prev_total_score,
    LAG(avg_score_per_user) OVER (PARTITION BY guild_id ORDER BY date) as prev_avg_score
FROM guild_daily_summary
WHERE date >= CURRENT_DATE - INTERVAL '60 days'
ORDER BY guild_id, date DESC;

-- Insert initial data migration note
INSERT INTO schema_migrations (filename, applied_at) 
VALUES ('002_daily_stats_tables.sql', CURRENT_TIMESTAMP)
ON CONFLICT (filename) DO NOTHING; 