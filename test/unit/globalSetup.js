/**
 * Jest 글로벌 설정 - 전체 테스트 시작 전 실행
 * 테스트 데이터베이스 설정, 필요한 서비스 초기화 등
 */

const path = require('path');
const fs = require('fs').promises;

module.exports = async () => {
  console.log('🚀 테스트 환경 글로벌 설정 시작...');

  try {
    // 테스트 결과 디렉터리 생성
    const resultsDir = path.join(__dirname, '..', 'results');
    try {
      await fs.access(resultsDir);
    } catch {
      await fs.mkdir(resultsDir, { recursive: true });
      console.log('📁 테스트 결과 디렉터리 생성 완료');
    }

    // 커버리지 디렉터리 생성
    const coverageDir = path.join(resultsDir, 'coverage');
    try {
      await fs.access(coverageDir);
    } catch {
      await fs.mkdir(coverageDir, { recursive: true });
      console.log('📊 커버리지 디렉터리 생성 완료');
    }

    // Jest 캐시 디렉터리 생성
    const cacheDir = path.join(resultsDir, '.jest-cache');
    try {
      await fs.access(cacheDir);
    } catch {
      await fs.mkdir(cacheDir, { recursive: true });
      console.log('💾 Jest 캐시 디렉터리 생성 완료');
    }

    // 테스트 시작 시간 기록
    global.__TEST_START_TIME__ = Date.now();
    
    // 테스트 실행 정보 기록
    const testInfo = {
      startTime: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    };

    const infoPath = path.join(resultsDir, 'test-session-info.json');
    await fs.writeFile(infoPath, JSON.stringify(testInfo, null, 2));

    console.log('✅ 테스트 환경 글로벌 설정 완료');

  } catch (error) {
    console.error('❌ 테스트 환경 설정 실패:', error);
    throw error;
  }
};
