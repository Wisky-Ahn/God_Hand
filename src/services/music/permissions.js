/**
 * 순위 기반 음악 권한 시스템
 * 사용자의 Discord 순위에 따른 계층적 음악 제어 권한 관리
 */

const db = require('../database');
const dbUtils = require('../database/utils');
const logger = require('../../utils/logger');

/**
 * 사용자의 현재 순위 조회 (실시간 계산)
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @returns {Promise<number>} 사용자 순위 (1부터 시작)
 */
async function getUserRank(guildId, userId) {
  try {
    // 매개변수 검증
    if (!guildId || !userId) {
      logger.warn(`getUserRank 매개변수 누락: guildId=${guildId}, userId=${userId}`);
      return 9999;
    }
    
    // 실시간 순위 계산 (current_score 기준)
    const result = await db.query(`
      WITH user_ranks AS (
        SELECT 
          discord_id,
          current_score,
          RANK() OVER (ORDER BY current_score DESC) as rank
        FROM users 
        WHERE guild_id = $1 AND current_score > 0
      )
      SELECT rank FROM user_ranks WHERE discord_id = $2
    `, [guildId, userId]);
    
    return result.rows[0]?.rank || 9999; // 기본값: 매우 낮은 순위
    
  } catch (error) {
    logger.error('사용자 순위 조회 중 오류:', error);
    return 9999; // 오류 시 가장 낮은 권한
  }
}

/**
 * 여러 사용자의 순위를 한번에 조회
 * @param {string} guildId - 길드 ID
 * @param {string[]} userIds - 사용자 ID 배열
 * @returns {Promise<Map<string, number>>} 사용자별 순위 맵
 */
async function getUserRanks(guildId, userIds) {
  try {
    if (!userIds || userIds.length === 0) {
      return new Map();
    }
    
    const placeholders = userIds.map((_, index) => `$${index + 2}`).join(', ');
    const result = await db.query(`
      SELECT discord_id, current_rank 
      FROM users 
      WHERE guild_id = $1 AND discord_id IN (${placeholders})
    `, [guildId, ...userIds]);
    
    const rankMap = new Map();
    result.rows.forEach(row => {
      rankMap.set(row.discord_id, row.current_rank);
    });
    
    // 조회되지 않은 사용자들은 기본값 설정
    userIds.forEach(userId => {
      if (!rankMap.has(userId)) {
        rankMap.set(userId, 9999);
      }
    });
    
    return rankMap;
    
  } catch (error) {
    logger.error('다중 사용자 순위 조회 중 오류:', error);
    const fallbackMap = new Map();
    userIds.forEach(userId => fallbackMap.set(userId, 9999));
    return fallbackMap;
  }
}

/**
 * 현재 재생 중인 트랙의 소유자 정보 조회
 * @param {string} guildId - 길드 ID
 * @returns {Promise<Object|null>} 트랙 소유자 정보
 */
async function getCurrentTrackOwner(guildId) {
  try {
    const musicPlayer = require('./index');
    const currentTrack = musicPlayer.currentTracks.get(guildId);
    
    if (!currentTrack || !currentTrack.requestedBy) {
      return null;
    }
    
    return {
      userId: currentTrack.requestedBy.id,
      rank: currentTrack.requestedBy.rank || await getUserRank(guildId, currentTrack.requestedBy.id),
      tag: currentTrack.requestedBy.tag,
      trackTitle: currentTrack.title
    };
    
  } catch (error) {
    logger.error('현재 트랙 소유자 조회 중 오류:', error);
    return null;
  }
}

/**
 * 사용자가 관리자 권한을 가지고 있는지 확인
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @returns {Promise<boolean>} 관리자 권한 여부
 */
async function isUserAdmin(guildId, userId) {
  try {
    // 매개변수 검증
    if (!guildId || !userId) {
      logger.warn(`매개변수 누락: guildId=${guildId}, userId=${userId}`);
      return false;
    }
    
    const client = global.discordClient;
    if (!client) {
      logger.warn('글로벌 클라이언트를 찾을 수 없음');
      return false;
    }
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`길드를 찾을 수 없음: ${guildId}`);
      return false;
    }
    
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      logger.warn(`멤버를 찾을 수 없음: ${userId}`);
      return false;
    }
    
    // 안전성 체크: permissions가 undefined인 경우 방지
    if (!member.permissions) {
      logger.warn(`멤버 권한 정보를 찾을 수 없음: ${userId}`);
      return false;
    }
    
    return member.permissions.has('Administrator');
    
  } catch (error) {
    logger.error('관리자 권한 확인 중 오류:', error);
    return false;
  }
}

