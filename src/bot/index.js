/**
 * GodHand Discord Bot - 메인 엔트리 포인트
 * 음성 활동 중심의 순위 시스템과 음악 재생 기능을 제공
 */
const client = require('./client');
const logger = require('../utils/logger');

// 환경변수 로드
require('dotenv').config();

// 글로벌 클라이언트 설정 (음악 서비스에서 사용)
global.discordClient = client;

/**
 * 필수 환경변수 검증
 */
const requiredEnvVars = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error(`필수 환경변수가 설정되지 않았습니다: ${missingEnvVars.join(', ')}`);
  logger.error('`.env` 파일을 확인하거나 `.env.example`을 참고해주세요.');
  process.exit(1);
}

/**
 * 이벤트 핸들러 로드 (새로운 이벤트 시스템 사용)
 */
let eventLoader;
try {
  const EventLoader = require('./events');
  eventLoader = new EventLoader(client);
  
  // 이벤트 로더를 클라이언트에 저장 (나중에 사용하기 위해)
  client.eventLoader = eventLoader;
  
  logger.info('이벤트 로딩 시스템 준비 완료');
} catch (error) {
  logger.error('이벤트 로딩 시스템 초기화 중 에러 발생:', error);
  process.exit(1);
}

/**
 * 명령어 로드
 */
try {
  const fs = require('fs');
  const path = require('path');
  
  // 명령어 디렉토리 경로
  const commandsPath = path.join(__dirname, '../commands');
  const commandFolders = ['user', 'admin'];
  
  let commandCount = 0;
  
  // user와 admin 폴더에서 명령어 로드
  for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    
    if (fs.existsSync(folderPath)) {
      const commandFiles = fs.readdirSync(folderPath)
        .filter(file => file.endsWith('.js'));
      
      for (const file of commandFiles) {
        try {
          const command = require(path.join(folderPath, file));
          
          if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            commandCount++;
            logger.debug(`명령어 로드됨: /${command.data.name} (${folder})`);
          } else {
            logger.warn(`잘못된 명령어 파일: ${folder}/${file}`);
          }
        } catch (error) {
          logger.error(`명령어 로드 실패: ${folder}/${file}`, error);
        }
      }
    }
  }
  
  logger.info(`${commandCount}개의 명령어 로드 완료`);
} catch (error) {
  logger.error('명령어 로드 중 에러 발생:', error);
  process.exit(1);
}

/**
 * 전역 에러 핸들러
 */
process.on('unhandledRejection', (error, promise) => {
  logger.error('처리되지 않은 Promise 거부:', error);
  logger.debug('Promise:', promise);
});

process.on('uncaughtException', (error, origin) => {
  logger.error('처리되지 않은 예외:', error);
  logger.debug('Origin:', origin);
  process.exit(1);
});

/**
 * 봇 로그인
 */
async function startBot() {
  try {
    logger.info('🚀 GodHand Bot 시작 중...');
    
    // 이벤트 핸들러 로드
    if (eventLoader) {
      await eventLoader.loadEvents();
    }
    
    // Discord에 로그인
    await client.login(process.env.DISCORD_TOKEN);
    
  } catch (error) {
    logger.error('봇 로그인 실패:', error);
    
    if (error.code === 'TokenInvalid') {
      logger.error('Discord 토큰이 유효하지 않습니다. DISCORD_TOKEN을 확인해주세요.');
    } else if (error.code === 'DisallowedIntents') {
      logger.error('Discord Developer Portal에서 필요한 인텐트를 활성화해주세요.');
    }
    
    process.exit(1);
  }
}

/**
 * 건강 상태 체크 엔드포인트 (선택사항)
 * 라즈베리파이 모니터링용
 */
if (process.env.ENABLE_HEALTH_CHECK === 'true') {
  const http = require('http');
  
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      const status = {
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        discord: {
          ready: client.isReady(),
          guilds: client.guilds.cache.size,
          ping: client.ws.ping
        },
        timestamp: new Date().toISOString()
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  
  const healthPort = process.env.HEALTH_PORT || 3000;
  healthServer.listen(healthPort, () => {
    logger.info(`건강 상태 체크 서버가 포트 ${healthPort}에서 실행 중`);
  });
}

// 봇 시작
startBot(); 