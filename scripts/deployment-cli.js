#!/usr/bin/env node

/**
 * GodHand Discord Bot 배포 관리 CLI
 * 배포, 롤백, 상태 확인 등을 위한 통합 관리 도구
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 설정
const CONFIG = {
  DEPLOY_DIR: path.join(process.cwd(), '.deploy'),
  VERSION_FILE: path.join(process.cwd(), '.deploy', 'version.json'),
  CHANGELOG_FILE: path.join(process.cwd(), '.deploy', 'CHANGELOG.md'),
  LOCK_FILE: path.join(process.cwd(), '.deploy', 'deploy.lock')
};

class DeploymentCLI {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * 메인 메뉴 표시
   */
  async showMainMenu() {
    console.clear();
    console.log('🚀 GodHand Discord Bot 배포 관리');
    console.log('=' .repeat(50));
    console.log('1. 📊 배포 상태 확인');
    console.log('2. 🚀 새 배포 실행');
    console.log('3. 🔄 이전 버전으로 롤백');
    console.log('4. 📋 배포 기록 조회');
    console.log('5. 🩺 환경 검증');
    console.log('6. 💾 수동 백업 생성');
    console.log('7. 🔧 PM2 관리');
    console.log('8. 📝 변경로그 보기');
    console.log('0. 🚪 종료');
    console.log('=' .repeat(50));

    const choice = await this.promptUser('선택하세요: ');
    await this.handleMenuChoice(choice);
  }

  /**
   * 메뉴 선택 처리
   */
  async handleMenuChoice(choice) {
    try {
      switch (choice) {
        case '1':
          await this.showDeploymentStatus();
          break;
        case '2':
          await this.executeNewDeployment();
          break;
        case '3':
          await this.performRollback();
          break;
        case '4':
          await this.showDeploymentHistory();
          break;
        case '5':
          await this.validateEnvironment();
          break;
        case '6':
          await this.createManualBackup();
          break;
        case '7':
          await this.managePM2();
          break;
        case '8':
          await this.showChangelog();
          break;
        case '0':
          console.log('👋 안녕히 가세요!');
          process.exit(0);
        default:
          console.log('❌ 잘못된 선택입니다.');
      }
    } catch (error) {
      console.error('❌ 오류 발생:', error.message);
    }

    await this.promptUser('\n계속하려면 Enter를 누르세요...');
    await this.showMainMenu();
  }

  /**
   * 배포 상태 확인
   */
  async showDeploymentStatus() {
    console.log('\n📊 배포 상태 확인');
    console.log('-' .repeat(30));

    try {
      // 버전 정보 읽기
      let versionInfo = null;
      if (fs.existsSync(CONFIG.VERSION_FILE)) {
        versionInfo = JSON.parse(fs.readFileSync(CONFIG.VERSION_FILE, 'utf8'));
      }

      // PM2 상태 확인
      let pm2Status = null;
      try {
        const pmList = execSync('pm2 jlist', { encoding: 'utf8' });
        const apps = JSON.parse(pmList);
        pm2Status = apps.find(app => app.name === 'godhand-bot');
      } catch (error) {
        console.error('⚠️  PM2 상태 확인 실패:', error.message);
      }

      // 배포 잠금 상태 확인
      const isLocked = fs.existsSync(CONFIG.LOCK_FILE);

      // 정보 출력
      console.log('\n🔍 현재 상태:');
      
      if (versionInfo && versionInfo.current) {
        const current = versionInfo.current;
        console.log(`📦 현재 버전: ${current.version}`);
        console.log(`🌿 브랜치: ${current.branch}`);
        console.log(`📝 커밋: ${current.commit}`);
        console.log(`⏰ 배포 시간: ${new Date(current.timestamp).toLocaleString('ko-KR')}`);
        console.log(`🆔 배포 ID: ${current.deploymentId}`);
      } else {
        console.log('📦 배포 정보 없음');
      }

      console.log('\n🖥️  PM2 상태:');
      if (pm2Status) {
        console.log(`📊 상태: ${pm2Status.pm2_env.status}`);
        console.log(`🔄 재시작 횟수: ${pm2Status.pm2_env.restart_time}`);
        console.log(`💾 메모리: ${Math.round(pm2Status.memory / 1024 / 1024)}MB`);
        console.log(`⚡ CPU: ${pm2Status.monit.cpu}%`);
      } else {
        console.log('❌ PM2에서 앱을 찾을 수 없습니다.');
      }

      console.log('\n🔒 배포 잠금:');
      console.log(isLocked ? '🔴 잠금됨' : '🟢 잠금 해제됨');

    } catch (error) {
      console.error('❌ 상태 확인 실패:', error.message);
    }
  }

  /**
   * 새 배포 실행
   */
  async executeNewDeployment() {
    console.log('\n🚀 새 배포 실행');
    console.log('-' .repeat(30));

    // 배포 잠금 확인
    if (fs.existsSync(CONFIG.LOCK_FILE)) {
      console.log('🔴 배포가 이미 진행 중입니다.');
      return;
    }

    // 확인 요청
    const confirm = await this.promptUser('배포를 실행하시겠습니까? (y/N): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('❌ 배포가 취소되었습니다.');
      return;
    }

    try {
      console.log('🚀 배포 시작...');
      execSync('node scripts/deploy-enhanced.js', { stdio: 'inherit' });
      console.log('✅ 배포 완료!');
    } catch (error) {
      console.error('❌ 배포 실패:', error.message);
    }
  }

  /**
   * 롤백 수행
   */
  async performRollback() {
    console.log('\n🔄 이전 버전으로 롤백');
    console.log('-' .repeat(30));

    try {
      // 버전 정보 확인
      if (!fs.existsSync(CONFIG.VERSION_FILE)) {
        console.log('❌ 롤백할 버전 정보가 없습니다.');
        return;
      }

      const versionInfo = JSON.parse(fs.readFileSync(CONFIG.VERSION_FILE, 'utf8'));
      if (!versionInfo.previous) {
        console.log('❌ 롤백할 이전 버전이 없습니다.');
        return;
      }

      console.log(`📦 현재 버전: ${versionInfo.current.version}`);
      console.log(`🔄 롤백 대상: ${versionInfo.previous.version}`);

      const confirm = await this.promptUser('롤백을 실행하시겠습니까? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
        console.log('❌ 롤백이 취소되었습니다.');
        return;
      }

      console.log('🔄 롤백 시작...');
      execSync('node scripts/deploy-enhanced.js --rollback', { stdio: 'inherit' });
      console.log('✅ 롤백 완료!');

    } catch (error) {
      console.error('❌ 롤백 실패:', error.message);
    }
  }

  /**
   * 배포 기록 조회
   */
  async showDeploymentHistory() {
    console.log('\n📋 배포 기록 조회');
    console.log('-' .repeat(30));

    try {
      if (!fs.existsSync(CONFIG.CHANGELOG_FILE)) {
        console.log('📝 배포 기록이 없습니다.');
        return;
      }

      const changelog = fs.readFileSync(CONFIG.CHANGELOG_FILE, 'utf8');
      const lines = changelog.split('\n');
      const recentEntries = lines.slice(0, 50); // 최근 50줄만

      console.log('\n📚 최근 배포 기록:');
      console.log(recentEntries.join('\n'));

      const showMore = await this.promptUser('\n전체 기록을 보시겠습니까? (y/N): ');
      if (showMore.toLowerCase() === 'y') {
        console.log('\n📖 전체 배포 기록:');
        console.log(changelog);
      }

    } catch (error) {
      console.error('❌ 기록 조회 실패:', error.message);
    }
  }

  /**
   * 환경 검증
   */
  async validateEnvironment() {
    console.log('\n🩺 환경 검증');
    console.log('-' .repeat(30));

    try {
      console.log('🔍 환경 검증 시작...');
      execSync('node scripts/deploy-enhanced.js --dry-run', { stdio: 'inherit' });
      console.log('✅ 환경 검증 완료!');
    } catch (error) {
      console.error('❌ 환경 검증 실패:', error.message);
    }
  }

  /**
   * 수동 백업 생성
   */
  async createManualBackup() {
    console.log('\n💾 수동 백업 생성');
    console.log('-' .repeat(30));

    try {
      console.log('💾 백업 생성 중...');
      execSync('node scripts/backup-manager.js backup manual', { stdio: 'inherit' });
      console.log('✅ 백업 완료!');
    } catch (error) {
      console.error('❌ 백업 실패:', error.message);
    }
  }

  /**
   * PM2 관리
   */
  async managePM2() {
    console.log('\n🔧 PM2 관리');
    console.log('-' .repeat(30));
    console.log('1. 📊 상태 확인');
    console.log('2. ▶️  시작');
    console.log('3. ⏸️  중지');
    console.log('4. 🔄 재시작');
    console.log('5. 📝 로그 보기');
    console.log('6. 📈 모니터링');
    console.log('0. 🔙 뒤로 가기');

    const choice = await this.promptUser('선택하세요: ');

    try {
      switch (choice) {
        case '1':
          execSync('node scripts/pm2-utils.js status', { stdio: 'inherit' });
          break;
        case '2':
          execSync('node scripts/pm2-utils.js start', { stdio: 'inherit' });
          break;
        case '3':
          execSync('node scripts/pm2-utils.js stop', { stdio: 'inherit' });
          break;
        case '4':
          execSync('node scripts/pm2-utils.js restart', { stdio: 'inherit' });
          break;
        case '5':
          execSync('node scripts/pm2-utils.js logs 50', { stdio: 'inherit' });
          break;
        case '6':
          console.log('📈 모니터링 시작 (Ctrl+C로 종료)');
          execSync('node scripts/pm2-utils.js monitor', { stdio: 'inherit' });
          break;
        case '0':
          return;
        default:
          console.log('❌ 잘못된 선택입니다.');
      }
    } catch (error) {
      console.error('❌ PM2 관리 실패:', error.message);
    }

    await this.promptUser('\n계속하려면 Enter를 누르세요...');
    await this.managePM2();
  }

  /**
   * 변경로그 보기
   */
  async showChangelog() {
    console.log('\n📝 변경로그 보기');
    console.log('-' .repeat(30));

    try {
      if (!fs.existsSync(CONFIG.CHANGELOG_FILE)) {
        console.log('📝 변경로그가 없습니다.');
        return;
      }

      const changelog = fs.readFileSync(CONFIG.CHANGELOG_FILE, 'utf8');
      console.log('\n📖 변경로그:');
      console.log(changelog);

    } catch (error) {
      console.error('❌ 변경로그 읽기 실패:', error.message);
    }
  }

  /**
   * 사용자 입력 프롬프트
   */
  promptUser(question) {
    return new Promise(resolve => {
      this.rl.question(question, answer => {
        resolve(answer);
      });
    });
  }

  /**
   * CLI 종료
   */
  close() {
    this.rl.close();
  }
}

// 메인 실행
if (require.main === module) {
  const cli = new DeploymentCLI();
  
  // 종료 시 readline 정리
  process.on('SIGINT', () => {
    console.log('\n👋 안녕히 가세요!');
    cli.close();
    process.exit(0);
  });
  
  // 메인 메뉴 시작
  cli.showMainMenu().catch(error => {
    console.error('❌ CLI 오류:', error);
    cli.close();
    process.exit(1);
  });
}

module.exports = DeploymentCLI; 