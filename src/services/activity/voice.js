/**
 * 음성 활동 추적 시스템
 * 사용자의 음성 채널 참여를 모니터링하고 점수를 계산
 */

const db = require('../database');
const { getUserIdByDiscordId, updateUserScore: updateUserScoreInDb, findOrCreateUser } = require('../database/utils');
const { getTimeWeight } = require('../../utils/timeWeights');
// AFK 감지 시스템 제거됨
const logger = require('../../utils/logger');

// 활성 음성 세션 추적
const activeSessions = new Map();

// 점수 계산 설정 (환경변수에서 로드)
const VOICE_SCORING = {
  SOLO_POINTS_PER_MINUTE: parseFloat(process.env.VOICE_SOLO_POINTS_PER_MINUTE) || 0.1,    // 혼자 있을 때 분당 점수
  MULTI_POINTS_PER_MINUTE: parseFloat(process.env.VOICE_MULTI_POINTS_PER_MINUTE) || 2.0,   // 2명 이상일 때 분당 점수
  MIN_SESSION_DURATION: parseInt(process.env.VOICE_MIN_SESSION_DURATION) || 30,       // 최소 세션 시간 (초)
  // 말하기 보너스 제거됨 (Discord API 제한으로 인해 작동하지 않음)
};

/**
 * 음성 상태 변경 이벤트 처리 (메인 함수)
 * @param {VoiceState} oldState - 이전 음성 상태
 * @param {VoiceState} newState - 새로운 음성 상태
 */
async function trackVoiceActivity(oldState, newState) {
  try {
    const userId = newState.id || oldState.id;
    
    // 봇 자신은 추적하지 않음
    if (newState.member?.user?.bot || oldState.member?.user?.bot) {
      return;
    }

    // 사용자가 음성 채널에 참가한 경우
    if (!oldState.channelId && newState.channelId) {
      await handleVoiceJoin(userId, newState);
    }
    // 사용자가 음성 채널에서 나간 경우
    else if (oldState.channelId && !newState.channelId) {
      await handleVoiceLeave(userId, oldState);
    }
    // 사용자가 채널을 이동한 경우
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      await handleVoiceMove(userId, oldState, newState);
    }
    // 음성 상태만 변경된 경우 (음소거, 헤드셋 등)
    else if (oldState.channelId && newState.channelId) {
      await handleVoiceStateChange(userId, oldState, newState);
    }

  } catch (error) {
    logger.error('음성 활동 추적 중 오류:', error);
  }
}

/**
 * 음성 채널 참가 처리
 * @param {string} userId - 사용자 ID
 * @param {VoiceState} newState - 새로운 음성 상태
 */
async function handleVoiceJoin(userId, newState) {
  try {
    const now = new Date();
    const guildId = newState.guild.id;
    
    // 데이터베이스에서 사용자 정보 조회/생성
    await findOrCreateUser(userId, guildId, newState.member.user);
    
    // 활성 세션 정보 저장
    activeSessions.set(userId, {
      channelId: newState.channelId,
      guildId: guildId,
      startTime: now,
      lastActivity: now,
      // 말하기 추적 제거됨 (Discord API 제한)
      user: newState.member.user
    });

    // AFK 감지 시스템 제거됨

    // 활동 로그 저장
    await logVoiceActivity(userId, guildId, 'join', {
      channelId: newState.channelId,
      timestamp: now
    });

    logger.info(`음성 채널 참가: ${newState.member.user.tag} -> ${newState.channel.name}`);

  } catch (error) {
    logger.error('음성 채널 참가 처리 중 오류:', error);
  }
}

/**
 * 음성 채널 퇴장 처리
 * @param {string} userId - 사용자 ID
 * @param {VoiceState} oldState - 이전 음성 상태
 */
async function handleVoiceLeave(userId, oldState) {
  try {
    const session = activeSessions.get(userId);
    if (!session) return;

    const now = new Date();
    const duration = (now - session.startTime) / 1000; // 초 단위

    // AFK 감지 시스템 제거됨

    // 최소 세션 시간 체크
    if (duration >= VOICE_SCORING.MIN_SESSION_DURATION) {
      // 점수 계산 및 저장 (users 테이블 업데이트 포함)
      const score = await calculateVoiceScore(userId, session, now, oldState.client);
      await saveVoiceSession(userId, session, now, duration, score);
      // updateUserScore 제거 - saveVoiceSession에서 이미 처리함
    }

    // 활동 로그 저장
    await logVoiceActivity(userId, session.guildId, 'leave', {
      channelId: oldState.channelId,
      timestamp: now,
      duration: duration,
      score: duration >= VOICE_SCORING.MIN_SESSION_DURATION ? await calculateVoiceScore(userId, session, now, oldState.client) : 0
    });

    // 세션 정보 정리
    activeSessions.delete(userId);

    logger.info(`음성 채널 퇴장: ${oldState.member.user.tag} (세션 시간: ${Math.round(duration)}초)`);

  } catch (error) {
    logger.error('음성 채널 퇴장 처리 중 오류:', error);
  }
}

