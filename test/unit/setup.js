/**
 * Jest 테스트 환경 설정
 * 모든 단위 테스트 실행 전에 로드됩니다.
 */

// 환경 변수 설정
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

// 테스트용 환경 변수
process.env.DISCORD_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/godhand_test';

// 콘솔 출력 억제 (필요시)
if (process.env.SUPPRESS_CONSOLE === 'true') {
  global.console = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}

// 공통 테스트 유틸리티
global.testUtils = {
  // 테스트용 Discord 사용자 ID
  TEST_USER_ID: '123456789012345678',
  TEST_GUILD_ID: '987654321098765432',
  
  // 테스트용 시간 헬퍼
  getTestDate: (daysAgo = 0) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date;
  },
  
  // 임의 점수 생성
  randomScore: (min = 0, max = 1000) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  
  // 테스트 대기 헬퍼
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Jest 설정
jest.setTimeout(30000); // 30초 타임아웃

// 전역 모킹
jest.mock('discord.js', () => ({
  Client: jest.fn(),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    GuildVoiceStates: 4,
    MessageContent: 8
  },
  SlashCommandBuilder: jest.fn(),
  EmbedBuilder: jest.fn()
}));

// 데이터베이스 모킹 (기본)
jest.mock('@/services/database', () => ({
  query: jest.fn(),
  close: jest.fn()
}));

// 로거 모킹
jest.mock('@/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

console.log('🧪 Jest 테스트 환경 설정 완료');
