/**
 * 일일 통계 집계 시스템
 * 성능 최적화를 위한 데이터 집계, 스케줄링, 데이터 보존 정책을 관리합니다.
 */

const cron = require('node-cron');
const db = require('../database');
const logger = require('../../utils/logger');
const { getOptimizationConfig, performCleanup } = require('../../config/optimization');

class DailyStatsManager {
  constructor() {
    this.isInitialized = false;
    this.aggregationInProgress = false;
    this.cleanupInProgress = false;
    this.config = {
      aggregationTime: '0 1 * * *', // 새벽 1시
      cleanupTime: '0 2 * * 0',     // 일요일 새벽 2시
      retentionDays: 30,            // 상세 데이터 보관 일수
      aggregationDays: 90,          // 집계 데이터 보관 일수
      batchSize: 100                // 배치 처리 크기
    };
  }

  /**
   * 일일 통계 집계 시스템 초기화
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('Daily stats manager already initialized');
      return;
    }

    try {
      // 어제 데이터가 집계되지 않았다면 집계 수행
      await this.checkAndAggregateYesterday();

      // 스케줄러 시작
      this.startSchedulers();

      this.isInitialized = true;
      logger.info('Daily statistics aggregation system initialized');
    } catch (error) {
      logger.error('Failed to initialize daily stats manager', { error: error.stack });
      throw error;
    }
  }

  /**
   * 어제 데이터 집계 확인 및 수행
   */
  async checkAndAggregateYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    try {
      // 어제 데이터가 이미 집계되었는지 확인
      const existingStats = await db.query(
        'SELECT COUNT(*) FROM daily_stats WHERE date = $1',
        [yesterday]
      );

      const hasStats = parseInt(existingStats.rows[0].count) > 0;

      if (!hasStats) {
        logger.info('Yesterday\'s data not aggregated yet, starting aggregation...');
        await this.aggregateDailyStats(yesterday);
      } else {
        logger.info('Yesterday\'s data already aggregated');
      }
    } catch (error) {
      logger.error('Error checking yesterday\'s aggregation', { error: error.stack });
    }
  }

  /**
   * 스케줄러 시작
   */
  startSchedulers() {
    // 일일 집계 스케줄러 (매일 새벽 1시)
    cron.schedule(this.config.aggregationTime, async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await this.aggregateDailyStats(yesterday);
    });

    // 데이터 정리 스케줄러 (매주 일요일 새벽 2시)
    cron.schedule(this.config.cleanupTime, async () => {
      await this.performDataCleanup();
    });

    logger.info('Daily statistics schedulers started', {
      aggregation: this.config.aggregationTime,
      cleanup: this.config.cleanupTime
    });
  }

  /**
   * 특정 날짜의 일일 통계 집계
   * @param {Date} date - 집계할 날짜
   */
  async aggregateDailyStats(date) {
    if (this.aggregationInProgress) {
      logger.warn('Aggregation already in progress, skipping');
      return false;
    }

    this.aggregationInProgress = true;

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const endDate = new Date(targetDate);
    endDate.setDate(endDate.getDate() + 1);

    const dateStr = targetDate.toISOString().split('T')[0];
    logger.info(`Starting daily stats aggregation for ${dateStr}`);

    try {
      // 기존 집계 데이터 삭제 (재집계 시)
      await db.query(
        'DELETE FROM daily_stats WHERE date = $1',
        [targetDate]
      );

      // 해당 날짜에 활동한 모든 사용자 조회
      const activeUsersResult = await db.query(
        `SELECT DISTINCT user_id, guild_id FROM activities 
         WHERE timestamp >= $1 AND timestamp < $2`,
        [targetDate, endDate]
      );

      const activeUsers = activeUsersResult.rows;
      logger.info(`Found ${activeUsers.length} active users for ${dateStr}`);

      if (activeUsers.length === 0) {
        logger.info(`No activity data for ${dateStr}, skipping aggregation`);
        return true;
      }

      // 배치 단위로 사용자 처리
      const batchSize = this.config.batchSize;
      const totalBatches = Math.ceil(activeUsers.length / batchSize);

      for (let i = 0; i < totalBatches; i++) {
        const batch = activeUsers.slice(i * batchSize, (i + 1) * batchSize);
        await this.processBatch(batch, targetDate, endDate);
        
        logger.debug(`Processed batch ${i + 1}/${totalBatches} for ${dateStr}`);
      }

      // 길드별 요약 통계 생성
      await this.generateGuildSummary(targetDate);

      logger.info(`Daily stats aggregation completed for ${dateStr}`);
      return true;

    } catch (error) {
      logger.error('Error aggregating daily stats', { 
        error: error, 
        date: dateStr 
      });
      return false;
    } finally {
      this.aggregationInProgress = false;
    }
  }

  /**
   * 사용자 배치 처리
   * @param {Array} batch - 처리할 사용자 배치
   * @param {Date} startDate - 시작 날짜
   * @param {Date} endDate - 종료 날짜
   */
  async processBatch(batch, startDate, endDate) {
    const transaction = await db.beginTransaction();

    try {
      for (const user of batch) {
        const { user_id, guild_id } = user;

        // 활동 타입별 집계
        const aggregatedData = await this.getActivityAggregation(
          user_id, 
          startDate, 
          endDate, 
          transaction
        );

        // 일일 통계 삽입
        await transaction.query(
          `INSERT INTO daily_stats (
            date, user_id, guild_id, 
            voice_score, voice_time, voice_sessions,
            message_score, message_count,
            reaction_given_score, reaction_given_count,
            reaction_received_score, reaction_received_count,
            streaming_score, streaming_time,
            other_score, other_count,
            total_score, total_activities
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            startDate,
            user_id,
            guild_id,
            aggregatedData.voice.score,
            aggregatedData.voice.time,
            aggregatedData.voice.sessions,
            aggregatedData.message.score,
            aggregatedData.message.count,
            aggregatedData.reaction_given.score,
            aggregatedData.reaction_given.count,
            aggregatedData.reaction_received.score,
            aggregatedData.reaction_received.count,
            aggregatedData.streaming.score,
            aggregatedData.streaming.time,
            aggregatedData.other.score,
            aggregatedData.other.count,
            aggregatedData.total.score,
            aggregatedData.total.activities
          ]
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * 활동 집계 함수
   * @param {number} userId - 사용자 ID
   * @param {Date} startDate - 시작 날짜
   * @param {Date} endDate - 종료 날짜
   * @param {Object} dbConnection - DB 연결 객체
   */
  async getActivityAggregation(userId, startDate, endDate, dbConnection = db) {
    try {
      // 음성 활동 집계 (voice_leave 타입에서 duration 정보 추출)
      const voiceData = await dbConnection.query(
        `SELECT 
           COALESCE(SUM(score_awarded), 0) as total_score,
           COALESCE(SUM(CASE WHEN activity_type = 'voice_leave' THEN (details->>'duration')::integer ELSE 0 END), 0) as total_time,
           COUNT(CASE WHEN activity_type = 'voice_join' THEN 1 END) as sessions
         FROM activities 
         WHERE user_id = $1 AND activity_type LIKE 'voice_%' 
         AND timestamp >= $2 AND timestamp < $3`,
        [userId, startDate, endDate]
      );

      // 메시지 활동 집계
      const messageData = await dbConnection.query(
        `SELECT 
           COALESCE(SUM(score_awarded), 0) as total_score,
           COUNT(*) as message_count
         FROM activities 
         WHERE user_id = $1 AND activity_type = 'message_create' 
         AND timestamp >= $2 AND timestamp < $3`,
        [userId, startDate, endDate]
      );

      // 반응 달기 집계
      const reactionGivenData = await dbConnection.query(
        `SELECT 
           COALESCE(SUM(score_awarded), 0) as total_score,
           COUNT(*) as reaction_count
         FROM activities 
         WHERE user_id = $1 AND activity_type = 'reaction_add' 
         AND timestamp >= $2 AND timestamp < $3`,
        [userId, startDate, endDate]
      );

      // 반응 받기 집계 (같은 타입으로 통합, 구분은 details에서)
      const reactionReceivedData = await dbConnection.query(
        `SELECT 
           COALESCE(SUM(score_awarded), 0) as total_score,
           COUNT(*) as reaction_count
         FROM activities 
         WHERE user_id = $1 AND activity_type = 'reaction_add' 
         AND timestamp >= $2 AND timestamp < $3`,
        [userId, startDate, endDate]
      );

      // 스트리밍 활동 집계
      const streamingData = await dbConnection.query(
        `SELECT 
           COALESCE(SUM(score_awarded), 0) as total_score,
           COALESCE(SUM((details->>'duration')::integer), 0) as total_time
         FROM activities 
         WHERE user_id = $1 AND activity_type LIKE 'stream%' 
         AND timestamp >= $2 AND timestamp < $3`,
        [userId, startDate, endDate]
      );

      // 기타 활동 집계
      const otherData = await dbConnection.query(
        `SELECT 
           COALESCE(SUM(score_awarded), 0) as total_score,
           COUNT(*) as activity_count
         FROM activities 
         WHERE user_id = $1 AND activity_type NOT IN ('voice_join', 'voice_leave', 'message_create', 'reaction_add')
         AND activity_type NOT LIKE 'stream%'
         AND timestamp >= $2 AND timestamp < $3`,
        [userId, startDate, endDate]
      );

      // 전체 통계
      const totalData = await dbConnection.query(
        `SELECT 
           COALESCE(SUM(score_awarded), 0) as total_score,
           COUNT(*) as total_activities
         FROM activities 
         WHERE user_id = $1 AND timestamp >= $2 AND timestamp < $3`,
        [userId, startDate, endDate]
      );

      return {
        voice: {
          score: parseFloat(voiceData.rows[0]?.total_score) || 0,
          time: parseInt(voiceData.rows[0]?.total_time) || 0,
          sessions: parseInt(voiceData.rows[0]?.sessions) || 0
        },
        message: {
          score: parseFloat(messageData.rows[0]?.total_score) || 0,
          count: parseInt(messageData.rows[0]?.message_count) || 0
        },
        reaction_given: {
          score: parseFloat(reactionGivenData.rows[0]?.total_score) || 0,
          count: parseInt(reactionGivenData.rows[0]?.reaction_count) || 0
        },
        reaction_received: {
          score: parseFloat(reactionReceivedData.rows[0]?.total_score) || 0,
          count: parseInt(reactionReceivedData.rows[0]?.reaction_count) || 0
        },
        streaming: {
          score: parseFloat(streamingData.rows[0]?.total_score) || 0,
          time: parseInt(streamingData.rows[0]?.total_time) || 0
        },
        other: {
          score: parseFloat(otherData.rows[0]?.total_score) || 0,
          count: parseInt(otherData.rows[0]?.activity_count) || 0
        },
        total: {
          score: parseFloat(totalData.rows[0]?.total_score) || 0,
          activities: parseInt(totalData.rows[0]?.total_activities) || 0
        }
      };
    } catch (error) {
      logger.error('Error in getActivityAggregation', { error, userId, startDate, endDate });
      // 기본값 반환
      return {
        voice: { score: 0, time: 0, sessions: 0 },
        message: { score: 0, count: 0 },
        reaction_given: { score: 0, count: 0 },
        reaction_received: { score: 0, count: 0 },
        streaming: { score: 0, time: 0 },
        other: { score: 0, count: 0 },
        total: { score: 0, activities: 0 }
      };
    }
  }

  /**
   * 길드별 요약 통계 생성
   * @param {Date} date - 날짜
   */
  async generateGuildSummary(date) {
    try {
      // 기존 길드 요약 삭제
      await db.query(
        'DELETE FROM guild_daily_summary WHERE date = $1',
        [date]
      );

      // 길드별 요약 생성
      await db.query(`
        INSERT INTO guild_daily_summary (
          date, guild_id, active_users, total_score, total_activities,
          avg_score_per_user, top_user_id, top_user_score
        )
        SELECT 
          date,
          guild_id,
          COUNT(DISTINCT user_id) as active_users,
          SUM(total_score) as total_score,
          SUM(total_activities) as total_activities,
          AVG(total_score) as avg_score_per_user,
          (SELECT user_id FROM daily_stats ds2 
           WHERE ds2.date = ds.date AND ds2.guild_id = ds.guild_id 
           ORDER BY total_score DESC LIMIT 1) as top_user_id,
          MAX(total_score) as top_user_score
        FROM daily_stats ds
        WHERE date = $1
        GROUP BY date, guild_id
      `, [date]);

      logger.debug(`Generated guild summary for ${date.toISOString().split('T')[0]}`);
    } catch (error) {
      logger.error('Error generating guild summary', { error: error.stack });
    }
  }

  /**
   * 집계된 통계 조회
   * @param {string} userId - 사용자 ID
   * @param {number} days - 조회할 일수
   * @param {string} guildId - 길드 ID (선택)
   */
  async getAggregatedStats(userId, days = 30, guildId = null) {
    try {
      let query = `
        SELECT 
          date, 
          voice_score, voice_time, voice_sessions,
          message_score, message_count,
          reaction_given_score + reaction_received_score as reaction_score,
          reaction_given_count + reaction_received_count as reaction_count,
          streaming_score, streaming_time,
          other_score, other_count,
          total_score, total_activities
        FROM daily_stats 
        WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
      `;

      const params = [userId];

      if (guildId) {
        query += ' AND guild_id = $2';
        params.push(guildId);
      }

      query += ' ORDER BY date';

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error getting aggregated stats', { 
        error: error.stack, 
        userId, 
        days, 
        guildId 
      });
      return [];
    }
  }

  /**
   * 길드 요약 통계 조회
   * @param {string} guildId - 길드 ID
   * @param {number} days - 조회할 일수
   */
  async getGuildSummaryStats(guildId, days = 30) {
    try {
      const result = await db.query(`
        SELECT 
          date, active_users, total_score, total_activities,
          avg_score_per_user, top_user_id, top_user_score
        FROM guild_daily_summary 
        WHERE guild_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY date
      `, [guildId]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting guild summary stats', { 
        error: error.stack, 
        guildId, 
        days 
      });
      return [];
    }
  }

  /**
   * 데이터 정리 수행
   */
  async performDataCleanup() {
    if (this.cleanupInProgress) {
      logger.warn('Cleanup already in progress, skipping');
      return false;
    }

    this.cleanupInProgress = true;
    logger.info('Starting data cleanup process');

    try {
      // 상세 활동 데이터 정리 (30일 이상 된 데이터)
      const detailCutoffDate = new Date();
      detailCutoffDate.setDate(detailCutoffDate.getDate() - this.config.retentionDays);

      const detailResult = await db.query(
        'DELETE FROM activities WHERE timestamp < $1',
        [detailCutoffDate]
      );

      // 집계 데이터 정리 (90일 이상 된 데이터)
      const aggregateCutoffDate = new Date();
      aggregateCutoffDate.setDate(aggregateCutoffDate.getDate() - this.config.aggregationDays);

      const aggregateResult = await db.query(
        'DELETE FROM daily_stats WHERE date < $1',
        [aggregateCutoffDate]
      );

      const summaryResult = await db.query(
        'DELETE FROM guild_daily_summary WHERE date < $1',
        [aggregateCutoffDate]
      );

      // 시스템 정리 수행
      await performCleanup();

      logger.info('Data cleanup completed', {
        deletedActivities: detailResult.rowCount,
        deletedDailyStats: aggregateResult.rowCount,
        deletedSummaries: summaryResult.rowCount,
        detailCutoff: detailCutoffDate.toISOString().split('T')[0],
        aggregateCutoff: aggregateCutoffDate.toISOString().split('T')[0]
      });

      return true;
    } catch (error) {
      logger.error('Error during data cleanup', { error: error.stack });
      return false;
    } finally {
      this.cleanupInProgress = false;
    }
  }

  /**
   * 집계 상태 확인
   * @param {number} days - 확인할 일수
   */
  async getAggregationStatus(days = 7) {
    try {
      const result = await db.query(`
        SELECT 
          DATE(generate_series(CURRENT_DATE - INTERVAL '${days} days', CURRENT_DATE - INTERVAL '1 day', '1 day')) as expected_date,
          ds.date as aggregated_date,
          CASE WHEN ds.date IS NOT NULL THEN true ELSE false END as is_aggregated,
          COALESCE(COUNT(ds.user_id), 0) as user_count
        FROM generate_series(CURRENT_DATE - INTERVAL '${days} days', CURRENT_DATE - INTERVAL '1 day', '1 day') expected_date
        LEFT JOIN daily_stats ds ON DATE(expected_date) = ds.date
        GROUP BY expected_date, ds.date
        ORDER BY expected_date DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error('Error getting aggregation status', { error: error.stack });
      return [];
    }
  }

  /**
   * 수동 집계 트리거
   * @param {Date} startDate - 시작 날짜 (선택)
   * @param {Date} endDate - 종료 날짜 (선택)
   */
  async triggerManualAggregation(startDate = null, endDate = null) {
    const start = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000); // 어제
    const end = endDate || new Date(start);

    logger.info('Starting manual aggregation', {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0]
    });

    const results = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      const success = await this.aggregateDailyStats(new Date(currentDate));
      results.push({
        date: currentDate.toISOString().split('T')[0],
        success
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return results;
  }

  /**
   * 시스템 상태 조회
   */
  getSystemStatus() {
    return {
      isInitialized: this.isInitialized,
      aggregationInProgress: this.aggregationInProgress,
      cleanupInProgress: this.cleanupInProgress,
      config: this.config
    };
  }

  /**
   * 시스템 종료
   */
  async shutdown() {
    logger.info('Shutting down daily statistics aggregation system');
    this.isInitialized = false;
    
    // 진행 중인 작업이 완료될 때까지 대기
    while (this.aggregationInProgress || this.cleanupInProgress) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    logger.info('Daily statistics aggregation system shut down');
  }
}

// 싱글톤 인스턴스
const dailyStatsManager = new DailyStatsManager();

module.exports = {
  DailyStatsManager,
  dailyStatsManager,
  
  // 편의 함수들
  initialize: () => dailyStatsManager.initialize(),
  aggregateDailyStats: (date) => dailyStatsManager.aggregateDailyStats(date),
  getAggregatedStats: (userId, days, guildId) => dailyStatsManager.getAggregatedStats(userId, days, guildId),
  getGuildSummaryStats: (guildId, days) => dailyStatsManager.getGuildSummaryStats(guildId, days),
  performDataCleanup: () => dailyStatsManager.performDataCleanup(),
  getAggregationStatus: (days) => dailyStatsManager.getAggregationStatus(days),
  triggerManualAggregation: (start, end) => dailyStatsManager.triggerManualAggregation(start, end),
  getSystemStatus: () => dailyStatsManager.getSystemStatus(),
  shutdown: () => dailyStatsManager.shutdown()
}; 