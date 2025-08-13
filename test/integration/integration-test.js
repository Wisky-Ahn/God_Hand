#!/usr/bin/env node
/**
 * 라즈베리파이 환경을 위한 통합 테스트 스크립트
 * GodHand Discord Bot의 모든 구성 요소들이 정상적으로 작동하는지 검증
 */

const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const util = require('util');

// exec을 Promise로 변환
const execAsync = util.promisify(exec);

// 테스트 결과 저장을 위한 설정
const RESULTS_DIR = path.join(process.cwd(), 'test-results');
const LOG_FILE = path.join(RESULTS_DIR, `integration-test-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

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

class IntegrationTestSuite {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
    this.ensureResultsDir();
  }

  /**
   * 테스트 결과 디렉터리 생성
   */
  ensureResultsDir() {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
  }

  /**
   * 로그 메시지 출력 및 파일 저장
   */
  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    
    console.log(logMessage);
    
    try {
      fs.appendFileSync(LOG_FILE, logMessage + '\n');
    } catch (error) {
      console.error('로그 파일 쓰기 실패:', error.message);
    }
  }

  /**
   * 테스트 결과 기록
   */
  recordTest(testName, passed, details = '', duration = 0) {
    const result = {
      name: testName,
      passed,
      details,
      duration,
      timestamp: new Date().toISOString()
    };
    
    this.testResults.push(result);
    
    const status = passed ? `${colors.green}PASS${colors.reset}` : `${colors.red}FAIL${colors.reset}`;
    const timeStr = duration > 0 ? ` (${duration}ms)` : '';
    
    this.log(`${status} ${testName}${timeStr}`, passed ? 'PASS' : 'FAIL');
    
    if (!passed && details) {
      this.log(`  Details: ${details}`, 'ERROR');
    }
  }

  /**
   * 1. 시스템 환경 검사
   */
  async testSystemEnvironment() {
    this.log(`${colors.cyan}1. 시스템 환경 검사 시작${colors.reset}`);
    
    const tests = [
      {
        name: 'Node.js 버전 확인',
        test: async () => {
          const version = process.version;
          const majorVersion = parseInt(version.slice(1).split('.')[0]);
          return majorVersion >= 18;
        }
      },
      {
        name: '사용 가능한 메모리 확인',
        test: async () => {
          const { stdout } = await execAsync('free -m');
          const lines = stdout.split('\n');
          const memLine = lines.find(line => line.startsWith('Mem:'));
          if (memLine) {
            const availableMemory = parseInt(memLine.split(/\s+/)[6] || memLine.split(/\s+/)[3]);
            return availableMemory >= 100; // 최소 100MB 필요
          }
          return false;
        }
      },
      {
        name: '디스크 공간 확인',
        test: async () => {
          const { stdout } = await execAsync('df -h .');
          const lines = stdout.split('\n');
          const diskLine = lines[1];
          if (diskLine) {
            const available = diskLine.split(/\s+/)[3];
            const numericValue = parseFloat(available.replace(/[^\d.]/g, ''));
            const unit = available.slice(-1);
            
            if (unit === 'G') return numericValue >= 1; // 최소 1GB
            if (unit === 'M') return numericValue >= 1000; // 최소 1000MB
            return false;
          }
          return false;
        }
      },
      {
        name: 'PM2 설치 확인',
        test: async () => {
          try {
            await execAsync('pm2 --version');
            return true;
          } catch {
            return false;
          }
        }
      },
      {
        name: 'PostgreSQL 연결 테스트',
        test: async () => {
          try {
            const { db } = require('../src/config/database');
            const result = await db.query('SELECT 1 as test');
            return result.rows.length > 0;
          } catch {
            return false;
          }
        }
      }
    ];

    for (const test of tests) {
      const startTime = Date.now();
      try {
        const passed = await test.test();
        const duration = Date.now() - startTime;
        this.recordTest(test.name, passed, '', duration);
      } catch (error) {
        const duration = Date.now() - startTime;
        this.recordTest(test.name, false, error.message, duration);
      }
    }
  }

  /**
   * 2. 데이터베이스 스키마 검증
   */
  async testDatabaseSchema() {
    this.log(`${colors.cyan}2. 데이터베이스 스키마 검증 시작${colors.reset}`);
    
    const requiredTables = [
      'user_activity_stats',
      'server_stats',
      'daily_stats',
      'admin_actions',
      'activity_logs'
    ];

    try {
      const { db } = require('../src/config/database');
      
      for (const tableName of requiredTables) {
        const startTime = Date.now();
        try {
          const result = await db.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_name = $1
            )
          `, [tableName]);
          
          const exists = result.rows[0].exists;
          const duration = Date.now() - startTime;
          
          this.recordTest(`테이블 존재 확인: ${tableName}`, exists, '', duration);
        } catch (error) {
          const duration = Date.now() - startTime;
          this.recordTest(`테이블 존재 확인: ${tableName}`, false, error.message, duration);
        }
      }
      
      // 인덱스 확인
      const startTime = Date.now();
      const indexResult = await db.query(`
        SELECT indexname FROM pg_indexes 
        WHERE tablename IN (${requiredTables.map((_, i) => `$${i+1}`).join(',')})
      `, requiredTables);
      
      const duration = Date.now() - startTime;
      this.recordTest('인덱스 존재 확인', indexResult.rows.length > 0, 
        `찾은 인덱스 수: ${indexResult.rows.length}`, duration);
      
    } catch (error) {
      this.recordTest('데이터베이스 연결', false, error.message);
    }
  }

  /**
   * 3. Discord Bot 구성 요소 테스트
   */
  async testDiscordBotComponents() {
    this.log(`${colors.cyan}3. Discord Bot 구성 요소 테스트 시작${colors.reset}`);
    
    const tests = [
      {
        name: 'Discord 토큰 확인',
        test: () => {
          require('dotenv').config();
          return !!process.env.DISCORD_TOKEN;
        }
      },
      {
        name: '명령어 파일 존재 확인',
        test: () => {
          const commandsDir = path.join(process.cwd(), 'src', 'commands');
          const userCommands = fs.readdirSync(path.join(commandsDir, 'user'));
          const adminCommands = fs.readdirSync(path.join(commandsDir, 'admin'));
          return userCommands.length > 0 && adminCommands.length > 0;
        }
      },
      {
        name: '이벤트 핸들러 확인',
        test: () => {
          const eventsDir = path.join(process.cwd(), 'src', 'events');
          const eventFiles = fs.readdirSync(eventsDir);
          const requiredEvents = ['ready.js', 'interactionCreate.js', 'voiceStateUpdate.js'];
          return requiredEvents.every(event => eventFiles.includes(event));
        }
      },
      {
        name: '서비스 모듈 확인',
        test: () => {
          const servicesDir = path.join(process.cwd(), 'src', 'services');
          const requiredServices = ['activity', 'database', 'monitoring', 'music', 'season', 'statistics'];
          return requiredServices.every(service => 
            fs.existsSync(path.join(servicesDir, service))
          );
        }
      }
    ];

    for (const test of tests) {
      const startTime = Date.now();
      try {
        const passed = await test.test();
        const duration = Date.now() - startTime;
        this.recordTest(test.name, passed, '', duration);
      } catch (error) {
        const duration = Date.now() - startTime;
        this.recordTest(test.name, false, error.message, duration);
      }
    }
  }

  /**
   * 4. 배포 스크립트 검증
   */
  async testDeploymentScripts() {
    this.log(`${colors.cyan}4. 배포 스크립트 검증 시작${colors.reset}`);
    
    const scripts = [
      'scripts/deploy.js',
      'scripts/deploy-enhanced.js',
      'scripts/deployment-cli.js',
      'scripts/backup-manager.js',
      'scripts/pm2-utils.js',
      'ecosystem.config.js'
    ];

    for (const script of scripts) {
      const startTime = Date.now();
      const exists = fs.existsSync(path.join(process.cwd(), script));
      const duration = Date.now() - startTime;
      
      this.recordTest(`스크립트 존재 확인: ${script}`, exists, '', duration);
      
      if (exists) {
        // 실행 권한 확인 (Unix 시스템만)
        if (process.platform !== 'win32') {
          try {
            const stats = fs.statSync(path.join(process.cwd(), script));
            const hasExecPermission = (stats.mode & parseInt('111', 8)) !== 0;
            this.recordTest(`실행 권한 확인: ${script}`, hasExecPermission, '', 0);
          } catch (error) {
            this.recordTest(`실행 권한 확인: ${script}`, false, error.message, 0);
          }
        }
      }
    }
  }

  /**
   * 5. 모니터링 시스템 테스트
   */
  async testMonitoringSystem() {
    this.log(`${colors.cyan}5. 모니터링 시스템 테스트 시작${colors.reset}`);
    
    try {
      // 모니터링 서비스 로드 테스트
      const startTime = Date.now();
      const MonitoringService = require('../src/services/monitoring');
      const duration = Date.now() - startTime;
      
      this.recordTest('모니터링 서비스 로드', true, '', duration);
      
      // 시스템 메트릭 수집 테스트
      const metricsStartTime = Date.now();
      const systemMonitor = MonitoringService.systemMonitor;
      
      if (systemMonitor && typeof systemMonitor.getSystemMetrics === 'function') {
        const metrics = await systemMonitor.getSystemMetrics();
        const metricsDuration = Date.now() - metricsStartTime;
        
        this.recordTest('시스템 메트릭 수집', 
          metrics && typeof metrics === 'object', 
          `수집된 메트릭: ${Object.keys(metrics || {}).join(', ')}`, 
          metricsDuration);
      } else {
        this.recordTest('시스템 메트릭 수집', false, '메트릭 수집 함수를 찾을 수 없음');
      }
      
    } catch (error) {
      this.recordTest('모니터링 시스템 로드', false, error.message);
    }
  }

  /**
   * 6. 성능 벤치마크 테스트
   */
  async testPerformanceBenchmark() {
    this.log(`${colors.cyan}6. 성능 벤치마크 테스트 시작${colors.reset}`);
    
    // 메모리 사용량 테스트
    const initialMemory = process.memoryUsage();
    this.recordTest('초기 메모리 사용량', true, 
      `RSS: ${Math.round(initialMemory.rss / 1024 / 1024)}MB, ` +
      `Heap Used: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`);
    
    // 데이터베이스 쿼리 성능 테스트
    try {
      const { db } = require('../src/config/database');
      
      const queryStartTime = Date.now();
      await db.query('SELECT COUNT(*) FROM user_activity_stats');
      const queryDuration = Date.now() - queryStartTime;
      
      this.recordTest('데이터베이스 쿼리 성능', queryDuration < 1000, 
        `쿼리 시간: ${queryDuration}ms`, queryDuration);
      
    } catch (error) {
      this.recordTest('데이터베이스 쿼리 성능', false, error.message);
    }
    
    // CPU 집약적 작업 성능 테스트
    const cpuStartTime = Date.now();
    let counter = 0;
    const targetTime = 100; // 100ms 목표
    
    while (Date.now() - cpuStartTime < targetTime) {
      counter++;
    }
    
    const actualDuration = Date.now() - cpuStartTime;
    this.recordTest('CPU 성능 테스트', 
      Math.abs(actualDuration - targetTime) < 50, 
      `목표: ${targetTime}ms, 실제: ${actualDuration}ms, 반복: ${counter.toLocaleString()}회`);
  }

  /**
   * 테스트 결과 요약 및 보고서 생성
   */
  generateReport() {
    const totalDuration = Date.now() - this.startTime;
    const passedTests = this.testResults.filter(test => test.passed).length;
    const totalTests = this.testResults.length;
    const failedTests = totalTests - passedTests;
    
    const reportData = {
      summary: {
        totalTests,
        passedTests,
        failedTests,
        successRate: `${((passedTests / totalTests) * 100).toFixed(1)}%`,
        totalDuration: `${totalDuration}ms`,
        timestamp: new Date().toISOString()
      },
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: process.memoryUsage()
      },
      results: this.testResults
    };
    
    // JSON 보고서 저장
    const reportFile = path.join(RESULTS_DIR, `integration-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
    
    // 콘솔 요약 출력
    this.log(`\n${colors.bright}테스트 결과 요약${colors.reset}`);
    this.log(`총 테스트: ${totalTests}`);
    this.log(`성공: ${colors.green}${passedTests}${colors.reset}`);
    this.log(`실패: ${colors.red}${failedTests}${colors.reset}`);
    this.log(`성공률: ${passedTests === totalTests ? colors.green : colors.yellow}${reportData.summary.successRate}${colors.reset}`);
    this.log(`총 소요 시간: ${totalDuration}ms`);
    this.log(`보고서 저장: ${reportFile}`);
    
    if (failedTests > 0) {
      this.log(`\n${colors.red}실패한 테스트:${colors.reset}`);
      this.testResults.filter(test => !test.passed).forEach(test => {
        this.log(`- ${test.name}: ${test.details}`);
      });
    }
    
    return failedTests === 0;
  }

  /**
   * 모든 통합 테스트 실행
   */
  async runAllTests() {
    this.log(`${colors.bright}GodHand Discord Bot 통합 테스트 시작${colors.reset}`);
    this.log(`테스트 시작 시간: ${new Date().toISOString()}`);
    
    try {
      await this.testSystemEnvironment();
      await this.testDatabaseSchema();
      await this.testDiscordBotComponents();
      await this.testDeploymentScripts();
      await this.testMonitoringSystem();
      await this.testPerformanceBenchmark();
    } catch (error) {
      this.log(`통합 테스트 중 오류 발생: ${error.message}`, 'ERROR');
    }
    
    return this.generateReport();
  }
}

// 스크립트 실행
if (require.main === module) {
  const testSuite = new IntegrationTestSuite();
  
  testSuite.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('통합 테스트 실행 실패:', error);
      process.exit(1);
    });
}

module.exports = IntegrationTestSuite; 