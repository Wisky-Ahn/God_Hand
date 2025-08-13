/**
 * 기타 활동 추적 시스템
 * 반응(리액션), 스트리밍, 화면 공유 등의 활동을 추적하고 점수를 부여합니다.
 */

const db = require('../database');
const dbUtils = require('../database/utils');
const logger = require('../../utils/logger');

// 기타 활동 점수 설정 (환경변수에서 로드)
const OTHER_ACTIVITY_SCORING = {
  REACTIONS: {
    GIVE_REACTION: parseFloat(process.env.REACTION_GIVE_POINTS) || 0.1,         // 반응을 준 사용자
    RECEIVE_REACTION: parseFloat(process.env.REACTION_RECEIVE_POINTS) || 0.2,      // 반응을 받은 사용자 (메시지 작성자)
    SELF_REACTION_PENALTY: parseFloat(process.env.REACTION_SELF_PENALTY) || 0    // 자신의 메시지에 반응하면 점수 없음
  },
  STREAMING: {
    SESSION_START: parseFloat(process.env.STREAMING_SESSION_START_POINTS) || 8,           // 스트리밍/화면공유 시작 시 점수
    QUALITY_BONUS: {
      'LOW': parseFloat(process.env.STREAMING_QUALITY_LOW_BONUS) || 0,                 // 저화질 보너스 없음
      'MEDIUM': parseFloat(process.env.STREAMING_QUALITY_MEDIUM_BONUS) || 2,              // 중화질 +2점
      'HIGH': parseFloat(process.env.STREAMING_QUALITY_HIGH_BONUS) || 4                 // 고화질 +4점
    }
  },
  VOICE_ACTIVITIES: {
    VIDEO_ENABLED: parseFloat(process.env.VIDEO_ENABLED_POINTS) || 3,           // 비디오 켜기
    SCREEN_SHARE: parseFloat(process.env.SCREEN_SHARE_POINTS) || 5,            // 화면 공유 시작
    GO_LIVE: parseFloat(process.env.GO_LIVE_POINTS) || 8                  // 라이브 스트리밍 시작
  },
  TIME_WEIGHTS: {
    MORNING: parseFloat(process.env.TIME_WEIGHT_MORNING) || 0.8,               // 06:00-09:00 (수정)
    AFTERNOON: parseFloat(process.env.TIME_WEIGHT_DAY) || 1.0,             // 09:00-18:00 (기본)
    EVENING: parseFloat(process.env.TIME_WEIGHT_EVENING) || 1.4,               // 18:00-23:00 (보너스)
    NIGHT: parseFloat(process.env.TIME_WEIGHT_DAWN) || 0.2                  // 00:00-06:00 (페널티)
  },
  TIME_BOUNDARIES: {
    DAWN_START: parseInt(process.env.TIME_DAWN_START) || 0,
    DAWN_END: parseInt(process.env.TIME_DAWN_END) || 6,
    MORNING_START: parseInt(process.env.TIME_MORNING_START) || 6,
    MORNING_END: parseInt(process.env.TIME_MORNING_END) || 9,
    DAY_START: parseInt(process.env.TIME_DAY_START) || 9,
    DAY_END: parseInt(process.env.TIME_DAY_END) || 18,
    EVENING_START: parseInt(process.env.TIME_EVENING_START) || 18,
    EVENING_END: parseInt(process.env.TIME_EVENING_END) || 23,
    LATE_NIGHT_START: parseInt(process.env.TIME_LATE_NIGHT_START) || 23,
    LATE_NIGHT_END: parseInt(process.env.TIME_LATE_NIGHT_END) || 24
  }
};

/**
 * 시간대별 가중치 계산
 * @param {Date} timestamp - 시간
 * @returns {number} 시간 가중치
 */
