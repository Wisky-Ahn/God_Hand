/**
 * 현재 시즌 랭킹 조회 명령어
 * 현재 활성 시즌의 TOP 10 순위를 보여줍니다.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../services/database');
const seasonManager = require('../../services/season');
const BaseCommand = require('../BaseCommand');
const logger = require('../../utils/logger');
const { getDisplayName, getDisplayNamesBatch } = require('../../utils/nickname');

class RankingCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('랭킹')
      .setDescription('현재 시즌 TOP 10 순위를 보여줍니다')
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

      // 현재 시즌 정보 가져오기
      const currentSeason = await seasonManager.getCurrentSeason(guildId);
      
      if (!currentSeason) {
        const noSeasonEmbed = new EmbedBuilder()
          .setColor('#95a5a6')
          .setTitle('🏆 시즌 랭킹')
          .setDescription('현재 활성화된 시즌이 없습니다.')
          .addFields({
            name: '💡 참고',
            value: '관리자가 시즌을 시작하면 랭킹이 집계됩니다.',
            inline: false
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [noSeasonEmbed] });
        return;
      }

      // 전체 참여자 수 조회 (점수가 0보다 큰 사용자)
      const totalParticipantsResult = await db.query(`
        SELECT COUNT(DISTINCT u.id) as total_count
        FROM users u
        LEFT JOIN activities a ON u.id = a.user_id 
          AND a.timestamp >= $2 AND a.timestamp <= $3
        WHERE u.guild_id = $1 
          AND COALESCE((
            SELECT SUM(score_awarded) 
            FROM activities 
            WHERE user_id = u.id 
              AND timestamp >= $2 AND timestamp <= $3
          ), 0) > 0
      `, [guildId, currentSeason.start_date, currentSeason.end_date]);

      const totalParticipants = totalParticipantsResult.rows[0].total_count;

      // 현재 시즌 랭킹 조회 (모든 데이터를 activities 테이블에서 Season 기간으로 계산)
      const result = await db.query(`
        SELECT 
          u.discord_id,
          u.display_name,
          COALESCE(season_data.current_score, 0) as current_score,
          COALESCE(season_data.season_voice_time, 0) as total_voice_time,
          COALESCE(season_data.season_messages, 0) as total_messages,
          COALESCE(season_data.season_reactions, 0) as total_reactions_given,
          RANK() OVER (ORDER BY COALESCE(season_data.current_score, 0) DESC) as rank
        FROM users u
        LEFT JOIN (
          SELECT 
            a.user_id,
            SUM(a.score_awarded) as current_score,
            ROUND(SUM(CASE WHEN a.activity_type = 'voice_leave' THEN (a.details->>'duration')::numeric ELSE 0 END) / 60) as season_voice_time,
            COUNT(CASE WHEN a.activity_type = 'message_create' THEN 1 END) as season_messages,
            COUNT(CASE WHEN a.activity_type = 'reaction_add' THEN 1 END) as season_reactions
          FROM activities a 
          WHERE a.timestamp >= $3 AND a.timestamp <= $4
          GROUP BY a.user_id
        ) season_data ON u.id = season_data.user_id
        WHERE u.guild_id = $1 
          AND COALESCE(season_data.current_score, 0) > 0
        ORDER BY COALESCE(season_data.current_score, 0) DESC
        LIMIT $2
      `, [guildId, limit, currentSeason.start_date, currentSeason.end_date]);

      if (result.rows.length === 0) {
        const noDataEmbed = new EmbedBuilder()
          .setColor('#95a5a6')
          .setTitle(`🏆 시즌 ${currentSeason.name} 랭킹`)
          .setDescription('아직 랭킹 데이터가 없습니다.')
          .addFields({
            name: '💡 활동해보세요!',
            value: '• 음성 채널 참여\n• 메시지 작성\n• 반응 달기\n• 음악 재생',
            inline: false
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [noDataEmbed] });
        return;
      }

      // 랭킹 임베드 생성
      const rankingEmbed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle(`🏆 시즌 ${currentSeason.name} 랭킹`)
        .setDescription(`**TOP ${result.rows.length}** • 총 참여자: ${totalParticipants}명`)
        .setTimestamp();

      // 시즌 정보 추가
      const startDate = new Date(currentSeason.start_date).toLocaleDateString('ko-KR');
      const endDate = new Date(currentSeason.end_date).toLocaleDateString('ko-KR');
      const now = new Date();
      const timeLeft = Math.ceil((new Date(currentSeason.end_date) - now) / (1000 * 60 * 60 * 24));

      rankingEmbed.addFields({
        name: '📅 시즌 정보',
        value: `시작: ${startDate}\n종료: ${endDate}\n남은 기간: **${timeLeft}일**`,
        inline: true
      });

      // 랭킹 목록 생성 - 새로운 닉네임 시스템 사용
      let rankingText = '';
      const rankEmojis = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

      // 모든 사용자의 닉네임을 배치로 가져오기 (성능 최적화)
      const discordIds = result.rows.map(user => user.discord_id);
      const displayNames = await getDisplayNamesBatch(interaction.guild, discordIds, {
        fallback: 'Unknown User'
      });

      for (const [index, user] of result.rows.entries()) {
        const rankEmoji = rankEmojis[index] || `${user.rank}️⃣`;
        const medal = index < 3 ? rankEmoji : `**${user.rank}.**`;
        
        // 배치에서 가져온 표시명 사용
        const userName = displayNames.get(user.discord_id) || user.display_name || `<@${user.discord_id}>`;
        
        // 음성 시간 계산 (이미 분 단위로 계산됨)
        const totalMinutes = user.total_voice_time || 0;
        const voiceHours = Math.floor(totalMinutes / 60);
        const voiceMinutes = totalMinutes % 60;
        
        rankingText += `${medal} ${userName}\n`;
        rankingText += `└ **${Math.round(user.current_score)}점** • `;
        rankingText += `음성 ${voiceHours > 0 ? `${voiceHours}시간 ` : ''}${voiceMinutes}분 • `;
        rankingText += `메시지 ${user.total_messages}개 • `;
        rankingText += `반응 ${user.total_reactions_given}개\n\n`;
      }

      rankingEmbed.addFields({
        name: '🏅 순위 목록',
        value: rankingText.trim(),
        inline: false
      });

      // 통계 요약
      const totalScore = result.rows.reduce((sum, user) => sum + parseFloat(user.current_score), 0);
      const avgScore = totalScore / result.rows.length;
      const topUser = result.rows[0];

      rankingEmbed.addFields({
        name: '📊 통계 요약',
        value: `평균 점수: **${Math.round(avgScore)}점**\n최고 점수: **${Math.round(topUser.current_score)}점**`,
        inline: true
      });

      // 사용자의 현재 순위 표시 (점수 > 0인 사용자만 대상으로 순위 계산)
      const userRankResult = await db.query(`
        WITH all_season_scores AS (
          SELECT 
            u.discord_id,
            COALESCE(SUM(a.score_awarded), 0) as current_score
          FROM users u
          LEFT JOIN activities a ON u.id = a.user_id 
            AND a.timestamp >= $3 AND a.timestamp <= $4
          WHERE u.guild_id = $1
          GROUP BY u.id, u.discord_id
          HAVING COALESCE(SUM(a.score_awarded), 0) > 0
        ),
        ranked_scores AS (
          SELECT 
            discord_id,
            current_score,
            RANK() OVER (ORDER BY current_score DESC) as rank
          FROM all_season_scores
        )
        SELECT rank, current_score
        FROM ranked_scores
        WHERE discord_id = $2
      `, [guildId, interaction.user.id, currentSeason.start_date, currentSeason.end_date]);

      if (userRankResult.rows.length > 0) {
        const userRankInfo = userRankResult.rows[0];
        rankingEmbed.addFields({
          name: '👤 내 순위',
          value: `**${userRankInfo.rank}위** • ${Math.round(userRankInfo.current_score)}점`,
          inline: true
        });
      } else {
        rankingEmbed.addFields({
          name: '👤 내 순위',
          value: '아직 활동 기록이 없습니다',
          inline: true
        });
      }

      // 푸터 정보 - 새로운 닉네임 시스템 사용
      const requesterName = await getDisplayName(interaction.guild, interaction.user.id, {
        fallback: interaction.user.username
      });
      rankingEmbed.setFooter({
        text: `시즌 ${currentSeason.season_number} • 요청자: ${requesterName}`,
        iconURL: interaction.user.displayAvatarURL()
      });

      await interaction.editReply({ embeds: [rankingEmbed] });

    } catch (error) {
      logger.error('랭킹 명령어 에러:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('❌ 오류 발생')
        .setDescription('랭킹 데이터를 가져오는 중 오류가 발생했습니다.')
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
}

module.exports = new RankingCommand(); 