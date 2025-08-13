#!/usr/bin/env node

/**
 * PM2 유틸리티 스크립트
 * GodHand Discord Bot의 PM2 프로세스 관리를 위한 도구
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_NAME = 'godhand-bot';

/**
 * PM2 프로세스 상태 확인
 */
function getProcessStatus() {
  try {
    const output = execSync('pm2 jlist', { encoding: 'utf8' });
    const processes = JSON.parse(output);
    const godhandProcess = processes.find(proc => proc.name === APP_NAME);
    
    if (godhandProcess) {
      const env = godhandProcess.pm2_env;
      const monit = godhandProcess.monit;
      
      return {
        name: godhandProcess.name,
        pid: env.pm_id,
        status: env.status,
        restarts: env.restart_time,
        uptime: new Date(env.pm_uptime).toLocaleString('ko-KR'),
        memory: `${Math.round(monit.memory / 1024 / 1024)}MB`,
        cpu: `${monit.cpu}%`,
        version: env.version || 'unknown'
      };
    }
    
    return null;
  } catch (error) {
    console.error('PM2 상태 확인 실패:', error.message);
    return null;
  }
}

/**
 * 프로세스 상태를 컬러풀하게 출력
 */
function displayStatus() {
  console.log('\n🤖 GodHand Discord Bot 상태');
  console.log('=' .repeat(40));
  
  const status = getProcessStatus();
  
  if (!status) {
    console.log('❌ 봇이 실행되고 있지 않습니다.');
    console.log('💡 다음 명령어로 봇을 시작하세요: npm run start');
    return;
  }
  
  // 상태에 따른 이모지 설정
  const statusEmoji = {
    'online': '🟢',
    'stopped': '🔴',
    'stopping': '🟡',
    'errored': '💥',
    'launching': '🚀'
  };
  
  console.log(`${statusEmoji[status.status] || '❓'} 상태: ${status.status}`);
  console.log(`🆔 프로세스 ID: ${status.pid}`);
  console.log(`🔄 재시작 횟수: ${status.restarts}`);
  console.log(`⏰ 시작 시간: ${status.uptime}`);
  console.log(`💾 메모리 사용량: ${status.memory}`);
  console.log(`⚡ CPU 사용률: ${status.cpu}`);
  console.log(`📦 버전: ${status.version}`);
  
  console.log('\n📊 실시간 로그 보기: pm2 logs ' + APP_NAME);
  console.log('🔧 상세 모니터링: pm2 monit');
}

/**
 * 프로세스 재시작
 */
function restartProcess() {
  console.log('🔄 봇 재시작 중...');
  
  try {
    execSync(`pm2 restart ${APP_NAME}`, { stdio: 'inherit' });
    console.log('✅ 봇이 성공적으로 재시작되었습니다.');
    
    // 잠시 후 상태 확인
    setTimeout(() => {
      displayStatus();
    }, 2000);
  } catch (error) {
    console.error('❌ 재시작 실패:', error.message);
  }
}

/**
 * 프로세스 중지
 */
function stopProcess() {
  console.log('🛑 봇 중지 중...');
  
  try {
    execSync(`pm2 stop ${APP_NAME}`, { stdio: 'inherit' });
    console.log('✅ 봇이 성공적으로 중지되었습니다.');
  } catch (error) {
    console.error('❌ 중지 실패:', error.message);
  }
}

/**
 * 프로세스 시작
 */
function startProcess() {
  console.log('▶️  봇 시작 중...');
  
  try {
    // ecosystem.config.js 파일 확인
    const configPath = path.join(process.cwd(), 'ecosystem.config.js');
    if (!fs.existsSync(configPath)) {
      console.error('❌ ecosystem.config.js 파일을 찾을 수 없습니다.');
      return;
    }
    
    execSync('pm2 start ecosystem.config.js --env production', { stdio: 'inherit' });
    execSync('pm2 save', { stdio: 'inherit' });
    console.log('✅ 봇이 성공적으로 시작되었습니다.');
    
    // 잠시 후 상태 확인
    setTimeout(() => {
      displayStatus();
    }, 3000);
  } catch (error) {
    console.error('❌ 시작 실패:', error.message);
  }
}

