/**
 * GuildCreate 이벤트 핸들러
 * 봇이 새로운 서버에 참가할 때 활동 추적 및 시스템 초기화
 */
const logger = require('../utils/logger');
const dbUtils = require('../services/database/utils');
const { initialize: initializeSeasonSystem } = require('../services/season');

module.exports = {
  name: 'guildCreate',
  once: false,
  
  async execute(guild, client) {
    try {
      logger.info(`🆕 새로운 서버 참가: ${guild.name} (ID: ${guild.id})`);
      logger.info(`👥 멤버 수: ${guild.memberCount}명`);

      // 길드 데이터베이스 초기화
      await initializeGuildDatabase(guild);

      // 기존 멤버들을 데이터베이스에 등록
      await registerExistingMembers(guild);

      // 현재 음성 채널 사용자들의 세션 시작
      await initializeVoiceSessions(guild, client);

      // 시즌 시스템 초기화 (길드별)
      await initializeGuildSeason(guild);

      // 환영 메시지 (시스템 채널이 있는 경우)
      await sendWelcomeMessage(guild);

      logger.info(`✅ 서버 초기화 완료: ${guild.name}`);
      logger.info(`📊 활동 추적이 시작되었습니다!`);

    } catch (error) {
      logger.error(`❌ 서버 초기화 실패: ${guild.name}`, error);
    }
  }
};

/**
 * 길드 데이터베이스 초기화
 */
async function initializeGuildDatabase(guild) {
  try {
    // 길드 정보 생성
    await dbUtils.findOrCreateGuild(guild.id, {
      name: guild.name,
      memberCount: guild.memberCount,
      ownerId: guild.ownerId,
      description: guild.description,
      joinedAt: new Date()
    });

    logger.info(`🗄️ 길드 데이터베이스 초기화 완료: ${guild.name}`);

  } catch (error) {
    logger.error('길드 데이터베이스 초기화 실패:', error);
    throw error;
  }
}

/**
 * 기존 멤버들을 데이터베이스에 등록
 */
async function registerExistingMembers(guild) {
  try {
    // 모든 멤버 정보 가져오기 (큰 서버의 경우 청크 단위로)
    await guild.members.fetch();

    let registeredCount = 0;

    for (const [memberId, member] of guild.members.cache) {
      // 봇은 제외
      if (member.user.bot) continue;

      try {
        await dbUtils.findOrCreateUser(guild.id, member.user.id, {
          username: member.user.username,
          discriminator: member.user.discriminator,
          displayName: member.nickname || member.displayName || member.user.username,
          joinedAt: member.joinedAt
        });

        registeredCount++;

      } catch (error) {
        logger.warn(`사용자 등록 실패: ${member.user.tag}`, error);
      }
    }

    logger.info(`👥 기존 멤버 등록 완료: ${registeredCount}/${guild.memberCount}명`);

  } catch (error) {
    logger.error('기존 멤버 등록 실패:', error);
    throw error;
  }
}

/**
 * 현재 음성 채널 사용자들의 세션 시작
 */
async function initializeVoiceSessions(guild, client) {
  try {
    let voiceSessionCount = 0;

    // 모든 음성 채널 확인
    guild.channels.cache
      .filter(channel => channel.type === 2) // GUILD_VOICE
      .forEach(channel => {
        if (channel.members.size > 0) {
          channel.members.forEach(member => {
            // 봇이 아닌 사용자만
            if (!member.user.bot) {
              // 음성 세션 시작 로직
              const sessionId = `${guild.id}-${member.id}`;
              
              if (!client.voiceSessions) {
                client.voiceSessions = new Map();
              }

              client.voiceSessions.set(sessionId, {
                userId: member.id,
                guildId: guild.id,
                channelId: channel.id,
                joinTime: new Date(),
                isAfk: false
              });

              voiceSessionCount++;
            }
          });
        }
      });

    if (voiceSessionCount > 0) {
      logger.info(`🎤 음성 세션 초기화 완료: ${voiceSessionCount}명`);
    }

  } catch (error) {
    logger.error('음성 세션 초기화 실패:', error);
    throw error;
  }
}

/**
 * 길드별 시즌 시스템 초기화
 */
async function initializeGuildSeason(guild) {
  try {
    // 해당 길드의 현재 시즌 확인
    const seasonManager = require('../services/season');
    const currentSeason = await seasonManager.getCurrentSeason(guild.id);

    if (!currentSeason) {
      // 새 시즌 생성
      await seasonManager.createNewSeason(guild.id);
      logger.info(`🗓️ 새 시즌 생성: ${guild.name}`);
    } else {
      logger.info(`📅 기존 시즌 연결: ${currentSeason.name} (${guild.name})`);
    }

  } catch (error) {
    logger.error('시즌 시스템 초기화 실패:', error);
    throw error;
  }
}

/**
 * 환영 메시지 발송
 */
async function sendWelcomeMessage(guild) {
  try {
    const systemChannel = guild.systemChannel;
    
    if (systemChannel && systemChannel.permissionsFor(guild.members.me).has('SendMessages')) {
      const welcomeEmbed = {
        color: 0x00ff00,
        title: '🎉 GodHand 봇이 서버에 참가했습니다!',
        description: '**음성 활동 중심의 순위 시스템**과 **음악 재생 기능**을 제공합니다.',
        fields: [
          {
            name: '🎯 핵심 기능',
            value: '• 🎤 음성 활동 우선 점수 시스템\n• 🏆 위계적 음악 제어 권한\n• 📊 실시간 활동 추적\n• 🗓️ 주간 시즌 랭킹',
            inline: false
          },
          {
            name: '🚀 시작하기',
            value: '• `/핑` - 봇 상태 확인\n• `/랭킹` - 현재 순위 확인\n• `/노래 재생` - 음악 재생\n• `/내기록` - 개인 통계',
            inline: false
          },
          {
            name: '📈 점수 시스템',
            value: '**음성 채널 참여**가 가장 높은 점수를 받습니다!\n저녁 시간(18:00-23:00)에는 보너스가 적용됩니다.',
            inline: false
          }
        ],
        footer: {
          text: '활동 추적이 지금부터 시작됩니다! 음성 채널에 참여해보세요 🎤',
          icon_url: guild.members.me.user.displayAvatarURL()
        },
        timestamp: new Date().toISOString()
      };

      await systemChannel.send({ embeds: [welcomeEmbed] });
      logger.info(`💬 환영 메시지 발송 완료: ${guild.name}`);
    }

  } catch (error) {
    logger.warn('환영 메시지 발송 실패:', error);
    // 중요하지 않은 오류이므로 throw하지 않음
  }
} 