function getTimeWeight(timestamp) {
  const hour = timestamp.getHours();
  const boundaries = OTHER_ACTIVITY_SCORING.TIME_BOUNDARIES;
  
  if (hour >= boundaries.MORNING_START && hour < boundaries.MORNING_END) {
    return OTHER_ACTIVITY_SCORING.TIME_WEIGHTS.MORNING;
  } else if (hour >= boundaries.DAY_START && hour < boundaries.DAY_END) {
    return OTHER_ACTIVITY_SCORING.TIME_WEIGHTS.AFTERNOON;
  } else if (hour >= boundaries.EVENING_START && hour < boundaries.LATE_NIGHT_START) {
    return OTHER_ACTIVITY_SCORING.TIME_WEIGHTS.EVENING;
  } else {
    return OTHER_ACTIVITY_SCORING.TIME_WEIGHTS.NIGHT;
  }
}

/**
 * 반응을 준 사용자 활동 추적
 * @param {Object} reaction - Discord 반응 객체
 * @param {Object} user - 반응을 준 사용자
 * @param {string} guildId - 길드 ID
 */
async function trackReactionGiven(reaction, user, guildId) {
  try {
    // 봇 사용자 무시
    if (user.bot) return;

    const userId = user.id;
    const now = new Date();
    const timeWeight = getTimeWeight(now);
    
    // 자기 자신의 메시지에 반응하는 경우 점수 없음
    if (reaction.message.author && reaction.message.author.id === userId) {
      logger.debug(`자신의 메시지에 반응: ${user.tag}`);
      return;
    }

    const baseScore = OTHER_ACTIVITY_SCORING.REACTIONS.GIVE_REACTION;
    const finalScore = baseScore * timeWeight;

    // 사용자 확인 및 생성
    await dbUtils.ensureUser(userId, guildId, user.tag);

    // 활동 로그 저장
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, type, data, score, timestamp, created_at)
      VALUES (
        (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
        $2, $3, $4, $5, $6, $7
      )
    `, [
      userId, guildId, 'reaction_given',
      JSON.stringify({
        messageId: reaction.message.id,
        emoji: reaction.emoji.name || reaction.emoji.toString(),
        timeWeight: timeWeight,
        baseScore: baseScore
      }),
      finalScore, now, now
    ]);

    // 사용자 점수 업데이트
    await db.query(`
      UPDATE users 
      SET current_score = current_score + $1, 
          last_active = $2,
          reaction_count = reaction_count + 1
      WHERE discord_id = $3 AND guild_id = $4
    `, [finalScore, now, userId, guildId]);

    // AFK 시스템 제거됨

    logger.debug(`반응 추가 추적: ${user.tag} (+${finalScore.toFixed(2)}점)`);

  } catch (error) {
    logger.error('반응 추가 추적 중 오류:', error);
  }
}

/**
 * 반응을 받은 사용자 활동 추적
 * @param {Object} reaction - Discord 반응 객체
 * @param {Object} user - 반응을 준 사용자
 * @param {string} guildId - 길드 ID
 */
async function trackReactionReceived(reaction, user, guildId) {
  try {
    const messageAuthor = reaction.message.author;
    if (!messageAuthor || messageAuthor.bot) return;

    // 자기 자신에게 반응한 경우 무시
    if (messageAuthor.id === user.id) return;

    const messageAuthorId = messageAuthor.id;
    const now = new Date();
    const timeWeight = getTimeWeight(now);
    
    const baseScore = OTHER_ACTIVITY_SCORING.REACTIONS.RECEIVE_REACTION;
    const finalScore = baseScore * timeWeight;

    // 사용자 확인 및 생성
    await dbUtils.ensureUser(messageAuthorId, guildId, messageAuthor.tag);

    // 활동 로그 저장
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, type, data, score, timestamp, created_at)
      VALUES (
        (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
        $2, $3, $4, $5, $6, $7
      )
    `, [
      messageAuthorId, guildId, 'reaction_received',
      JSON.stringify({
        messageId: reaction.message.id,
        emoji: reaction.emoji.name || reaction.emoji.toString(),
        reactorId: user.id,
        reactorTag: user.tag,
        timeWeight: timeWeight,
        baseScore: baseScore
      }),
      finalScore, now, now
    ]);

    // 사용자 점수 업데이트
    await db.query(`
      UPDATE users 
      SET current_score = current_score + $1, 
          last_active = $2
      WHERE discord_id = $3 AND guild_id = $4
    `, [finalScore, now, messageAuthorId, guildId]);

    logger.debug(`반응 수신 추적: ${messageAuthor.tag} (+${finalScore.toFixed(2)}점)`);

  } catch (error) {
    logger.error('반응 수신 추적 중 오류:', error);
  }
}

