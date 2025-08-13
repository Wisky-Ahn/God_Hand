/**
 * Ready 이벤트 핸들러
 * 봇이 준비되었을 때 실행되는 로직
 */

const logger = require('../utils/logger');
const { initialize: initializeSeasonSystem } = require('../services/season');
const { createErrorHandler } = require('../utils/errorHandler');
const { LogRotationManager } = require('../utils/logRotation');
// AFK 감지 시스템 제거됨
const { initialize: initializeDailyStats } = require('../services/statistics/daily');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    try {
      logger.info(`✅ ${client.user.tag} 봇이 준비되었습니다!`);
      logger.info(`🌐 ${client.guilds.cache.size}개의 서버에 연결됨`);
      logger.info(`👥 ${client.users.cache.size}명의 사용자와 연결됨`);

      // 봇 활동 상태 설정 (순환)
      const activities = [
        { name: '음성채널 모니터링 중...', type: 'LISTENING' },
        { name: '서버 순위 계산 중...', type: 'PLAYING' },
        { name: '사용자 활동 추적 중...', type: 'WATCHING' }
      ];

      let activityIndex = 0;
      setInterval(() => {
        const activity = activities[activityIndex];
        client.user.setActivity(activity.name, { type: activity.type });
        activityIndex = (activityIndex + 1) % activities.length;
      }, 30000); // 30초마다 변경

      // 초기 활동 설정
      client.user.setActivity(activities[0].name, { type: activities[0].type });

      // 데이터베이스 연결 및 초기화
      await initializeDatabase(client);

      // 서비스 초기화
      await initializeServices(client);

      // 기존 음성 세션 복구
      await recoverVoiceSessions(client);

      // 시즌 시스템 초기화
      await initializeSeasonSystem(client);
      
      // 에러 핸들링 시스템 초기화
      await initializeErrorHandling(client);
      
      // 로그 로테이션 시스템 초기화
      await initializeLogRotation();

      // 일일 통계 집계 시스템 초기화
      await initializeDailyStatsSystem();

      // 음성 활동 추적 시스템 초기화
      await initializeVoiceTracking(client);

      // AFK 감지 시스템 제거됨

          // 음악 플레이어 시스템 초기화
    await initializeMusicSystem(client);

    // 모니터링 시스템 초기화
    await initializeMonitoringSystem(client);

    // 라즈베리파이 최적화 시스템 초기화
    await initializeOptimizationSystem();

    // 닉네임 동기화 스케줄러 초기화
    await initializeNicknameSyncScheduler(client);

    logger.info('🚀 모든 시스템이 성공적으로 초기화되었습니다!');

    } catch (error) {
      logger.error('Ready 이벤트 처리 중 오류:', error);
    }
  }
};

/**
 * 데이터베이스 연결 및 초기화
 */
async function initializeDatabase(client) {
  try {
    const db = require('../services/database');
    await db.checkConnection();
    logger.info('✅ 데이터베이스 연결 성공');
  } catch (error) {
    logger.error('❌ 데이터베이스 초기화 실패:', error);
    throw error;
  }
}

/**
 * 각종 서비스 초기화
 */
async function initializeServices(client) {
  try {
    // 향후 추가 서비스 초기화 로직
    logger.info('✅ 서비스 초기화 완료');
  } catch (error) {
    logger.error('❌ 서비스 초기화 실패:', error);
    throw error;
  }
}

/**
 * 기존 음성 세션 복구
 */
async function recoverVoiceSessions(client) {
  try {
    // 음성 채널에 있는 사용자들의 세션 복구
    client.guilds.cache.forEach(guild => {
      guild.channels.cache
        .filter(channel => channel.type === 'GUILD_VOICE' && channel.members.size > 0)
        .forEach(channel => {
          channel.members.forEach(member => {
            if (!member.user.bot) {
              // 음성 세션 복구 로직 (필요시 구현)
              logger.debug(`음성 세션 복구: ${member.user.tag} in ${channel.name}`);
            }
          });
        });
    });
    
    logger.info('✅ 음성 세션 복구 완료');
  } catch (error) {
    logger.error('❌ 음성 세션 복구 실패:', error);
  }
}

/**
 * 에러 핸들링 시스템 초기화
 */
async function initializeErrorHandling(client) {
  try {
    const errorHandler = createErrorHandler(client);
    client.errorHandler = errorHandler;
    
    // 전역 에러 핸들러 설정
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      errorHandler.handleError(error, 'UncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      errorHandler.handleError(reason, 'UnhandledRejection');
    });

    logger.info('✅ 에러 핸들링 시스템 초기화 완료');
  } catch (error) {
    logger.error('❌ 에러 핸들링 시스템 초기화 실패:', error);
  }
}

