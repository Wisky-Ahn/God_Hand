/**
 * 시즌 관리 Admin 명령어
 * 관리자가 시즌을 생성, 완료, 조회할 수 있는 명령어
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const db = require('../../services/database');
const seasonManager = require('../../services/season');
const seasonUtils = require('../../services/season/utils');

class SeasonAdminCommand extends BaseCommand {
  constructor() {
    super();
    
    this.data = new SlashCommandBuilder()
      .setName('시즌관리')
      .setDescription('시즌 관리 명령어 (관리자 전용)')
      .setDefaultMemberPermissions(0) // 관리자만
      .addSubcommand(subcommand =>
        subcommand
          .setName('새시즌')
          .setDescription('새로운 시즌을 강제로 시작합니다')
          .addBooleanOption(option =>
            option
              .setName('확인')
              .setDescription('현재 시즌을 강제 종료하고 새 시즌을 시작하시겠습니까?')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('통계')
          .setDescription('시즌 통계를 표시합니다')
          .addIntegerOption(option =>
            option
              .setName('시즌번호')
              .setDescription('조회할 시즌 번호 (생략 시 현재 시즌)')
              .setMinValue(1)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('점수초기화')
          .setDescription('모든 사용자의 점수를 초기화합니다')
          .addBooleanOption(option =>
            option
              .setName('확인')
              .setDescription('정말로 모든 점수를 초기화하시겠습니까?')
              .setRequired(true)
          )
      );

    this.category = 'admin';
    this.cooldown = 5;
  }

  async execute(interaction) {
    try {
      // 관리자 권한 확인
      if (!this.checkAdminPermission(interaction)) {
        return await interaction.reply({
          content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.',
          ephemeral: true
        });
      }

      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case '새시즌':
          await this.handleNewSeason(interaction);
          break;
        case '통계':
          await this.handleSeasonStats(interaction);
          break;
        case '점수초기화':
          await this.handleResetScores(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ 알 수 없는 하위 명령어입니다.',
            ephemeral: true
          });
      }

    } catch (error) {
      this.logger.error(`시즌관리 명령어 실행 중 에러:`, error);
      
      const errorMessage = {
        content: '❌ 명령어 실행 중 오류가 발생했습니다.',
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }

  /**
   * 새 시즌 강제 생성
   */
  async handleNewSeason(interaction) {
    const confirm = interaction.options.getBoolean('확인');
    
    if (!confirm) {
      return await interaction.reply({
        content: '❌ 확인 옵션을 true로 설정해야 새 시즌을 시작할 수 있습니다.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const oldSeason = seasonManager.getCurrentSeason();
      
      // 강제 시즌 전환 실행
      await seasonManager.forceSeasonTransition();
      
      const newSeason = seasonManager.getCurrentSeason();
      
      const embed = new EmbedBuilder()
        .setTitle('🆕 새 시즌이 시작되었습니다!')
        .setColor(0x00FF00)
        .setDescription('관리자에 의해 새로운 시즌이 강제로 시작되었습니다.')
        .addFields(
          {
            name: '이전 시즌',
            value: oldSeason ? `${oldSeason.name} (완료)` : '없음',
            inline: true
          },
          {
            name: '새 시즌',
            value: `${newSeason.name}`,
            inline: true
          },
          {
            name: '상태',
            value: '✅ 모든 점수가 초기화되었습니다',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      this.logger.error('새 시즌 생성 중 에러:', error);
      await interaction.editReply({
        content: '❌ 새 시즌 생성 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 시즌 통계 표시
   */
  async handleSeasonStats(interaction) {
    await interaction.deferReply();

    try {
      const seasonNumber = interaction.options.getInteger('시즌번호');
      let targetSeason;

      if (seasonNumber) {
        // 특정 시즌 조회
        const result = await db.query(
          'SELECT * FROM seasons WHERE season_number = $1',
          [seasonNumber]
        );
        targetSeason = result.rows[0];
      } else {
        // 현재 시즌
        targetSeason = seasonManager.getCurrentSeason();
      }

      if (!targetSeason) {
        return await interaction.editReply({
          content: '❌ 해당 시즌을 찾을 수 없습니다.'
        });
      }

      // 시즌 정보 포맷팅
      const seasonInfo = seasonUtils.formatSeasonInfo(targetSeason, true);
      const nextSeasonInfo = seasonUtils.predictNextSeason(targetSeason);

      // 시즌 순위 조회
      const rankings = await seasonManager.getSeasonRankings(targetSeason.id, 10);
      const formattedRankings = seasonUtils.formatSeasonRankings(rankings);
      
      // 시즌 통계 집계
      const stats = await seasonUtils.aggregateSeasonStats(targetSeason.id);

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${targetSeason.name} 정보 및 통계`)
        .setColor(0x00A8FF);

      // 현재 시즌 기본 정보 추가
      embed.addFields(
        {
          name: '🏷️ 시즌 이름',
          value: seasonInfo.name,
          inline: true
        },
        {
          name: '🔢 시즌 번호',
          value: `#${seasonInfo.seasonNumber}`,
          inline: true
        },
        {
          name: '📊 상태',
          value: seasonInfo.isActive ? '🟢 활성' : '🔴 비활성',
          inline: true
        },
        {
          name: '📅 기간',
          value: `${seasonInfo.startDate} ~ ${seasonInfo.endDate}`,
          inline: false
        },
        {
          name: '⏰ 남은 시간',
          value: seasonInfo.progress.timeLeftText,
          inline: true
        },
        {
          name: '📈 진행률',
          value: `${seasonInfo.progress.percent}%`,
          inline: true
        }
      );

      // 다음 시즌 정보 추가
      if (nextSeasonInfo) {
        embed.addFields(
          {
            name: '🔮 다음 시즌',
            value: `Season #${nextSeasonInfo.seasonNumber}\n시작 예정: ${nextSeasonInfo.predictedStartDate}`,
            inline: false
          }
        );
      }

      // 구분선 추가
      embed.addFields({
        name: '\u200B',
        value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        inline: false
      });

      // 시즌 통계 추가
      if (stats) {
        embed.addFields(
          {
            name: '👥 참가자',
            value: `총 ${stats.participants.total_participants}명`,
            inline: true
          },
          {
            name: '🎯 활동',
            value: `총 ${stats.activities.total_activities}회`,
            inline: true
          },
          {
            name: '🏆 평균 점수',
            value: `${stats.participants.average_score}점`,
            inline: true
          },
          {
            name: '🔥 최고 점수',
            value: `${stats.participants.highest_score}점`,
            inline: true
          },
          {
            name: '🎤 총 음성 시간',
            value: stats.participants.total_voice_time ? 
              seasonUtils.formatDuration(stats.participants.total_voice_time) : '0분',
            inline: true
          },
          {
            name: '💬 총 메시지',
            value: `${stats.participants.total_messages}개`,
            inline: true
          }
        );
      }

      // 상위 3명 표시
      if (formattedRankings.length > 0) {
        // 순위 정보는 데이터베이스에서 가져온 올바른 displayName 사용
        const rankingText = formattedRankings.slice(0, 3).map(r => 
          `${r.rank}위: ${r.displayName} (${r.score.total}점)`
        ).join('\n');

        embed.addFields({
          name: '🥇 상위 순위',
          value: rankingText || '데이터 없음',
          inline: false
        });
      }

      embed.setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      this.logger.error('시즌 통계 조회 중 에러:', error);
      await interaction.editReply({
        content: '❌ 시즌 통계 조회 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 점수 초기화
   */
  async handleResetScores(interaction) {
    const confirm = interaction.options.getBoolean('확인');
    
    if (!confirm) {
      return await interaction.reply({
        content: '❌ 확인 옵션을 true로 설정해야 점수를 초기화할 수 있습니다.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      // guildData.id (정수) 대신 interaction.guildId (문자열)를 사용
      await seasonManager.resetUserScores(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('🔄 점수 초기화 완료')
        .setColor(0xE74C3C)
        .setDescription('모든 사용자의 점수가 초기화되었습니다.')
        .addFields({
          name: '⚠️ 주의',
          value: '이 작업은 되돌릴 수 없습니다.\n새로운 순위 경쟁이 시작됩니다.',
          inline: false
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      this.logger.error('점수 초기화 중 에러:', error);
      await interaction.editReply({
        content: '❌ 점수 초기화 중 오류가 발생했습니다.'
      });
    }
  }
}

module.exports = new SeasonAdminCommand(); 