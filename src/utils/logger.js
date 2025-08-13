/**
 * 로깅 시스템 설정
 * Winston을 사용한 중앙화된 로깅 관리
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// logs 디렉토리가 없으면 생성
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * 로그 레벨 설정
 * development: debug 이상
 * production: info 이상
 */
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

/**
 * 커스텀 로그 포맷
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const logMessage = stack || message;
    return `${timestamp} [${level.toUpperCase()}]: ${logMessage}`;
  })
);

/**
 * Winston 로거 인스턴스 생성
 */
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: 'godhand-bot' },
  transports: [
    // 콘솔 출력 (개발환경에서만 컬러 적용)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: process.env.NODE_ENV !== 'production' }),
        logFormat
      )
    }),
    
    // 에러 로그 파일
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // 모든 로그 파일
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

/**
 * 라즈베리파이 환경에서는 로그 레벨을 조정
 */
if (process.env.OPTIMIZATION_MODE === 'raspberry_pi') {
  logger.level = 'warn';
  logger.info('Raspberry Pi mode detected - Log level set to warn');
}

/**
 * 비동기 로깅을 위한 헬퍼 함수들
 */
const logHelpers = {
  /**
   * 사용자 활동 로깅
   */
  userActivity: (userId, activity, details = {}) => {
    logger.info(`User Activity: ${userId} - ${activity}`, { 
      userId, 
      activity, 
      details,
      type: 'user_activity'
    });
  },

  /**
   * 음악 관련 로깅
   */
  musicAction: (userId, action, track = null) => {
    logger.info(`Music Action: ${userId} - ${action}`, {
      userId,
      action,
      track,
      type: 'music_action'
    });
  },

  /**
   * 시스템 성능 로깅
   */
  performance: (operation, duration, details = {}) => {
    logger.debug(`Performance: ${operation} took ${duration}ms`, {
      operation,
      duration,
      details,
      type: 'performance'
    });
  },

  /**
   * 데이터베이스 쿼리 로깅
   */
  database: (query, duration, rowCount = null) => {
    logger.debug(`Database Query: ${query.substring(0, 100)}... (${duration}ms)`, {
      query: query.substring(0, 200),
      duration,
      rowCount,
      type: 'database'
    });
  },

  /**
   * 에러 상황에 대한 상세 로깅
   */
  error: (message, error = null, context = {}) => {
    // error 객체가 첫 번째 인수인 경우 처리
    if (typeof message === 'object' && message instanceof Error) {
      error = message;
      message = 'Error occurred';
    }
    
    const logMessage = error ? `${message}: ${error.message}` : message;
    const logMeta = { 
      context, 
      type: 'error' 
    };
    
    if (error && error.stack) {
      logMeta.stack = error.stack;
    }
    
    // Winston logger의 error 메서드를 직접 호출하여 무한재귀 방지
    logger.log('error', logMessage, logMeta);
  }
};

// 로거와 헬퍼 함수들을 합친 객체 export
module.exports = Object.assign(logger, logHelpers); 