/**
 * 로그 로테이션 시스템 초기화
 */
async function initializeLogRotation() {
  try {
    const logRotation = new LogRotationManager({
      logDirectory: './logs',
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      maxAge: 7, // 7일
      schedule: '0 2 * * *' // 매일 새벽 2시
    });

    await logRotation.initialize();
    logger.info('✅ 로그 로테이션 시스템 초기화 완료');
  } catch (error) {
    logger.error('❌ 로그 로테이션 시스템 초기화 실패:', error);
  }
}

/**
 * 일일 통계 집계 시스템 초기화
 */
async function initializeDailyStatsSystem() {
  try {
    await initializeDailyStats();
    logger.info('✅ 일일 통계 집계 시스템 초기화 완료');
  } catch (error) {
    logger.error('❌ 일일 통계 집계 시스템 초기화 실패:', error);
    // 일일 통계 시스템은 중요하지만 봇 전체 실행을 막지는 않음
  }
}

/**
 * 음성 활동 추적 시스템 초기화
 */
async function initializeVoiceTracking(client) {
  try {
    // 음성 활동 추적 관련 초기화
    const voiceTracking = require('../services/activity/voice');
    
    // 기존 음성 세션 복구
    client.guilds.cache.forEach(guild => {
      guild.channels.cache
        .filter(channel => channel.type === 2 && channel.members.size > 0) // GUILD_VOICE = 2
        .forEach(channel => {
          channel.members.forEach(member => {
            if (!member.user.bot) {
              // 음성 세션 시작 (복구)
              if (!client.voiceSessions) {
                client.voiceSessions = new Map();
              }
              
              const sessionId = `${guild.id}-${member.id}`;
              if (!client.voiceSessions.has(sessionId)) {
                client.voiceSessions.set(sessionId, {
                  userId: member.id,
                  guildId: guild.id,
                  channelId: channel.id,
                  joinTime: new Date()
                });
              }
            }
          });
        });
    });
    
    logger.info('✅ 음성 활동 추적 시스템 초기화 완료');
  } catch (error) {
    logger.error('❌ 음성 활동 추적 시스템 초기화 실패:', error);
  }
}

// AFK 감지 시스템 제거됨

/**
 * 음악 플레이어 시스템 초기화
 */
async function initializeMusicSystem(client) {
  try {
    // 음악 큐 초기화
    if (!client.musicQueues) {
      client.musicQueues = new Map();
    }
    
    // 음악 관련 유틸리티 초기화
    logger.info('✅ 음악 플레이어 시스템 초기화 완료');
  } catch (error) {
    logger.error('❌ 음악 플레이어 시스템 초기화 실패:', error);
  }
}

/**
 * 모니터링 시스템 초기화
 */
async function initializeMonitoringSystem(client) {
  try {
    const MonitoringService = require('../services/monitoring');
    
    // 모니터링 서비스 인스턴스 생성
    const monitoringService = new MonitoringService({
      autoStart: true,
      systemMonitor: {
        interval: 30,
        thresholds: {
          memory: 85,
          cpu: 80,
          disk: 90
        }
      }
    });
    
    // Discord 클라이언트 설정
    monitoringService.setDiscordClient(client);
    
    // 클라이언트에 모니터링 서비스 할당
    client.monitoringService = monitoringService;
    
    // 초기화
    monitoringService.initialize();
    
    logger.info('✅ 모니터링 시스템 초기화 완료');
  } catch (error) {
    logger.error('❌ 모니터링 시스템 초기화 실패:', error);
  }
}

/**
 * 라즈베리파이 최적화 시스템 초기화
 */
async function initializeOptimizationSystem() {
  try {
    const { initialize } = require('../config/optimization');
    await initialize();
    logger.info('✅ 라즈베리파이 최적화 시스템 초기화 완료');
  } catch (error) {
    logger.error('❌ 라즈베리파이 최적화 시스템 초기화 실패:', error);
  }
}

/**
 * 닉네임 동기화 스케줄러 초기화
 */
async function initializeNicknameSyncScheduler(client) {
  try {
    const NicknameSyncScheduler = require('../services/nickname/scheduler');
    
    // 스케줄러 인스턴스 생성
    const nicknameSyncScheduler = new NicknameSyncScheduler(client);
    
    // 클라이언트에 스케줄러 할당
    client.nicknameSyncScheduler = nicknameSyncScheduler;
    
    // 스케줄러 시작
    nicknameSyncScheduler.start();
    
    logger.info('✅ 닉네임 동기화 스케줄러 초기화 완료');
  } catch (error) {
    logger.error('❌ 닉네임 동기화 스케줄러 초기화 실패:', error);
    // 닉네임 스케줄러 실패는 봇 전체 실행을 막지 않음
  }
} 