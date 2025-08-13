/**
 * 포괄적인 에러 핸들링 시스템
 * Discord Bot의 안정성을 위한 에러 처리 및 복구 메커니즘
 */
const logger = require('./logger');

/**
 * 에러 타입 분류
 */
const ERROR_TYPES = {
  DISCORD_API: 'discord_api',
  DATABASE: 'database',
  COMMAND: 'command',
  VOICE: 'voice',
  MUSIC: 'music',
  SYSTEM: 'system',
  UNKNOWN: 'unknown'
};

/**
 * 에러 심각도 레벨
 */
const ERROR_SEVERITY = {
  LOW: 'low',        // 로그만 기록
  MEDIUM: 'medium',  // 로그 + 알림
  HIGH: 'high',      // 로그 + 알림 + 복구 시도
  CRITICAL: 'critical' // 로그 + 알림 + 복구 시도 + 관리자 알림
};

/**
 * 메인 에러 핸들러 클래스
 */
class ErrorHandler {
  constructor(client = null) {
    this.client = client;
    this.errorStats = {
      total: 0,
      byType: {},
      bySeverity: {},
      lastReset: new Date()
    };
    this.recoveryAttempts = new Map(); // 에러별 복구 시도 횟수 추적
    this.maxRecoveryAttempts = 3;
    this.isShuttingDown = false;
  }

