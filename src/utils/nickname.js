/**
 * 통합 닉네임 관리 시스템
 * Discord 닉네임 자동 동기화, 캐싱, 에러 처리 등을 통합 관리
 */

const logger = require('./logger');
const db = require('../services/database');

// 메모리 캐시 시스템 (TTL: 5분, 최대 1000개)
const CACHE_TTL = 5 * 60 * 1000; // 5분
const MAX_CACHE_SIZE = 1000;
const nicknameCache = new Map();

// 캐시 정리 타이머
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of nicknameCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      nicknameCache.delete(key);
    }
  }
}, 60000); // 1분마다 정리

/**
 * 사용자의 표시명을 가져오는 통합 함수
 * 1. 캐시 확인 → 2. Discord 실시간 조회 → 3. DB 조회 → 4. 기본값
 * @param {Guild} guild - Discord 길드 객체
 * @param {string} discordId - Discord 사용자 ID
 * @param {Object} options - 옵션
 * @param {boolean} options.updateDB - DB 업데이트 여부 (기본: true)
 * @param {boolean} options.useCache - 캐시 사용 여부 (기본: true)
 * @param {string} options.fallback - 기본값 (기본: 'Unknown User')
 * @returns {Promise<string>} 사용자 표시명
 */
async function getDisplayName(guild, discordId, options = {}) {
  const {
    updateDB = true,
    useCache = true,
    fallback = 'Unknown User'
  } = options;

  const cacheKey = `${guild.id}-${discordId}`;

  try {
    // 1. 캐시 확인
    if (useCache && nicknameCache.has(cacheKey)) {
      const cached = nicknameCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        logger.debug(`닉네임 캐시 히트: ${discordId} -> ${cached.displayName}`);
        return cached.displayName;
      }
      nicknameCache.delete(cacheKey);
    }

    // 2. Discord 실시간 조회
    let discordDisplayName = null;
    let member = null;
    
    try {
      member = await guild.members.fetch(discordId);
      discordDisplayName = member.nickname || member.displayName || member.user.username;
      
      logger.debug(`Discord에서 닉네임 조회 성공: ${discordId} -> ${discordDisplayName}`);
      
      // Discord 조회 성공 시 캐시 업데이트
      if (useCache) {
        // 캐시 크기 제한
        if (nicknameCache.size >= MAX_CACHE_SIZE) {
          const oldestKey = nicknameCache.keys().next().value;
          nicknameCache.delete(oldestKey);
        }
        
        nicknameCache.set(cacheKey, {
          displayName: discordDisplayName,
          timestamp: Date.now()
        });
      }

      // DB 업데이트 (백그라운드에서 실행)
      if (updateDB) {
        updateUserDisplayNameInDB(discordId, guild.id, discordDisplayName, member.user.username).catch(error => {
          logger.warn(`닉네임 DB 업데이트 실패: ${discordId}`, error);
        });
      }

      return discordDisplayName;

    } catch (discordError) {
      logger.debug(`Discord 멤버 조회 실패: ${discordId} - ${discordError.message}`);
    }

    // 3. DB에서 기존 닉네임 조회
    try {
      const dbResult = await db.query(
        'SELECT display_name, username FROM users WHERE discord_id = $1 AND guild_id = $2',
        [discordId, guild.id]
      );

      if (dbResult.rows.length > 0) {
        const dbDisplayName = dbResult.rows[0].display_name || dbResult.rows[0].username;
        if (dbDisplayName && dbDisplayName !== 'Unknown' && dbDisplayName !== 'Unknown User') {
          logger.debug(`DB에서 닉네임 조회: ${discordId} -> ${dbDisplayName}`);
          return dbDisplayName;
        }
      }
    } catch (dbError) {
      logger.warn(`닉네임 DB 조회 실패: ${discordId}`, dbError);
    }

    // 4. 기본값 반환
    logger.debug(`닉네임 기본값 사용: ${discordId} -> ${fallback}`);
    return fallback;

  } catch (error) {
    logger.error(`닉네임 조회 중 예상치 못한 에러: ${discordId}`, error);
    return fallback;
  }
}

/**
 * 여러 사용자의 표시명을 배치로 가져오는 함수
 * @param {Guild} guild - Discord 길드 객체
 * @param {Array<string>} discordIds - Discord 사용자 ID 배열
 * @param {Object} options - 옵션
 * @returns {Promise<Map<string, string>>} 사용자 ID -> 표시명 맵
 */
