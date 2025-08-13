-- GodHand Discord Bot Database Indexes
-- Performance optimization indexes for hierarchical ranking and music system
-- Created: 2024-01-XX
-- Version: 1.0

-- =====================================
-- Primary Performance Indexes
-- =====================================

-- Users table indexes (critical for ranking system)
CREATE INDEX idx_users_discord_id ON users(discord_id);
CREATE INDEX idx_users_guild_rank ON users(guild_id, current_rank) WHERE is_active = TRUE;
CREATE INDEX idx_users_current_score ON users(current_score DESC) WHERE is_active = TRUE;
CREATE INDEX idx_users_last_active ON users(last_active DESC) WHERE is_active = TRUE;

-- Activities table indexes (heavy insert/query table)
CREATE INDEX idx_activities_user_timestamp ON activities(user_id, timestamp DESC);
CREATE INDEX idx_activities_guild_timestamp ON activities(guild_id, timestamp DESC);
CREATE INDEX idx_activities_type_timestamp ON activities(activity_type, timestamp DESC);
CREATE INDEX idx_activities_processing ON activities(is_processed, timestamp) WHERE is_processed = FALSE;

-- Voice Sessions indexes (real-time tracking)
CREATE INDEX idx_voice_sessions_user_start ON voice_sessions(user_id, start_time DESC);
CREATE INDEX idx_voice_sessions_active ON voice_sessions(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_voice_sessions_guild_active ON voice_sessions(guild_id, channel_id) WHERE is_active = TRUE;
CREATE INDEX idx_voice_sessions_duration ON voice_sessions(duration DESC) WHERE duration IS NOT NULL;

-- Daily Stats indexes (aggregated queries)
CREATE INDEX idx_daily_stats_date_user ON daily_stats(date DESC, user_id);
CREATE INDEX idx_daily_stats_guild_date ON daily_stats(guild_id, date DESC);
CREATE INDEX idx_daily_stats_rank_date ON daily_stats(daily_rank, date DESC) WHERE daily_rank IS NOT NULL;

-- =====================================
-- Music System Indexes
-- =====================================

-- Music Logs indexes (hierarchical permission queries)
CREATE INDEX idx_music_logs_guild_timestamp ON music_logs(guild_id, timestamp DESC);
CREATE INDEX idx_music_logs_requester ON music_logs(requester_id, timestamp DESC);
CREATE INDEX idx_music_logs_controller ON music_logs(controller_id, action_type, timestamp DESC);
CREATE INDEX idx_music_logs_permissions ON music_logs(requester_rank, controller_rank, permission_granted);
CREATE INDEX idx_music_logs_track ON music_logs(track_url, guild_id) WHERE action_type = 'queue_add';

-- =====================================
-- Season Management Indexes
-- =====================================

-- Seasons indexes
CREATE INDEX idx_seasons_guild_status ON seasons(guild_id, status, start_date DESC);
CREATE INDEX idx_seasons_active ON seasons(status, start_date, end_date) WHERE status = 'active';
CREATE INDEX idx_seasons_number ON seasons(guild_id, season_number DESC);

-- Season Rankings indexes
CREATE INDEX idx_season_rankings_season_rank ON season_rankings(season_id, final_rank);
CREATE INDEX idx_season_rankings_user_score ON season_rankings(user_id, final_score DESC);
CREATE INDEX idx_season_rankings_achievements ON season_rankings(season_id, is_winner, is_top_3, is_top_10);

-- =====================================
-- Composite Indexes for Complex Queries
-- =====================================

-- Real-time ranking queries (most critical)
CREATE INDEX idx_users_ranking_composite ON users(guild_id, current_score DESC, current_rank, is_active) 
    WHERE is_active = TRUE;

-- Voice activity analysis
CREATE INDEX idx_voice_activity_composite ON voice_sessions(user_id, guild_id, start_time DESC, duration) 
    WHERE is_active = FALSE AND duration IS NOT NULL;

-- Daily activity aggregation
CREATE INDEX idx_daily_activity_composite ON activities(user_id, guild_id, DATE(timestamp), activity_type, score_awarded)
    WHERE is_processed = TRUE;

-- Music permission validation (critical for hierarchical system)
CREATE INDEX idx_music_permission_composite ON music_logs(guild_id, action_type, requester_rank, controller_rank, timestamp DESC)
    WHERE permission_granted = TRUE;

-- =====================================
-- Partial Indexes for Optimization
-- =====================================

-- Only index active voice sessions (reduces index size)
CREATE INDEX idx_voice_sessions_active_only ON voice_sessions(user_id, channel_id, start_time)
    WHERE is_active = TRUE;

-- Only index recent activities (last 30 days for performance)
CREATE INDEX idx_activities_recent ON activities(user_id, timestamp DESC, activity_type)
    WHERE timestamp > NOW() - INTERVAL '30 days';

-- Only index current season data
CREATE INDEX idx_users_current_season ON users(guild_id, current_score DESC, username)
    WHERE is_active = TRUE AND current_score > 0;

-- Only index failed music permissions (for monitoring)
CREATE INDEX idx_music_permission_denied ON music_logs(controller_rank, requester_rank, action_type, timestamp)
    WHERE permission_granted = FALSE;

-- =====================================
-- Text Search Indexes (for track titles)
-- =====================================

-- Full-text search for music tracks (PostgreSQL specific)
CREATE INDEX idx_music_logs_track_title_gin ON music_logs USING GIN(to_tsvector('english', track_title))
    WHERE track_title IS NOT NULL;

-- =====================================
-- Statistics and Analytics Indexes
-- =====================================

-- Lifetime stats queries
CREATE INDEX idx_lifetime_stats_ranking ON lifetime_stats(average_rank, total_score DESC, first_place_wins DESC);
CREATE INDEX idx_lifetime_stats_consistency ON lifetime_stats(consistency_index, total_seasons_participated DESC);

-- Guild statistics
CREATE INDEX idx_guilds_settings ON guilds USING GIN(settings)
    WHERE settings != '{}';

-- =====================================
-- Maintenance Indexes
-- =====================================

-- For cleanup operations (old data removal)
CREATE INDEX idx_activities_cleanup ON activities(timestamp) 
    WHERE timestamp < NOW() - INTERVAL '90 days';

CREATE INDEX idx_voice_sessions_cleanup ON voice_sessions(created_at)
    WHERE created_at < NOW() - INTERVAL '90 days' AND is_active = FALSE;

-- For data integrity checks
CREATE INDEX idx_users_orphaned ON users(guild_id) 
    WHERE guild_id NOT IN (SELECT id FROM guilds);

-- =====================================
-- Comments for Index Documentation
-- =====================================

COMMENT ON INDEX idx_users_ranking_composite IS 'Critical index for real-time ranking queries and music permission validation';
COMMENT ON INDEX idx_music_permission_composite IS 'Optimizes hierarchical music control permission checks';
COMMENT ON INDEX idx_voice_sessions_active_only IS 'Tracks currently active voice sessions for real-time monitoring';
COMMENT ON INDEX idx_activities_recent IS 'Optimizes recent activity queries while reducing index size';
COMMENT ON INDEX idx_music_logs_track_title_gin IS 'Enables full-text search for music track titles';

-- =====================================
-- Index Maintenance Notes
-- =====================================

-- Run ANALYZE after creating indexes
-- ANALYZE users, activities, voice_sessions, music_logs, daily_stats;

-- Monitor index usage with:
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch 
-- FROM pg_stat_user_indexes ORDER BY idx_scan DESC;

-- Check index sizes with:
-- SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size
-- FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC; 