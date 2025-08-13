/**
 * Ping 명령어
 * 봇 응답성 테스트 및 지연시간 확인
 */
const { SlashCommandBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');

class PingCommand extends BaseCommand {
  constructor() {
    const data = new SlashCommandBuilder()
      .setName('핑')
      .setDescription('🏓 봇의 응답 속도와 지연시간을 확인합니다');

    super(data);

    // 설정
    this.category = 'general';
    this.cooldown = 3;
    this.adminOnly = false;
    this.musicCommand = false;
    this.requiresVoiceChannel = false;
  }

  async execute(interaction, validationData) {
    try {
      // 초기 응답 (지연시간 측정을 위해)
      const sent = await interaction.reply({
        content: '🏓 핑 측정 중...',
        fetchReply: true
      });

      // 지연시간 계산
      const botLatency = sent.createdTimestamp - interaction.createdTimestamp;
      const apiLatency = Math.round(interaction.client.ws.ping);

      // 사용자 데이터
      const { userData, guildData } = validationData;

      // 응답 임베드 생성
      const pingEmbed = this.createSuccessEmbed(
        '🏓 퐁!',
        `**🤖 봇 응답 속도:** ${botLatency}ms\n**📡 API 지연시간:** ${apiLatency}ms\n**📊 상태:** ${getStatusEmoji(botLatency, apiLatency)}`,
        {
          footer: `${interaction.user.tag}님이 요청 | 현재 ${userData.current_rank}위 (${userData.current_score}점)`,
          fields: [
            {
              name: '👤 사용자 정보',
              value: `순위: ${userData.current_rank}위\n점수: ${userData.current_score}점`,
              inline: true
            }
          ]
        }
      );

      // 추가 시스템 정보 (개발 모드일 때)
      if (process.env.NODE_ENV === 'development') {
        const memUsage = process.memoryUsage();
        const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);

        pingEmbed.addFields({
          name: '💾 메모리 사용량',
          value: `${memUsageMB}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
          inline: true
        });

        pingEmbed.addFields({
          name: '⏱️ 업타임',
          value: formatUptime(process.uptime()),
          inline: true
        });

        // 라즈베리파이 모드일 때 추가 정보
        if (process.env.OPTIMIZATION_MODE === 'raspberry_pi') {
          pingEmbed.addFields({
            name: '🍓 최적화 모드',
            value: 'Raspberry Pi',
            inline: true
          });
        }
      }

      // 응답 업데이트
      await interaction.editReply({
        content: null,
        embeds: [pingEmbed]
      });

    } catch (error) {
      throw error; // BaseCommand에서 에러 처리
    }
  }
}

/**
 * 지연시간에 따른 상태 이모지 반환
 */
function getStatusEmoji(botLatency, apiLatency) {
  const maxLatency = Math.max(botLatency, apiLatency);

  if (maxLatency < 100) {
    return '🟢 매우 좋음';
  } else if (maxLatency < 200) {
    return '🟡 좋음';
  } else if (maxLatency < 500) {
    return '🟠 보통';
  } else {
    return '🔴 느림';
  }
}

/**
 * 업타임을 읽기 쉬운 형식으로 변환
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0) parts.push(`${minutes}분`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}초`);

  return parts.join(' ');
}

// 인스턴스 생성 및 내보내기
const command = new PingCommand();

module.exports = {
  data: command.data,
  category: command.category,
  cooldown: command.cooldown,
  adminOnly: command.adminOnly,
  musicCommand: command.musicCommand,
  requiresVoiceChannel: command.requiresVoiceChannel,
  execute: (interaction) => command.run(interaction)
}; 