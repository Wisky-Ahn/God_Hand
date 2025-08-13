/**
 * 시즌 관리 시스템
 * 2주 단위 시즌 운영, 순위 계산, 자동 전환 관리
 */
const cron = require('node-cron');
const db = require('../database');
const logger = require('../../utils/logger');
const dbUtils = require('../database/utils');

/**
 * 시즌 관리자 클래스
 */
class SeasonManager {
  constructor() {
    this.client = null;
    this.cronJob = null;
    this.isInitialized = false;
    this.currentSeason = null;
  }

  /**
   * 시즌 시스템 초기화
   */
  async initialize(client) {
    try {
      this.client = client;
      
      logger.info('🗓️ 시즌 관리 시스템 초기화 중...');
      
      // 현재 시즌 확인 및 로드
      await this.loadCurrentSeason();
      
      // 활성 시즌이 없으면 새 시즌 생성
      if (!this.currentSeason) {
        this.currentSeason = await this.createNewSeason();
        logger.info(`🆕 새로운 시즌 생성: ${this.currentSeason.name}`);
      } else {
        logger.info(`📅 현재 시즌: ${this.currentSeason.name} (종료: ${new Date(this.currentSeason.end_date).toLocaleDateString('ko-KR')})`);
      }
      
      // 시즌 전환 스케줄러 시작
      this.startSeasonScheduler();
      
      // 시즌 상태 모니터링 시작
      this.startSeasonMonitoring();
      
      this.isInitialized = true;
      logger.info('✅ 시즌 관리 시스템 초기화 완료');
      
    } catch (error) {
      logger.error('시즌 시스템 초기화 중 에러:', error);
      throw error;
    }
  }

  /**
   * 현재 활성 시즌 로드
   */
  async loadCurrentSeason() {
    try {
      const result = await db.query(
        'SELECT * FROM seasons WHERE status = $1 ORDER BY created_at DESC LIMIT 1',
        ['active']
      );
      
      this.currentSeason = result.rows.length > 0 ? result.rows[0] : null;
      return this.currentSeason;
      
    } catch (error) {
      logger.error('현재 시즌 로드 중 에러:', error);
      throw error;
    }
  }