/**
 * 스트리밍 활동 추적
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {Object} streamingInfo - 스트리밍 정보
 */
async function trackStreaming(userId, guildId, streamingInfo = {}) {
  try {
    const now = new Date();
    const timeWeight = getTimeWeight(now);
    
    const baseScore = OTHER_ACTIVITY_SCORING.STREAMING.SESSION_START;
    
    // 화질에 따른 보너스 점수
    let qualityBonus = 0;
    if (streamingInfo.quality) {
      qualityBonus = OTHER_ACTIVITY_SCORING.STREAMING.QUALITY_BONUS[streamingInfo.quality.toUpperCase()] || 0;
    }
    
    const totalBaseScore = baseScore + qualityBonus;
    const finalScore = totalBaseScore * timeWeight;

    // 사용자 확인
    const userExists = await db.query(
      'SELECT discord_id FROM users WHERE discord_id = $1 AND guild_id = $2',
      [userId, guildId]
    );

    if (userExists.rows.length === 0) {
      logger.warn(`스트리밍 추적: 사용자를 찾을 수 없음 (${userId})`);
      return;
    }

    // 활동 로그 저장
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, activity_type, details, score_awarded, timestamp, created_at)
      VALUES (
        (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
        $2, $3, $4, $5, $6, $7
      )
    `, [
      userId, guildId, 'stream_start',
      JSON.stringify({
        quality: streamingInfo.quality || 'unknown',
        qualityBonus: qualityBonus,
        timeWeight: timeWeight,
        baseScore: totalBaseScore,
        streamType: streamingInfo.type || 'stream'
      }),
      finalScore, now, now
    ]);

    // 사용자 점수 업데이트
    await db.query(`
      UPDATE users 
      SET current_score = current_score + $1, 
          last_active = $2
      WHERE discord_id = $3 AND guild_id = $4
    `, [finalScore, now, userId, guildId]);

    // AFK 시스템 제거됨

    logger.info(`스트리밍 추적: 사용자 ${userId} (+${finalScore.toFixed(2)}점, 화질: ${streamingInfo.quality || 'unknown'})`);

  } catch (error) {
    logger.error('스트리밍 추적 중 오류:', error);
  }
}

/**
 * 음성 활동 추적 (비디오, 화면공유, 라이브)
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {string} activityType - 활동 타입 ('video', 'screenshare', 'golive')
 * @param {Object} activityInfo - 활동 정보
 */
async function trackVoiceActivity(userId, guildId, activityType, activityInfo = {}) {
  try {
    const now = new Date();
    const timeWeight = getTimeWeight(now);
    
    let baseScore = 0;
    let activityTypeName = '';

    switch (activityType) {
      case 'video':
        baseScore = OTHER_ACTIVITY_SCORING.VOICE_ACTIVITIES.VIDEO_ENABLED;
        activityTypeName = 'video_enabled';
        break;
      case 'screenshare':
        baseScore = OTHER_ACTIVITY_SCORING.VOICE_ACTIVITIES.SCREEN_SHARE;
        activityTypeName = 'screen_share';
        break;
      case 'golive':
        baseScore = OTHER_ACTIVITY_SCORING.VOICE_ACTIVITIES.GO_LIVE;
        activityTypeName = 'go_live';
        break;
      default:
        logger.warn(`알 수 없는 음성 활동 타입: ${activityType}`);
        return;
    }

    const finalScore = baseScore * timeWeight;

    // 사용자 확인
    const userExists = await db.query(
      'SELECT discord_id FROM users WHERE discord_id = $1 AND guild_id = $2',
      [userId, guildId]
    );

    if (userExists.rows.length === 0) {
      logger.warn(`음성 활동 추적: 사용자를 찾을 수 없음 (${userId})`);
      return;
    }

    // 활동 로그 저장
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, activity_type, details, score_awarded, timestamp, created_at)
      VALUES (
        (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
        $2, $3, $4, $5, $6, $7
      )
    `, [
      userId, guildId, activityTypeName,
      JSON.stringify({
        activityType: activityType,
        timeWeight: timeWeight,
        baseScore: baseScore,
        ...activityInfo
      }),
      finalScore, now, now
    ]);

    // 사용자 점수 업데이트
    await db.query(`
      UPDATE users 
      SET current_score = current_score + $1, 
          last_active = $2
      WHERE discord_id = $3 AND guild_id = $4
    `, [finalScore, now, userId, guildId]);

    // AFK 시스템 제거됨

    logger.info(`음성 활동 추적: 사용자 ${userId} (${activityType}) (+${finalScore.toFixed(2)}점)`);

  } catch (error) {
    logger.error('음성 활동 추적 중 오류:', error);
  }
}

