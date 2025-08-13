/**
 * Jest 설정 파일
 * GodHand Discord Bot 테스트 환경 설정
 */

module.exports = {
  // 테스트 환경
  testEnvironment: 'node',
  
  // 테스트 파일 경로 패턴
  testMatch: [
    '<rootDir>/test/unit/**/*.test.js',
    '<rootDir>/test/unit/**/*.spec.js',
    '<rootDir>/src/**/*.test.js',
    '<rootDir>/src/**/*.spec.js'
  ],
  
  // 테스트에서 제외할 패턴
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/audio/',
    '/test/music/',
    '/test/integration/',
    '/test/performance/',
    '/test/results/'
  ],
  
  // 코드 커버리지 수집 대상
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/bot/index.js',
    '!src/bot/deploy-commands.js',
    '!src/config/**',
    '!**/node_modules/**'
  ],
  
  // 커버리지 리포트 출력 디렉터리
  coverageDirectory: 'test/results/coverage',
  
  // 커버리지 리포터
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json'
  ],
  
  // 커버리지 임계값
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  
  // 테스트 실행 전 설정 파일
  setupFilesAfterEnv: ['<rootDir>/test/unit/setup.js'],
  
  // 모듈 경로 매핑
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1'
  },
  
  // 테스트 타임아웃 (30초)
  testTimeout: 30000,
  
  // 병렬 실행 제한 (라즈베리파이 최적화)
  maxWorkers: 2,
  
  // 캐시 디렉터리
  cacheDirectory: '<rootDir>/test/results/.jest-cache',
  
  // 테스트 결과 출력 형식
  verbose: true,
  
  // 에러 출력 시 전체 스택 트레이스 표시
  errorOnDeprecated: true,
  
  // 전역 변수 설정
  globals: {
    'process.env.NODE_ENV': 'test',
    'process.env.LOG_LEVEL': 'silent'
  },
  
  // 테스트 실행 전/후 스크립트
  globalSetup: '<rootDir>/test/unit/globalSetup.js',
  globalTeardown: '<rootDir>/test/unit/globalTeardown.js'
};