/**
 * 음성 채널 참여 확인
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @returns {Promise<boolean>} 음성 채널 참여 여부
 */
async function isUserInVoiceChannel(guildId, userId) {
  try {
    // 매개변수 검증
    if (!guildId || !userId) {
      logger.warn(`매개변수 누락: guildId=${guildId}, userId=${userId}`);
      return false;
    }
    
    const client = global.discordClient;
    if (!client) return false;
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    
    // 안전성 체크: voice가 undefined인 경우 방지
    if (!member.voice) {
      logger.warn(`멤버 음성 정보를 찾을 수 없음: ${userId}`);
      return false;
    }
    
    return !!member.voice.channel;
    
  } catch (error) {
    logger.error('음성 채널 참여 확인 중 오류:', error);
    return false;
  }
}

/**
 * 음악 제어 권한 확인 (핵심 권한 시스템)
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 요청 사용자 ID
 * @param {string} action - 수행할 액션 ('skip', 'stop', 'control', 'add')
 * @param {Object} options - 추가 옵션
 * @returns {Promise<Object>} 권한 확인 결과
 */
async function canControlMusic(guildId, userId, action, options = {}) {
  try {
    // 1. 관리자는 모든 권한을 가짐
    const isAdmin = await isUserAdmin(guildId, userId);
    if (isAdmin) {
      return {
        allowed: true,
        reason: 'administrator',
        message: '관리자 권한으로 허용되었습니다.'
      };
    }
    
    // 2. 음성 채널 참여 확인 (add 액션 제외)
    if (action !== 'add') {
      const inVoice = await isUserInVoiceChannel(guildId, userId);
      if (!inVoice) {
        return {
          allowed: false,
          reason: 'not_in_voice',
          message: '음성 채널에 참여한 후 사용해주세요.'
        };
      }
    }
    
    // 3. add 액션은 모든 사용자에게 허용 (PRD 요구사항)
    if (action === 'add') {
      return {
        allowed: true,
        reason: 'add_allowed_for_all',
        message: '모든 사용자가 곡을 추가할 수 있습니다.'
      };
    }
    
    // 4. 현재 재생 중인 트랙 확인
    const currentTrackOwner = await getCurrentTrackOwner(guildId);
    
    // 재생 중인 트랙이 없으면 허용
    if (!currentTrackOwner) {
      return {
        allowed: true,
        reason: 'no_current_track',
        message: '현재 재생 중인 트랙이 없습니다.'
      };
    }
    
    // 5. 트랙 소유자 본인은 항상 자신의 트랙을 제어 가능
    if (currentTrackOwner.userId === userId) {
      return {
        allowed: true,
        reason: 'track_owner',
        message: '자신이 요청한 트랙을 제어할 수 있습니다.'
      };
    }
    
    // 6. 순위 기반 권한 확인 (핵심 로직)
    const userRank = await getUserRank(guildId, userId);
    const ownerRank = currentTrackOwner.rank;
    
    // 더 높은 순위(낮은 숫자)를 가진 사용자가 제어 가능
    if (userRank < ownerRank) {
      return {
        allowed: true,
        reason: 'higher_rank',
        message: `${userRank}위가 ${ownerRank}위의 음악을 제어할 수 있습니다.`,
        userRank,
        ownerRank,
        trackOwner: currentTrackOwner.tag,
        trackTitle: currentTrackOwner.trackTitle
      };
    }
    
    // 7. 권한 없음
    return {
      allowed: false,
      reason: 'insufficient_rank',
      message: `${ownerRank}위 ${currentTrackOwner.tag}님의 음악을 제어할 권한이 없습니다. (현재 순위: ${userRank}위)`,
      userRank,
      ownerRank,
      trackOwner: currentTrackOwner.tag,
      trackTitle: currentTrackOwner.trackTitle
    };
    
  } catch (error) {
    logger.error('음악 제어 권한 확인 중 오류:', error);
    return {
      allowed: false,
      reason: 'error',
      message: '권한 확인 중 오류가 발생했습니다.'
    };
  }
}

/**
 * 사용자의 음악 권한 정보 조회
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @returns {Promise<Object>} 권한 정보
 */
