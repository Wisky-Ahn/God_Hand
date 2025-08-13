/**
 * Discord 클라이언트 설정
 * GodHand Bot의 Discord.js 클라이언트 초기화
 */
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const logger = require('../utils/logger');
const { createErrorHandler } = require('../utils/errorHandler');

// 환경변수 로드
require('dotenv').config();

/**
 * Discord 클라이언트 인스턴스 생성
 * 음성 활동 추적과 메시지 모니터링을 위한 인텐트 설정
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,                    // 서버 정보
    GatewayIntentBits.GuildMessages,             // 메시지 읽기
    GatewayIntentBits.MessageContent,            // 메시지 내용 읽기
    GatewayIntentBits.GuildVoiceStates,          // 음성 상태 변경 감지
    GatewayIntentBits.GuildMessageReactions,     // 리액션 추적
    GatewayIntentBits.GuildMembers,              // 멤버 정보 (권한 확인용)
    GatewayIntentBits.GuildPresences             // 사용자 상태 (온라인/오프라인)
  ],
  partials: [
    Partials.Message,                            // 오래된 메시지 처리
    Partials.Channel,                            // 채널 정보
    Partials.Reaction,                           // 리액션 정보
    Partials.User,                               // 사용자 정보
    Partials.GuildMember                         // 서버 멤버 정보
  ]
});

/**
 * 클라이언트에 컬렉션 추가
 * 명령어와 기타 데이터 저장용
 */
client.commands = new Collection();      // 슬래시 명령어 저장
client.voiceSessions = new Collection(); // 현재 음성 세션 추적
client.musicQueues = new Collection();   // 서버별 음악 큐

/**
 * 에러 핸들러 초기화
 */
client.errorHandler = createErrorHandler(client);
// AFK 트래커 제거됨
client.seasonData = new Map();           // 시즌 데이터 캐시

/**
 * 클라이언트 이벤트 리스너
 */

// 봇이 준비되었을 때
client.once('ready', () => {
  logger.info(`🤖 ${client.user.tag} 봇이 성공적으로 로그인되었습니다!`);
  logger.info(`📊 ${client.guilds.cache.size}개의 서버에서 활동 중`);
  
  // 봇 상태 설정
  client.user.setActivity('음성 활동 추적 중...', { type: 'WATCHING' });
});

// 에러 처리
client.on('error', (error) => {
  logger.error('Discord 클라이언트 에러:', { error: error.message, stack: error.stack });
});

// 연결 해제 시
client.on('disconnect', () => {
  logger.warn('Discord 연결이 해제되었습니다.');
});

// 재연결 시
client.on('reconnecting', () => {
  logger.info('Discord에 재연결을 시도합니다...');
});

// 경고 메시지 처리
client.on('warn', (warning) => {
  logger.warn('Discord 경고:', warning);
});

/**
 * 프로세스 종료 시 정리 작업
 */
process.on('SIGINT', async () => {
  logger.info('봇 종료 신호를 받았습니다. 정리 작업을 시작합니다...');
  
  try {
    // 음성 연결 정리
    if (client.voice && client.voice.connections) {
      client.voice.connections.forEach(connection => {
        connection.destroy();
      });
    }
    
    // 활성 세션 데이터 저장
    if (client.voiceSessions.size > 0) {
      logger.info(`${client.voiceSessions.size}개의 활성 음성 세션 데이터를 저장합니다...`);
      // TODO: 데이터베이스에 세션 데이터 저장 로직 추가
    }
    
    // 클라이언트 종료
    await client.destroy();
    logger.info('봇이 안전하게 종료되었습니다.');
    
  } catch (error) {
    logger.error('봇 종료 중 에러 발생:', error);
  } finally {
    process.exit(0);
  }
});

/**
 * 메모리 사용량 모니터링 (라즈베리파이 최적화)
 */
if (process.env.OPTIMIZATION_MODE === 'raspberry_pi') {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    if (memUsageMB > 300) { // 300MB 이상 사용 시 경고
      logger.warn(`높은 메모리 사용량 감지: ${memUsageMB}MB`);
      
      // 메모리 정리 시도
      if (global.gc) {
        global.gc();
        logger.info('가비지 컬렉션 실행됨');
      }
    }
  }, 60000); // 1분마다 체크
}

module.exports = client; 