/**
 * 음성 채널 이동 처리
 * @param {string} userId - 사용자 ID
 * @param {VoiceState} oldState - 이전 음성 상태
 * @param {VoiceState} newState - 새로운 음성 상태
 */
async function handleVoiceMove(userId, oldState, newState) {
  try {
    // 기존 채널에서 나가기 처리
    await handleVoiceLeave(userId, oldState);
    
    // 새 채널에 참가 처리
    await handleVoiceJoin(userId, newState);

    logger.info(`음성 채널 이동: ${newState.member.user.tag} ${oldState.channel.name} -> ${newState.channel.name}`);

  } catch (error) {
    logger.error('음성 채널 이동 처리 중 오류:', error);
  }
}

/**
 * 음성 상태 변경 처리 (음소거, 헤드셋 등)
 * @param {string} userId - 사용자 ID
 * @param {VoiceState} oldState - 이전 음성 상태
 * @param {VoiceState} newState - 새로운 음성 상태
 */
async function handleVoiceStateChange(userId, oldState, newState) {
  try {
    // AFK 감지 시스템 제거됨

    // 상태 변경 로그
    const changes = [];
    if (oldState.mute !== newState.mute) {
      changes.push(`서버음소거: ${newState.mute ? 'ON' : 'OFF'}`);
    }
    if (oldState.selfMute !== newState.selfMute) {
      changes.push(`자체음소거: ${newState.selfMute ? 'ON' : 'OFF'}`);
    }
    if (oldState.deaf !== newState.deaf) {
      changes.push(`서버헤드셋: ${newState.deaf ? 'OFF' : 'ON'}`);
    }
    if (oldState.selfDeaf !== newState.selfDeaf) {
      changes.push(`자체헤드셋: ${newState.selfDeaf ? 'OFF' : 'ON'}`);
    }

    if (changes.length > 0) {
      logger.debug(`음성 상태 변경: ${newState.member.user.tag} - ${changes.join(', ')}`);
    }

  } catch (error) {
    logger.error('음성 상태 변경 처리 중 오류:', error);
  }
}

/**
 * 말하기 활동 처리 (더미 함수)
 * Discord.js v14에서 speaking 이벤트가 제거되어 더 이상 작동하지 않음
 * @param {string} userId - 사용자 ID
 * @param {boolean} speaking - 말하기 상태
 */
function handleSpeakingActivity(userId, speaking) {
  // Discord.js v14에서 speaking 이벤트가 제거되어 이 함수는 호출되지 않음
  // 하위 호환성을 위해 빈 함수로 유지
}

/**
 * 음성 점수 계산
 * @param {string} userId - 사용자 ID
 * @param {Object} session - 세션 정보
 * @param {Date} endTime - 종료 시간
 * @param {Client} client - Discord 클라이언트 (채널 정보 조회용)
 * @returns {number} 계산된 점수
 */
async function calculateVoiceScore(userId, session, endTime, client = null) {
  try {
    const duration = (endTime - session.startTime) / 60000; // 분 단위
    const timeWeight = getTimeWeight(session.startTime);
    
    // 채널 내 인원수에 따른 점수 계산
    let pointsPerMinute = VOICE_SCORING.MULTI_POINTS_PER_MINUTE; // 기본값
    
    if (client && session.channelId) {
      try {
        const channel = await client.channels.fetch(session.channelId);
        if (channel && channel.members) {
          // 봇을 제외한 실제 사용자 수만 카운트
          const humanMemberCount = channel.members.filter(member => !member.user.bot).size;
          // 혼자 있으면 낮은 점수, 2명 이상이면 높은 점수
          if (humanMemberCount <= 1) {
            pointsPerMinute = VOICE_SCORING.SOLO_POINTS_PER_MINUTE;
          }
          logger.debug(`채널 ${session.channelId} 인원수: ${humanMemberCount}명 (봇 제외), 점수: ${pointsPerMinute}점/분`);
        }
      } catch (channelError) {
        logger.debug('채널 정보 조회 실패, 기본 점수 적용:', channelError.message);
        // 채널 정보를 가져올 수 없는 경우 기본 점수 적용
      }
    }
    
    let score = duration * pointsPerMinute * timeWeight;

    // 말하기 활동 보너스 제거됨 (Discord API 제한으로 인해 작동하지 않음)

    // AFK 패널티 제거됨 - 모든 활동에 동일한 점수 적용

    return Math.round(score * 100) / 100; // 소수점 둘째 자리까지

  } catch (error) {
    logger.error('음성 점수 계산 중 오류:', error);
    return 0;
  }
}

