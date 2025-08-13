/**
 * 메시지 활동 추적 시스템
 * 사용자의 메시지 품질과 참여도에 따른 점수 계산 및 추적
 */

const db = require('../database');
const dbUtils = require('../database/utils');
const logger = require('../../utils/logger');
const { getDisplayName } = require('../../utils/nickname');

// 메시지 품질 평가 상수 (환경변수에서 로드)
const MESSAGE_SCORING = {
  BASE_SCORE: parseFloat(process.env.MESSAGE_BASE_POINTS) || 0.15,             // 모든 메시지 기본 점수
  MAX_QUALITY_BONUS: parseFloat(process.env.MESSAGE_MAX_QUALITY_BONUS) || 0.35,      // 최대 품질 보너스
  LENGTH_THRESHOLDS: {
    SHORT: parseInt(process.env.MESSAGE_LENGTH_SHORT_THRESHOLD) || 20,                  // 짧은 메시지 기준
    MEDIUM: parseInt(process.env.MESSAGE_LENGTH_MEDIUM_THRESHOLD) || 50,                 // 중간 메시지 기준  
    LONG: parseInt(process.env.MESSAGE_LENGTH_LONG_THRESHOLD) || 100                   // 긴 메시지 기준
  },
  LENGTH_BONUSES: {
    SHORT: parseFloat(process.env.MESSAGE_LENGTH_SHORT_BONUS) || 0.1,                 // 20자 이상
    MEDIUM: parseFloat(process.env.MESSAGE_LENGTH_MEDIUM_BONUS) || 0.1,                // 50자 이상 추가
    LONG: parseFloat(process.env.MESSAGE_LENGTH_LONG_BONUS) || 0.1                   // 100자 이상 추가
  },
  CONTENT_BONUSES: {
    CODE_BLOCK: parseFloat(process.env.MESSAGE_CODE_BLOCK_BONUS) || 0.1,            // 코드 블록 포함
    LINK: parseFloat(process.env.MESSAGE_LINK_BONUS) || 0.1,                  // 링크 포함
    ATTACHMENT: parseFloat(process.env.MESSAGE_ATTACHMENT_BONUS) || 0.2,            // 첨부파일 포함
    MENTION: parseFloat(process.env.MESSAGE_MENTION_BONUS) || 0.05,              // 멘션 포함
    EMOJI: parseFloat(process.env.MESSAGE_EMOJI_BONUS) || 0.05,                // 이모지 포함
    THREAD_STARTER: parseFloat(process.env.MESSAGE_THREAD_STARTER_BONUS) || 0.15        // 스레드 시작
  },
  TIME_WEIGHTS: {
    MORNING: parseFloat(process.env.TIME_WEIGHT_MORNING) || 0.8,               // 06:00-09:00 (아침)
    AFTERNOON: parseFloat(process.env.TIME_WEIGHT_DAY) || 1.0,             // 09:00-18:00 (오후) - 기본
    EVENING: parseFloat(process.env.TIME_WEIGHT_EVENING) || 1.4,               // 18:00-23:00 (저녁) - 보너스
    NIGHT: parseFloat(process.env.TIME_WEIGHT_DAWN) || 0.2                  // 00:00-06:00 (새벽) - 페널티
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
 * @param {Date} timestamp - 메시지 시간
 * @returns {number} 시간 가중치
 */
function getTimeWeight(timestamp) {
  const hour = timestamp.getHours();
  const boundaries = MESSAGE_SCORING.TIME_BOUNDARIES;
  
  if (hour >= boundaries.MORNING_START && hour < boundaries.MORNING_END) {
    return MESSAGE_SCORING.TIME_WEIGHTS.MORNING;
  } else if (hour >= boundaries.DAY_START && hour < boundaries.DAY_END) {
    return MESSAGE_SCORING.TIME_WEIGHTS.AFTERNOON;
  } else if (hour >= boundaries.EVENING_START && hour < boundaries.LATE_NIGHT_START) {
    return MESSAGE_SCORING.TIME_WEIGHTS.EVENING;
  } else {
    return MESSAGE_SCORING.TIME_WEIGHTS.NIGHT;
  }
}

/**
 * 메시지 길이 기반 점수 계산
 * @param {number} length - 메시지 길이
 * @returns {number} 길이 보너스 점수
 */
function calculateLengthBonus(length) {
  let bonus = 0;
  
  if (length >= MESSAGE_SCORING.LENGTH_THRESHOLDS.SHORT) {
    bonus += MESSAGE_SCORING.LENGTH_BONUSES.SHORT;
  }
  if (length >= MESSAGE_SCORING.LENGTH_THRESHOLDS.MEDIUM) {
    bonus += MESSAGE_SCORING.LENGTH_BONUSES.MEDIUM;
  }
  if (length >= MESSAGE_SCORING.LENGTH_THRESHOLDS.LONG) {
    bonus += MESSAGE_SCORING.LENGTH_BONUSES.LONG;
  }
  
  return bonus;
}

/**
 * 메시지 내용 기반 품질 점수 계산
 * @param {Object} message - Discord 메시지 객체
 * @returns {number} 내용 기반 보너스 점수
 */
function calculateContentBonus(message) {
  const content = message.content;
  let bonus = 0;
  
  // 코드 블록 체크
  if (content.includes('```') || content.includes('`')) {
    bonus += MESSAGE_SCORING.CONTENT_BONUSES.CODE_BLOCK;
  }
  
  // URL 링크 체크
  if (content.includes('http://') || content.includes('https://')) {
    bonus += MESSAGE_SCORING.CONTENT_BONUSES.LINK;
  }
  
  // 첨부파일 체크
  if (message.attachments && message.attachments.size > 0) {
    bonus += MESSAGE_SCORING.CONTENT_BONUSES.ATTACHMENT;
  }
  
  // 멘션 체크
  if (message.mentions && (message.mentions.users.size > 0 || message.mentions.roles.size > 0)) {
    bonus += MESSAGE_SCORING.CONTENT_BONUSES.MENTION;
  }
  
  // 이모지 체크 (커스텀 이모지와 유니코드 이모지)
  if (content.includes('<:') || /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(content)) {
    bonus += MESSAGE_SCORING.CONTENT_BONUSES.EMOJI;
  }
  
  // 스레드 시작 체크
  if (message.hasThread) {
    bonus += MESSAGE_SCORING.CONTENT_BONUSES.THREAD_STARTER;
  }
  
  return Math.min(bonus, MESSAGE_SCORING.MAX_QUALITY_BONUS);
}

/**
 * 메시지 활동 추적 및 점수 계산
 * @param {Object} message - Discord 메시지 객체
 * @returns {Promise<Object>} 처리 결과
 */
async function trackMessageActivity(message) {
  try {
    // 봇 메시지 무시
    if (message.author.bot) {
      return { success: false, reason: 'bot_message' };
    }
    
    // 시스템 메시지 무시
    if (message.system) {
      return { success: false, reason: 'system_message' };
    }
    
    const userId = message.author.id;
    const guildId = message.guild?.id;
    const now = new Date();
    
    if (!guildId) {
      return { success: false, reason: 'no_guild' };
    }
    
    // 사용자 확인/생성 - 새로운 닉네임 시스템 사용
    const displayName = await getDisplayName(message.guild, userId, {
      fallback: message.author.username,
      updateDB: false // 이미 findOrCreateUser에서 처리됨
    });
    
    await dbUtils.findOrCreateUser(userId, guildId, {
      username: message.author.username,
      discriminator: message.author.discriminator,
      displayName: displayName
    });
    
    // 기본 점수 계산
    let score = MESSAGE_SCORING.BASE_SCORE;
    
    // 길이 기반 보너스
    const lengthBonus = calculateLengthBonus(message.content.length);
    
    // 내용 기반 보너스
    const contentBonus = calculateContentBonus(message);
    
    // 품질 보너스 합계
    const qualityBonus = lengthBonus + contentBonus;
    score += Math.min(qualityBonus, MESSAGE_SCORING.MAX_QUALITY_BONUS);
    
    // 시간 가중치 적용
    const timeWeight = getTimeWeight(now);
    const finalScore = score * timeWeight;
    
    // 메시지 활동 정보
    const activityData = {
      channelId: message.channel.id,
      channelName: message.channel.name,
      messageLength: message.content.length,
      baseScore: MESSAGE_SCORING.BASE_SCORE,
      lengthBonus: lengthBonus,
      contentBonus: contentBonus,
      qualityBonus: qualityBonus,
      timeWeight: timeWeight,
      finalScore: finalScore,
      hasAttachments: message.attachments.size > 0,
      hasLinks: message.content.includes('http'),
      hasCodeBlocks: message.content.includes('```'),
      hasMentions: message.mentions.users.size > 0 || message.mentions.roles.size > 0,
      hasThread: !!message.hasThread
    };
    
    // 활동 기록 저장
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, activity_type, score_awarded, timestamp, details, created_at)
      VALUES (
        (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
        $2, $3, $4, $5, $6, $7
      )
    `, [
      userId, guildId, 'message_create', finalScore, now, 
      JSON.stringify(activityData), now
    ]);
    
    // 사용자 점수 및 활동 업데이트
    await db.query(`
      UPDATE users 
      SET current_score = current_score + $1, 
          message_score = message_score + $1,
          total_messages = total_messages + 1,
          last_active = $2,
          last_message_activity = $2,
          updated_at = $2
      WHERE discord_id = $3 AND guild_id = $4
    `, [finalScore, now, userId, guildId]);
    
    // AFK 시스템 제거됨
    
    logger.debug(`메시지 활동 추적 완료: ${message.author.tag} (+${finalScore.toFixed(3)}점)`, {
      userId,
      guildId,
      score: finalScore,
      breakdown: activityData
    });
    
    return {
      success: true,
      score: finalScore,
      breakdown: activityData
    };
    
  } catch (error) {
    logger.error('메시지 활동 추적 중 오류:', error);
    return {
      success: false,
      reason: 'error',
      error: error.message
    };
  }
}

/**
 * 사용자의 메시지 활동 통계 조회
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Object>} 메시지 활동 통계
 */
async function getMessageActivityStats(guildId, userId, options = {}) {
  try {
    const {
      days = 7,           // 기본 7일
      includeBreakdown = false
    } = options;
    
    const result = await db.query(`
      SELECT 
        COUNT(*) as message_count,
        SUM(score) as total_score,
        AVG(score) as avg_score,
        MIN(score) as min_score,
        MAX(score) as max_score,
        COUNT(*) FILTER (
          WHERE data->>'qualityBonus' != '0'
        ) as quality_messages,
        AVG((data->>'messageLength')::int) as avg_length,
        COUNT(*) FILTER (
          WHERE data->>'hasAttachments' = 'true'
        ) as messages_with_attachments,
        COUNT(*) FILTER (
          WHERE data->>'hasLinks' = 'true'
        ) as messages_with_links,
        COUNT(*) FILTER (
          WHERE data->>'hasCodeBlocks' = 'true'
        ) as messages_with_code
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE u.guild_id = $1 
        AND u.discord_id = $2 
        AND a.type = 'message'
        AND a.timestamp >= NOW() - INTERVAL '${days} days'
    `, [guildId, userId]);
    
    const stats = result.rows[0] || {};
    
    // 시간대별 분석 (옵션)
    let timeBreakdown = null;
    if (includeBreakdown) {
      const timeResult = await db.query(`
        SELECT 
          EXTRACT(HOUR FROM timestamp) as hour,
          COUNT(*) as count,
          AVG(score) as avg_score
        FROM activities a
        JOIN users u ON a.user_id = u.id
        WHERE u.guild_id = $1 
          AND u.discord_id = $2 
          AND a.type = 'message'
          AND a.timestamp >= NOW() - INTERVAL '${days} days'
        GROUP BY EXTRACT(HOUR FROM timestamp)
        ORDER BY hour
      `, [guildId, userId]);
      
      timeBreakdown = timeResult.rows;
    }
    
    return {
      userId,
      guildId,
      period: `${days} days`,
      stats: {
        messageCount: parseInt(stats.message_count || 0),
        totalScore: parseFloat(stats.total_score || 0),
        averageScore: parseFloat(stats.avg_score || 0),
        minScore: parseFloat(stats.min_score || 0),
        maxScore: parseFloat(stats.max_score || 0),
        qualityMessages: parseInt(stats.quality_messages || 0),
        averageLength: parseInt(stats.avg_length || 0),
        messagesWithAttachments: parseInt(stats.messages_with_attachments || 0),
        messagesWithLinks: parseInt(stats.messages_with_links || 0),
        messagesWithCode: parseInt(stats.messages_with_code || 0)
      },
      timeBreakdown
    };
    
  } catch (error) {
    logger.error('메시지 활동 통계 조회 중 오류:', error);
    throw error;
  }
}

/**
 * 길드의 메시지 활동 순위 조회
 * @param {string} guildId - 길드 ID
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 메시지 활동 순위
 */
async function getMessageActivityRanking(guildId, options = {}) {
  try {
    const {
      days = 7,
      limit = 10
    } = options;
    
    const result = await db.query(`
      SELECT 
        u.discord_id,
        u.username,
        COUNT(*) as message_count,
        SUM(a.score) as total_score,
        AVG(a.score) as avg_score,
        COUNT(*) FILTER (
          WHERE a.data->>'qualityBonus' != '0'
        ) as quality_messages,
        RANK() OVER (ORDER BY SUM(a.score) DESC) as rank
      FROM users u
      JOIN activities a ON u.id = a.user_id
      WHERE u.guild_id = $1 
        AND a.type = 'message'
        AND a.timestamp >= NOW() - INTERVAL '${days} days'
      GROUP BY u.id, u.discord_id, u.username
      ORDER BY total_score DESC
      LIMIT $2
    `, [guildId, limit]);
    
    return result.rows.map(row => ({
      rank: parseInt(row.rank),
      userId: row.discord_id,
      username: row.username,
      messageCount: parseInt(row.message_count),
      totalScore: parseFloat(row.total_score),
      averageScore: parseFloat(row.avg_score),
      qualityMessages: parseInt(row.quality_messages),
      qualityRate: row.message_count > 0 ? 
        (row.quality_messages / row.message_count * 100).toFixed(1) : '0.0'
    }));
    
  } catch (error) {
    logger.error('메시지 활동 순위 조회 중 오류:', error);
    throw error;
  }
}

module.exports = {
  trackMessageActivity,
  getMessageActivityStats,
  getMessageActivityRanking,
  getTimeWeight,
  calculateLengthBonus,
  calculateContentBonus
}; 