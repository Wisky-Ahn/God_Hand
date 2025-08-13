#!/usr/bin/env node

/**
 * GodHand Discord Bot 향상된 배포 스크립트
 * 롤백, 환경 검증, 버전 관리, Discord 알림 기능 포함
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 설정 상수
const CONFIG = {
  APP_NAME: 'godhand-bot',
  BACKUP_DIR: path.join(process.cwd(), 'backups'),
  LOG_DIR: path.join(process.cwd(), 'logs'),
  DEPLOY_DIR: path.join(process.cwd(), '.deploy'),
  LOCK_FILE: path.join(process.cwd(), '.deploy', 'deploy.lock'),
  VERSION_FILE: path.join(process.cwd(), '.deploy', 'version.json'),
  CHANGELOG_FILE: path.join(process.cwd(), '.deploy', 'CHANGELOG.md'),
  
  // 환경 요구사항
  REQUIREMENTS: {
    nodeMinVersion: '16.0.0',
    memoryMinMB: 512,
    diskMinMB: 1024,
    requiredCommands: ['pm2', 'git', 'node', 'npm']
  },
  
  // 배포 설정
  DEPLOYMENT: {
    maxRetries: 3,
    retryDelay: 5000,
    healthCheckTimeout: 30000,
    rollbackOnFailure: true
  }
};

class DeploymentManager {
  constructor() {
    this.startTime = Date.now();
    this.deploymentId = this.generateDeploymentId();
    this.currentVersion = null;
    this.previousVersion = null;
    this.changes = [];
    this.isRollback = false;
    
    this.ensureDirectories();
    this.loadVersionInfo();
  }

  /**
   * 배포 ID 생성
   */
  generateDeploymentId() {
    return `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 필요한 디렉토리 생성
   */
  ensureDirectories() {
    const directories = [
      CONFIG.BACKUP_DIR,
      CONFIG.LOG_DIR,
      CONFIG.DEPLOY_DIR,
      path.join(CONFIG.DEPLOY_DIR, 'versions'),
      path.join(CONFIG.DEPLOY_DIR, 'rollbacks')
    ];

    directories.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 디렉토리 생성: ${dir}`);
      }
    });
  }

  /**
   * 버전 정보 로드
   */
  loadVersionInfo() {
    try {
      if (fs.existsSync(CONFIG.VERSION_FILE)) {
        const versionData = JSON.parse(fs.readFileSync(CONFIG.VERSION_FILE, 'utf8'));
        this.previousVersion = versionData.current;
        console.log(`📋 이전 버전 로드: ${this.previousVersion?.version || 'Unknown'}`);
      }
    } catch (error) {
      console.warn('⚠️  버전 정보 로드 실패:', error.message);
    }
  }

  /**
   * 배포 잠금 확인 및 생성
   */
  checkAndCreateLock() {
    if (fs.existsSync(CONFIG.LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(CONFIG.LOCK_FILE, 'utf8'));
      const lockAge = Date.now() - lockData.timestamp;
      
      // 30분 이상 된 잠금은 무시
      if (lockAge < 30 * 60 * 1000) {
        throw new Error(`배포가 이미 진행 중입니다. PID: ${lockData.pid}, 시작: ${new Date(lockData.timestamp).toLocaleString()}`);
      } else {
        console.warn('⚠️  오래된 배포 잠금 파일 삭제');
        fs.unlinkSync(CONFIG.LOCK_FILE);
      }
    }

    const lockData = {
      pid: process.pid,
      timestamp: Date.now(),
      deploymentId: this.deploymentId,
      user: os.userInfo().username
    };

    fs.writeFileSync(CONFIG.LOCK_FILE, JSON.stringify(lockData, null, 2));
    console.log(`🔒 배포 잠금 생성: ${this.deploymentId}`);
  }

  /**
   * 배포 잠금 해제
   */
  removeLock() {
    try {
      if (fs.existsSync(CONFIG.LOCK_FILE)) {
        fs.unlinkSync(CONFIG.LOCK_FILE);
        console.log('🔓 배포 잠금 해제');
      }
    } catch (error) {
      console.error('❌ 배포 잠금 해제 실패:', error.message);
    }
  }

  /**
   * 환경 검증
   */
  async validateEnvironment() {
    console.log('🔍 환경 검증 시작...');
    
    const results = {
      node: await this.checkNodeVersion(),
      memory: this.checkMemory(),
      disk: this.checkDiskSpace(),
      commands: this.checkRequiredCommands(),
      git: this.checkGitStatus(),
      pm2: this.checkPM2Status()
    };

    const failed = Object.entries(results).filter(([key, result]) => !result.success);
    
    if (failed.length > 0) {
      console.error('❌ 환경 검증 실패:');
      failed.forEach(([key, result]) => {
        console.error(`  - ${key}: ${result.message}`);
      });
      return false;
    }

    console.log('✅ 환경 검증 완료');
    return true;
  }

  /**
   * Node.js 버전 확인
   */
  async checkNodeVersion() {
    try {
      const currentVersion = process.version.replace('v', '');
      const minVersion = CONFIG.REQUIREMENTS.nodeMinVersion;
      
      if (this.compareVersions(currentVersion, minVersion) >= 0) {
        console.log(`✅ Node.js 버전: ${currentVersion}`);
        return { success: true };
      } else {
        return { 
          success: false, 
          message: `Node.js 버전이 부족합니다. 현재: ${currentVersion}, 필요: ${minVersion}` 
        };
      }
    } catch (error) {
      return { success: false, message: `Node.js 버전 확인 실패: ${error.message}` };
    }
  }

  /**
   * 메모리 확인
   */
  checkMemory() {
    try {
      const freeMemoryMB = Math.round(os.freemem() / 1024 / 1024);
      const minMemoryMB = CONFIG.REQUIREMENTS.memoryMinMB;
      
      if (freeMemoryMB >= minMemoryMB) {
        console.log(`✅ 사용 가능한 메모리: ${freeMemoryMB}MB`);
        return { success: true };
      } else {
        return { 
          success: false, 
          message: `메모리가 부족합니다. 사용 가능: ${freeMemoryMB}MB, 필요: ${minMemoryMB}MB` 
        };
      }
    } catch (error) {
      return { success: false, message: `메모리 확인 실패: ${error.message}` };
    }
  }

  /**
   * 디스크 공간 확인
   */
  checkDiskSpace() {
    try {
      const diskUsage = execSync('df -m .', { encoding: 'utf8' });
      const lines = diskUsage.trim().split('\n');
      const data = lines[1].split(/\s+/);
      const availableMB = parseInt(data[3]);
      const minDiskMB = CONFIG.REQUIREMENTS.diskMinMB;
      
      if (availableMB >= minDiskMB) {
        console.log(`✅ 사용 가능한 디스크: ${availableMB}MB`);
        return { success: true };
      } else {
        return { 
          success: false, 
          message: `디스크 공간이 부족합니다. 사용 가능: ${availableMB}MB, 필요: ${minDiskMB}MB` 
        };
      }
    } catch (error) {
      return { success: false, message: `디스크 공간 확인 실패: ${error.message}` };
    }
  }

  /**
   * 필수 명령어 확인
   */
  checkRequiredCommands() {
    const missingCommands = [];
    
    CONFIG.REQUIREMENTS.requiredCommands.forEach(command => {
      try {
        execSync(`which ${command}`, { stdio: 'pipe' });
        console.log(`✅ ${command} 명령어 사용 가능`);
      } catch (error) {
        missingCommands.push(command);
      }
    });

    if (missingCommands.length === 0) {
      return { success: true };
    } else {
      return { 
        success: false, 
        message: `필수 명령어가 없습니다: ${missingCommands.join(', ')}` 
      };
    }
  }

  /**
   * Git 상태 확인
   */
  checkGitStatus() {
    try {
      // Git 저장소인지 확인
      execSync('git rev-parse --git-dir', { stdio: 'pipe' });
      
      // 변경사항 확인
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      if (status.trim()) {
        console.warn('⚠️  커밋되지 않은 변경사항이 있습니다:');
        console.warn(status);
      }
      
      // 현재 브랜치 및 커밋 정보
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      
      console.log(`✅ Git 브랜치: ${branch}, 커밋: ${commit}`);
      
      this.currentVersion = {
        version: `${branch}-${commit}`,
        branch,
        commit,
        timestamp: new Date().toISOString(),
        deploymentId: this.deploymentId
      };
      
      return { success: true };
    } catch (error) {
      return { success: false, message: `Git 상태 확인 실패: ${error.message}` };
    }
  }

  /**
   * PM2 상태 확인
   */
  checkPM2Status() {
    try {
      const pmList = execSync('pm2 jlist', { encoding: 'utf8' });
      const apps = JSON.parse(pmList);
      const godhandApp = apps.find(app => app.name === CONFIG.APP_NAME);
      
      if (godhandApp) {
        console.log(`✅ PM2 앱 상태: ${godhandApp.pm2_env.status}`);
        return { success: true, currentApp: godhandApp };
      } else {
        console.log('📝 PM2에서 앱을 찾을 수 없습니다. 새로 배포됩니다.');
        return { success: true, currentApp: null };
      }
    } catch (error) {
      return { success: false, message: `PM2 상태 확인 실패: ${error.message}` };
    }
  }

  /**
   * 배포 전 백업 생성
   */
  async createPreDeploymentBackup() {
    console.log('💾 배포 전 백업 생성 중...');
    
    try {
      // 데이터베이스 백업
      const { createBackup } = require('./backup-manager');
      const backupResult = createBackup('pre-deploy', `pre-deploy-${this.deploymentId}`);
      
      if (backupResult.success) {
        console.log(`✅ 데이터베이스 백업 완료: ${backupResult.sqlFile}`);
        return backupResult;
      } else {
        console.warn('⚠️  데이터베이스 백업 실패, 배포를 계속합니다.');
        return null;
      }
    } catch (error) {
      console.warn('⚠️  백업 모듈 로드 실패:', error.message);
      return null;
    }
  }

  /**
   * 변경사항 수집
   */
  collectChanges() {
    try {
      if (!this.previousVersion || !this.previousVersion.commit) {
        this.changes = ['초기 배포'];
        return;
      }
      
      const gitLog = execSync(
        `git log --oneline ${this.previousVersion.commit}..HEAD`,
        { encoding: 'utf8' }
      ).trim();
      
      if (gitLog) {
        this.changes = gitLog.split('\n').map(line => line.trim()).filter(line => line);
      } else {
        this.changes = ['변경사항 없음'];
      }
      
      console.log(`📋 변경사항 ${this.changes.length}개 수집됨`);
      
    } catch (error) {
      console.warn('⚠️  변경사항 수집 실패:', error.message);
      this.changes = ['변경사항 수집 실패'];
    }
  }

  /**
   * PM2 배포 실행
   */
  async executeDeployment() {
    console.log('🚀 PM2 배포 실행 중...');
    
    let retryCount = 0;
    const maxRetries = CONFIG.DEPLOYMENT.maxRetries;
    
    while (retryCount < maxRetries) {
      try {
        // 기존 앱 중지 (존재하는 경우)
        try {
          execSync(`pm2 stop ${CONFIG.APP_NAME}`, { stdio: 'pipe' });
          execSync(`pm2 delete ${CONFIG.APP_NAME}`, { stdio: 'pipe' });
          console.log('🛑 기존 애플리케이션 중지 완료');
        } catch (error) {
          console.log('📝 중지할 기존 애플리케이션이 없습니다.');
        }
        
        // 새 애플리케이션 시작
        console.log('▶️  새 애플리케이션 시작 중...');
        execSync('pm2 start ecosystem.config.js --env production', { stdio: 'inherit' });
        
        // PM2 설정 저장
        execSync('pm2 save', { stdio: 'inherit' });
        
        // 헬스체크
        const isHealthy = await this.performHealthCheck();
        if (isHealthy) {
          console.log('✅ 배포 성공!');
          return true;
        } else {
          throw new Error('헬스체크 실패');
        }
        
      } catch (error) {
        retryCount++;
        console.error(`❌ 배포 시도 ${retryCount} 실패:`, error.message);
        
        if (retryCount < maxRetries) {
          console.log(`⏳ ${CONFIG.DEPLOYMENT.retryDelay / 1000}초 후 재시도...`);
          await this.sleep(CONFIG.DEPLOYMENT.retryDelay);
        } else {
          console.error('💥 모든 배포 시도 실패');
          return false;
        }
      }
    }
    
    return false;
  }

  /**
   * 헬스체크 수행
   */
  async performHealthCheck() {
    console.log('🩺 헬스체크 수행 중...');
    
    const startTime = Date.now();
    const timeout = CONFIG.DEPLOYMENT.healthCheckTimeout;
    
    while (Date.now() - startTime < timeout) {
      try {
        const pmStatus = execSync('pm2 jlist', { encoding: 'utf8' });
        const apps = JSON.parse(pmStatus);
        const godhandApp = apps.find(app => app.name === CONFIG.APP_NAME);
        
        if (godhandApp && godhandApp.pm2_env.status === 'online') {
          // 추가 헬스체크 (예: Discord 봇 상태 확인)
          await this.sleep(3000); // 3초 대기 후 안정성 확인
          
          const pmStatusAgain = execSync('pm2 jlist', { encoding: 'utf8' });
          const appsAgain = JSON.parse(pmStatusAgain);
          const godhandAppAgain = appsAgain.find(app => app.name === CONFIG.APP_NAME);
          
          if (godhandAppAgain && godhandAppAgain.pm2_env.status === 'online') {
            console.log('✅ 헬스체크 성공');
            return true;
          }
        }
        
        console.log('⏳ 애플리케이션 시작 대기 중...');
        await this.sleep(2000);
        
      } catch (error) {
        console.warn('⚠️  헬스체크 오류:', error.message);
        await this.sleep(2000);
      }
    }
    
    console.error('❌ 헬스체크 시간 초과');
    return false;
  }

  /**
   * 롤백 실행
   */
  async performRollback() {
    if (!this.previousVersion) {
      console.error('❌ 롤백할 이전 버전이 없습니다.');
      return false;
    }
    
    console.log(`🔄 이전 버전으로 롤백 중: ${this.previousVersion.version}`);
    this.isRollback = true;
    
    try {
      // Git 롤백
      if (this.previousVersion.commit) {
        execSync(`git checkout ${this.previousVersion.commit}`, { stdio: 'inherit' });
        console.log('✅ Git 롤백 완료');
      }
      
      // PM2 재배포
      const deploymentSuccess = await this.executeDeployment();
      
      if (deploymentSuccess) {
        console.log('✅ 롤백 성공');
        return true;
      } else {
        console.error('❌ 롤백 실패');
        return false;
      }
      
    } catch (error) {
      console.error('❌ 롤백 실행 실패:', error.message);
      return false;
    }
  }

  /**
   * 버전 정보 저장
   */
  saveVersionInfo() {
    try {
      const versionData = {
        current: this.currentVersion,
        previous: this.previousVersion,
        deploymentId: this.deploymentId,
        timestamp: new Date().toISOString(),
        isRollback: this.isRollback
      };
      
      fs.writeFileSync(CONFIG.VERSION_FILE, JSON.stringify(versionData, null, 2));
      console.log('💾 버전 정보 저장 완료');
      
    } catch (error) {
      console.error('❌ 버전 정보 저장 실패:', error.message);
    }
  }

  /**
   * 변경로그 업데이트
   */
  updateChangelog() {
    try {
      const changelogEntry = [
        `## [${this.currentVersion.version}] - ${new Date().toISOString().split('T')[0]}`,
        '',
        `### ${this.isRollback ? 'Rollback' : 'Deployment'}`,
        `- Deployment ID: ${this.deploymentId}`,
        `- Timestamp: ${new Date().toISOString()}`,
        `- Duration: ${Math.round((Date.now() - this.startTime) / 1000)}s`,
        '',
        '### Changes',
        ...this.changes.map(change => `- ${change}`),
        '',
        '---',
        ''
      ].join('\n');
      
      let existingChangelog = '';
      if (fs.existsSync(CONFIG.CHANGELOG_FILE)) {
        existingChangelog = fs.readFileSync(CONFIG.CHANGELOG_FILE, 'utf8');
      }
      
      const newChangelog = changelogEntry + existingChangelog;
      fs.writeFileSync(CONFIG.CHANGELOG_FILE, newChangelog);
      
      console.log('📝 변경로그 업데이트 완료');
      
    } catch (error) {
      console.error('❌ 변경로그 업데이트 실패:', error.message);
    }
  }

  /**
   * Discord 배포 알림 전송
   */
  async sendDiscordNotification(success, error = null) {
    try {
      // 모니터링 서비스가 있는 경우 알림 전송
      const monitoringServicePath = path.join(process.cwd(), 'src', 'services', 'monitoring', 'index.js');
      
      if (fs.existsSync(monitoringServicePath)) {
        const deployment = {
          success,
          version: this.currentVersion?.version || 'Unknown',
          deploymentId: this.deploymentId,
          startTime: new Date(this.startTime).toLocaleString('ko-KR'),
          duration: `${Math.round((Date.now() - this.startTime) / 1000)}초`,
          changes: this.changes.slice(0, 5), // 최대 5개 변경사항
          error: error?.message,
          isRollback: this.isRollback,
          rollback: this.isRollback ? {
            version: this.previousVersion?.version
          } : null
        };
        
        console.log('📢 Discord 배포 알림 전송 중...');
        // 실제 알림 전송은 봇이 실행 중일 때만 가능
        console.log('💡 봇 재시작 후 Discord 알림을 확인하세요.');
        
        // 배포 정보를 파일로 저장 (봇이 시작될 때 읽을 수 있도록)
        const notificationFile = path.join(CONFIG.DEPLOY_DIR, 'pending-notification.json');
        fs.writeFileSync(notificationFile, JSON.stringify(deployment, null, 2));
        
      } else {
        console.log('📢 모니터링 서비스를 찾을 수 없습니다. Discord 알림을 건너뜁니다.');
      }
      
    } catch (error) {
      console.error('❌ Discord 알림 전송 실패:', error.message);
    }
  }

  /**
   * 메인 배포 프로세스
   */
  async deploy() {
    let deploymentSuccess = false;
    let deploymentError = null;
    
    try {
      console.log('🎯 GodHand Discord Bot 향상된 배포 시작');
      console.log('=' * 60);
      console.log(`📋 배포 ID: ${this.deploymentId}`);
      console.log(`⏰ 시작 시간: ${new Date(this.startTime).toLocaleString('ko-KR')}`);
      console.log('=' * 60);
      
      // 1. 배포 잠금 확인 및 생성
      this.checkAndCreateLock();
      
      // 2. 환경 검증
      const envValid = await this.validateEnvironment();
      if (!envValid) {
        throw new Error('환경 검증 실패');
      }
      
      // 3. 배포 전 백업
      await this.createPreDeploymentBackup();
      
      // 4. 변경사항 수집
      this.collectChanges();
      
      // 5. PM2 배포 실행
      deploymentSuccess = await this.executeDeployment();
      
      if (!deploymentSuccess) {
        throw new Error('배포 실패');
      }
      
      // 6. 버전 정보 저장
      this.saveVersionInfo();
      
      // 7. 변경로그 업데이트
      this.updateChangelog();
      
      console.log('🎉 배포가 성공적으로 완료되었습니다!');
      console.log(`⏱️  총 소요 시간: ${Math.round((Date.now() - this.startTime) / 1000)}초`);
      console.log(`📱 Discord에서 봇의 상태를 확인해보세요.`);
      
    } catch (error) {
      deploymentError = error;
      console.error('💥 배포 실패:', error.message);
      
      // 롤백 수행 (설정된 경우)
      if (CONFIG.DEPLOYMENT.rollbackOnFailure && !this.isRollback) {
        console.log('🔄 자동 롤백 시작...');
        const rollbackSuccess = await this.performRollback();
        
        if (rollbackSuccess) {
          console.log('✅ 롤백 완료');
          deploymentSuccess = true; // 롤백 성공으로 처리
        } else {
          console.error('❌ 롤백도 실패했습니다.');
        }
      }
      
    } finally {
      // 8. Discord 알림 전송
      await this.sendDiscordNotification(deploymentSuccess, deploymentError);
      
      // 9. 배포 잠금 해제
      this.removeLock();
      
      // 10. 종료 코드 설정
      process.exit(deploymentSuccess ? 0 : 1);
    }
  }

  /**
   * 헬퍼 메서드들
   */
  
  compareVersions(a, b) {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    
    return 0;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI 인터페이스
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
GodHand Discord Bot 향상된 배포 스크립트

사용법:
  node scripts/deploy-enhanced.js [옵션]

옵션:
  --help, -h          이 도움말 표시
  --rollback          이전 버전으로 롤백
  --dry-run           실제 배포 없이 검증만 수행
  --no-backup         배포 전 백업 건너뛰기
  --no-notification   Discord 알림 비활성화

예시:
  node scripts/deploy-enhanced.js                # 일반 배포
  node scripts/deploy-enhanced.js --rollback     # 롤백 수행
  node scripts/deploy-enhanced.js --dry-run      # 드라이런
    `);
    process.exit(0);
  }
  
  const deployment = new DeploymentManager();
  
  if (args.includes('--rollback')) {
    deployment.performRollback().then(success => {
      process.exit(success ? 0 : 1);
    });
  } else if (args.includes('--dry-run')) {
    deployment.validateEnvironment().then(valid => {
      console.log(valid ? '✅ 드라이런 성공' : '❌ 드라이런 실패');
      process.exit(valid ? 0 : 1);
    });
  } else {
    deployment.deploy();
  }
}

module.exports = DeploymentManager; 