async function getDisplayNamesBatch(guild, discordIds, options = {}) {
  const results = new Map();
  
  // 동시 실행 제한 (Discord API 부하 방지)
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < discordIds.length; i += BATCH_SIZE) {
    const batch = discordIds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (discordId) => {
      try {
        const displayName = await getDisplayName(guild, discordId, options);
        return [discordId, displayName];
      } catch (error) {
        logger.warn(`배치 닉네임 조회 실패: ${discordId}`, error);
        return [discordId, options.fallback || 'Unknown User'];
      }
    });

    const batchResults = await Promise.all(promises);
    batchResults.forEach(([discordId, displayName]) => {
      results.set(discordId, displayName);
    });

    // 배치 간 잠시 대기 (API 부하 방지)
    if (i + BATCH_SIZE < discordIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * DB에서 사용자 닉네임 업데이트 (백그라운드 실행용)
 * @param {string} discordId - Discord 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {string} displayName - 새 표시명
 * @param {string} username - 사용자명 (선택사항)
 */
async function updateUserDisplayNameInDB(discordId, guildId, displayName, username = null) {
  try {
    const updateData = [displayName];
    let updateQuery = 'UPDATE users SET display_name = $1, updated_at = NOW()';
    
    if (username) {
      updateQuery += ', username = $2';
      updateData.push(username);
      updateQuery += ' WHERE discord_id = $3 AND guild_id = $4';
      updateData.push(discordId, guildId);
    } else {
      updateQuery += ' WHERE discord_id = $2 AND guild_id = $3';
      updateData.push(discordId, guildId);
    }

    const result = await db.query(updateQuery, updateData);
    
    if (result.rowCount > 0) {
      logger.debug(`사용자 닉네임 DB 업데이트 완료: ${discordId} -> ${displayName}`);
    } else {
      logger.debug(`사용자 DB 업데이트 대상 없음: ${discordId}`);
    }
  } catch (error) {
    logger.error(`사용자 닉네임 DB 업데이트 실패: ${discordId}`, error);
    throw error;
  }
}

/**
 * 특정 사용자의 닉네임을 강제로 동기화
 * @param {Guild} guild - Discord 길드 객체
 * @param {string} discordId - Discord 사용자 ID
 * @returns {Promise<Object>} 동기화 결과
 */
async function forceNicknameSync(guild, discordId) {
  const cacheKey = `${guild.id}-${discordId}`;
  
  try {
    // 캐시 삭제
    nicknameCache.delete(cacheKey);
    
    // 강제로 Discord에서 조회
    const member = await guild.members.fetch(discordId);
    const newDisplayName = member.nickname || member.displayName || member.user.username;
    
    // DB 업데이트
    await updateUserDisplayNameInDB(discordId, guild.id, newDisplayName, member.user.username);
    
    // 새 캐시 설정
    nicknameCache.set(cacheKey, {
      displayName: newDisplayName,
      timestamp: Date.now()
    });
    
    logger.info(`닉네임 강제 동기화 완료: ${discordId} -> ${newDisplayName}`);
    
    return {
      success: true,
      oldDisplayName: null, // 이전 값을 알 수 없음
      newDisplayName,
      discordId
    };
    
  } catch (error) {
    logger.error(`닉네임 강제 동기화 실패: ${discordId}`, error);
    return {
      success: false,
      error: error.message,
      discordId
    };
  }
}

/**
 * 캐시 통계 조회
 * @returns {Object} 캐시 통계
 */
function getCacheStats() {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;

  for (const [key, value] of nicknameCache.entries()) {
    if (now - value.timestamp < CACHE_TTL) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    totalEntries: nicknameCache.size,
    validEntries,
    expiredEntries,
    cacheHitRate: validEntries / Math.max(nicknameCache.size, 1),
    maxSize: MAX_CACHE_SIZE,
    ttlMinutes: CACHE_TTL / 60000
  };
}

/**
 * 캐시 수동 정리
 */
function clearExpiredCache() {
  const now = Date.now();
  let cleared = 0;

  for (const [key, value] of nicknameCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      nicknameCache.delete(key);
      cleared++;
    }
  }

  logger.debug(`만료된 닉네임 캐시 ${cleared}개 정리 완료`);
  return cleared;
}

/**
 * 전체 캐시 초기화
 */
function clearAllCache() {
  const size = nicknameCache.size;
  nicknameCache.clear();
  logger.info(`닉네임 캐시 전체 초기화: ${size}개 항목 삭제`);
  return size;
}

module.exports = {
  getDisplayName,
  getDisplayNamesBatch,
  updateUserDisplayNameInDB,
  forceNicknameSync,
  getCacheStats,
  clearExpiredCache,
  clearAllCache
};
