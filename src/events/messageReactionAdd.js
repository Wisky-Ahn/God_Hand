/**
 * 메시지 반응 추가 이벤트 핸들러
 * 메시지에 반응을 추가했을 때 활동 추적
 */

const db = require('../services/database');
const dbUtils = require('../services/database/utils');
const logger = require('../utils/logger');

// 반응 점수 설정
const REACTION_SCORING = {
  GIVE_REACTION: 0.1,        // 반응을 준 사용자
  RECEIVE_REACTION: 0.2,     // 반응을 받은 사용자 (메시지 작성자)
  TIME_WEIGHTS: {
    MORNING: 0.9,           // 06:00-12:00
    AFTERNOON: 1.0,         // 12:00-18:00
    EVENING: 1.2,           // 18:00-24:00
    NIGHT: 0.7              // 00:00-06:00
  }
};

/**
 * 시간대별 가중치 계산
 * @param {Date} timestamp - 시간
 * @returns {number} 시간 가중치
 */
function getTimeWeight(timestamp) {
  const hour = timestamp.getHours();
  
  if (hour >= 6 && hour < 12) {
    return REACTION_SCORING.TIME_WEIGHTS.MORNING;
  } else if (hour >= 12 && hour < 18) {
    return REACTION_SCORING.TIME_WEIGHTS.AFTERNOON;
  } else if (hour >= 18 && hour < 24) {
    return REACTION_SCORING.TIME_WEIGHTS.EVENING;
  } else {
    return REACTION_SCORING.TIME_WEIGHTS.NIGHT;
  }
}

module.exports = {
  name: 'messageReactionAdd',
  once: false,
  async execute(reaction, user) {
    try {
      // 봇이 반응한 경우 무시
      if (user.bot) return;
      
      // 부분 메시지인 경우 완전한 메시지를 가져옴
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.warn('부분 반응 메시지 가져오기 실패:', error);
          return;
        }
      }
      
      // 메시지가 부분적인 경우 완전한 메시지를 가져옴
      if (reaction.message.partial) {
        try {
          await reaction.message.fetch();
        } catch (error) {
          logger.warn('부분 메시지 가져오기 실패:', error);
          return;
        }
      }
      
      const userId = user.id;
      const guildId = reaction.message.guild?.id;
      const messageAuthorId = reaction.message.author.id;
      const now = new Date();
      
      if (!guildId) return; // DM 무시

      // 자신이 자신의 메시지에 반응한 경우 무시 (점수 중복 방지)
      if (userId === messageAuthorId) {
        logger.debug(`셀프 반응은 점수를 부여하지 않습니다: ${user.tag}`);
        return;
      }
      
      // 시간 가중치
      const timeWeight = getTimeWeight(now);
      
      // 반응을 준 사용자 처리
      await processReactionGiver(userId, guildId, reaction, user, timeWeight, now);

      // 반응을 받은 사용자 처리 (메시지 작성자)
      await processReactionReceiver(messageAuthorId, guildId, reaction, timeWeight, now);
      
    } catch (error) {
      logger.error('messageReactionAdd 이벤트 처리 중 오류:', error);
    }
  }
};

/**
 * 반응을 준 사용자 처리
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {MessageReaction} reaction - 반응 객체
 * @param {User} user - 사용자 객체
 * @param {number} timeWeight - 시간 가중치
 * @param {Date} timestamp - 시간
 */
