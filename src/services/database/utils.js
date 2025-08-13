/**
 * 데이터베이스 유틸리티 함수들
 * 공통 DB 작업, 순위 계산, 위계적 음악 권한 등
 */
const db = require('./index');
const logger = require('../../utils/logger');

// =====================================
// 사용자 관련 유틸리티
// =====================================

/**
 * 사용자 찾기 또는 생성
 * @param {string} discordId - Discord 사용자 ID
 * @param {number} guildId - 길드 ID
 * @param {Object} userData - 사용자 데이터
 * @returns {Promise<Object>} 사용자 객체
 */
async function findOrCreateUser(discordId, guildId, userData = {}) {
  try {
    // 기존 사용자 찾기
    let result = await db.query(
      'SELECT * FROM users WHERE discord_id = $1 AND guild_id = $2',
      [discordId, guildId]
    );

    if (result.rows.length > 0) {
      // 사용자 정보 업데이트 (마지막 활동 시간 등)
      await db.query(
        `UPDATE users SET 
         username = COALESCE($3, username),
         discriminator = COALESCE($4, discriminator),
         display_name = COALESCE($5, display_name),
         last_active = NOW(),
         updated_at = NOW()
         WHERE discord_id = $1 AND guild_id = $2`,
        [
          discordId, 
          guildId, 
          userData.username, 
          userData.discriminator, 
          userData.displayName
        ]
      );

      return result.rows[0];
    }

    // 새 사용자 생성 (중복 시 기존 사용자 반환)
    result = await db.query(
      `INSERT INTO users (discord_id, guild_id, username, discriminator, display_name) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (discord_id) 
       DO UPDATE SET 
         username = COALESCE($3, users.username),
         discriminator = COALESCE($4, users.discriminator),
         display_name = COALESCE($5, users.display_name),
         last_active = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        discordId,
        guildId,
        userData.username || 'Unknown',
        userData.discriminator || '0000',
        userData.displayName || userData.username || 'Unknown'
      ]
    );

    // 평생 통계 레코드도 생성
    await db.query(
      'INSERT INTO lifetime_stats (user_id) VALUES ($1)',
      [result.rows[0].id]
    );

    logger.info(`새 사용자 생성됨: ${userData.username}#${userData.discriminator}`);
    return result.rows[0];

  } catch (error) {
    logger.error('사용자 찾기/생성 중 에러:', error);
    throw error;
  }
}

/**
 * 사용자 점수 업데이트 및 순위 재계산
 * @param {string} discordId - Discord 사용자 ID
 * @param {number} guildId - 길드 ID
 * @param {number} scoreToAdd - 추가할 점수
 * @param {string} scoreType - 점수 타입 (voice, message, reaction, other)
 * @returns {Promise<Object>} 업데이트된 사용자 정보
 */
async function updateUserScore(discordId, guildId, scoreToAdd, scoreType = 'other') {
  return await db.transaction(async (query) => {
    // 점수 타입 검증
    const validTypes = ['voice', 'message', 'reaction', 'other'];
    if (!validTypes.includes(scoreType)) {
      throw new Error(`Invalid score type: ${scoreType}`);
    }

    // 사용자 점수 업데이트 (동적 쿼리 방지를 위해 조건문 사용)
    let updateQuery;
    if (scoreType === 'voice') {
      updateQuery = `UPDATE users SET 
        voice_score = voice_score + $3,
        current_score = voice_score + message_score + reaction_score + other_score + $3,
        updated_at = NOW()
        WHERE discord_id = $1 AND guild_id = $2 
        RETURNING *`;
    } else if (scoreType === 'message') {
      updateQuery = `UPDATE users SET 
        message_score = message_score + $3,
        current_score = voice_score + message_score + reaction_score + other_score + $3,
        updated_at = NOW()
        WHERE discord_id = $1 AND guild_id = $2 
        RETURNING *`;
    } else if (scoreType === 'reaction') {
      updateQuery = `UPDATE users SET 
        reaction_score = reaction_score + $3,
        current_score = voice_score + message_score + reaction_score + other_score + $3,
        updated_at = NOW()
        WHERE discord_id = $1 AND guild_id = $2 
        RETURNING *`;
    } else {
      updateQuery = `UPDATE users SET 
        other_score = other_score + $3,
        current_score = voice_score + message_score + reaction_score + other_score + $3,
        updated_at = NOW()
        WHERE discord_id = $1 AND guild_id = $2 
        RETURNING *`;
    }

    const updateResult = await query(updateQuery, [discordId, guildId, scoreToAdd]);

    if (updateResult.rows.length === 0) {
      throw new Error(`사용자를 찾을 수 없습니다: ${discordId}`);
    }

    const user = updateResult.rows[0];

    // 해당 길드의 순위 재계산
    await recalculateRankings(guildId, query);

    // 업데이트된 사용자 정보 반환
    const finalResult = await query(
      'SELECT * FROM users WHERE discord_id = $1 AND guild_id = $2',
      [discordId, guildId]
    );

    return finalResult.rows[0];
  });
}

/**
 * 길드 내 순위 재계산
 * @param {number} guildId - 길드 ID
 * @param {Function} queryFn - 쿼리 함수 (트랜잭션용)
 */
async function recalculateRankings(guildId, queryFn = db.query) {
  try {
    // 점수순으로 정렬하여 순위 부여
    await queryFn(
      `UPDATE users SET 
       current_rank = ranked_users.new_rank,
       updated_at = NOW()
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY current_score DESC, username ASC) as new_rank
         FROM users 
         WHERE guild_id = $1 AND is_active = TRUE AND current_score > 0
       ) as ranked_users
       WHERE users.id = ranked_users.id`,
      [guildId]
    );

    logger.debug(`길드 ${guildId}의 순위 재계산 완료`);
  } catch (error) {
    logger.error('순위 재계산 중 에러:', error);
    throw error;
  }
}

// =====================================
// 음악 권한 시스템
// =====================================

/**
 * 음악 제어 권한 확인 (위계적 시스템)
 * @param {string} controllerDiscordId - 제어하려는 사용자의 Discord ID
 * @param {string} musicOwnerDiscordId - 음악 소유자의 Discord ID  
 * @param {number} guildId - 길드 ID
 * @returns {Promise<Object>} 권한 정보
 */
async function checkMusicPermission(controllerDiscordId, musicOwnerDiscordId, guildId) {
  try {
    const result = await db.query(
      `SELECT 
         controller.current_rank as controller_rank,
         controller.username as controller_name,
         owner.current_rank as owner_rank,
         owner.username as owner_name,
         (controller.current_rank < owner.current_rank) as has_permission
       FROM users controller
       CROSS JOIN users owner
       WHERE controller.discord_id = $1 
         AND controller.guild_id = $3
         AND owner.discord_id = $2 
         AND owner.guild_id = $3
         AND controller.is_active = TRUE 
         AND owner.is_active = TRUE`,
      [controllerDiscordId, musicOwnerDiscordId, guildId]
    );

    if (result.rows.length === 0) {
      return {
        hasPermission: false,
        reason: '사용자를 찾을 수 없습니다',
        controllerRank: null,
        ownerRank: null
      };
    }

    const row = result.rows[0];
    
    return {
      hasPermission: row.has_permission,
      reason: row.has_permission ? 
        `${row.controller_name}(${row.controller_rank}위)가 ${row.owner_name}(${row.owner_rank}위)의 음악을 제어할 수 있습니다` :
        `${row.controller_name}(${row.controller_rank}위)는 ${row.owner_name}(${row.owner_rank}위)의 음악을 제어할 수 없습니다`,
      controllerRank: row.controller_rank,
      ownerRank: row.owner_rank,
      controllerName: row.controller_name,
      ownerName: row.owner_name
    };

  } catch (error) {
    logger.error('음악 권한 확인 중 에러:', error);
    return {
      hasPermission: false,
      reason: '권한 확인 중 에러가 발생했습니다',
      error: error.message
    };
  }
}

/**
 * 음악 로그 기록
 * @param {Object} logData - 음악 로그 데이터
 * @returns {Promise<Object>} 생성된 로그
 */
async function logMusicAction(logData) {
  try {
    const result = await db.query(
      `INSERT INTO music_logs (
         guild_id, requester_id, controller_id, track_url, track_title, 
         track_duration, track_thumbnail, action_type, requester_rank, 
         controller_rank, permission_granted, channel_id, volume_level, 
         queue_position, details
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        logData.guildId,
        logData.requesterId,
        logData.controllerId,
        logData.trackUrl,
        logData.trackTitle,
        logData.trackDuration,
        logData.trackThumbnail,
        logData.actionType,
        logData.requesterRank,
        logData.controllerRank,
        logData.permissionGranted,
        logData.channelId,
        logData.volumeLevel,
        logData.queuePosition,
        logData.details || {}
      ]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('음악 로그 기록 중 에러:', error);
    throw error;
  }
}

// =====================================
// 순위 및 통계 조회
// =====================================

/**
 * 길드 순위 조회
 * @param {number} guildId - 길드 ID
 * @param {number} limit - 조회할 인원 수
 * @returns {Promise<Array>} 순위 목록
 */
async function getGuildRankings(guildId, limit = 10) {
  try {
    const result = await db.query(
      `SELECT 
         discord_id,
         username,
         display_name,
         current_score,
         current_rank,
         voice_score,
         message_score,
         reaction_score,
         other_score,
         total_voice_time,
         total_messages,
         last_active
       FROM users 
       WHERE guild_id = $1 AND is_active = TRUE AND current_score > 0
       ORDER BY current_rank ASC
       LIMIT $2`,
      [guildId, limit]
    );

    return result.rows;
  } catch (error) {
    logger.error('길드 순위 조회 중 에러:', error);
    throw error;
  }
}

/**
 * 사용자 상세 통계 조회
 * @param {string} discordId - Discord 사용자 ID
 * @param {number} guildId - 길드 ID
 * @returns {Promise<Object>} 사용자 통계
 */
async function getUserStats(discordId, guildId) {
  try {
    const result = await db.query(
      `SELECT 
         u.*,
         ls.total_score as lifetime_total_score,
         ls.total_seasons_participated,
         ls.first_place_wins,
         ls.top_3_finishes,
         ls.average_rank,
         ls.best_rank,
         ls.consistency_index
       FROM users u
       LEFT JOIN lifetime_stats ls ON u.id = ls.user_id
       WHERE u.discord_id = $1 AND u.guild_id = $2`,
      [discordId, guildId]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('사용자 통계 조회 중 에러:', error);
    throw error;
  }
}

// =====================================
// 페이지네이션 및 필터링
// =====================================

/**
 * 페이지네이션된 쿼리 실행
 * @param {string} baseQuery - 기본 쿼리
 * @param {Array} params - 쿼리 매개변수
 * @param {number} page - 페이지 번호 (1부터 시작)
 * @param {number} limit - 페이지당 항목 수
 * @returns {Promise<Object>} 페이지네이션 결과
 */
async function paginatedQuery(baseQuery, params = [], page = 1, limit = 10) {
  try {
    const offset = (page - 1) * limit;
    
    // 전체 개수 조회
    const countQuery = baseQuery.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM');
    const countResult = await db.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);
    
    // 데이터 조회
    const dataQuery = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const dataResult = await db.query(dataQuery, [...params, limit, offset]);
    
    return {
      data: dataResult.rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasNextPage: page * limit < totalCount,
        hasPrevPage: page > 1
      }
    };
  } catch (error) {
    logger.error('페이지네이션 쿼리 중 에러:', error);
    throw error;
  }
}

/**
 * 시간 범위별 활동 조회
 * @param {number} guildId - 길드 ID
 * @param {Date} startDate - 시작 날짜
 * @param {Date} endDate - 종료 날짜
 * @param {string} activityType - 활동 타입 (선택사항)
 * @returns {Promise<Array>} 활동 목록
 */
async function getActivitiesByTimeRange(guildId, startDate, endDate, activityType = null) {
  try {
    let query = `
      SELECT a.*, u.username, u.display_name
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE a.guild_id = $1 
        AND a.timestamp >= $2 
        AND a.timestamp <= $3
    `;
    
    const params = [guildId, startDate, endDate];
    
    if (activityType) {
      query += ' AND a.activity_type = $4';
      params.push(activityType);
    }
    
    query += ' ORDER BY a.timestamp DESC';
    
    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error('시간 범위별 활동 조회 중 에러:', error);
    throw error;
  }
}

/**
 * Discord ID로 사용자 내부 ID 조회
 * @param {string} discordId - Discord 사용자 ID
 * @param {string} guildId - 길드 ID
 * @returns {Promise<number|null>} 사용자 내부 ID 또는 null
 */
async function getUserIdByDiscordId(discordId, guildId) {
  try {
    const result = await db.query(
      'SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2',
      [discordId, guildId]
    );
    return result.rows.length > 0 ? result.rows[0].id : null;
  } catch (error) {
    logger.error('Discord ID로 사용자 ID 조회 중 에러:', { discordId, guildId, error });
    return null;
  }
}

// =====================================
// 배치 작업
// =====================================

/**
 * 일일 통계 집계
 * @param {Date} date - 집계할 날짜
 * @param {number} guildId - 길드 ID (선택사항)
 * @returns {Promise<void>}
 */
async function aggregateDailyStats(date, guildId = null) {
  try {
    const dateStr = date.toISOString().split('T')[0];
    
    let guildCondition = '';
    let params = [dateStr];
    
    if (guildId) {
      guildCondition = 'AND a.guild_id = $2';
      params.push(guildId);
    }
    
    await db.query(`
      INSERT INTO daily_stats (
        date, user_id, guild_id, 
        daily_voice_score, daily_message_score, daily_reaction_score, daily_other_score,
        daily_total_score, voice_sessions, voice_time, messages_sent,
        reactions_given, reactions_received
      )
      SELECT 
        $1::date as date,
        a.user_id,
        a.guild_id,
        COALESCE(SUM(CASE WHEN a.activity_type LIKE 'voice_%' THEN a.score_awarded END), 0) as daily_voice_score,
        COALESCE(SUM(CASE WHEN a.activity_type LIKE 'message_%' THEN a.score_awarded END), 0) as daily_message_score,
        COALESCE(SUM(CASE WHEN a.activity_type LIKE 'reaction_%' THEN a.score_awarded END), 0) as daily_reaction_score,
        COALESCE(SUM(CASE WHEN a.activity_type NOT LIKE 'voice_%' AND a.activity_type NOT LIKE 'message_%' AND a.activity_type NOT LIKE 'reaction_%' THEN a.score_awarded END), 0) as daily_other_score,
        COALESCE(SUM(a.score_awarded), 0) as daily_total_score,
        COUNT(DISTINCT CASE WHEN a.activity_type = 'voice_join' THEN a.details->>'session_id' END) as voice_sessions,
        COALESCE(SUM(CASE WHEN a.activity_type = 'voice_leave' THEN (a.details->>'duration')::integer END), 0) as voice_time,
        COUNT(CASE WHEN a.activity_type = 'message_create' THEN 1 END) as messages_sent,
        COUNT(CASE WHEN a.activity_type = 'reaction_add' THEN 1 END) as reactions_given,
        0 as reactions_received -- 별도 계산 필요
      FROM activities a
      WHERE DATE(a.timestamp) = $1 ${guildCondition}
      GROUP BY a.user_id, a.guild_id
      ON CONFLICT (date, user_id, guild_id) 
      DO UPDATE SET
        daily_voice_score = EXCLUDED.daily_voice_score,
        daily_message_score = EXCLUDED.daily_message_score,
        daily_reaction_score = EXCLUDED.daily_reaction_score,
        daily_other_score = EXCLUDED.daily_other_score,
        daily_total_score = EXCLUDED.daily_total_score,
        voice_sessions = EXCLUDED.voice_sessions,
        voice_time = EXCLUDED.voice_time,
        messages_sent = EXCLUDED.messages_sent,
        reactions_given = EXCLUDED.reactions_given,
        updated_at = NOW()
    `, params);

    logger.info(`일일 통계 집계 완료: ${dateStr}${guildId ? ` (길드: ${guildId})` : ''}`);
  } catch (error) {
    logger.error('일일 통계 집계 중 에러:', error);
    throw error;
  }
}

module.exports = {
  // 사용자 관리
  findOrCreateUser,
  updateUserScore,
  recalculateRankings,
  
  // 음악 권한 시스템
  checkMusicPermission,
  logMusicAction,
  
  // 순위 및 통계
  getGuildRankings,
  getUserStats,
  
  // 유틸리티
  paginatedQuery,
  getActivitiesByTimeRange,
  aggregateDailyStats,
  getUserIdByDiscordId
}; 