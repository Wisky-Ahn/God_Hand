/**
 * 데이터베이스 연결 설정
 * PostgreSQL 연결 풀 및 환경별 설정 관리
 */
require('dotenv').config();

const config = {
  // 기본 연결 설정
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'godhand_bot',
  user: process.env.DB_USER || 'godhand_user',
  password: process.env.DB_PASSWORD,

  // 연결 풀 설정
  max: parseInt(process.env.DB_MAX_CONNECTIONS) || 20, // 최대 연결 수
  min: parseInt(process.env.DB_MIN_CONNECTIONS) || 2,  // 최소 연결 수
  acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 30000, // 30초
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000, // 30초
  createTimeoutMillis: parseInt(process.env.DB_CREATE_TIMEOUT) || 30000, // 30초

  // 라즈베리파이 최적화
  ...(process.env.OPTIMIZATION_MODE === 'raspberry_pi' && {
    max: 5,  // 라즈베리파이에서는 연결 수 제한
    min: 1,
    acquireTimeoutMillis: 60000, // 더 긴 타임아웃
    idleTimeoutMillis: 60000,
    statement_timeout: 30000, // 30초 쿼리 타임아웃
    query_timeout: 30000
  }),

  // SSL 설정 (프로덕션 환경)
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,

  // 추가 PostgreSQL 설정
  application_name: 'godhand-discord-bot',
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,

  // 로깅 설정
  log: process.env.NODE_ENV === 'development' ? 
    (msg) => console.log('[DB]', msg) : 
    undefined
};

// 환경별 설정 오버라이드
const environmentConfigs = {
  development: {
    // 개발 환경에서는 더 자세한 로깅
    log: (msg) => console.log('[DB DEV]', msg)
  },
  
  production: {
    // 프로덕션에서는 로깅 최소화
    log: undefined,
    // 연결 풀 최적화
    max: parseInt(process.env.DB_MAX_CONNECTIONS) || 15
  },
  
  test: {
    // 테스트 환경
    database: process.env.DB_NAME_TEST || 'godhand_bot_test',
    max: 5,
    min: 1
  }
};

// 현재 환경에 맞는 설정 병합
const environment = process.env.NODE_ENV || 'development';
const finalConfig = {
  ...config,
  ...environmentConfigs[environment]
};

module.exports = finalConfig; 