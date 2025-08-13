#!/usr/bin/env node
/**
 * 프로덕션 준비 상태 검증 스크립트
 * 라즈베리파이 환경에서 GodHand Discord Bot의 프로덕션 배포 준비 상태를 확인
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

class ProductionReadinessChecker {
  constructor() {
    this.checks = [];
    this.warnings = [];
    this.errors = [];
  }

  /**
   * 체크 결과 기록
   */
  recordCheck(category, name, status, message = '', recommendation = '') {
    const check = {
      category,
      name,
      status, // 'pass', 'warn', 'fail'
      message,
      recommendation,
      timestamp: new Date().toISOString()
    };

    this.checks.push(check);

    const statusIcon = {
      pass: `${colors.green}✓${colors.reset}`,
      warn: `${colors.yellow}⚠${colors.reset}`,
      fail: `${colors.red}✗${colors.reset}`
    };

    console.log(`${statusIcon[status]} [${category}] ${name}`);
    if (message) {
      console.log(`  ${message}`);
    }
    if (recommendation && status !== 'pass') {
      console.log(`  ${colors.cyan}권장사항: ${recommendation}${colors.reset}`);
    }

    if (status === 'warn') this.warnings.push(check);
    if (status === 'fail') this.errors.push(check);
  }

  /**
   * 1. 환경 변수 및 설정 검증
   */
  async checkEnvironmentConfiguration() {
    console.log(`\n${colors.bright}1. 환경 변수 및 설정 검증${colors.reset}`);

    // .env 파일 존재 확인
    const envExists = fs.existsSync('.env');
    this.recordCheck('Environment', '.env 파일 존재', 
      envExists ? 'pass' : 'fail',
      envExists ? '.env 파일이 존재합니다' : '.env 파일이 없습니다',
      envExists ? '' : '.env.example을 참고하여 .env 파일을 생성하세요'
    );

    if (envExists) {
      // 필수 환경 변수 확인
      require('dotenv').config();
      
      const requiredEnvVars = [
        'DISCORD_TOKEN',
        'DB_HOST',
        'DB_PORT', 
        'DB_NAME',
        'DB_USER',
        'DB_PASSWORD'
      ];

      for (const envVar of requiredEnvVars) {
        const exists = !!process.env[envVar];
        this.recordCheck('Environment', `환경 변수: ${envVar}`,
          exists ? 'pass' : 'fail',
          exists ? '설정됨' : '설정되지 않음',
          exists ? '' : `${envVar} 환경 변수를 설정하세요`
        );
      }

      // 선택적 환경 변수 확인
      const optionalEnvVars = [
        'DISCORD_WEBHOOK_URL',
        'LOG_LEVEL'
      ];

      for (const envVar of optionalEnvVars) {
        const exists = !!process.env[envVar];
        this.recordCheck('Environment', `선택적 환경 변수: ${envVar}`,
          exists ? 'pass' : 'warn',
          exists ? '설정됨' : '설정되지 않음',
          exists ? '' : `${envVar} 설정을 고려해보세요`
        );
      }
    }

    // ecosystem.config.js 확인
    const ecosystemExists = fs.existsSync('ecosystem.config.js');
    this.recordCheck('Environment', 'PM2 설정 파일',
      ecosystemExists ? 'pass' : 'fail',
      ecosystemExists ? 'ecosystem.config.js가 존재합니다' : 'ecosystem.config.js가 없습니다',
      ecosystemExists ? '' : 'PM2 배포를 위해 ecosystem.config.js를 생성하세요'
    );
  }

  /**
   * 2. 데이터베이스 연결 및 스키마 확인
   */
  async checkDatabaseConfiguration() {
    console.log(`\n${colors.bright}2. 데이터베이스 설정 검증${colors.reset}`);

    try {
      const { db } = require('../src/config/database');
      
      // 데이터베이스 연결 테스트
      await db.query('SELECT 1');
      this.recordCheck('Database', '데이터베이스 연결', 'pass', 
        '데이터베이스에 성공적으로 연결되었습니다');

      // 필수 테이블 존재 확인
      const requiredTables = [
        'user_activity_stats',
        'server_stats', 
        'daily_stats',
        'admin_actions',
        'activity_logs'
      ];

      for (const table of requiredTables) {
        const result = await db.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          )
        `, [table]);

        const exists = result.rows[0].exists;
        this.recordCheck('Database', `테이블: ${table}`,
          exists ? 'pass' : 'fail',
          exists ? '테이블이 존재합니다' : '테이블이 없습니다',
          exists ? '' : 'database/migrations를 실행하여 스키마를 생성하세요'
        );
      }

      // 인덱스 확인
      const indexResult = await db.query(`
        SELECT COUNT(*) as count FROM pg_indexes 
        WHERE tablename IN (${requiredTables.map((_, i) => `$${i+1}`).join(',')})
      `, requiredTables);

      const indexCount = parseInt(indexResult.rows[0].count);
      this.recordCheck('Database', '인덱스 설정',
        indexCount > 0 ? 'pass' : 'warn',
        `${indexCount}개의 인덱스가 발견되었습니다`,
        indexCount === 0 ? 'database/indexes.sql을 실행하여 성능 최적화 인덱스를 생성하세요' : ''
      );

    } catch (error) {
      this.recordCheck('Database', '데이터베이스 연결', 'fail',
        `연결 실패: ${error.message}`,
        '데이터베이스 설정을 확인하고 PostgreSQL이 실행 중인지 확인하세요'
      );
    }
  }

  /**
   * 3. 보안 설정 검증
   */
  async checkSecurityConfiguration() {
    console.log(`\n${colors.bright}3. 보안 설정 검증${colors.reset}`);

    // .env 파일 권한 확인 (Unix 시스템만)
    if (process.platform !== 'win32' && fs.existsSync('.env')) {
      try {
        const stats = fs.statSync('.env');
        const permissions = (stats.mode & parseInt('777', 8)).toString(8);
        const isSecure = permissions === '600' || permissions === '400';
        
        this.recordCheck('Security', '.env 파일 권한',
          isSecure ? 'pass' : 'warn',
          `현재 권한: ${permissions}`,
          isSecure ? '' : 'chmod 600 .env로 파일 권한을 제한하세요'
        );
      } catch (error) {
        this.recordCheck('Security', '.env 파일 권한', 'warn',
          '권한 확인 실패', '파일 권한을 수동으로 확인하세요'
        );
      }
    }

    // 로그 디렉터리 권한 확인
    if (fs.existsSync('logs')) {
      try {
        fs.accessSync('logs', fs.constants.W_OK);
        this.recordCheck('Security', '로그 디렉터리 쓰기 권한', 'pass',
          '로그 디렉터리에 쓰기 권한이 있습니다');
      } catch (error) {
        this.recordCheck('Security', '로그 디렉터리 쓰기 권한', 'fail',
          '로그 디렉터리에 쓰기 권한이 없습니다',
          'sudo chown -R $USER:$USER logs로 권한을 수정하세요'
        );
      }
    }

    // PM2 로그 로테이션 확인
    try {
      const { stdout } = await execAsync('pm2 conf');
      const hasLogRotate = stdout.includes('pm2-logrotate');
      
      this.recordCheck('Security', 'PM2 로그 로테이션',
        hasLogRotate ? 'pass' : 'warn',
        hasLogRotate ? 'PM2 로그 로테이션이 설정되어 있습니다' : 'PM2 로그 로테이션이 설정되지 않았습니다',
        hasLogRotate ? '' : 'pm2 install pm2-logrotate로 로그 로테이션을 설정하세요'
      );
    } catch (error) {
      this.recordCheck('Security', 'PM2 로그 로테이션', 'warn',
        'PM2 설정 확인 실패', 'PM2가 설치되어 있는지 확인하세요'
      );
    }
  }

  /**
   * 4. 성능 및 리소스 설정 검증
   */
  async checkPerformanceConfiguration() {
    console.log(`\n${colors.bright}4. 성능 및 리소스 설정 검증${colors.reset}`);

    // 시스템 메모리 확인
    try {
      const { stdout } = await execAsync('free -m');
      const lines = stdout.split('\n');
      const memLine = lines.find(line => line.startsWith('Mem:'));
      
      if (memLine) {
        const totalMemory = parseInt(memLine.split(/\s+/)[1]);
        const availableMemory = parseInt(memLine.split(/\s+/)[6] || memLine.split(/\s+/)[3]);
        
        this.recordCheck('Performance', '시스템 메모리',
          totalMemory >= 512 ? 'pass' : 'warn',
          `총 메모리: ${totalMemory}MB, 사용 가능: ${availableMemory}MB`,
          totalMemory < 512 ? '라즈베리파이 4 이상을 권장합니다 (최소 1GB RAM)' : ''
        );
        
        this.recordCheck('Performance', '사용 가능한 메모리',
          availableMemory >= 200 ? 'pass' : 'warn',
          `사용 가능한 메모리: ${availableMemory}MB`,
          availableMemory < 200 ? '다른 프로세스를 종료하여 메모리를 확보하세요' : ''
        );
      }
    } catch (error) {
      this.recordCheck('Performance', '메모리 확인', 'warn',
        '메모리 정보를 가져올 수 없습니다', '수동으로 시스템 리소스를 확인하세요'
      );
    }

    // 디스크 공간 확인
    try {
      const { stdout } = await execAsync('df -h .');
      const lines = stdout.split('\n');
      const diskLine = lines[1];
      
      if (diskLine) {
        const available = diskLine.split(/\s+/)[3];
        const numericValue = parseFloat(available.replace(/[^\d.]/g, ''));
        const unit = available.slice(-1);
        
        let availableGB = 0;
        if (unit === 'G') availableGB = numericValue;
        else if (unit === 'M') availableGB = numericValue / 1024;
        
        this.recordCheck('Performance', '디스크 공간',
          availableGB >= 2 ? 'pass' : 'warn',
          `사용 가능한 공간: ${available}`,
          availableGB < 2 ? '최소 2GB 이상의 여유 공간을 확보하세요' : ''
        );
      }
    } catch (error) {
      this.recordCheck('Performance', '디스크 공간', 'warn',
        '디스크 정보를 가져올 수 없습니다', '수동으로 디스크 공간을 확인하세요'
      );
    }

    // Node.js 버전 확인
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    this.recordCheck('Performance', 'Node.js 버전',
      majorVersion >= 18 ? 'pass' : 'fail',
      `현재 버전: ${nodeVersion}`,
      majorVersion < 18 ? 'Node.js 18 이상으로 업그레이드하세요' : ''
    );
  }

  /**
   * 5. 백업 및 복구 시스템 검증
   */
  async checkBackupConfiguration() {
    console.log(`\n${colors.bright}5. 백업 및 복구 시스템 검증${colors.reset}`);

    // 백업 스크립트 존재 확인
    const backupScript = 'scripts/backup-manager.js';
    const backupExists = fs.existsSync(backupScript);
    
    this.recordCheck('Backup', '백업 스크립트',
      backupExists ? 'pass' : 'fail',
      backupExists ? '백업 스크립트가 존재합니다' : '백업 스크립트가 없습니다',
      backupExists ? '' : '백업 관리 스크립트를 생성하세요'
    );

    // 백업 디렉터리 확인
    const backupDir = 'backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    try {
      fs.accessSync(backupDir, fs.constants.W_OK);
      this.recordCheck('Backup', '백업 디렉터리',
        'pass', '백업 디렉터리에 쓰기 권한이 있습니다');
    } catch (error) {
      this.recordCheck('Backup', '백업 디렉터리',
        'fail', '백업 디렉터리에 쓰기 권한이 없습니다',
        'mkdir -p backups && chmod 755 backups로 디렉터리를 생성하세요'
      );
    }

    // PostgreSQL dump 도구 확인
    try {
      await execAsync('pg_dump --version');
      this.recordCheck('Backup', 'PostgreSQL 백업 도구',
        'pass', 'pg_dump가 설치되어 있습니다');
    } catch (error) {
      this.recordCheck('Backup', 'PostgreSQL 백업 도구',
        'fail', 'pg_dump가 설치되지 않았습니다',
        'sudo apt-get install postgresql-client로 클라이언트 도구를 설치하세요'
      );
    }
  }

  /**
   * 6. 모니터링 시스템 검증
   */
  async checkMonitoringConfiguration() {
    console.log(`\n${colors.bright}6. 모니터링 시스템 검증${colors.reset}`);

    // 모니터링 서비스 파일 확인
    const monitoringFiles = [
      'src/services/monitoring/index.js',
      'src/services/monitoring/systemMonitor.js',
      'src/services/monitoring/discordAlertService.js'
    ];

    for (const file of monitoringFiles) {
      const exists = fs.existsSync(file);
      this.recordCheck('Monitoring', `모니터링 파일: ${path.basename(file)}`,
        exists ? 'pass' : 'fail',
        exists ? '파일이 존재합니다' : '파일이 없습니다',
        exists ? '' : '모니터링 시스템 파일을 생성하세요'
      );
    }

    // Discord 웹훅 설정 확인 (선택적)
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    this.recordCheck('Monitoring', 'Discord 웹훅 설정',
      webhookUrl ? 'pass' : 'warn',
      webhookUrl ? 'Discord 웹훅이 설정되어 있습니다' : 'Discord 웹훅이 설정되지 않았습니다',
      webhookUrl ? '' : '알림을 위해 Discord 웹훅 URL을 설정하는 것을 권장합니다'
    );

    // PM2 모니터링 확인
    try {
      await execAsync('pm2 --version');
      this.recordCheck('Monitoring', 'PM2 프로세스 관리',
        'pass', 'PM2가 설치되어 있습니다');
    } catch (error) {
      this.recordCheck('Monitoring', 'PM2 프로세스 관리',
        'fail', 'PM2가 설치되지 않았습니다',
        'npm install -g pm2로 PM2를 설치하세요'
      );
    }
  }

  /**
   * 7. 배포 및 운영 도구 검증
   */
  async checkDeploymentTools() {
    console.log(`\n${colors.bright}7. 배포 및 운영 도구 검증${colors.reset}`);

    // 배포 스크립트들 확인
    const deploymentScripts = [
      'scripts/deploy.js',
      'scripts/deploy-enhanced.js',
      'scripts/deployment-cli.js',
      'scripts/pm2-utils.js'
    ];

    for (const script of deploymentScripts) {
      const exists = fs.existsSync(script);
      this.recordCheck('Deployment', `배포 스크립트: ${path.basename(script)}`,
        exists ? 'pass' : 'fail',
        exists ? '스크립트가 존재합니다' : '스크립트가 없습니다',
        exists ? '' : '배포 관리 스크립트를 생성하세요'
      );
    }

    // Git 설정 확인
    try {
      await execAsync('git --version');
      this.recordCheck('Deployment', 'Git 버전 관리',
        'pass', 'Git이 설치되어 있습니다');

      // Git 저장소 확인
      try {
        await execAsync('git status');
        this.recordCheck('Deployment', 'Git 저장소 초기화',
          'pass', 'Git 저장소가 초기화되어 있습니다');
      } catch (error) {
        this.recordCheck('Deployment', 'Git 저장소 초기화',
          'warn', 'Git 저장소가 초기화되지 않았습니다',
          'git init으로 저장소를 초기화하는 것을 권장합니다'
        );
      }
    } catch (error) {
      this.recordCheck('Deployment', 'Git 버전 관리',
        'fail', 'Git이 설치되지 않았습니다',
        'sudo apt-get install git으로 Git을 설치하세요'
      );
    }

    // 패키지 매니저 확인
    try {
      await execAsync('npm --version');
      this.recordCheck('Deployment', 'NPM 패키지 관리',
        'pass', 'NPM이 사용 가능합니다');
    } catch (error) {
      this.recordCheck('Deployment', 'NPM 패키지 관리',
        'fail', 'NPM을 찾을 수 없습니다',
        'Node.js와 NPM을 설치하세요'
      );
    }
  }

  /**
   * 최종 보고서 생성
   */
  generateReport() {
    const totalChecks = this.checks.length;
    const passedChecks = this.checks.filter(c => c.status === 'pass').length;
    const warningChecks = this.warnings.length;
    const failedChecks = this.errors.length;

    console.log(`\n${colors.bright}프로덕션 준비 상태 요약${colors.reset}`);
    console.log(`${'='.repeat(50)}`);
    console.log(`총 검사 항목: ${totalChecks}`);
    console.log(`${colors.green}통과: ${passedChecks}${colors.reset}`);
    console.log(`${colors.yellow}경고: ${warningChecks}${colors.reset}`);
    console.log(`${colors.red}실패: ${failedChecks}${colors.reset}`);
    
    const successRate = ((passedChecks / totalChecks) * 100).toFixed(1);
    console.log(`통과율: ${successRate}%`);

    // 전체 준비 상태 평가
    let readinessStatus;
    if (failedChecks === 0 && warningChecks <= 2) {
      readinessStatus = `${colors.green}프로덕션 배포 준비 완료${colors.reset}`;
    } else if (failedChecks <= 2 && warningChecks <= 5) {
      readinessStatus = `${colors.yellow}조건부 프로덕션 준비 (일부 수정 필요)${colors.reset}`;
    } else {
      readinessStatus = `${colors.red}프로덕션 배포 준비 미완료 (수정 필요)${colors.reset}`;
    }

    console.log(`\n${colors.bright}전체 평가: ${readinessStatus}${colors.reset}`);

    // 중요한 오류들 표시
    if (this.errors.length > 0) {
      console.log(`\n${colors.red}반드시 수정해야 할 항목:${colors.reset}`);
      this.errors.forEach(error => {
        console.log(`${colors.red}• [${error.category}] ${error.name}${colors.reset}`);
        if (error.recommendation) {
          console.log(`  해결방법: ${error.recommendation}`);
        }
      });
    }

    // 권장 개선사항 표시
    if (this.warnings.length > 0) {
      console.log(`\n${colors.yellow}권장 개선사항:${colors.reset}`);
      this.warnings.forEach(warning => {
        console.log(`${colors.yellow}• [${warning.category}] ${warning.name}${colors.reset}`);
        if (warning.recommendation) {
          console.log(`  권장사항: ${warning.recommendation}`);
        }
      });
    }

    // 보고서 파일 저장
    const reportData = {
      summary: {
        totalChecks,
        passedChecks,
        warningChecks,
        failedChecks,
        successRate: parseFloat(successRate),
        readinessStatus: readinessStatus.replace(/\x1b\[[0-9;]*m/g, ''), // 색상 코드 제거
        timestamp: new Date().toISOString()
      },
      checks: this.checks,
      errors: this.errors,
      warnings: this.warnings
    };

    const reportFile = `production-readiness-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
    console.log(`\n상세 보고서가 저장되었습니다: ${reportFile}`);

    return failedChecks === 0;
  }

  /**
   * 모든 프로덕션 준비 검사 실행
   */
  async runAllChecks() {
    console.log(`${colors.bright}GodHand Discord Bot 프로덕션 준비 상태 검증${colors.reset}`);
    console.log(`검증 시작 시간: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(50)}`);

    try {
      await this.checkEnvironmentConfiguration();
      await this.checkDatabaseConfiguration();
      await this.checkSecurityConfiguration();
      await this.checkPerformanceConfiguration();
      await this.checkBackupConfiguration();
      await this.checkMonitoringConfiguration();
      await this.checkDeploymentTools();
    } catch (error) {
      console.error(`${colors.red}검증 중 오류 발생: ${error.message}${colors.reset}`);
    }

    return this.generateReport();
  }
}

// 스크립트 실행
if (require.main === module) {
  const checker = new ProductionReadinessChecker();
  
  checker.runAllChecks()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('프로덕션 준비 상태 검증 실패:', error);
      process.exit(1);
    });
}

module.exports = ProductionReadinessChecker; 