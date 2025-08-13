/**
 * 닉네임 동기화 스케줄러
 * 정기적으로 모든 사용자의 Discord 닉네임을 데이터베이스와 동기화
 */

const cron = require('node-cron');
const logger = require('../../utils/logger');
const db = require('../database');
const { forceNicknameSync, getCacheStats, clearExpiredCache } = require('../../utils/nickname');

class NicknameSyncScheduler {
  constructor(client) {
    this.client = client;
    this.isRunning = false;
    this.lastSyncResult = null;
    this.schedules = new Map();
  }

  /**
   * 스케줄러 시작
   */
  start() {
    logger.info('🔄 닉네임 동기화 스케줄러 시작');

    // 1. 매일 새벽 3시에 전체 동기화
    const fullSyncSchedule = cron.schedule('0 3 * * *', async () => {
      await this.runFullSync();
    }, {
      scheduled: true,
      timezone: 'Asia/Seoul'
    });

    // 2. 매시간 만료된 캐시 정리
    const cacheCleanupSchedule = cron.schedule('0 * * * *', () => {
      this.cleanupCache();
    }, {
      scheduled: true,
      timezone: 'Asia/Seoul'
    });

    // 3. 매 10분마다 활성 사용자 동기화 (선택사항)
    const activeSyncSchedule = cron.schedule('*/10 * * * *', async () => {
      await this.runActiveUserSync();
    }, {
      scheduled: false, // 기본적으로 비활성화
      timezone: 'Asia/Seoul'
    });

    this.schedules.set('fullSync', fullSyncSchedule);
    this.schedules.set('cacheCleanup', cacheCleanupSchedule);
    this.schedules.set('activeSync', activeSyncSchedule);

    logger.info('✅ 닉네임 동기화 스케줄러 설정 완료', {
      fullSync: '매일 03:00',
      cacheCleanup: '매시간',
      activeSync: '10분마다 (비활성화)'
    });
  }

  /**
   * 스케줄러 중지
   */
  stop() {
    logger.info('⏹️ 닉네임 동기화 스케줄러 중지');

    for (const [name, schedule] of this.schedules) {
      if (schedule) {
        schedule.destroy();
        logger.debug(`스케줄 중지: ${name}`);
      }
    }

    this.schedules.clear();
    logger.info('✅ 모든 닉네임 동기화 스케줄 중지 완료');
  }

