#!/usr/bin/env node
/**
 * 성능 벤치마크 및 부하 테스트 스크립트
 * 라즈베리파이 환경에서 GodHand Discord Bot의 성능을 측정하고 최적화 지점을 찾기 위한 도구
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

// 색상 출력을 위한 유틸리티
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

class PerformanceBenchmark {
  constructor() {
    this.results = [];
    this.systemMetrics = [];
    this.startTime = Date.now();
    this.reportDir = path.join(process.cwd(), 'performance-reports');
    this.ensureReportDir();
  }

  /**
   * 보고서 디렉터리 생성
   */
  ensureReportDir() {
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  /**
   * 벤치마크 결과 기록
   */
  recordBenchmark(category, name, metrics, recommendation = '') {
    const result = {
      category,
      name,
      metrics,
      recommendation,
      timestamp: new Date().toISOString()
    };

    this.results.push(result);

    console.log(`${colors.cyan}[${category}] ${name}${colors.reset}`);
    Object.entries(metrics).forEach(([key, value]) => {
      let displayValue = value;
      let status = '';
      
      // 성능 임계값에 따른 상태 표시
      if (key.includes('시간') || key.includes('Time')) {
        if (typeof value === 'number') {
          if (value < 100) status = `${colors.green}매우 좋음${colors.reset}`;
          else if (value < 500) status = `${colors.yellow}양호${colors.reset}`;
          else status = `${colors.red}개선 필요${colors.reset}`;
          displayValue = `${value}ms`;
        }
      } else if (key.includes('메모리') || key.includes('Memory')) {
        if (typeof value === 'number') {
          if (value < 50) status = `${colors.green}매우 좋음${colors.reset}`;
          else if (value < 100) status = `${colors.yellow}양호${colors.reset}`;
          else status = `${colors.red}개선 필요${colors.reset}`;
          displayValue = `${value}MB`;
        }
      }
      
      console.log(`  ${key}: ${displayValue} ${status}`);
    });

    if (recommendation) {
      console.log(`  ${colors.magenta}권장사항: ${recommendation}${colors.reset}`);
    }
    console.log('');
  }

  /**
   * 시스템 메트릭 수집
   */
  async collectSystemMetrics() {
    try {
      const metrics = {
        timestamp: Date.now(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime()
      };

      // 시스템 메모리 정보
      try {
        const { stdout: memInfo } = await execAsync('free -m');
        const lines = memInfo.split('\n');
        const memLine = lines.find(line => line.startsWith('Mem:'));
        if (memLine) {
          const parts = memLine.split(/\s+/);
          metrics.systemMemory = {
            total: parseInt(parts[1]),
            used: parseInt(parts[2]),
            free: parseInt(parts[3]),
            available: parseInt(parts[6] || parts[3])
          };
        }
      } catch (error) {
        // 시스템 메모리 정보를 가져올 수 없는 경우 무시
      }

      // CPU 온도 (라즈베리파이)
      try {
        const { stdout: tempInfo } = await execAsync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "0"');
        const tempCelsius = parseInt(tempInfo.trim()) / 1000;
        if (tempCelsius > 0) {
          metrics.cpuTemperature = tempCelsius;
        }
      } catch (error) {
        // 온도 정보를 가져올 수 없는 경우 무시
      }

      this.systemMetrics.push(metrics);
      return metrics;
    } catch (error) {
      console.warn('시스템 메트릭 수집 실패:', error.message);
      return null;
    }
  }

  /**
   * 1. 데이터베이스 성능 벤치마크
   */
  async benchmarkDatabase() {
    console.log(`${colors.bright}1. 데이터베이스 성능 벤치마크${colors.reset}`);

    try {
      const { db } = require('../src/config/database');

      // 연결 지연시간 테스트
      const connectionTests = [];
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await db.query('SELECT 1');
        connectionTests.push(Date.now() - start);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const avgConnectionTime = connectionTests.reduce((a, b) => a + b, 0) / connectionTests.length;
      const maxConnectionTime = Math.max(...connectionTests);

      this.recordBenchmark('Database', '연결 지연시간', {
        '평균 연결 시간': Math.round(avgConnectionTime),
        '최대 연결 시간': maxConnectionTime,
        '테스트 횟수': connectionTests.length
      }, avgConnectionTime > 50 ? '데이터베이스 연결 풀 설정을 최적화하세요' : '');

      // 단순 쿼리 성능 테스트
      const simpleQueryStart = Date.now();
      await db.query('SELECT COUNT(*) FROM user_activity_stats');
      const simpleQueryTime = Date.now() - simpleQueryStart;

      this.recordBenchmark('Database', '단순 쿼리 성능', {
        '카운트 쿼리 시간': simpleQueryTime
      }, simpleQueryTime > 200 ? '인덱스 최적화를 고려하세요' : '');

      // 복잡한 쿼리 성능 테스트
      const complexQueryStart = Date.now();
      await db.query(`
        SELECT 
          user_id,
          total_voice_time,
          total_message_count,
          last_activity
        FROM user_activity_stats 
        WHERE last_activity >= NOW() - INTERVAL '7 days'
        ORDER BY total_voice_time DESC 
        LIMIT 10
      `);
      const complexQueryTime = Date.now() - complexQueryStart;

      this.recordBenchmark('Database', '복잡한 쿼리 성능', {
        '랭킹 쿼리 시간': complexQueryTime
      }, complexQueryTime > 500 ? '쿼리 최적화 및 인덱싱을 검토하세요' : '');

      // 동시 쿼리 성능 테스트
      const concurrentStart = Date.now();
      const concurrentPromises = [];
      for (let i = 0; i < 5; i++) {
        concurrentPromises.push(db.query('SELECT COUNT(*) FROM user_activity_stats'));
      }
      await Promise.all(concurrentPromises);
      const concurrentTime = Date.now() - concurrentStart;

      this.recordBenchmark('Database', '동시 쿼리 성능', {
        '5개 동시 쿼리 시간': concurrentTime,
        '평균 쿼리당 시간': Math.round(concurrentTime / 5)
      }, concurrentTime > 1000 ? '연결 풀 크기를 늘리거나 쿼리를 최적화하세요' : '');

    } catch (error) {
      this.recordBenchmark('Database', '데이터베이스 벤치마크', {
        '오류': error.message
      }, '데이터베이스 연결을 확인하세요');
    }
  }

  /**
   * 2. 메모리 사용량 분석
   */
  async benchmarkMemoryUsage() {
    console.log(`${colors.bright}2. 메모리 사용량 분석${colors.reset}`);

    const initialMemory = process.memoryUsage();
    const initialSystem = await this.collectSystemMetrics();

    // 기본 메모리 사용량
    this.recordBenchmark('Memory', '기본 메모리 사용량', {
      'RSS 메모리': Math.round(initialMemory.rss / 1024 / 1024),
      'Heap 사용량': Math.round(initialMemory.heapUsed / 1024 / 1024),
      'Heap 총량': Math.round(initialMemory.heapTotal / 1024 / 1024),
      '외부 메모리': Math.round(initialMemory.external / 1024 / 1024)
    }, initialMemory.rss / 1024 / 1024 > 200 ? '메모리 사용량이 높습니다. 불필요한 모듈을 제거하세요' : '');

    // 메모리 스트레스 테스트
    console.log('메모리 스트레스 테스트 수행 중...');
    const largeArrays = [];
    const stressStart = Date.now();

    try {
      // 점진적으로 메모리 사용량 증가
      for (let i = 0; i < 10; i++) {
        largeArrays.push(new Array(100000).fill(`data-${i}`));
        
        if (i % 3 === 0) {
          const currentMemory = process.memoryUsage();
          console.log(`  단계 ${i + 1}: RSS ${Math.round(currentMemory.rss / 1024 / 1024)}MB`);
        }
      }

      const stressMemory = process.memoryUsage();
      const stressTime = Date.now() - stressStart;

      this.recordBenchmark('Memory', '메모리 스트레스 테스트', {
        '스트레스 후 RSS': Math.round(stressMemory.rss / 1024 / 1024),
        '메모리 증가량': Math.round((stressMemory.rss - initialMemory.rss) / 1024 / 1024),
        '스트레스 시간': stressTime
      });

      // 메모리 정리
      largeArrays.length = 0;
      if (global.gc) {
        global.gc();
      }

      // 정리 후 메모리 확인
      setTimeout(async () => {
        const cleanupMemory = process.memoryUsage();
        this.recordBenchmark('Memory', '메모리 정리 후', {
          '정리 후 RSS': Math.round(cleanupMemory.rss / 1024 / 1024),
          '메모리 회수량': Math.round((stressMemory.rss - cleanupMemory.rss) / 1024 / 1024)
        }, (stressMemory.rss - cleanupMemory.rss) / stressMemory.rss < 0.5 ? '가비지 컬렉션이 효과적이지 않습니다' : '');
      }, 1000);

    } catch (error) {
      this.recordBenchmark('Memory', '메모리 스트레스 테스트', {
        '오류': error.message
      }, '메모리 부족으로 인한 오류입니다');
    }
  }

  /**
   * 3. CPU 성능 벤치마크
   */
  async benchmarkCpuPerformance() {
    console.log(`${colors.bright}3. CPU 성능 벤치마크${colors.reset}`);

    // CPU 집약적 작업 성능 테스트
    const cpuStart = process.cpuUsage();
    const wallStart = Date.now();

    // 피보나치 계산 (CPU 집약적)
    function fibonacci(n) {
      if (n < 2) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }

    const fibResult = fibonacci(35); // 라즈베리파이에 적합한 크기
    const cpuEnd = process.cpuUsage(cpuStart);
    const wallEnd = Date.now();

    this.recordBenchmark('CPU', 'CPU 집약적 작업 (피보나치)', {
        '계산 결과': fibResult,
        '벽시계 시간': wallEnd - wallStart,
        'CPU 사용자 시간': Math.round(cpuEnd.user / 1000),
        'CPU 시스템 시간': Math.round(cpuEnd.system / 1000)
    }, (wallEnd - wallStart) > 3000 ? '라즈베리파이 CPU 성능이 제한적입니다' : '');

    // JSON 파싱 성능 테스트
    const jsonTestData = JSON.stringify({
      users: Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `user${i}`,
        stats: {
          voiceTime: Math.random() * 10000,
          messageCount: Math.random() * 1000
        }
      }))
    });

    const jsonStart = Date.now();
    for (let i = 0; i < 100; i++) {
      JSON.parse(jsonTestData);
    }
    const jsonTime = Date.now() - jsonStart;

    this.recordBenchmark('CPU', 'JSON 파싱 성능', {
      '파싱 시간 (100회)': jsonTime,
      '평균 파싱 시간': Math.round(jsonTime / 100 * 100) / 100,
      '데이터 크기': `${Math.round(jsonTestData.length / 1024)}KB`
    }, jsonTime > 1000 ? 'JSON 파싱 최적화를 고려하세요' : '');

    // 정규표현식 성능 테스트
    const regexTestText = 'user123@example.com, admin456@test.org, moderator789@discord.gg'.repeat(100);
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    const regexStart = Date.now();
    for (let i = 0; i < 1000; i++) {
      regexTestText.match(emailRegex);
    }
    const regexTime = Date.now() - regexStart;

    this.recordBenchmark('CPU', '정규표현식 성능', {
      '정규식 매칭 시간 (1000회)': regexTime,
      '평균 매칭 시간': Math.round(regexTime / 1000 * 100) / 100
    }, regexTime > 500 ? '정규표현식 최적화를 고려하세요' : '');
  }

  /**
   * 4. 파일 I/O 성능 테스트
   */
  async benchmarkFileIO() {
    console.log(`${colors.bright}4. 파일 I/O 성능 테스트${colors.reset}`);

    const testDir = path.join(process.cwd(), 'temp-io-test');
    const testFile = path.join(testDir, 'performance-test.txt');

    try {
      // 테스트 디렉터리 생성
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // 작은 파일 쓰기 성능
      const smallData = 'a'.repeat(1024); // 1KB
      const smallWriteStart = Date.now();
      for (let i = 0; i < 100; i++) {
        fs.writeFileSync(`${testFile}-small-${i}`, smallData);
      }
      const smallWriteTime = Date.now() - smallWriteStart;

      this.recordBenchmark('File I/O', '작은 파일 쓰기 (1KB x 100)', {
        '총 쓰기 시간': smallWriteTime,
        '평균 파일당 시간': Math.round(smallWriteTime / 100 * 100) / 100
      }, smallWriteTime > 2000 ? 'SSD 사용을 고려하거나 I/O 최적화하세요' : '');

      // 큰 파일 쓰기 성능
      const largeData = 'b'.repeat(1024 * 1024); // 1MB
      const largeWriteStart = Date.now();
      fs.writeFileSync(`${testFile}-large`, largeData);
      const largeWriteTime = Date.now() - largeWriteStart;

      this.recordBenchmark('File I/O', '큰 파일 쓰기 (1MB)', {
        '쓰기 시간': largeWriteTime,
        '쓰기 속도': `${Math.round(1024 / (largeWriteTime / 1000))}KB/s`
      }, largeWriteTime > 1000 ? '디스크 성능이 제한적입니다' : '');

      // 파일 읽기 성능
      const readStart = Date.now();
      for (let i = 0; i < 50; i++) {
        fs.readFileSync(`${testFile}-small-${i}`);
      }
      const readTime = Date.now() - readStart;

      this.recordBenchmark('File I/O', '파일 읽기 (1KB x 50)', {
        '총 읽기 시간': readTime,
        '평균 파일당 시간': Math.round(readTime / 50 * 100) / 100
      }, readTime > 1000 ? '파일 캐싱을 고려하세요' : '');

      // 정리
      for (let i = 0; i < 100; i++) {
        try {
          fs.unlinkSync(`${testFile}-small-${i}`);
        } catch (error) {
          // 파일이 없는 경우 무시
        }
      }
      try {
        fs.unlinkSync(`${testFile}-large`);
        fs.rmdirSync(testDir);
      } catch (error) {
        // 정리 실패는 무시
      }

    } catch (error) {
      this.recordBenchmark('File I/O', '파일 I/O 테스트', {
        '오류': error.message
      }, '파일 시스템 권한을 확인하세요');
    }
  }

  /**
   * 5. 네트워크 및 외부 API 성능 테스트
   */
  async benchmarkNetworkPerformance() {
    console.log(`${colors.bright}5. 네트워크 성능 테스트${colors.reset}`);

    // 로컬 데이터베이스 연결 성능은 이미 측정했으므로
    // 여기서는 외부 서비스 응답성을 테스트

    try {
      // DNS 해석 성능
      const dnsStart = Date.now();
      require('dns').lookup('discord.com', (err) => {
        const dnsTime = Date.now() - dnsStart;
        this.recordBenchmark('Network', 'DNS 해석 성능', {
          'DNS 해석 시간': dnsTime,
          '상태': err ? '실패' : '성공'
        }, dnsTime > 1000 ? 'DNS 서버를 변경하거나 캐싱을 고려하세요' : '');
      });

      // HTTP 요청 성능 (간단한 테스트)
      const http = require('http');
      const httpStart = Date.now();
      
      // 매우 간단한 HTTP 서버 테스트 (외부 의존성 없이)
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('test');
      });

      server.listen(0, 'localhost', () => {
        const port = server.address().port;
        const req = http.request({
          hostname: 'localhost',
          port: port,
          path: '/',
          method: 'GET'
        }, (res) => {
          const httpTime = Date.now() - httpStart;
          this.recordBenchmark('Network', '로컬 HTTP 요청', {
            'HTTP 요청 시간': httpTime,
            '상태 코드': res.statusCode
          });
          server.close();
        });

        req.on('error', (err) => {
          this.recordBenchmark('Network', '로컬 HTTP 요청', {
            '오류': err.message
          });
          server.close();
        });

        req.end();
      });

    } catch (error) {
      this.recordBenchmark('Network', '네트워크 테스트', {
        '오류': error.message
      });
    }
  }

  /**
   * 6. 종합 부하 테스트
   */
  async benchmarkLoadTest() {
    console.log(`${colors.bright}6. 종합 부하 테스트${colors.reset}`);

    const loadTestStart = Date.now();
    const initialMetrics = await this.collectSystemMetrics();

    try {
      // 동시에 여러 작업 수행하여 부하 생성
      const tasks = [
        // CPU 부하
        new Promise(resolve => {
          const start = Date.now();
          let counter = 0;
          const interval = setInterval(() => {
            for (let i = 0; i < 10000; i++) {
              counter += Math.random();
            }
            if (Date.now() - start > 5000) { // 5초간
              clearInterval(interval);
              resolve(counter);
            }
          }, 10);
        }),

        // 메모리 부하
        new Promise(resolve => {
          const arrays = [];
          const start = Date.now();
          const interval = setInterval(() => {
            arrays.push(new Array(10000).fill(Math.random()));
            if (Date.now() - start > 5000) { // 5초간
              clearInterval(interval);
              resolve(arrays.length);
            }
          }, 100);
        }),

        // I/O 부하 (데이터베이스가 있는 경우)
        (async () => {
          try {
            const { db } = require('../src/config/database');
            let queryCount = 0;
            const start = Date.now();
            
            while (Date.now() - start < 5000) {
              await db.query('SELECT 1');
              queryCount++;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            return queryCount;
          } catch (error) {
            return 0;
          }
        })()
      ];

      // 중간 메트릭 수집 (2.5초 후)
      setTimeout(async () => {
        const midMetrics = await this.collectSystemMetrics();
        if (midMetrics && initialMetrics) {
          const memoryIncrease = midMetrics.memory.rss - initialMetrics.memory.rss;
          console.log(`  중간 체크: 메모리 증가 ${Math.round(memoryIncrease / 1024 / 1024)}MB`);
        }
      }, 2500);

      const results = await Promise.all(tasks);
      const loadTestTime = Date.now() - loadTestStart;
      const finalMetrics = await this.collectSystemMetrics();

      const memoryIncrease = finalMetrics ? 
        (finalMetrics.memory.rss - initialMetrics.memory.rss) : 0;

      this.recordBenchmark('Load Test', '종합 부하 테스트 (5초)', {
        '총 테스트 시간': loadTestTime,
        'CPU 작업 결과': Math.round(results[0] || 0),
        '메모리 배열 생성': results[1] || 0,
        '데이터베이스 쿼리': results[2] || 0,
        '메모리 증가량': Math.round(memoryIncrease / 1024 / 1024),
        'CPU 온도': finalMetrics?.cpuTemperature ? `${finalMetrics.cpuTemperature.toFixed(1)}°C` : '측정 불가'
      }, memoryIncrease / 1024 / 1024 > 100 ? '부하 상황에서 메모리 누수가 의심됩니다' : '');

    } catch (error) {
      this.recordBenchmark('Load Test', '종합 부하 테스트', {
        '오류': error.message
      });
    }
  }

  /**
   * 최종 보고서 생성
   */
  generateReport() {
    const totalTime = Date.now() - this.startTime;
    
    console.log(`\n${colors.bright}성능 벤치마크 요약${colors.reset}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`총 테스트 시간: ${Math.round(totalTime / 1000)}초`);
    console.log(`테스트 항목 수: ${this.results.length}`);
    console.log(`시스템 메트릭 수집: ${this.systemMetrics.length}회`);

    // 성능 등급 계산
    let performanceScore = 100;
    const issues = [];

    this.results.forEach(result => {
      if (result.recommendation) {
        if (result.name.includes('메모리') && result.recommendation.includes('높습니다')) {
          performanceScore -= 15;
          issues.push('높은 메모리 사용량');
        }
        if (result.name.includes('쿼리') && result.recommendation.includes('최적화')) {
          performanceScore -= 10;
          issues.push('데이터베이스 쿼리 성능');
        }
        if (result.name.includes('CPU') && result.recommendation.includes('제한적')) {
          performanceScore -= 5;
          issues.push('CPU 성능 제한');
        }
      }
    });

    let gradeColor = colors.green;
    let grade = 'A';
    if (performanceScore < 90) { grade = 'B'; gradeColor = colors.yellow; }
    if (performanceScore < 75) { grade = 'C'; gradeColor = colors.yellow; }
    if (performanceScore < 60) { grade = 'D'; gradeColor = colors.red; }

    console.log(`성능 점수: ${gradeColor}${performanceScore}/100 (등급: ${grade})${colors.reset}`);

    if (issues.length > 0) {
      console.log(`\n${colors.yellow}개선이 필요한 영역:${colors.reset}`);
      issues.forEach(issue => {
        console.log(`${colors.yellow}• ${issue}${colors.reset}`);
      });
    }

    // 라즈베리파이 특화 권장사항
    console.log(`\n${colors.cyan}라즈베리파이 최적화 권장사항:${colors.reset}`);
    console.log('• 메모리 사용량을 200MB 이하로 유지하세요');
    console.log('• CPU 집약적 작업은 비동기로 처리하세요'); 
    console.log('• 데이터베이스 연결 풀 크기를 3-5개로 제한하세요');
    console.log('• PM2로 메모리 제한(--max-memory-restart 500M)을 설정하세요');
    console.log('• 로그 파일은 정기적으로 로테이션하세요');

    // JSON 보고서 저장
    const reportData = {
      summary: {
        totalTime,
        testCount: this.results.length,
        performanceScore,
        grade,
        issues,
        timestamp: new Date().toISOString()
      },
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      results: this.results,
      systemMetrics: this.systemMetrics.slice(-5) // 마지막 5개 메트릭만 저장
    };

    const reportFile = path.join(this.reportDir, 
      `performance-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
    
    console.log(`\n상세 보고서 저장: ${reportFile}`);
    return performanceScore >= 75;
  }

  /**
   * 모든 성능 벤치마크 실행
   */
  async runAllBenchmarks() {
    console.log(`${colors.bright}GodHand Discord Bot 성능 벤치마크 시작${colors.reset}`);
    console.log(`벤치마크 시작 시간: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(60)}`);

    try {
      await this.collectSystemMetrics(); // 초기 메트릭 수집
      
      await this.benchmarkDatabase();
      await this.benchmarkMemoryUsage();
      await this.benchmarkCpuPerformance();
      await this.benchmarkFileIO();
      await this.benchmarkNetworkPerformance();
      await this.benchmarkLoadTest();
      
      await this.collectSystemMetrics(); // 최종 메트릭 수집
    } catch (error) {
      console.error(`${colors.red}벤치마크 실행 중 오류: ${error.message}${colors.reset}`);
    }

    return this.generateReport();
  }
}

// 스크립트 실행
if (require.main === module) {
  const benchmark = new PerformanceBenchmark();
  
  benchmark.runAllBenchmarks()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('성능 벤치마크 실행 실패:', error);
      process.exit(1);
    });
}

module.exports = PerformanceBenchmark; 