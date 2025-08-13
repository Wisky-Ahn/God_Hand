-- Migration: Remove AFK System
-- Date: 2025-08-08
-- Description: AFK 시스템 완전 제거 - 데이터베이스 필드 정리

-- 1. voice_sessions 테이블에서 AFK 관련 필드 제거
ALTER TABLE voice_sessions DROP COLUMN IF EXISTS afk_time;
ALTER TABLE voice_sessions DROP COLUMN IF EXISTS afk_penalty;

-- 2. activities 테이블에서 AFK 관련 활동 데이터 정리
DELETE FROM activities WHERE activity_type IN ('afk_detected', 'afk_returned');

-- 3. activities 테이블의 activity_type CHECK 제약조건 업데이트
-- 기존 제약조건 삭제
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;

-- 새 제약조건 추가 (AFK 타입 제거)
ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check 
CHECK (activity_type IN (
    -- Voice Activities
    'voice_join', 'voice_leave', 'voice_speaking',
    'voice_mute', 'voice_unmute', 'voice_deafen', 'voice_undeafen',
    'channel_move',
    
    -- Message Activities  
    'message_create', 'message_delete', 'message_edit',
    
    -- Reaction Activities
    'reaction_add', 'reaction_remove',
    
    -- Special Activities
    'screen_share_start', 'screen_share_stop',
    'stream_start', 'stream_stop',
    'video_start', 'video_stop',
    
    -- Other Activities
    'command_slash', 'command_prefix',
    'thread_create', 'thread_join'
));

-- 4. 코멘트 업데이트
COMMENT ON TABLE voice_sessions IS 'Voice channel activity tracking';
COMMENT ON COLUMN voice_sessions.speaking_time IS 'Time spent actively speaking in voice channel';
COMMENT ON COLUMN voice_sessions.alone_time IS 'Time spent alone in voice channel';
COMMENT ON COLUMN voice_sessions.with_others_time IS 'Time spent with others in voice channel';

-- 5. 인덱스 정리 (AFK 관련 인덱스가 있다면 제거)
DROP INDEX IF EXISTS idx_activities_afk_type;
DROP INDEX IF EXISTS idx_voice_sessions_afk_time;

-- Migration 완료 로그
INSERT INTO activities (user_id, guild_id, activity_type, details, score_awarded, timestamp, created_at)
SELECT 
    1, -- 시스템 사용자 ID (존재한다면)
    1, -- 기본 길드 ID 
    'system_migration',
    '{"migration": "remove_afk_system", "timestamp": "' || NOW() || '"}',
    0,
    NOW(),
    NOW()
WHERE EXISTS (SELECT 1 FROM users LIMIT 1); -- users 테이블에 데이터가 있을 때만 실행

COMMIT;