async function processReactionGiver(userId, guildId, reaction, user, timeWeight, timestamp) {
  try {
    let internalUserId = await dbUtils.getUserIdByDiscordId(userId, guildId);
    if (!internalUserId) {
      await dbUtils.findOrCreateUser(userId, guildId, user);
      internalUserId = await dbUtils.getUserIdByDiscordId(userId, guildId);
    }

    if (!internalUserId) {
      logger.error('반응 준 사용자 처리 실패: 사용자 ID를 찾을 수 없습니다.', { userId, guildId });
      return;
    }
    
    // 점수 계산
    const baseScore = REACTION_SCORING.GIVE_REACTION;
    const finalScore = baseScore * timeWeight;
    
    // 활동 데이터
    const activityData = {
      type: 'give_reaction',
      channelId: reaction.message.channel.id,
      channelName: reaction.message.channel.name,
      messageId: reaction.message.id,
      messageAuthorId: reaction.message.author.id,
      emoji: reaction.emoji.name,
      emojiId: reaction.emoji.id,
      baseScore: baseScore,
      timeWeight: timeWeight,
      finalScore: finalScore
    };
    
    // 활동 기록 저장
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, activity_type, score_awarded, timestamp, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      internalUserId, guildId, 'reaction_add', finalScore, timestamp,
      JSON.stringify(activityData), timestamp
    ]);
    
    // 사용자 점수 업데이트
    await db.query(`
      UPDATE users 
      SET current_score = current_score + $1, 
          reaction_score = reaction_score + $1,
          total_reactions_given = total_reactions_given + 1,
          last_active = $2
      WHERE discord_id = $3 AND guild_id = $4
    `, [finalScore, timestamp, userId, guildId]);
    
    // AFK 시스템 제거됨
    
    logger.debug(`반응 추가 활동: ${user.tag} (+${finalScore.toFixed(3)}점)`);
    
  } catch (error) {
    logger.error('반응 준 사용자 처리 중 오류:', error);
  }
}

/**
 * 반응을 받은 사용자 처리 (메시지 작성자)
 * @param {string} messageAuthorId - 메시지 작성자 ID
 * @param {string} guildId - 길드 ID
 * @param {MessageReaction} reaction - 반응 객체
 * @param {number} timeWeight - 시간 가중치
 * @param {Date} timestamp - 시간
 */
async function processReactionReceiver(messageAuthorId, guildId, reaction, timeWeight, timestamp) {
  try {
    let internalUserId = await dbUtils.getUserIdByDiscordId(messageAuthorId, guildId);
    if (!internalUserId) {
      await dbUtils.findOrCreateUser(messageAuthorId, guildId, reaction.message.author);
      internalUserId = await dbUtils.getUserIdByDiscordId(messageAuthorId, guildId);
    }

    if (!internalUserId) {
      logger.error('반응 받은 사용자 처리 실패: 사용자 ID를 찾을 수 없습니다.', { messageAuthorId, guildId });
      return;
    }
    
    // 점수 계산
    const baseScore = REACTION_SCORING.RECEIVE_REACTION;
    const finalScore = baseScore * timeWeight;
    
    // 활동 데이터
    const activityData = {
      type: 'receive_reaction',
      channelId: reaction.message.channel.id,
      channelName: reaction.message.channel.name,
      messageId: reaction.message.id,
      reactorId: reaction.users.cache.last()?.id,
      emoji: reaction.emoji.name,
      emojiId: reaction.emoji.id,
      baseScore: baseScore,
      timeWeight: timeWeight,
      finalScore: finalScore
    };
    
    // 활동 기록 저장
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, activity_type, score_awarded, timestamp, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      internalUserId, guildId, 'reaction_add', finalScore, timestamp,
      JSON.stringify(activityData), timestamp
    ]);
    
    // 사용자 점수 업데이트
    await db.query(`
      UPDATE users 
      SET current_score = current_score + $1, 
          reaction_score = reaction_score + $1,
          total_reactions_received = total_reactions_received + 1,
          last_active = $2
      WHERE discord_id = $3 AND guild_id = $4
    `, [finalScore, timestamp, messageAuthorId, guildId]);
    
    logger.debug(`반응 받기 활동: ${reaction.message.author.tag} (+${finalScore.toFixed(3)}점)`);
    
  } catch (error) {
    logger.error('반응 받은 사용자 처리 중 오류:', error);
  }
} 