/**
 * 슬래시 명령어 배포 스크립트
 * Discord API에 명령어 등록
 */
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// 환경변수 로드
require('dotenv').config();

/**
 * 필수 환경변수 검증
 */
if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  logger.error('DISCORD_TOKEN과 DISCORD_CLIENT_ID가 설정되어야 합니다.');
  process.exit(1);
}

/**
 * 명령어 수집
 */
const commands = [];
const commandsPath = path.join(__dirname, '../commands');
const commandFolders = ['user', 'admin'];

logger.info('명령어 수집 중...');

for (const folder of commandFolders) {
  const folderPath = path.join(commandsPath, folder);
  
  if (fs.existsSync(folderPath)) {
    const commandFiles = fs.readdirSync(folderPath)
      .filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
      try {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);
        
        if (command.data && typeof command.execute === 'function') {
          commands.push(command.data.toJSON());
          logger.info(`✅ 명령어 추가됨: /${command.data.name} (${folder})`);
        } else {
          logger.warn(`⚠️ 잘못된 명령어 구조: ${folder}/${file}`);
        }
      } catch (error) {
        logger.error(`❌ 명령어 로드 실패: ${folder}/${file}`, error);
      }
    }
  } else {
    logger.warn(`⚠️ 폴더를 찾을 수 없음: ${folder}`);
  }
}

/**
 * Discord API 클라이언트 생성
 */
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

/**
 * 명령어 배포 함수
 */
async function deployCommands() {
  try {
    logger.info(`🚀 ${commands.length}개의 슬래시 명령어 배포를 시작합니다...`);
    
    // 개발 환경: 특정 길드에만 등록 (즉시 적용)
    if (process.env.DISCORD_GUILD_ID && process.env.NODE_ENV === 'development') {
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commands }
      );
      
      logger.info(`✅ ${data.length}개의 길드 명령어가 성공적으로 등록되었습니다! (서버: ${process.env.DISCORD_GUILD_ID})`);
      
    } 
    // 프로덕션 환경: 전역 명령어 등록 (최대 1시간 소요)
    else {
      const data = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
      
      logger.info(`✅ ${data.length}개의 전역 명령어가 성공적으로 등록되었습니다!`);
      logger.info('📝 전역 명령어는 모든 서버에 적용되는데 최대 1시간이 걸릴 수 있습니다.');
    }
    
    // 등록된 명령어 목록 출력
    if (commands.length > 0) {
      logger.info('\n📋 등록된 명령어 목록:');
      commands.forEach(cmd => {
        logger.info(`   • /${cmd.name} - ${cmd.description}`);
      });
    }
    
  } catch (error) {
    logger.error('❌ 명령어 배포 중 에러 발생:', error);
    
    // 구체적인 에러 메시지 제공
    if (error.code === 50001) {
      logger.error('권한 부족: 봇이 해당 서버에 있는지 확인하세요.');
    } else if (error.code === 50035) {
      logger.error('잘못된 양식: 명령어 데이터를 확인하세요.');
    } else if (error.status === 401) {
      logger.error('인증 실패: Discord 토큰을 확인하세요.');
    }
    
    process.exit(1);
  }
}

/**
 * 스크립트 실행
 */
if (require.main === module) {
  deployCommands();
}

module.exports = { deployCommands }; 