/**
 * 로그 실시간 보기
 */
function showLogs(lines = 50) {
  console.log(`📜 최근 ${lines}줄의 로그를 표시합니다...`);
  console.log('Ctrl+C로 종료할 수 있습니다.');
  console.log('='.repeat(50));
  
  try {
    execSync(`pm2 logs ${APP_NAME} --lines ${lines}`, { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ 로그 확인 실패:', error.message);
  }
}

/**
 * 메모리 사용량 모니터링
 */
function monitorMemory() {
  console.log('📊 메모리 사용량 모니터링 (Ctrl+C로 종료)');
  console.log('='.repeat(50));
  
  const interval = setInterval(() => {
    const status = getProcessStatus();
    if (status) {
      const timestamp = new Date().toLocaleTimeString('ko-KR');
      console.log(`[${timestamp}] 메모리: ${status.memory}, CPU: ${status.cpu}, 재시작: ${status.restarts}`);
    } else {
      console.log('❌ 프로세스를 찾을 수 없습니다.');
      clearInterval(interval);
    }
  }, 5000);
  
  // Ctrl+C 처리
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n✅ 모니터링이 종료되었습니다.');
    process.exit(0);
  });
}

/**
 * 프로세스 완전 삭제
 */
function deleteProcess() {
  console.log('🗑️  봇 프로세스 삭제 중...');
  
  try {
    execSync(`pm2 delete ${APP_NAME}`, { stdio: 'inherit' });
    console.log('✅ 봇 프로세스가 완전히 삭제되었습니다.');
  } catch (error) {
    console.error('❌ 삭제 실패:', error.message);
  }
}

/**
 * PM2 설정 저장
 */
function saveConfig() {
  console.log('💾 PM2 설정 저장 중...');
  
  try {
    execSync('pm2 save', { stdio: 'inherit' });
    console.log('✅ PM2 설정이 저장되었습니다.');
  } catch (error) {
    console.error('❌ 설정 저장 실패:', error.message);
  }
}

/**
 * 도움말 표시
 */
function showHelp() {
  console.log(`
🤖 GodHand Discord Bot PM2 관리 도구

사용법:
  node scripts/pm2-utils.js <명령어>

명령어:
  status     봇 상태 확인
  start      봇 시작
  stop       봇 중지
  restart    봇 재시작
  delete     봇 프로세스 삭제
  logs       로그 보기 (기본: 50줄)
  logs <n>   로그 n줄 보기
  monitor    메모리 사용량 실시간 모니터링
  save       PM2 설정 저장
  help       이 도움말 표시

예시:
  node scripts/pm2-utils.js status     # 상태 확인
  node scripts/pm2-utils.js restart    # 재시작
  node scripts/pm2-utils.js logs 100   # 최근 100줄 로그 보기
  node scripts/pm2-utils.js monitor    # 실시간 모니터링

기타 PM2 명령어:
  pm2 monit                  # PM2 대시보드
  pm2 info ${APP_NAME}       # 상세 정보
  pm2 reload ${APP_NAME}     # 무중단 재시작 (가능한 경우)
  `);
}

// CLI 인터페이스
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'status':
      displayStatus();
      break;
    
    case 'start':
      startProcess();
      break;
    
    case 'stop':
      stopProcess();
      break;
    
    case 'restart':
      restartProcess();
      break;
    
    case 'delete':
      deleteProcess();
      break;
    
    case 'logs':
      const lines = parseInt(args[1]) || 50;
      showLogs(lines);
      break;
    
    case 'monitor':
      monitorMemory();
      break;
    
    case 'save':
      saveConfig();
      break;
    
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    
    default:
      console.log('❓ 알 수 없는 명령어입니다.');
      showHelp();
      process.exit(1);
  }
}

module.exports = {
  getProcessStatus,
  displayStatus,
  restartProcess,
  stopProcess,
  startProcess,
  showLogs,
  monitorMemory,
  deleteProcess,
  saveConfig
}; 