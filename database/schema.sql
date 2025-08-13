-- GodHand Discord Bot Database Schema
-- PostgreSQL Database Schema for hierarchical ranking and music permission system
-- Created: 2024-01-XX
-- Version: 1.0

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS daily_stats CASCADE;
DROP TABLE IF EXISTS music_logs CASCADE;
DROP TABLE IF EXISTS voice_sessions CASCADE;
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS season_rankings CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;
DROP TABLE IF EXISTS lifetime_stats CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS guilds CASCADE;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================
-- Core Tables
-- =====================================

-- Guilds (Discord Servers)
CREATE TABLE guilds (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users (Current Season Data)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    discord_id VARCHAR(20) NOT NULL UNIQUE,
    guild_id VARCHAR(20) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    discriminator VARCHAR(4),
    display_name VARCHAR(255),
    
    -- Current Season Stats
    current_score DECIMAL(10,2) DEFAULT 0.00,
    current_rank INTEGER DEFAULT 0,
    voice_score DECIMAL(10,2) DEFAULT 0.00,
    message_score DECIMAL(10,2) DEFAULT 0.00,
    reaction_score DECIMAL(10,2) DEFAULT 0.00,
    other_score DECIMAL(10,2) DEFAULT 0.00,
    
    -- Activity Tracking
    total_voice_time INTEGER DEFAULT 0, -- seconds
    total_messages INTEGER DEFAULT 0,
    total_reactions_given INTEGER DEFAULT 0,
    total_reactions_received INTEGER DEFAULT 0,
    
    -- Status & Metadata
    is_active BOOLEAN DEFAULT TRUE,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_voice_activity TIMESTAMP WITH TIME ZONE,
    last_message_activity TIMESTAMP WITH TIME ZONE,
    
    -- Settings
    user_settings JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(discord_id, guild_id)
);

-- Lifetime Statistics (Cumulative across all seasons)
CREATE TABLE lifetime_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    
    -- Cumulative Stats
    total_score DECIMAL(12,2) DEFAULT 0.00,
    total_voice_time INTEGER DEFAULT 0, -- seconds
    total_messages INTEGER DEFAULT 0,
    total_seasons_participated INTEGER DEFAULT 0,
    
    -- Achievement Stats
    first_place_wins INTEGER DEFAULT 0,
    top_3_finishes INTEGER DEFAULT 0,
    top_10_finishes INTEGER DEFAULT 0,
    
    -- Performance Metrics
    average_rank DECIMAL(6,2) DEFAULT 0.00,
    best_rank INTEGER DEFAULT 0,
    worst_rank INTEGER DEFAULT 0,
    consistency_index DECIMAL(6,4) DEFAULT 0.0000, -- Lower = more consistent
    
    -- Streaks
    current_season_streak INTEGER DEFAULT 0,
    longest_season_streak INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================
-- Season Management
-- =====================================

-- Seasons (2-week periods)
CREATE TABLE seasons (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(20) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    season_number INTEGER NOT NULL,
    
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
    
    -- Season Metadata
    total_participants INTEGER DEFAULT 0,
    total_activities INTEGER DEFAULT 0,
    settings JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(guild_id, season_number)
);

-- Season Rankings (Final rankings for each season)
CREATE TABLE season_rankings (
    id SERIAL PRIMARY KEY,
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    
    final_score DECIMAL(10,2) NOT NULL,
    final_rank INTEGER NOT NULL,
    
    -- Detailed Breakdown
    voice_score DECIMAL(10,2) DEFAULT 0.00,
    message_score DECIMAL(10,2) DEFAULT 0.00,
    reaction_score DECIMAL(10,2) DEFAULT 0.00,
    other_score DECIMAL(10,2) DEFAULT 0.00,
    
    -- Activity Counts
    total_voice_time INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    days_active INTEGER DEFAULT 0,
    
    -- Achievement Flags
    is_winner BOOLEAN DEFAULT FALSE,
    is_top_3 BOOLEAN DEFAULT FALSE,
    is_top_10 BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(season_id, user_id),
    UNIQUE(season_id, final_rank)
);

-- =====================================
-- Activity Tracking
-- =====================================

-- Activities (Detailed activity logs)
CREATE TABLE activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    guild_id VARCHAR(20) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    
    -- Activity Details
    activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN (
        'voice_join', 'voice_leave', 'voice_speaking', 'voice_mute', 'voice_deafen',
        'message_create', 'message_delete', 'message_edit',
        'reaction_add', 'reaction_remove',
        'screen_share_start', 'screen_share_stop',
        'stream_start', 'stream_stop',
        'music_play', 'music_stop', 'music_skip', 'music_queue',
        'music_add_track', 'music_track_end', 'music_volume_change',
        'music_repeat_change', 'music_shuffle', 'music_remove_track', 'music_clear_queue'
    )),
    
    score_awarded DECIMAL(8,4) DEFAULT 0.0000,
    
    -- Context Data
    channel_id VARCHAR(20),
    channel_name VARCHAR(255),
    details JSONB DEFAULT '{}',
    
    -- Time & Multipliers
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    time_multiplier DECIMAL(4,2) DEFAULT 1.00,
    
    -- Processing Status
    is_processed BOOLEAN DEFAULT TRUE,
    processing_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Voice Sessions (Voice channel activity tracking)
