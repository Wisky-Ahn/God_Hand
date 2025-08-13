#!/usr/bin/env node

/**
 * GodHand Discord Bot 배포 스크립트
 * Raspberry Pi 환경에 최적화된 배포 및 프로세스 관리
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
  SCRIPT_DIR: path.join(process.cwd(), 'scripts'),
  MAX_BACKUP_COUNT: 7, // 최대 백업 파일 개수
  MEMORY_THRESHOLD: 0.85 // 메모리 사용률 임계치 (85%)
};

/**
 * 시스템 리소스 확인 함수
 * Raspberry Pi의 제한된 리소스를 고려한 배포 전 검증
 */
function checkSystemResources() {
  console.log('🔍 시스템 리소스 확인 중...');
  
  try {
    // 메모리 사용률 확인
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const memoryUsage = (totalMemory - freeMemory) / totalMemory;
    
    console.log(`💾 메모리 사용률: ${(memoryUsage * 100).toFixed(1)}%`);
    
    if (memoryUsage > CONFIG.MEMORY_THRESHOLD) {
      console.warn('⚠️  높은 메모리 사용률 감지. 배포를 계속하시겠습니까?');
    }
    
    // 디스크 공간 확인
    const diskUsage = execSync('df -h /', { encoding: 'utf8' });
    console.log('💿 디스크 사용률:');
    console.log(diskUsage);
    
    // Node.js 버전 확인
    const nodeVersion = process.version;
    console.log(`🟢 Node.js 버전: ${nodeVersion}`);
    
    // PM2 설치 확인
    try {
      const pm2Version = execSync('pm2 --version', { encoding: 'utf8' }).trim();
      console.log(`⚙️  PM2 버전: ${pm2Version}`);
    } catch (error) {
      console.error('❌ PM2가 설치되지 않았습니다. npm install -g pm2 를 실행하세요.');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ 시스템 리소스 확인 실패:', error.message);
    return false;
  }
}

/**
 * 백업 디렉토리 생성 및 관리
 */
function ensureDirectories() {
  console.log('📁 필요한 디렉토리 생성 중...');
  
  const directories = [CONFIG.BACKUP_DIR, CONFIG.LOG_DIR, CONFIG.SCRIPT_DIR];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ 디렉토리 생성됨: ${dir}`);
    }
  });
}

/**
 * 데이터베이스 백업 함수
 * 배포 전 안전을 위한 자동 백업
 */
function createDatabaseBackup() {
  console.log('💾 데이터베이스 백업 생성 중...');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
  const backupFile = path.join(CONFIG.BACKUP_DIR, `godhand-backup-${timestamp}-${timeStr}.sql`);
  
  try {
    // 환경 변수에서 데이터베이스 정보 읽기
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || '5432',
      database: process.env.DB_NAME || 'godhand',
      username: process.env.DB_USER || 'godhand'
    };
    
    // pg_dump를 사용한 백업 생성
    const backupCommand = `PGPASSWORD="${process.env.DB_PASSWORD}" pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.username} -d ${dbConfig.database} > "${backupFile}"`;
    
    execSync(backupCommand, { stdio: 'inherit' });
    
    // 백업 파일 압축
    execSync(`gzip "${backupFile}"`, { stdio: 'inherit' });
    
    console.log(`✅ 데이터베이스 백업 완료: ${backupFile}.gz`);
    
    // 오래된 백업 파일 정리
    cleanupOldBackups();
    
    return `${backupFile}.gz`;
  } catch (error) {
    console.warn('⚠️  데이터베이스 백업 실패:', error.message);
    console.log('⏭️  백업 없이 배포를 계속합니다...');
    return null;
  }
}

/**
 * 오래된 백업 파일 정리
 */
function cleanupOldBackups() {
  try {
    const backupFiles = fs.readdirSync(CONFIG.BACKUP_DIR)
      .filter(file => file.startsWith('godhand-backup-') && file.endsWith('.sql.gz'))
      .map(file => ({
        name: file,
        path: path.join(CONFIG.BACKUP_DIR, file),
        stats: fs.statSync(path.join(CONFIG.BACKUP_DIR, file))
      }))
      .sort((a, b) => b.stats.mtime - a.stats.mtime);
    
    if (backupFiles.length > CONFIG.MAX_BACKUP_COUNT) {
      const filesToDelete = backupFiles.slice(CONFIG.MAX_BACKUP_COUNT);
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        console.log(`🗑️  오래된 백업 파일 삭제: ${file.name}`);
      });
    }
  } catch (error) {
    console.warn('⚠️  백업 파일 정리 실패:', error.message);
  }
}

/**
 * PM2를 사용한 애플리케이션 배포
 */
function deployWithPM2() {
  console.log('🚀 PM2를 사용한 애플리케이션 배포 시작...');
  
  try {
    // 현재 실행 중인 앱 확인
    let isRunning = false;
    try {
      const pmList = execSync('pm2 jlist', { encoding: 'utf8' });
      const apps = JSON.parse(pmList);
      isRunning = apps.some(app => app.name === CONFIG.APP_NAME);
    } catch (error) {
      console.log('📝 PM2 프로세스 목록을 확인할 수 없습니다. 새로 시작합니다.');
    }
    
    if (isRunning) {
      console.log('🔄 기존 애플리케이션 중지 중...');
      execSync(`pm2 stop ${CONFIG.APP_NAME}`, { stdio: 'inherit' });
      execSync(`pm2 delete ${CONFIG.APP_NAME}`, { stdio: 'inherit' });
    }
    
    // 새 애플리케이션 시작
    console.log('▶️  새 애플리케이션 시작 중...');
    execSync('pm2 start ecosystem.config.js --env production', { stdio: 'inherit' });
    
    // PM2 설정 저장
    execSync('pm2 save', { stdio: 'inherit' });
    
    // 애플리케이션 상태 확인
    setTimeout(() => {
      try {
        execSync('pm2 status', { stdio: 'inherit' });
        console.log('✅ 애플리케이션 배포 완료!');
      } catch (error) {
        console.error('❌ 애플리케이션 상태 확인 실패');
      }
    }, 3000);
    
    return true;
  } catch (error) {
    console.error('❌ PM2 배포 실패:', error.message);
    return false;
  }
}

/**
 * PM2 시작 스크립트 설정
 * 시스템 재부팅 시 자동 시작을 위한 설정
 */
function setupPM2Startup() {
  console.log('🔧 PM2 시작 스크립트 설정 중...');
  
  try {
    // 기존 startup 스크립트 확인
    try {
      execSync('pm2 unstartup', { stdio: 'pipe' });
    } catch (error) {
      // 기존 스크립트가 없어도 문제없음
    }
    
    // 새 startup 스크립트 생성
    const startupOutput = execSync('pm2 startup', { encoding: 'utf8' });
    console.log('📋 PM2 startup 명령어:');
    console.log(startupOutput);
    
    // sudo 명령어 추출 및 실행
    const sudoMatch = startupOutput.match(/sudo\s+(.+)/);
    if (sudoMatch && sudoMatch[1]) {
      console.log('🔐 관리자 권한으로 startup 스크립트 설치 중...');
      execSync(`sudo ${sudoMatch[1]}`, { stdio: 'inherit' });
      console.log('✅ PM2 startup 스크립트 설치 완료!');
      return true;
    } else {
      console.warn('⚠️  PM2 startup 명령어를 추출할 수 없습니다.');
      return false;
    }
  } catch (error) {
    console.error('❌ PM2 startup 설정 실패:', error.message);
    console.log('💡 수동으로 다음 명령어를 실행하세요: pm2 startup');
    return false;
  }
}

/**
 * 배포 후 상태 확인
 */
function verifyDeployment() {
  console.log('🔍 배포 상태 확인 중...');
  
  try {
    // PM2 상태 확인
    const pmStatus = execSync('pm2 jlist', { encoding: 'utf8' });
    const apps = JSON.parse(pmStatus);
    const godhandApp = apps.find(app => app.name === CONFIG.APP_NAME);
    
    if (godhandApp) {
      console.log(`✅ 애플리케이션 상태: ${godhandApp.pm2_env.status}`);
      console.log(`📊 메모리 사용량: ${Math.round(godhandApp.memory / 1024 / 1024)}MB`);
      console.log(`🔄 재시작 횟수: ${godhandApp.pm2_env.restart_time}`);
      return true;
    } else {
      console.error('❌ 애플리케이션을 찾을 수 없습니다.');
      return false;
    }
  } catch (error) {
    console.error('❌ 배포 상태 확인 실패:', error.message);
    return false;
  }
}

/**
 * 메인 배포 함수
 */
async function deploy() {
  console.log('🎯 GodHand Discord Bot 배포 시작');
  console.log('=' * 50);
  
  try {
    // 1. 시스템 리소스 확인
    if (!checkSystemResources()) {
      console.error('❌ 시스템 리소스 확인 실패. 배포를 중단합니다.');
      process.exit(1);
    }
    
    // 2. 필요한 디렉토리 생성
    ensureDirectories();
    
    // 3. 데이터베이스 백업
    const backupFile = createDatabaseBackup();
    if (backupFile) {
      console.log(`💾 백업 파일: ${backupFile}`);
    }
    
    // 4. PM2로 애플리케이션 배포
    const deployed = deployWithPM2();
    if (!deployed) {
      console.error('❌ 배포 실패!');
      process.exit(1);
    }
    
    // 5. PM2 startup 스크립트 설정
    setupPM2Startup();
    
    // 6. 배포 상태 확인
    setTimeout(() => {
      if (verifyDeployment()) {
        console.log('🎉 배포가 성공적으로 완료되었습니다!');
        console.log('📱 Discord에서 봇의 상태를 확인해보세요.');
      }
    }, 5000);
    
  } catch (error) {
    console.error('💥 배포 중 오류 발생:', error.message);
    process.exit(1);
  }
}

// CLI 인터페이스
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
GodHand Discord Bot 배포 스크립트

사용법:
  node scripts/deploy.js [옵션]

옵션:
  --help, -h     이 도움말 표시
  --check        시스템 리소스만 확인
  --backup-only  백업만 실행
  --verify       배포 상태만 확인

예시:
  node scripts/deploy.js                # 전체 배포 실행
  node scripts/deploy.js --check        # 시스템 확인만
  node scripts/deploy.js --backup-only  # 백업만 실행
    `);
    process.exit(0);
  }
  
  if (args.includes('--check')) {
    checkSystemResources();
    process.exit(0);
  }
  
  if (args.includes('--backup-only')) {
    ensureDirectories();
    createDatabaseBackup();
    process.exit(0);
  }
  
  if (args.includes('--verify')) {
    verifyDeployment();
    process.exit(0);
  }
  
  // 기본 배포 실행
  deploy().catch(error => {
    console.error('💥 배포 실패:', error);
    process.exit(1);
  });
}

module.exports = {
  deploy,
  checkSystemResources,
  createDatabaseBackup,
  deployWithPM2,
  setupPM2Startup,
  verifyDeployment
}; 