  /**
   * 전체 사용자 닉네임 동기화 (일일 작업)
   */
  async runFullSync() {
    if (this.isRunning) {
      logger.warn('이미 닉네임 동기화가 실행 중입니다');
      return;
    }

    logger.info('🌅 일일 전체 닉네임 동기화 시작');
    this.isRunning = true;

    const startTime = Date.now();
    const result = {
      totalUsers: 0,
      successCount: 0,
      errorCount: 0,
      guilds: 0,
      errors: [],
      startTime: new Date(),
      endTime: null,
      duration: 0
    };

    try {
      // 모든 길드에서 동기화 수행
      const guilds = this.client.guilds.cache;
      result.guilds = guilds.size;

      logger.info(`${guilds.size}개 길드에서 닉네임 동기화 시작`);

      for (const [guildId, guild] of guilds) {
        try {
          const guildResult = await this.syncGuildNicknames(guild);
          result.totalUsers += guildResult.totalUsers;
          result.successCount += guildResult.successCount;
          result.errorCount += guildResult.errorCount;
          result.errors.push(...guildResult.errors);

          logger.info(`길드 동기화 완료: ${guild.name}`, {
            totalUsers: guildResult.totalUsers,
            successCount: guildResult.successCount,
            errorCount: guildResult.errorCount
          });

          // 길드 간 잠시 대기 (API 부하 방지)
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
          logger.error(`길드 동기화 실패: ${guild.name}`, error);
          result.errorCount++;
          result.errors.push({
            type: 'guild_error',
            guildId,
            guildName: guild.name,
            error: error.message
          });
        }
      }

      result.endTime = new Date();
      result.duration = Date.now() - startTime;

      logger.info('🎉 일일 전체 닉네임 동기화 완료', {
        guilds: result.guilds,
        totalUsers: result.totalUsers,
        successCount: result.successCount,
        errorCount: result.errorCount,
        duration: `${Math.round(result.duration / 1000)}초`,
        successRate: `${Math.round((result.successCount / Math.max(result.totalUsers, 1)) * 100)}%`
      });

      this.lastSyncResult = result;

      // 동기화 결과 DB에 로깅 (선택사항)
      await this.logSyncResult(result);

    } catch (error) {
      logger.error('전체 닉네임 동기화 중 에러:', error);
      result.endTime = new Date();
      result.duration = Date.now() - startTime;
      result.errors.push({
        type: 'system_error',
        error: error.message
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 특정 길드의 모든 사용자 닉네임 동기화
   * @param {Guild} guild - Discord 길드 객체
   * @returns {Promise<Object>} 동기화 결과
   */
  async syncGuildNicknames(guild) {
    const result = {
      totalUsers: 0,
      successCount: 0,
      errorCount: 0,
      errors: []
    };

    try {
      // DB에서 해당 길드의 모든 사용자 조회
      const dbResult = await db.query(
        'SELECT discord_id, display_name FROM users WHERE guild_id = $1 AND is_active = true',
        [guild.id]
      );

      result.totalUsers = dbResult.rows.length;

      if (result.totalUsers === 0) {
        logger.debug(`길드에 활성 사용자 없음: ${guild.name}`);
        return result;
      }

      // Discord에서 멤버 정보 가져오기 (배치 처리)
      let members;
      try {
        members = await guild.members.fetch();
      } catch (error) {
        logger.error(`길드 멤버 조회 실패: ${guild.name}`, error);
        result.errorCount = result.totalUsers;
        return result;
      }

      // 각 사용자 닉네임 동기화
      for (const userRow of dbResult.rows) {
        const discordId = userRow.discord_id;
        
        try {
          const member = members.get(discordId);
          
          if (!member) {
            logger.debug(`멤버가 길드에 없음: ${discordId} in ${guild.name}`);
            continue;
          }

          // 강제 동기화 수행
          const syncResult = await forceNicknameSync(guild, discordId);
          
          if (syncResult.success) {
            result.successCount++;
            if (syncResult.newDisplayName !== userRow.display_name) {
              logger.debug(`닉네임 업데이트됨: ${discordId}`, {
                old: userRow.display_name,
                new: syncResult.newDisplayName,
                guild: guild.name
              });
            }
          } else {
            result.errorCount++;
            result.errors.push({
              type: 'user_sync_error',
              discordId,
              error: syncResult.error
            });
          }

          // 사용자 간 잠시 대기 (API 부하 방지)
          await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error) {
          result.errorCount++;
          result.errors.push({
            type: 'user_error',
            discordId,
            error: error.message
          });
          logger.debug(`사용자 동기화 실패: ${discordId}`, error);
        }
      }

    } catch (error) {
      logger.error(`길드 닉네임 동기화 실패: ${guild.name}`, error);
      throw error;
    }

    return result;
  }

  /**
   * 활성 사용자 닉네임 동기화 (빠른 업데이트용)
   */
  async runActiveUserSync() {
    if (this.isRunning) {
      return; // 전체 동기화 중이면 건너뛰기
    }

    logger.debug('⚡ 활성 사용자 닉네임 동기화 시작');

    try {
      // 최근 24시간 내 활동한 사용자들만 동기화
      const activeUsersResult = await db.query(`
        SELECT DISTINCT u.discord_id, u.guild_id
        FROM users u
        JOIN activities a ON u.id = a.user_id
        WHERE a.timestamp >= NOW() - INTERVAL '24 hours'
          AND u.is_active = true
        LIMIT 50
      `);

      if (activeUsersResult.rows.length === 0) {
        logger.debug('동기화할 활성 사용자 없음');
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      for (const userRow of activeUsersResult.rows) {
        try {
          const guild = this.client.guilds.cache.get(userRow.guild_id);
          if (!guild) continue;

          const syncResult = await forceNicknameSync(guild, userRow.discord_id);
          if (syncResult.success) {
            successCount++;
          } else {
            errorCount++;
          }

          // 빠른 처리를 위해 짧은 대기
          await new Promise(resolve => setTimeout(resolve, 25));

        } catch (error) {
          errorCount++;
          logger.debug(`활성 사용자 동기화 실패: ${userRow.discord_id}`, error);
        }
      }

      logger.debug('⚡ 활성 사용자 닉네임 동기화 완료', {
        processed: activeUsersResult.rows.length,
        successCount,
        errorCount
      });

    } catch (error) {
      logger.warn('활성 사용자 닉네임 동기화 중 에러:', error);
    }
  }

  /**
   * 캐시 정리
   */
  cleanupCache() {
    try {
      const beforeStats = getCacheStats();
      const clearedCount = clearExpiredCache();
      const afterStats = getCacheStats();

      logger.debug('🧹 닉네임 캐시 정리 완료', {
        before: beforeStats.totalEntries,
        after: afterStats.totalEntries,
        cleared: clearedCount,
        validEntries: afterStats.validEntries
      });
    } catch (error) {
      logger.warn('캐시 정리 중 에러:', error);
    }
  }

  /**
   * 동기화 결과 DB에 로깅
   * @param {Object} result - 동기화 결과
   */
  async logSyncResult(result) {
    try {
      await db.query(`
        INSERT INTO sync_logs (
          sync_type, start_time, end_time, duration_ms,
          total_items, success_count, error_count, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'nickname_full_sync',
        result.startTime,
        result.endTime,
        result.duration,
        result.totalUsers,
        result.successCount,
        result.errorCount,
        JSON.stringify({
          guilds: result.guilds,
          errors: result.errors.slice(0, 10) // 처음 10개 에러만 저장
        })
      ]);
    } catch (error) {
      // 로깅 실패는 중요하지 않으므로 조용히 처리
      logger.debug('동기화 결과 로깅 실패:', error);
    }
  }

  /**
   * 수동 동기화 트리거
   * @param {string} guildId - 길드 ID (선택사항)
   * @returns {Promise<Object>} 동기화 결과
   */
  async triggerManualSync(guildId = null) {
    if (this.isRunning) {
      throw new Error('이미 동기화가 실행 중입니다');
    }

    logger.info('🔧 수동 닉네임 동기화 시작', { guildId });

    if (guildId) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        throw new Error(`길드를 찾을 수 없습니다: ${guildId}`);
      }
      return await this.syncGuildNicknames(guild);
    } else {
      await this.runFullSync();
      return this.lastSyncResult;
    }
  }

  /**
   * 활성 사용자 동기화 활성화/비활성화
   * @param {boolean} enabled - 활성화 여부
   */
  toggleActiveSync(enabled) {
    const schedule = this.schedules.get('activeSync');
    if (!schedule) return;

    if (enabled) {
      schedule.start();
      logger.info('⚡ 활성 사용자 동기화 활성화됨');
    } else {
      schedule.stop();
      logger.info('⏸️ 활성 사용자 동기화 비활성화됨');
    }
  }

  /**
   * 스케줄러 상태 조회
   * @returns {Object} 상태 정보
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastSyncResult: this.lastSyncResult,
      cacheStats: getCacheStats(),
      schedules: Array.from(this.schedules.keys()).map(name => ({
        name,
        running: this.schedules.get(name)?.running || false
      }))
    };
  }
}

module.exports = NicknameSyncScheduler;