  /**
   * 새 시즌 생성
   */
  async createNewSeason(guildId = null) {
    try {
      const now = new Date();
      
      // 2주 후 일요일 자정으로 종료일 설정
      const endDate = this.calculateSeasonEndDate(now);
      
      // 시즌 이름 생성 (시즌 번호 형식)
      const seasonName = await this.generateSeasonName(guildId);
      
      // 현재 활성 시즌이 있다면 완료 처리
      if (this.currentSeason) {
        await this.completeCurrentSeason();
      }
      
      // 새 시즌 생성
      const result = await db.query(
        `INSERT INTO seasons (guild_id, name, season_number, start_date, end_date, status, settings) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [
          guildId || 1, // 기본 길드 ID
          seasonName,
          await this.getNextSeasonNumber(guildId),
          now,
          endDate,
          'active',
          JSON.stringify({
            scoreReset: true,
            rankingEnabled: true,
            musicPermissionEnabled: true
          })
        ]
      );
      
      const newSeason = result.rows[0];
      
      // 사용자 점수 초기화 (새 시즌 시작)
      await this.resetUserScores(guildId);
      
      // 시즌 시작 이벤트 로깅
      logger.info(`🆕 새 시즌 생성: ${seasonName} (${now.toLocaleDateString('ko-KR')} ~ ${endDate.toLocaleDateString('ko-KR')})`);
      
      return newSeason;
      
    } catch (error) {
      logger.error('새 시즌 생성 중 에러:', error);
      throw error;
    }
  }

  /**
   * 현재 시즌 완료 처리
   */
  async completeCurrentSeason() {
    try {
      if (!this.currentSeason) {
        logger.warn('완료할 현재 시즌이 없습니다');
        return null;
      }
      
      logger.info(`📊 시즌 완료 처리 시작: ${this.currentSeason.name}`);
      
      // 시즌 상태를 완료로 변경
      await db.query(
        'UPDATE seasons SET status = $1, total_participants = $2, total_activities = $3 WHERE id = $4',
        [
          'completed',
          await this.getSeasonParticipantCount(this.currentSeason.id),
          await this.getSeasonActivityCount(this.currentSeason.id),
          this.currentSeason.id
        ]
      );
      
      // 최종 순위 계산 및 저장
      await this.calculateAndStoreFinalRankings(this.currentSeason.id);
      
      // 평생 통계 업데이트
      await this.updateLifetimeStats(this.currentSeason.id);
      
      // Hall of Fame 업데이트 (1위 사용자)
      await this.updateHallOfFame(this.currentSeason.id);
      
      // 시즌 완료 알림
      if (this.client) {
        await this.announceSeasonCompletion(this.currentSeason);
      }
      
      logger.info(`✅ 시즌 완료: ${this.currentSeason.name}`);
      
      return this.currentSeason;
      
    } catch (error) {
      logger.error('시즌 완료 처리 중 에러:', error);
      throw error;
    }
  }

  /**
   * 최종 순위 계산 및 저장
   */
  async calculateAndStoreFinalRankings(seasonId) {
    try {
      // 해당 시즌 기간 동안의 실제 활동 점수로 순위 계산
      const rankings = await db.query(`
        SELECT 
          u.id as user_id,
          u.discord_id,
          u.username,
          COALESCE(season_scores.final_score, 0) as final_score,
          COALESCE(season_scores.voice_score, 0) as voice_score,
          COALESCE(season_scores.message_score, 0) as message_score,
          COALESCE(season_scores.reaction_score, 0) as reaction_score,
          COALESCE(season_scores.other_score, 0) as other_score,
          COALESCE(season_scores.total_voice_time, 0) as total_voice_time,
          COALESCE(season_scores.total_messages, 0) as total_messages,
          ROW_NUMBER() OVER (ORDER BY COALESCE(season_scores.final_score, 0) DESC, COALESCE(season_scores.total_voice_time, 0) DESC) as final_rank
        FROM users u 
        LEFT JOIN (
          SELECT 
            a.user_id,
            SUM(a.score_awarded) as final_score,
            SUM(CASE WHEN a.activity_type = 'voice' THEN a.score_awarded ELSE 0 END) as voice_score,
            SUM(CASE WHEN a.activity_type = 'message' THEN a.score_awarded ELSE 0 END) as message_score,
            SUM(CASE WHEN a.activity_type LIKE '%reaction%' THEN a.score_awarded ELSE 0 END) as reaction_score,
            SUM(CASE WHEN a.activity_type NOT IN ('voice', 'message') AND a.activity_type NOT LIKE '%reaction%' THEN a.score_awarded ELSE 0 END) as other_score,
            SUM(CASE WHEN a.activity_type = 'voice' THEN a.duration ELSE 0 END) as total_voice_time,
            COUNT(CASE WHEN a.activity_type = 'message' THEN 1 END) as total_messages
          FROM activities a 
          JOIN seasons s ON s.id = $1
          WHERE a.timestamp >= s.start_date AND a.timestamp <= s.end_date
          GROUP BY a.user_id
        ) season_scores ON u.id = season_scores.user_id
        WHERE u.is_active = TRUE AND COALESCE(season_scores.final_score, 0) > 0
        ORDER BY COALESCE(season_scores.final_score, 0) DESC, COALESCE(season_scores.total_voice_time, 0) DESC
      `, [seasonId]);
      
      // 순위 데이터 저장
      for (const ranking of rankings.rows) {
        await db.query(`
          INSERT INTO season_rankings (
            season_id, user_id, final_score, final_rank,
            voice_score, message_score, reaction_score, other_score,
            total_voice_time, total_messages,
            is_winner, is_top_3, is_top_10
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
          seasonId,
          ranking.user_id,
          ranking.final_score,
          ranking.final_rank,
          ranking.voice_score,
          ranking.message_score,
          ranking.reaction_score,
          ranking.other_score,
          ranking.total_voice_time,
          ranking.total_messages,
          ranking.final_rank === 1,
          ranking.final_rank <= 3,
          ranking.final_rank <= 10
        ]);
      }
      
      logger.info(`📊 최종 순위 저장 완료: ${rankings.rows.length}명`);
      
    } catch (error) {
      logger.error('최종 순위 계산 중 에러:', error);
      throw error;
    }
  }

  /**
   * 평생 통계 업데이트 (모든 활동의 누적 점수 기반)
   */
  async updateLifetimeStats(seasonId) {
    try {
      const seasonRankings = await db.query(
        'SELECT * FROM season_rankings WHERE season_id = $1',
        [seasonId]
      );
      
      for (const ranking of seasonRankings.rows) {
        // 해당 사용자의 모든 활동 총 점수 계산
        const userTotalScoreResult = await db.query(`
          SELECT 
            COALESCE(SUM(a.score_awarded), 0) as total_lifetime_score,
            COUNT(CASE WHEN a.activity_type LIKE '%message%' THEN 1 END) as total_lifetime_messages
          FROM activities a 
          WHERE a.user_id = $1
        `, [ranking.user_id]);
        
        const userTotalScore = userTotalScoreResult.rows[0];
        
        await db.query(`
          INSERT INTO lifetime_stats (
            user_id, total_score, total_voice_time, total_messages, 
            total_seasons_participated, first_place_wins, top_3_finishes, top_10_finishes,
            best_rank, worst_rank, current_season_streak, longest_season_streak
          ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $8, 1, 1)
          ON CONFLICT (user_id) DO UPDATE SET
            total_score = $2,
            total_voice_time = lifetime_stats.total_voice_time + $3,
            total_messages = $4,
            total_seasons_participated = lifetime_stats.total_seasons_participated + 1,
            first_place_wins = lifetime_stats.first_place_wins + $5,
            top_3_finishes = lifetime_stats.top_3_finishes + $6,
            top_10_finishes = lifetime_stats.top_10_finishes + $7,
            best_rank = CASE WHEN $8 < lifetime_stats.best_rank OR lifetime_stats.best_rank = 0 THEN $8 ELSE lifetime_stats.best_rank END,
            worst_rank = CASE WHEN $8 > lifetime_stats.worst_rank THEN $8 ELSE lifetime_stats.worst_rank END,
            current_season_streak = lifetime_stats.current_season_streak + 1,
            longest_season_streak = CASE WHEN lifetime_stats.current_season_streak + 1 > lifetime_stats.longest_season_streak THEN lifetime_stats.current_season_streak + 1 ELSE lifetime_stats.longest_season_streak END,
            average_rank = (lifetime_stats.average_rank * (lifetime_stats.total_seasons_participated - 1) + $8) / lifetime_stats.total_seasons_participated
        `, [
          ranking.user_id,
          userTotalScore.total_lifetime_score,  // 모든 활동의 총 점수
          ranking.total_voice_time,             // 시즌별 음성 시간은 누적
          userTotalScore.total_lifetime_messages, // 모든 활동의 총 메시지 수
          ranking.is_winner ? 1 : 0,
          ranking.is_top_3 ? 1 : 0,
          ranking.is_top_10 ? 1 : 0,
          ranking.final_rank
        ]);
      }
      
      logger.info(`📈 평생 통계 업데이트 완료: ${seasonRankings.rows.length}명`);
      
    } catch (error) {
      logger.error('평생 통계 업데이트 중 에러:', error);
      throw error;
    }
  }

  /**
   * 사용자 점수 초기화
   */
  async resetUserScores(guildId = null) {
    try {
      const query = guildId 
        ? 'UPDATE users SET current_score = 0, voice_score = 0, message_score = 0, reaction_score = 0, other_score = 0, total_voice_time = 0, total_messages = 0, total_reactions_given = 0, total_reactions_received = 0 WHERE guild_id = $1'
        : 'UPDATE users SET current_score = 0, voice_score = 0, message_score = 0, reaction_score = 0, other_score = 0, total_voice_time = 0, total_messages = 0, total_reactions_given = 0, total_reactions_received = 0';
      
      const params = guildId ? [guildId] : [];
      
      const result = await db.query(query, params);
      
      // 순위 재계산
      if (guildId) {
        await dbUtils.recalculateRankings(guildId);
      }
      
      logger.info(`🔄 사용자 점수 초기화 완료: ${result.rowCount}명`);
      
    } catch (error) {
      logger.error('사용자 점수 초기화 중 에러:', error);
      throw error;
    }
  }

  /**
   * 시즌 종료일 계산 (정확히 2주 후)
   */
  calculateSeasonEndDate(startDate) {
    const endDate = new Date(startDate);
    
    // 정확히 2주(14일) 추가
    endDate.setDate(endDate.getDate() + 14);
    
    // 자정으로 설정
    endDate.setHours(0, 0, 0, 0);
    
    return endDate;
  }

  /**
   * 시즌 이름 생성 (단순한 시즌 번호 사용)
   */
  async generateSeasonName(guildId = null) {
    const seasonNumber = await this.getNextSeasonNumber(guildId);
    return `Season ${seasonNumber}`;
  }

  /**
   * 다음 시즌 번호 가져오기
   */
  async getNextSeasonNumber(guildId = null) {
    try {
      const query = guildId 
        ? 'SELECT COALESCE(MAX(season_number), 0) + 1 as next_number FROM seasons WHERE guild_id = $1'
        : 'SELECT COALESCE(MAX(season_number), 0) + 1 as next_number FROM seasons';
      
      const params = guildId ? [guildId] : [];
      const result = await db.query(query, params);
      
      return result.rows[0].next_number;
      
    } catch (error) {
      logger.error('다음 시즌 번호 조회 중 에러:', error);
      return 1;
    }
  }

  /**
   * 시즌 스케줄러 시작
   */
  startSeasonScheduler() {
    try {
      // 매일 자정에 시즌 만료 체크
      this.cronJob = cron.schedule('0 0 * * *', async () => {
        await this.checkSeasonExpiration();
      }, {
        scheduled: true,
        timezone: "Asia/Seoul"
      });
      
      logger.info('⏰ 시즌 스케줄러 시작됨 (매일 자정 체크)');
      
    } catch (error) {
      logger.error('시즌 스케줄러 시작 중 에러:', error);
    }
  }

  /**
   * 시즌 만료 체크
   */
  async checkSeasonExpiration() {
    try {
      if (!this.currentSeason) return;
      
      const now = new Date();
      const endDate = new Date(this.currentSeason.end_date);
      
      if (now >= endDate) {
        logger.info('⏰ 시즌 만료 감지, 새 시즌으로 전환 시작');
        
        // 현재 시즌 완료
        await this.completeCurrentSeason();
        
        // 새 시즌 생성
        this.currentSeason = await this.createNewSeason();
        
        // 새 시즌 알림
        if (this.client) {
          await this.announceNewSeason(this.currentSeason);
        }
      }
      
    } catch (error) {
      logger.error('시즌 만료 체크 중 에러:', error);
    }
  }

  /**
   * 시즌 모니터링 시작
   */
  startSeasonMonitoring() {
    // 1시간마다 시즌 상태 체크
    setInterval(async () => {
      try {
        if (this.currentSeason) {
          const now = new Date();
          const endDate = new Date(this.currentSeason.end_date);
          const timeLeft = endDate - now;
          const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
          
          // 24시간 남았을 때 알림
          if (hoursLeft === 24) {
            await this.announceSeasonEndingSoon(this.currentSeason, '24시간');
          }
          // 1시간 남았을 때 알림
          else if (hoursLeft === 1) {
            await this.announceSeasonEndingSoon(this.currentSeason, '1시간');
          }
        }
      } catch (error) {
        logger.error('시즌 모니터링 중 에러:', error);
      }
    }, 60 * 60 * 1000); // 1시간
  }

  // 유틸리티 메서드들...
  async getSeasonParticipantCount(seasonId) {
    try {
      const result = await db.query(
        'SELECT COUNT(DISTINCT user_id) as count FROM activities WHERE timestamp >= (SELECT start_date FROM seasons WHERE id = $1)',
        [seasonId]
      );
      return result.rows[0].count;
    } catch (error) {
      return 0;
    }
  }

  async getSeasonActivityCount(seasonId) {
    try {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM activities WHERE timestamp >= (SELECT start_date FROM seasons WHERE id = $1)',
        [seasonId]
      );
      return result.rows[0].count;
    } catch (error) {
      return 0;
    }
  }

  async updateHallOfFame(seasonId) {
    // Hall of Fame 업데이트 로직 (향후 구현)
    logger.debug(`Hall of Fame 업데이트: Season ${seasonId}`);
  }

  async announceSeasonCompletion(season) {
    // 시즌 완료 알림 (향후 구현)
    logger.info(`시즌 완료 알림: ${season.name}`);
  }

  async announceNewSeason(season) {
    // 새 시즌 알림 (향후 구현)
    logger.info(`새 시즌 알림: ${season.name}`);
  }

  async announceSeasonEndingSoon(season, timeLeft) {
    // 시즌 종료 임박 알림 (향후 구현)
    logger.info(`시즌 종료 임박 알림: ${season.name} (${timeLeft} 남음)`);
  }

  // 공개 API 메서드들
  getCurrentSeason() {
    return this.currentSeason;
  }

  async getSeasonRankings(seasonId = null, limit = 10) {
    const targetSeasonId = seasonId || this.currentSeason?.id;
    if (!targetSeasonId) return [];

    try {
      const result = await db.query(`
        SELECT sr.*, u.username, u.display_name 
        FROM season_rankings sr
        JOIN users u ON sr.user_id = u.id
        WHERE sr.season_id = $1
        ORDER BY sr.final_rank
        LIMIT $2
      `, [targetSeasonId, limit]);

      return result.rows;
    } catch (error) {
      logger.error('시즌 순위 조회 중 에러:', error);
      return [];
    }
  }

  async getSeasonHistory(limit = 5) {
    try {
      const result = await db.query(`
        SELECT * FROM seasons 
        WHERE status = 'completed'
        ORDER BY end_date DESC
        LIMIT $1
      `, [limit]);

      return result.rows;
    } catch (error) {
      logger.error('시즌 히스토리 조회 중 에러:', error);
      return [];
    }
  }

  async forceSeasonTransition() {
    logger.warn('⚠️ 강제 시즌 전환 실행');
    await this.checkSeasonExpiration();
  }

  // 종료 처리
  async shutdown() {
    if (this.cronJob) {
      this.cronJob.destroy();
      logger.info('시즌 스케줄러 종료됨');
    }
  }
}

// 싱글톤 인스턴스
const seasonManager = new SeasonManager();

module.exports = {
  // 메인 관리자
  seasonManager,
  
  // 편의 함수들
  getCurrentSeason: () => seasonManager.getCurrentSeason(),
  createNewSeason: (guildId) => seasonManager.createNewSeason(guildId),
  completeCurrentSeason: () => seasonManager.completeCurrentSeason(),
  getSeasonRankings: (seasonId, limit) => seasonManager.getSeasonRankings(seasonId, limit),
  getSeasonHistory: (limit) => seasonManager.getSeasonHistory(limit),
  initialize: (client) => seasonManager.initialize(client),
  
  // 관리자 함수들
  forceSeasonTransition: () => seasonManager.forceSeasonTransition(),
  resetUserScores: (guildId) => seasonManager.resetUserScores(guildId)
}; 