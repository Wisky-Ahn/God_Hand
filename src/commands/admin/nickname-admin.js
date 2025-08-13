/**
 * 관리자용 닉네임 동기화 명령어
 * 특정 사용자 또는 전체 서버의 닉네임을 수동으로 동기화
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const logger = require('../../utils/logger');
const { forceNicknameSync } = require('../../utils/nickname');

class NicknameAdminCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('닉네임동기화')
      .setDescription('특정 사용자 또는 전체 서버의 닉네임을 강제 동기화합니다')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(option =>
        option.setName('사용자')
          .setDescription('동기화할 특정 사용자 (미지정 시 전체 서버)')
          .setRequired(false)
      );
  }

  /**
   * 명령어 실행
   * @param {CommandInteraction} interaction - Discord 상호작용
   */
  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser('사용자');
      
      if (targetUser) {
        // 특정 사용자 동기화
        await this.syncSingleUser(interaction, targetUser);
      } else {
        // 전체 서버 동기화
        await this.syncAllUsers(interaction);
      }

    } catch (error) {
      logger.error('닉네임 동기화 명령어 에러:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('❌ 오류 발생')
        .setDescription('닉네임 동기화 작업 중 오류가 발생했습니다.')
        .addFields({
          name: '에러 내용',
          value: error.message || '알 수 없는 오류',
          inline: false
        })
        .setTimestamp();

      if (interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  }



  /**
   * 특정 사용자 닉네임 동기화
   * @param {CommandInteraction} interaction - Discord 상호작용
   * @param {User} targetUser - 대상 사용자
   */
  async syncSingleUser(interaction, targetUser) {
    try {
      const result = await forceNicknameSync(interaction.guild, targetUser.id);
      
      const embed = new EmbedBuilder()
        .setColor(result.success ? '#2ecc71' : '#e74c3c')
        .setTitle(`🔄 사용자 닉네임 동기화`)
        .addFields(
          { name: '대상 사용자', value: `<@${targetUser.id}>`, inline: true },
          { name: '결과', value: result.success ? '✅ 성공' : '❌ 실패', inline: true }
        )
        .setTimestamp();

      if (result.success) {
        embed.addFields(
          { name: '현재 표시명', value: result.newDisplayName, inline: true }
        );
      } else {
        embed.addFields(
          { name: '에러 내용', value: result.error, inline: false }
        );
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error(`사용자 닉네임 동기화 실패: ${targetUser.id}`, error);
      throw error;
    }
  }

  /**
   * 전체 서버 닉네임 동기화
   * @param {CommandInteraction} interaction - Discord 상호작용
   */
  async syncAllUsers(interaction) {
    try {
      const scheduler = interaction.client.nicknameSyncScheduler;
      
      if (!scheduler) {
        throw new Error('닉네임 동기화 스케줄러가 초기화되지 않았습니다');
      }

      const statusEmbed = new EmbedBuilder()
        .setColor('#f39c12')
        .setTitle('🔄 전체 서버 닉네임 동기화 시작')
        .setDescription('모든 사용자의 닉네임을 동기화하고 있습니다...')
        .addFields({
          name: '⏱️ 예상 소요 시간',
          value: '서버 크기에 따라 1-5분 정도 소요될 수 있습니다',
          inline: false
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [statusEmbed] });

      // 수동 동기화 실행
      const result = await scheduler.triggerManualSync(interaction.guild.id);

      const resultEmbed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('✅ 전체 서버 닉네임 동기화 완료')
        .addFields(
          { name: '총 사용자', value: result.totalUsers.toString(), inline: true },
          { name: '성공', value: result.successCount.toString(), inline: true },
          { name: '실패', value: result.errorCount.toString(), inline: true },
          { name: '성공률', value: `${Math.round((result.successCount / Math.max(result.totalUsers, 1)) * 100)}%`, inline: true }
        )
        .setTimestamp();

      if (result.errors && result.errors.length > 0) {
        const errorSample = result.errors.slice(0, 3).map(err => err.error || '알 수 없는 오류').join('\n');
        resultEmbed.addFields({
          name: '⚠️ 에러 샘플',
          value: errorSample,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [resultEmbed] });

    } catch (error) {
      logger.error('전체 서버 닉네임 동기화 실패:', error);
      throw error;
    }
  }

}

module.exports = new NicknameAdminCommand();