/**
 * 기타 활동 통계 조회
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {number} days - 조회 기간 (일)
 * @returns {Object} 활동 통계
 */
async function getOtherActivityStats(userId, guildId, days = 7) {
  try {
    const result = await db.query(`
      SELECT 
        type,
        COUNT(*) as count,
        SUM(score) as total_score,
        AVG(score) as avg_score,
        MAX(timestamp) as last_activity
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE u.discord_id = $1 
        AND u.guild_id = $2
        AND a.timestamp >= NOW() - INTERVAL '${days} days'
        AND a.type IN ('reaction_given', 'reaction_received', 'streaming', 'video_enabled', 'screen_share', 'go_live')
      GROUP BY type
      ORDER BY total_score DESC
    `, [userId, guildId]);

    const stats = {
      totalActivities: 0,
      totalScore: 0,
      activities: {},
      period: `${days}일간`
    };

    result.rows.forEach(row => {
      stats.totalActivities += parseInt(row.count);
      stats.totalScore += parseFloat(row.total_score);
      
      stats.activities[row.type] = {
        count: parseInt(row.count),
        totalScore: parseFloat(row.total_score),
        avgScore: parseFloat(row.avg_score),
        lastActivity: row.last_activity
      };
    });

    return stats;

  } catch (error) {
    logger.error('기타 활동 통계 조회 중 오류:', error);
    return null;
  }
}

/**
 * 길드 기타 활동 순위 조회
 * @param {string} guildId - 길드 ID
 * @param {number} limit - 결과 수 제한
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 순위 목록
 */
async function getOtherActivityRanking(guildId, limit = 10, days = 7) {
  try {
    const result = await db.query(`
      SELECT 
        u.discord_id,
        u.display_name,
        COUNT(a.id) as total_activities,
        SUM(a.score) as total_score,
        COUNT(CASE WHEN a.type IN ('reaction_given', 'reaction_received') THEN 1 END) as reaction_count,
        COUNT(CASE WHEN a.type IN ('streaming', 'video_enabled', 'screen_share', 'go_live') THEN 1 END) as voice_activity_count
      FROM users u
      LEFT JOIN activities a ON u.id = a.user_id 
        AND a.timestamp >= NOW() - INTERVAL '${days} days'
        AND a.type IN ('reaction_given', 'reaction_received', 'streaming', 'video_enabled', 'screen_share', 'go_live')
      WHERE u.guild_id = $1
      GROUP BY u.id, u.discord_id, u.display_name
      HAVING SUM(a.score) > 0
      ORDER BY total_score DESC
      LIMIT $2
    `, [guildId, limit]);

    return result.rows.map((row, index) => ({
      rank: index + 1,
      userId: row.discord_id,
      displayName: row.display_name,
      totalActivities: parseInt(row.total_activities),
      totalScore: parseFloat(row.total_score),
      reactionCount: parseInt(row.reaction_count),
      voiceActivityCount: parseInt(row.voice_activity_count)
    }));

  } catch (error) {
    logger.error('기타 활동 순위 조회 중 오류:', error);
    return [];
  }
}

module.exports = {
  trackReactionGiven,
  trackReactionReceived,
  trackStreaming,
  trackVoiceActivity,
  getOtherActivityStats,
  getOtherActivityRanking,
  getTimeWeight,
  OTHER_ACTIVITY_SCORING
}; 