/**
 * 음성 세션 데이터베이스 저장
 * @param {string} userId - 사용자 ID
 * @param {Object} session - 세션 정보
 * @param {Date} endTime - 종료 시간
 * @param {number} duration - 지속 시간 (초)
 * @param {number} score - 점수
 */
async function saveVoiceSession(userId, session, endTime, duration, score) {
  try {
    const internalUserId = await getUserIdByDiscordId(userId, session.guildId);
    if (!internalUserId) {
      logger.error('음성 세션 저장 실패: 사용자의 내부 ID를 찾을 수 없습니다.', { userId, guildId: session.guildId });
      return;
    }

    // duration을 정수로 변환 (데이터베이스 스키마가 INTEGER 타입)
    const durationInt = Math.round(duration);
    const speakingTimeInt = 0; // 말하기 시간 추적 불가능 (Discord API 제한)

    // 트랜잭션으로 음성 세션 저장과 사용자 통계 업데이트를 함께 처리
    await db.transaction(async (query) => {
      // 음성 세션 저장
      await query(`
        INSERT INTO voice_sessions 
        (user_id, channel_id, start_time, end_time, duration, speaking_time, total_score, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        internalUserId, session.channelId,
        session.startTime, endTime, durationInt,
        speakingTimeInt, score, new Date()
      ]);

      // users 테이블의 음성 시간 및 점수 업데이트
      await query(`
        UPDATE users 
        SET total_voice_time = total_voice_time + $1,
            voice_score = voice_score + $2,
            current_score = voice_score + message_score + reaction_score + other_score + $2,
            last_voice_activity = $3,
            last_active = $3,
            updated_at = $3
        WHERE discord_id = $4 AND guild_id = $5
      `, [durationInt, score, endTime, userId, session.guildId]);
    });

    logger.debug(`음성 세션 저장 완료: ${userId} - ${score}점, ${durationInt}초`);

  } catch (error) {
    logger.error('음성 세션 저장 중 오류:', error);
  }
}

/**
 * 사용자 점수 업데이트
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {number} score - 추가할 점수
 */
async function updateUserScore(userId, guildId, score) {
  try {
    await updateUserScoreInDb(userId, guildId, score, 'voice');
    logger.debug(`사용자 점수 업데이트: ${userId} +${score}점`);

  } catch (error) {
    logger.error('사용자 점수 업데이트 중 오류:', error);
  }
}

/**
 * 음성 활동 로그 저장
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {string} type - 활동 타입
 * @param {Object} data - 추가 데이터
 */
async function logVoiceActivity(userId, guildId, type, data) {
  try {
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, activity_type, details, score_awarded, timestamp, created_at)
      VALUES (
        (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
        $2, $3, $4, $5, $6, $7
      )
    `, [userId, guildId, `voice_${type}`, JSON.stringify(data), data.score || 0, data.timestamp, new Date()]);

  } catch (error) {
    logger.error('음성 활동 로그 저장 중 오류:', error);
  }
}

/**
 * 활성 음성 세션 정보 조회
 * @param {string} userId - 사용자 ID (선택사항)
 * @returns {Map|Object} 세션 정보
 */
function getActiveSessions(userId = null) {
  if (userId) {
    return activeSessions.get(userId) || null;
  }
  return activeSessions;
}

/**
 * 음성 활동 통계 조회
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID (선택사항)
 * @returns {Object} 통계 정보
 */
async function getVoiceStats(guildId, userId = null) {
  try {
    let query = `
      SELECT 
        COUNT(*) as total_sessions,
        SUM(duration) as total_duration,
        SUM(speaking_time) as total_speaking_time, -- 항상 0 (Discord API 제한)
        SUM(total_score) as total_score,
        AVG(total_score) as avg_score_per_session,
        AVG(duration) as avg_session_duration
      FROM voice_sessions vs
      JOIN users u ON vs.user_id = u.id
      WHERE u.guild_id = $1
    `;

    const params = [guildId];
    
    if (userId) {
      query += ' AND u.discord_id = $2';
      params.push(userId);
    }

    const result = await db.query(query, params);
    return result.rows[0] || {};

  } catch (error) {
    logger.error('음성 활동 통계 조회 중 오류:', error);
    return {};
  }
}

/**
 * 글로벌 클라이언트 참조 설정 (말하기 활동 처리용)
 * @param {Client} client - Discord.js 클라이언트
 */
function setGlobalClient(client) {
  global.discordClient = client;
}

module.exports = {
  trackVoiceActivity,
  handleSpeakingActivity,
  getActiveSessions,
  getVoiceStats,
  setGlobalClient,
  VOICE_SCORING
}; 