async function getUserMusicPermissions(guildId, userId) {
  try {
    const isAdmin = await isUserAdmin(guildId, userId);
    const userRank = await getUserRank(guildId, userId);
    const inVoice = await isUserInVoiceChannel(guildId, userId);
    const currentTrackOwner = await getCurrentTrackOwner(guildId);
    
    // 현재 제어 가능한 트랙이 있는지 확인
    let canControlCurrentTrack = false;
    if (currentTrackOwner) {
      if (isAdmin || currentTrackOwner.userId === userId || userRank < currentTrackOwner.rank) {
        canControlCurrentTrack = true;
      }
    }
    
    return {
      userId,
      guildId,
      isAdmin,
      rank: userRank,
      inVoiceChannel: inVoice,
      permissions: {
        canAdd: true, // 모든 사용자가 곡 추가 가능
        canSkip: canControlCurrentTrack && inVoice,
        canStop: canControlCurrentTrack && inVoice,
        canControlVolume: canControlCurrentTrack && inVoice,
        canControlQueue: isAdmin // 대기열 조작은 관리자만
      },
      currentTrack: currentTrackOwner ? {
        owner: currentTrackOwner.tag,
        ownerRank: currentTrackOwner.rank,
        title: currentTrackOwner.trackTitle,
        canControl: canControlCurrentTrack
      } : null
    };
    
  } catch (error) {
    logger.error('사용자 음악 권한 조회 중 오류:', error);
    return {
      userId,
      guildId,
      isAdmin: false,
      rank: 9999,
      inVoiceChannel: false,
      permissions: {
        canAdd: true,
        canSkip: false,
        canStop: false,
        canControlVolume: false,
        canControlQueue: false
      },
      currentTrack: null
    };
  }
}

/**
 * 음악 로그에 권한 정보 기록
 * @param {string} guildId - 길드 ID
 * @param {string} userId - 사용자 ID
 * @param {string} action - 수행된 액션
 * @param {Object} permissionResult - 권한 확인 결과
 * @param {Object} additionalData - 추가 데이터
 */
async function logMusicPermissionAction(guildId, userId, action, permissionResult, additionalData = {}) {
  try {
    const logData = {
      action,
      userId,
      permissionResult: {
        allowed: permissionResult.allowed,
        reason: permissionResult.reason,
        userRank: permissionResult.userRank,
        ownerRank: permissionResult.ownerRank
      },
      additionalData,
      timestamp: new Date()
    };
    
    await db.query(`
      INSERT INTO activities 
      (user_id, guild_id, activity_type, details, timestamp, created_at)
      VALUES (
        (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
        $2, $3, $4, $5, $6
      )
    `, [
      userId, guildId, 'music_play', 
      JSON.stringify(logData), 
      new Date(), 
      new Date()
    ]);
    
  } catch (error) {
    logger.error('음악 권한 로그 저장 중 오류:', error);
  }
}

/**
 * 길드의 음악 권한 통계 조회
 * @param {string} guildId - 길드 ID
 * @returns {Promise<Object>} 권한 통계
 */
async function getMusicPermissionStats(guildId) {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE data->>'allowed' = 'true') as allowed_actions,
        COUNT(*) FILTER (WHERE data->>'allowed' = 'false') as denied_actions,
        COUNT(*) FILTER (WHERE data->>'reason' = 'higher_rank') as rank_based_controls,
        COUNT(*) FILTER (WHERE data->>'reason' = 'administrator') as admin_overrides,
        COUNT(DISTINCT user_id) as active_users
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE u.guild_id = $1 
        AND type LIKE 'music_permission_%'
        AND timestamp >= NOW() - INTERVAL '7 days'
    `, [guildId]);
    
    return result.rows[0] || {
      allowed_actions: 0,
      denied_actions: 0,
      rank_based_controls: 0,
      admin_overrides: 0,
      active_users: 0
    };
    
  } catch (error) {
    logger.error('음악 권한 통계 조회 중 오류:', error);
    return {
      allowed_actions: 0,
      denied_actions: 0,
      rank_based_controls: 0,
      admin_overrides: 0,
      active_users: 0
    };
  }
}

module.exports = {
  getUserRank,
  getUserRanks,
  getCurrentTrackOwner,
  isUserAdmin,
  isUserInVoiceChannel,
  canControlMusic,
  getUserMusicPermissions,
  logMusicPermissionAction,
  getMusicPermissionStats
}; 