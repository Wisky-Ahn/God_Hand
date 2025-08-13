/**
 * 명예의 전당 조회 명령어
 * 전체 시즌을 통합한 라이프타임 랭킹을 보여줍니다.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../services/database');
const BaseCommand = require('../BaseCommand');
const logger = require('../../utils/logger');

class HallOfFameCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('명예의전당')
      .setDescription('명예의 전당 - 전체 기간 TOP 10 랭킹을 보여줍니다')
      .addIntegerOption(option =>
        option.setName('limit')
          .setDescription('표시할 순위 수 (기본값: 10)')
          .setMinValue(5)
          .setMaxValue(20)
          .setRequired(false)
      );
  }

  /**
   * 명령어 실행
   * @param {CommandInteraction} interaction - Discord 상호작용
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();

      const guildId = interaction.guild.id;
      const limit = interaction.options.getInteger('limit') || 10;

      // 라이프타임 랭킹 조회
      const result = await db.query(`
        SELECT 
          u.discord_id,
          u.display_name,
          u.current_score as lifetime_score,
          u.total_voice_time,
          u.total_messages as total_message_count,
          1 as seasons_participated,
          1 as highest_rank,
          0 as total_wins,
          RANK() OVER (ORDER BY u.current_score DESC) as rank
        FROM users u
        WHERE u.guild_id = $1 
          AND u.current_score > 0
        ORDER BY u.current_score DESC
        LIMIT $2
      `, [guildId, limit]);

      if (result.rows.length === 0) {
        const noDataEmbed = new EmbedBuilder()
          .setColor('#95a5a6')
          .setTitle('🏛️ 명예의 전당')
          .setDescription('아직 명예의 전당 데이터가 없습니다.')
          .addFields({
            name: '💡 참고',
            value: '시즌이 완료되면 라이프타임 기록이 누적됩니다.',
            inline: false
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [noDataEmbed] });
        return;
      }

      // 명예의 전당 임베드 생성
      const hofEmbed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('🏛️ 명예의 전당')
        .setDescription(`**전체 기간 TOP ${result.rows.length}** • 라이프타임 랭킹`)
        .setTimestamp();

      // 전체 통계 요약
      const totalParticipants = result.rows.length;
      const totalSeasons = await this.getTotalSeasonCount(guildId);
      const totalLifetimeScore = result.rows.reduce((sum, user) => sum + parseFloat(user.lifetime_score), 0);
      const avgLifetimeScore = totalLifetimeScore / totalParticipants;

      hofEmbed.addFields({
        name: '📊 전체 통계',
        value: `총 시즌: **${totalSeasons}개**\n참여자: **${totalParticipants}명**\n평균 누적점수: **${Math.round(avgLifetimeScore)}점**`,
        inline: true
      });

      // 명예의 전당 목록 생성
      let hofText = '';
      const rankEmojis = ['👑', '🥇', '🥈', '🥉', '🏅', '🎖️', '🌟', '⭐', '✨', '💎'];

      result.rows.forEach((user, index) => {
        const rankEmoji = rankEmojis[index] || `${user.rank}️⃣`;
        let medal = rankEmoji;
        
        // 특별한 타이틀 부여
        if (index === 0) {
          medal = '👑 **전설**';
        } else if (index === 1) {
          medal = '🥇 **마스터**';
        } else if (index === 2) {
          medal = '🥈 **엘리트**';
        } else if (index < 5) {
          medal = `🥉 **베테랑** ${user.rank}.`;
        } else {
          medal = `**${user.rank}.**`;
        }
        
        // 사용자 이름
        const userName = user.display_name || `<@${user.discord_id}>`;
        
        hofText += `${medal} ${userName}\n`;
        hofText += `└ **${Math.round(user.lifetime_score)}점** • `;
        hofText += `${user.seasons_participated || 0}시즌 참여 • `;
        hofText += `최고 ${user.highest_rank || 'N/A'}위`;
        
        // 우승 횟수 표시
        if (user.total_wins > 0) {
          hofText += ` • 🏆${user.total_wins}승`;
        }
        
        hofText += '\n\n';
      });

      hofEmbed.addFields({
        name: '👑 명예의 전당 순위',
        value: hofText.trim(),
        inline: false
      });

      // 레전드 정보 (1위 사용자 특별 정보)
      if (result.rows.length > 0) {
        const legend = result.rows[0];
        
        // 음성 시간 계산 (초 단위 → 시간/분 변환)
        const totalVoiceSeconds = legend.total_voice_time || 0;
        const totalHours = Math.floor(totalVoiceSeconds / 3600);
        const totalMinutes = Math.floor((totalVoiceSeconds % 3600) / 60);
        const voiceTimeText = totalHours > 0 ? `${totalHours}시간 ${totalMinutes}분` : `${totalMinutes}분`;
        
        hofEmbed.addFields({
          name: '👑 전설의 플레이어',
          value: `${legend.display_name || `<@${legend.discord_id}>`}\n` +
                `• 누적 점수: **${Math.round(legend.lifetime_score)}점**\n` +
                `• 총 음성시간: **${voiceTimeText}**\n` +
                `• 총 메시지: **${legend.total_message_count || 0}개**\n` +
                `• 우승 횟수: **${legend.total_wins || 0}회**`,
          inline: true
        });
      }

      // 사용자의 명예의 전당 순위 표시
      const userRank = result.rows.findIndex(user => user.discord_id === interaction.user.id);
      if (userRank !== -1) {
        const userInfo = result.rows[userRank];
        hofEmbed.addFields({
          name: '👤 내 명예의 전당 순위',
          value: `**${userInfo.rank}위** • ${Math.round(userInfo.lifetime_score)}점\n` +
                `참여 시즌: ${userInfo.seasons_participated || 0}개\n` +
                `최고 순위: ${userInfo.highest_rank || 'N/A'}위`,
          inline: true
        });
      } else {
        // TOP 범위 밖인 경우 실제 순위 조회
        const userRankResult = await db.query(`
          SELECT 
            RANK() OVER (ORDER BY current_score DESC) as rank,
            current_score as lifetime_score,
            1 as seasons_participated,
            1 as highest_rank
          FROM users 
          WHERE guild_id = $1 AND discord_id = $2
        `, [guildId, interaction.user.id]);

        if (userRankResult.rows.length > 0) {
          const userRankInfo = userRankResult.rows[0];
          hofEmbed.addFields({
            name: '👤 내 명예의 전당 순위',
            value: `**${userRankInfo.rank}위** • ${Math.round(userRankInfo.lifetime_score)}점\n` +
                  `참여 시즌: ${userRankInfo.seasons_participated || 0}개\n` +
                  `최고 순위: ${userRankInfo.highest_rank || 'N/A'}위`,
            inline: true
          });
        } else {
          hofEmbed.addFields({
            name: '👤 내 명예의 전당 순위',
            value: '아직 라이프타임 기록이 없습니다\n시즌 완료 후 기록이 누적됩니다',
            inline: true
          });
        }
      }

      // 최근 업적들
      const recentAchievements = []; // 업적 시스템 비활성화
      // const recentAchievements = await this.getRecentAchievements(guildId);
      if (recentAchievements.length > 0) {
        let achievementText = '';
        recentAchievements.forEach(achievement => {
          achievementText += `🏆 ${achievement.description}\n`;
        });

        hofEmbed.addFields({
          name: '🎉 최근 업적',
          value: achievementText.trim() || '최근 업적이 없습니다',
          inline: false
        });
      }

      // Footer 설정 - 서버별 닉네임 우선 적용
      const requesterName = interaction.member.nickname || interaction.member.displayName || interaction.user.username;
      hofEmbed.setFooter({
        text: `전체 ${totalSeasons}시즌 통합 • 요청자: ${requesterName}`,
        iconURL: interaction.user.displayAvatarURL()
      });

      await interaction.editReply({ embeds: [hofEmbed] });

    } catch (error) {
      logger.error('명예의전당 명령어 에러:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('❌ 오류 발생')
        .setDescription('명예의 전당 데이터를 가져오는 중 오류가 발생했습니다.')
        .addFields({
          name: '💡 도움말',
          value: '잠시 후 다시 시도해보세요. 문제가 계속되면 관리자에게 문의하세요.',
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
   * 총 시즌 수 조회 (현재는 임시로 하드코딩)
   */
  async getTotalSeasonCount(guildId) {
    try {
      // seasons 테이블이 없으므로 임시로 0 반환
      // TODO: 향후 seasons 테이블 구현 시 실제 쿼리로 변경
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 최근 업적 조회
   */
  async getRecentAchievements(guildId) {
    try {
      const result = await db.query(`
        SELECT description, created_at
        FROM achievements 
        WHERE guild_id = $1 
        ORDER BY created_at DESC 
        LIMIT 3
      `, [guildId]);
      
      return result.rows || [];
    } catch (error) {
      return [];
    }
  }
}

module.exports = new HallOfFameCommand(); 