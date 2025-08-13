-- Migration: 003_admin_actions_table.sql
-- Description: Add admin_actions table for logging administrative actions
-- Date: 2025-01-28

-- Admin actions log table
-- This table stores all administrative actions performed by admins
CREATE TABLE IF NOT EXISTS admin_actions (
    id SERIAL PRIMARY KEY,
    admin_id VARCHAR(255) NOT NULL,
    target_user_id VARCHAR(255),
    action_type VARCHAR(100) NOT NULL,
    details JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for common queries
    INDEX idx_admin_actions_admin_id (admin_id),
    INDEX idx_admin_actions_target_user (target_user_id),
    INDEX idx_admin_actions_timestamp (timestamp),
    INDEX idx_admin_actions_type (action_type),
    INDEX idx_admin_actions_composite (admin_id, action_type, timestamp)
);

-- Add comments for documentation
COMMENT ON TABLE admin_actions IS 'Logs all administrative actions performed by admins';
COMMENT ON COLUMN admin_actions.admin_id IS 'Discord ID of the admin who performed the action';
COMMENT ON COLUMN admin_actions.target_user_id IS 'Discord ID of the target user (if applicable)';
COMMENT ON COLUMN admin_actions.action_type IS 'Type of action performed (e.g., score_adjustment, music_control)';
COMMENT ON COLUMN admin_actions.details IS 'Additional details about the action in JSON format';

-- Insert migration record
INSERT INTO schema_migrations (filename, applied_at) 
VALUES ('003_admin_actions_table.sql', CURRENT_TIMESTAMP)
ON CONFLICT (filename) DO NOTHING; 