CREATE TABLE voice_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    guild_id VARCHAR(20) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    
    -- Channel Information
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(255),
    
    -- Session Timeline
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    duration INTEGER, -- seconds (calculated when session ends)
    
    -- Activity Details
    speaking_time INTEGER DEFAULT 0, -- seconds of actual speaking
    -- afk_time 필드 제거됨
    alone_time INTEGER DEFAULT 0, -- seconds spent alone in channel
    with_others_time INTEGER DEFAULT 0, -- seconds with other users
    
    -- Special Activities
    screen_share_time INTEGER DEFAULT 0,
    streaming_time INTEGER DEFAULT 0,
    
    -- Scoring
    base_score DECIMAL(8,4) DEFAULT 0.0000,
    speaking_bonus DECIMAL(8,4) DEFAULT 0.0000,
    social_bonus DECIMAL(8,4) DEFAULT 0.0000,
    special_bonus DECIMAL(8,4) DEFAULT 0.0000,
    -- afk_penalty 필드 제거됨
    total_score DECIMAL(8,4) DEFAULT 0.0000,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    session_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================
-- Music System
-- =====================================

-- Music Logs (Music playback and control history)
CREATE TABLE music_logs (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(20) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    
    -- User Information
    requester_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Who requested the music
    controller_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Who controlled it (stop/skip)
    
    -- Track Information
    track_url VARCHAR(500),
    track_title VARCHAR(500),
    track_duration INTEGER, -- seconds
    track_thumbnail VARCHAR(500),
    
    -- Playback Details
    action_type VARCHAR(20) NOT NULL CHECK (action_type IN (
        'queue_add', 'play_start', 'play_pause', 'play_resume', 
        'play_stop', 'play_skip', 'volume_change', 'queue_clear'
    )),
    
    -- Ranking Context (for permission validation)
    requester_rank INTEGER,
    controller_rank INTEGER,
    permission_granted BOOLEAN DEFAULT TRUE,
    
    -- Technical Details
    channel_id VARCHAR(20),
    volume_level INTEGER DEFAULT 50,
    queue_position INTEGER,
    
    -- Metadata
    details JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================
-- Performance & Analytics
-- =====================================

-- Daily Statistics (Aggregated daily data for performance)
CREATE TABLE daily_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    guild_id VARCHAR(20) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    
    -- Daily Scores
    daily_voice_score DECIMAL(8,4) DEFAULT 0.0000,
    daily_message_score DECIMAL(8,4) DEFAULT 0.0000,
    daily_reaction_score DECIMAL(8,4) DEFAULT 0.0000,
    daily_other_score DECIMAL(8,4) DEFAULT 0.0000,
    daily_total_score DECIMAL(8,4) DEFAULT 0.0000,
    
    -- Daily Activity Counts
    voice_sessions INTEGER DEFAULT 0,
    voice_time INTEGER DEFAULT 0, -- seconds
    messages_sent INTEGER DEFAULT 0,
    reactions_given INTEGER DEFAULT 0,
    reactions_received INTEGER DEFAULT 0,
    
    -- Daily Rankings
    daily_rank INTEGER,
    rank_change INTEGER DEFAULT 0,
    
    -- Engagement Metrics
    peak_concurrent_users INTEGER DEFAULT 0,
    active_hours INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(date, user_id, guild_id)
);

-- =====================================
-- Triggers for Updated_at
-- =====================================

-- Function to update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at columns
CREATE TRIGGER update_guilds_updated_at BEFORE UPDATE ON guilds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lifetime_stats_updated_at BEFORE UPDATE ON lifetime_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_seasons_updated_at BEFORE UPDATE ON seasons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_voice_sessions_updated_at BEFORE UPDATE ON voice_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_daily_stats_updated_at BEFORE UPDATE ON daily_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================
-- Comments for Documentation
-- =====================================

COMMENT ON TABLE guilds IS 'Discord servers using the bot';
COMMENT ON TABLE users IS 'Current season user data with real-time rankings';
COMMENT ON TABLE lifetime_stats IS 'Cumulative user statistics across all seasons';
COMMENT ON TABLE seasons IS '2-week competitive seasons';
COMMENT ON TABLE season_rankings IS 'Final rankings for completed seasons';
COMMENT ON TABLE activities IS 'Detailed log of all user activities';
COMMENT ON TABLE voice_sessions IS 'Voice channel activity tracking';
COMMENT ON TABLE music_logs IS 'Music playback history with hierarchical permission tracking';
COMMENT ON TABLE daily_stats IS 'Daily aggregated statistics for performance optimization';

COMMENT ON COLUMN users.current_rank IS 'Real-time rank used for music permission system';
COMMENT ON COLUMN music_logs.requester_rank IS 'Rank of user who requested the music';
COMMENT ON COLUMN music_logs.controller_rank IS 'Rank of user who controlled the music (for permission validation)';
COMMENT ON COLUMN activities.time_multiplier IS 'Time-based score multiplier (evening bonus, dawn penalty, etc.)';
COMMENT ON COLUMN lifetime_stats.consistency_index IS 'Lower values indicate more consistent performance across seasons'; 