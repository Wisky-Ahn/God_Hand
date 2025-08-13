/**
 * Jest 글로벌 정리 - 전체 테스트 종료 후 실행
 * 테스트 후 정리 작업, 결과 요약 등
 */

const path = require('path');
const fs = require('fs').promises;

module.exports = async () => {
  console.log('🧹 테스트 환경 글로벌 정리 시작...');

  try {
    // 테스트 실행 시간 계산
    const testDuration = Date.now() - (global.__TEST_START_TIME__ || Date.now());
    const durationMs = testDuration;
    const durationSec = Math.round(testDuration / 1000);

    // 테스트 완료 정보 기록
    const resultsDir = path.join(__dirname, '..', 'results');
    const infoPath = path.join(resultsDir, 'test-session-info.json');
    
    try {
      const infoData = await fs.readFile(infoPath, 'utf8');
      const testInfo = JSON.parse(infoData);
      
      testInfo.endTime = new Date().toISOString();
      testInfo.duration = {
        ms: durationMs,
        seconds: durationSec,
        formatted: formatDuration(durationMs)
      };
      
      await fs.writeFile(infoPath, JSON.stringify(testInfo, null, 2));
      
    } catch (error) {
      console.warn('⚠️ 테스트 세션 정보 업데이트 실패:', error.message);
    }

    // 메모리 사용량 정보
    const memUsage = process.memoryUsage();
    const memInfo = {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
    };

    // 정리 완료 로그
    console.log('📊 테스트 실행 완료:');
    console.log(`   ⏱️  실행 시간: ${formatDuration(durationMs)}`);
    console.log(`   💾 메모리 사용: ${memInfo.heapUsed} / ${memInfo.heapTotal}`);
    console.log('✅ 테스트 환경 글로벌 정리 완료');

  } catch (error) {
    console.error('❌ 테스트 환경 정리 실패:', error);
    // 정리 실패해도 프로세스는 계속 진행
  }
};

/**
 * 시간을 읽기 쉬운 형식으로 변환
 * @param {number} ms - 밀리초
 * @returns {string} 포맷된 시간 문자열
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}초`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return `${minutes}분 ${remainingSeconds}초`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return `${hours}시간 ${remainingMinutes}분 ${remainingSeconds}초`;
}