  /**
   * 글로벌 에러 핸들러 초기화
   */
  initializeGlobalHandlers() {
    // Uncaught Exception 처리
    process.on('uncaughtException', (error) => {
      this.handleError(error, {
        type: ERROR_TYPES.SYSTEM,
        severity: ERROR_SEVERITY.CRITICAL,
        context: 'uncaughtException'
      });

      // 심각한 에러의 경우 graceful shutdown
      if (!this.isShuttingDown) {
        this.gracefulShutdown('Uncaught Exception');
      }
    });

    // Unhandled Promise Rejection 처리
    process.on('unhandledRejection', (reason, promise) => {
      this.handleError(reason, {
        type: ERROR_TYPES.SYSTEM,
        severity: ERROR_SEVERITY.HIGH,
        context: 'unhandledRejection',
        promise: promise
      });
    });

    // Warning 처리
    process.on('warning', (warning) => {
      logger.warn('Process Warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });

    // SIGTERM 처리
    process.on('SIGTERM', () => {
      this.gracefulShutdown('SIGTERM received');
    });

    // SIGINT 처리 (Ctrl+C)
    process.on('SIGINT', () => {
      this.gracefulShutdown('SIGINT received');
    });

    logger.info('✅ 글로벌 에러 핸들러 초기화 완료');
  }

  /**
   * Discord 클라이언트 에러 핸들러 설정
   */
  initializeDiscordHandlers(client) {
    this.client = client;

    // Discord 클라이언트 에러
    client.on('error', (error) => {
      this.handleError(error, {
        type: ERROR_TYPES.DISCORD_API,
        severity: ERROR_SEVERITY.HIGH,
        context: 'client_error'
      });
    });

    // Discord 샤드 에러
    client.on('shardError', (error, shardId) => {
      this.handleError(error, {
        type: ERROR_TYPES.DISCORD_API,
        severity: ERROR_SEVERITY.HIGH,
        context: 'shard_error',
        shardId
      });
    });

    // Discord 경고
    client.on('warn', (message) => {
      logger.warn('Discord Client Warning', { message });
    });

    // Discord 재연결
    client.on('shardReconnecting', (shardId) => {
      logger.info(`Shard ${shardId} reconnecting...`);
    });

    // Discord 연결 복구
    client.on('shardResume', (shardId, replayedEvents) => {
      logger.info(`Shard ${shardId} resumed`, { replayedEvents });
    });

    // Discord 연결 해제
    client.on('shardDisconnect', (closeEvent, shardId) => {
      logger.warn(`Shard ${shardId} disconnected`, { 
        code: closeEvent.code, 
        reason: closeEvent.reason 
      });
    });

    logger.info('✅ Discord 에러 핸들러 설정 완료');
  }

  /**
   * 메인 에러 처리 함수
   */
  handleError(error, options = {}) {
    const {
      type = ERROR_TYPES.UNKNOWN,
      severity = ERROR_SEVERITY.MEDIUM,
      context = 'unknown',
      userId = null,
      guildId = null,
      commandName = null,
      ...additionalContext
    } = options;

    // 에러 통계 업데이트
    this.updateErrorStats(type, severity);

    // 에러 정보 구성
    const errorInfo = {
      message: error.message || error,
      stack: error.stack,
      type,
      severity,
      context,
      timestamp: new Date().toISOString(),
      userId,
      guildId,
      commandName,
      ...additionalContext
    };

    // 로깅
    this.logError(errorInfo);

    // 심각도에 따른 추가 처리
    switch (severity) {
      case ERROR_SEVERITY.LOW:
        // 로그만 기록
        break;

      case ERROR_SEVERITY.MEDIUM:
        // 알림 시도
        this.notifyError(errorInfo);
        break;

      case ERROR_SEVERITY.HIGH:
        // 복구 시도
        this.attemptRecovery(errorInfo);
        this.notifyError(errorInfo);
        break;

      case ERROR_SEVERITY.CRITICAL:
        // 즉시 알림 + 복구 시도
        this.attemptRecovery(errorInfo);
        this.notifyError(errorInfo, true);
        this.notifyAdministrators(errorInfo);
        break;
    }

    return errorInfo;
  }

  /**
   * 에러 로깅
   */
  logError(errorInfo) {
    const logLevel = this.getSeverityLogLevel(errorInfo.severity);
    
    logger.log(logLevel, `[${errorInfo.type.toUpperCase()}] ${errorInfo.message}`, {
      context: errorInfo.context,
      stack: errorInfo.stack,
      userId: errorInfo.userId,
      guildId: errorInfo.guildId,
      commandName: errorInfo.commandName,
      timestamp: errorInfo.timestamp,
      type: 'error_handled'
    });
  }

  /**
   * 심각도에 따른 로그 레벨 결정
   */
  getSeverityLogLevel(severity) {
    switch (severity) {
      case ERROR_SEVERITY.LOW:
        return 'warn';
      case ERROR_SEVERITY.MEDIUM:
        return 'error';
      case ERROR_SEVERITY.HIGH:
      case ERROR_SEVERITY.CRITICAL:
        return 'error';
      default:
        return 'error';
    }
  }

  /**
   * 에러 통계 업데이트
   */
  updateErrorStats(type, severity) {
    this.errorStats.total++;
    this.errorStats.byType[type] = (this.errorStats.byType[type] || 0) + 1;
    this.errorStats.bySeverity[severity] = (this.errorStats.bySeverity[severity] || 0) + 1;
  }

  /**
   * 복구 시도
   */
  async attemptRecovery(errorInfo) {
    const errorKey = `${errorInfo.type}_${errorInfo.context}`;
    const attempts = this.recoveryAttempts.get(errorKey) || 0;

    if (attempts >= this.maxRecoveryAttempts) {
      logger.warn(`Maximum recovery attempts reached for ${errorKey}`);
      return false;
    }

    this.recoveryAttempts.set(errorKey, attempts + 1);

    try {
      logger.info(`Attempting recovery for ${errorKey} (attempt ${attempts + 1})`);

      switch (errorInfo.type) {
        case ERROR_TYPES.DISCORD_API:
          return await this.recoverDiscordConnection();

        case ERROR_TYPES.DATABASE:
          return await this.recoverDatabaseConnection();

        case ERROR_TYPES.VOICE:
          return await this.recoverVoiceConnection(errorInfo);

        case ERROR_TYPES.MUSIC:
          return await this.recoverMusicSystem(errorInfo);

        default:
          logger.warn(`No recovery method for error type: ${errorInfo.type}`);
          return false;
      }
    } catch (recoveryError) {
      logger.error('Recovery attempt failed', {
        originalError: errorInfo.message,
        recoveryError: recoveryError.message
      });
      return false;
    }
  }

  /**
   * Discord 연결 복구
   */
  async recoverDiscordConnection() {
    if (!this.client || this.client.destroyed) {
      logger.error('Cannot recover: Client is destroyed');
      return false;
    }

    try {
      logger.info('Attempting Discord connection recovery...');
      
      // 재연결 시도
      if (this.client.readyTimestamp === null) {
        await this.client.login(process.env.DISCORD_TOKEN);
        logger.info('✅ Discord connection recovered');
        return true;
      }

      return true;
    } catch (error) {
      logger.error('Discord connection recovery failed', { error: error.message });
      return false;
    }
  }

  /**
   * 데이터베이스 연결 복구
   */
  async recoverDatabaseConnection() {
    try {
      logger.info('Attempting database connection recovery...');
      
      const db = require('../services/database');
      await db.checkConnection();
      
      logger.info('✅ Database connection recovered');
      return true;
    } catch (error) {
      logger.error('Database connection recovery failed', { error: error.message });
      return false;
    }
  }

  /**
   * 음성 연결 복구
   */
  async recoverVoiceConnection(errorInfo) {
    try {
      logger.info('Attempting voice connection recovery...');
      
      if (!this.client || !errorInfo.guildId) {
        return false;
      }

      const guild = this.client.guilds.cache.get(errorInfo.guildId);
      if (!guild) return false;

      // 음성 연결 정리 및 재설정
      const voiceConnection = guild.voice?.connection;
      if (voiceConnection) {
        voiceConnection.destroy();
      }

      logger.info('✅ Voice connection cleaned up');
      return true;
    } catch (error) {
      logger.error('Voice connection recovery failed', { error: error.message });
      return false;
    }
  }

  /**
   * 음악 시스템 복구
   */
  async recoverMusicSystem(errorInfo) {
    try {
      logger.info('Attempting music system recovery...');
      
      // 음악 큐 정리
      if (this.client && this.client.musicQueues) {
        const guildQueue = this.client.musicQueues.get(errorInfo.guildId);
        if (guildQueue) {
          guildQueue.clear();
        }
      }

      logger.info('✅ Music system recovered');
      return true;
    } catch (error) {
      logger.error('Music system recovery failed', { error: error.message });
      return false;
    }
  }

  /**
   * 에러 알림
   */
  async notifyError(errorInfo, immediate = false) {
    if (!this.client || !this.client.isReady()) {
      return;
    }

    try {
      // 심각한 에러의 경우 관리자에게 DM 발송
      if (immediate && errorInfo.severity === ERROR_SEVERITY.CRITICAL) {
        await this.sendAdminNotification(errorInfo);
      }

      // 길드 시스템 채널에 알림 (에러 타입에 따라)
      if (errorInfo.guildId) {
        await this.sendGuildNotification(errorInfo);
      }

    } catch (notificationError) {
      logger.error('Failed to send error notification', {
        error: notificationError.message
      });
    }
  }

  /**
   * 관리자 알림
   */
  async notifyAdministrators(errorInfo) {
    // 환경 변수에서 관리자 ID 목록 가져오기
    const adminIds = process.env.ADMIN_USER_IDS?.split(',') || [];
    
    for (const adminId of adminIds) {
      try {
        const admin = await this.client.users.fetch(adminId.trim());
        if (admin) {
          await admin.send({
            content: `🚨 **Critical Error Detected**\n\`\`\`\nType: ${errorInfo.type}\nMessage: ${errorInfo.message}\nTime: ${errorInfo.timestamp}\n\`\`\``
          });
        }
      } catch (error) {
        logger.error(`Failed to notify admin ${adminId}`, { error: error.message });
      }
    }
  }

  /**
   * 길드 알림
   */
  async sendGuildNotification(errorInfo) {
    if (errorInfo.severity === ERROR_SEVERITY.LOW) {
      return; // 낮은 심각도는 길드 알림 없음
    }

    try {
      const guild = this.client.guilds.cache.get(errorInfo.guildId);
      if (!guild || !guild.systemChannel) {
        return;
      }

      const embed = {
        color: this.getSeverityColor(errorInfo.severity),
        title: '⚠️ System Error',
        description: `An error occurred in the ${errorInfo.type} system.`,
        fields: [
          {
            name: 'Context',
            value: errorInfo.context,
            inline: true
          },
          {
            name: 'Severity',
            value: errorInfo.severity.toUpperCase(),
            inline: true
          }
        ],
        timestamp: new Date().toISOString()
      };

      await guild.systemChannel.send({ embeds: [embed] });

    } catch (error) {
      logger.error('Failed to send guild notification', { error: error.message });
    }
  }

  /**
   * 심각도별 색상
   */
  getSeverityColor(severity) {
    switch (severity) {
      case ERROR_SEVERITY.LOW:
        return 0xFFFF00; // 노란색
      case ERROR_SEVERITY.MEDIUM:
        return 0xFF8800; // 주황색
      case ERROR_SEVERITY.HIGH:
        return 0xFF4400; // 빨간색
      case ERROR_SEVERITY.CRITICAL:
        return 0x8B0000; // 진한 빨간색
      default:
        return 0x808080; // 회색
    }
  }

  /**
   * 우아한 종료
   */
  async gracefulShutdown(reason) {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info(`🛑 Graceful shutdown initiated: ${reason}`);

    try {
      // 에러 통계 로깅
      this.logErrorStats();

      // Discord 클라이언트 종료
      if (this.client && !this.client.destroyed) {
        await this.client.destroy();
        logger.info('Discord client destroyed');
      }

      // 데이터베이스 연결 종료
      try {
        const db = require('../services/database');
        await db.close();
        logger.info('Database connections closed');
      } catch (error) {
        logger.error('Error closing database', { error: error.message });
      }

      // 시즌 매니저 종료
      try {
        const seasonManager = require('../services/season');
        await seasonManager.seasonManager.shutdown();
        logger.info('Season manager shut down');
      } catch (error) {
        logger.error('Error shutting down season manager', { error: error.message });
      }

      logger.info('✅ Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logger.error('Error during graceful shutdown', { error: error.message });
      process.exit(1);
    }
  }

  /**
   * 에러 통계 로깅
   */
  logErrorStats() {
    const uptime = Date.now() - this.errorStats.lastReset.getTime();
    const uptimeHours = (uptime / (1000 * 60 * 60)).toFixed(2);

    logger.info('📊 Error Statistics', {
      totalErrors: this.errorStats.total,
      errorsByType: this.errorStats.byType,
      errorsBySeverity: this.errorStats.bySeverity,
      uptimeHours: `${uptimeHours} hours`,
      errorRate: `${(this.errorStats.total / parseFloat(uptimeHours)).toFixed(2)} errors/hour`
    });
  }

  /**
   * 에러 통계 초기화
   */
  resetErrorStats() {
    this.errorStats = {
      total: 0,
      byType: {},
      bySeverity: {},
      lastReset: new Date()
    };
    this.recoveryAttempts.clear();
    logger.info('Error statistics reset');
  }

  /**
   * 현재 에러 통계 반환
   */
  getErrorStats() {
    return { ...this.errorStats };
  }
}

/**
 * 편의 함수들
 */
const createErrorHandler = (client) => {
  return new ErrorHandler(client);
};

/**
 * 명령어 에러 래퍼
 */
const wrapCommand = (commandHandler) => {
  return async (interaction) => {
    try {
      await commandHandler(interaction);
    } catch (error) {
      const errorHandler = interaction.client.errorHandler;
      if (errorHandler) {
        errorHandler.handleError(error, {
          type: ERROR_TYPES.COMMAND,
          severity: ERROR_SEVERITY.MEDIUM,
          context: 'command_execution',
          userId: interaction.user.id,
          guildId: interaction.guildId,
          commandName: interaction.commandName
        });
      }

      // 사용자에게 친화적인 에러 메시지
      const errorMessage = {
        content: '❌ 명령어 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  };
};

/**
 * 이벤트 에러 래퍼
 */
const wrapEvent = (eventHandler) => {
  return async (...args) => {
    try {
      await eventHandler(...args);
    } catch (error) {
      // 첫 번째 인수가 클라이언트인 경우가 많음
      const client = args.find(arg => arg && arg.user && arg.guilds);
      const errorHandler = client?.errorHandler;
      
      if (errorHandler) {
        errorHandler.handleError(error, {
          type: ERROR_TYPES.SYSTEM,
          severity: ERROR_SEVERITY.MEDIUM,
          context: 'event_handling'
        });
      } else {
        logger.error('Event handler error (no error handler available)', {
          error: error.message,
          stack: error.stack
        });
      }
    }
  };
};

module.exports = {
  ErrorHandler,
  ERROR_TYPES,
  ERROR_SEVERITY,
  createErrorHandler,
  wrapCommand,
  wrapEvent
}; 