/**
 * 개인 통계 조회 명령어
 * 사용자의 현재 시즌 및 라이프타임 통계를 상세히 보여줍니다.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../services/database');
const seasonManager = require('../../services/season');
const BaseCommand = require('../BaseCommand');
const logger = require('../../utils/logger');
const { getDisplayName } = require('../../utils/nickname');

class MyStatsCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('내기록')
      .setDescription('나의 상세한 활동 통계를 확인합니다');
  }

  /**
   * 명령어 실행
   * @param {CommandInteraction} interaction - Discord 상호작용
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();

      const guildId = interaction.guild.id;
      const targetUser = interaction.user;
      
      // 새로운 닉네임 시스템 사용
      const displayName = await getDisplayName(interaction.guild, targetUser.id, {
        fallback: targetUser.username
      });

      // 사용자 통계 조회
      logger.debug(`[my-stats] 1. getUserStats 호출 (대상: ${targetUser.id})`);
      const userStats = await this.getUserStats(guildId, targetUser.id);
      logger.debug('[my-stats] 1. getUserStats 완료');
      
      if (!userStats) {
        const noDataEmbed = new EmbedBuilder()
          .setColor('#95a5a6')
          .setTitle('📊 개인 통계')
          .setDescription(`${displayName}님의 활동 기록이 없습니다.`)
          .addFields({
            name: '💡 활동을 시작해보세요!',
            value: '• 음성 채널에 참여해보세요\n• 메시지를 작성해보세요\n• 다른 사람의 메시지에 반응해보세요',
            inline: false
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [noDataEmbed] });
        return;
      }

      // 현재 시즌 정보
      logger.debug('[my-stats] 2. getCurrentSeason 호출');
      const currentSeason = await seasonManager.getCurrentSeason();
      logger.debug('[my-stats] 2. getCurrentSeason 완료');
      
      // 사용자 현재 순위 조회
      logger.debug(`[my-stats] 3. getUserRank 호출 (대상: ${targetUser.id})`);
      const rankInfo = await this.getUserRank(guildId, targetUser.id);
      logger.debug('[my-stats] 3. getUserRank 완료');
      
      // 통계 임베드 생성
      const statsEmbed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle(`📊 ${displayName}님의 통계`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setTimestamp();

      // 현재 시즌 통계
      if (currentSeason) {
        logger.debug('[my-stats] 4. formatSeasonStats 호출');
        const seasonStats = this.formatSeasonStats(userStats, currentSeason, rankInfo);
        logger.debug('[my-stats] 4. formatSeasonStats 완료');
        statsEmbed.addFields({
          name: `🏆 현재 시즌 (${currentSeason.name})`,
          value: seasonStats,
          inline: false
        });
      }

      // 라이프타임 통계
      logger.debug('[my-stats] 5. getLifetimeStats 호출');
      const lifetimeStatsData = await this.getLifetimeStats(guildId, targetUser.id);
      logger.debug('[my-stats] 5. getLifetimeStats 완료');
      const lifetimeStats = this.formatLifetimeStats(lifetimeStatsData);
      logger.debug('[my-stats] 6. formatLifetimeStats 완료');
      statsEmbed.addFields({
        name: '🏛️ 라이프타임 통계',
        value: lifetimeStats,
        inline: false
      });

      // 활동 분석
      const activityAnalysis = await this.getActivityAnalysis(guildId, targetUser.id);
      if (activityAnalysis) {
        statsEmbed.addFields({
          name: '📈 활동 분석',
          value: activityAnalysis,
          inline: false
        });
      }

      // 상세 통계 부분 제거 (옵션이 의미 없었으므로)
      
      // 최근 활동
      logger.debug('[my-stats] 8. getRecentActivity 호출');
      const recentActivity = await this.getRecentActivity(guildId, targetUser.id);
      logger.debug('[my-stats] 8. getRecentActivity 완료');
      if (recentActivity) {
        statsEmbed.addFields({
          name: '⏰ 최근 활동',
          value: recentActivity,
          inline: false
        });
      }

      // 성취도 및 목표
      logger.debug('[my-stats] 7. getAchievements 호출');
      const achievements = this.getAchievements(userStats, rankInfo);
      logger.debug('[my-stats] 7. getAchievements 완료');
      if (achievements) {
        statsEmbed.addFields({
          name: '🎯 성취도 & 목표',
          value: achievements,
          inline: false
        });
      }

      // 푸터 정보 (항상 본인 기록이므로 간소화)
      statsEmbed.setFooter({
        text: `내 통계 • 요청자: ${interaction.user.username}`,
        iconURL: interaction.user.displayAvatarURL()
      });

      logger.debug('[my-stats] 9. 응답 전송');
      await interaction.editReply({ embeds: [statsEmbed] });
      logger.debug('[my-stats] 9. 응답 완료');

    } catch (error) {
      logger.error('내기록 명령어 에러 발생 지점:', error.stack);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('❌ 오류 발생')
        .setDescription('개인 통계를 가져오는 중 오류가 발생했습니다.')
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
   * 사용자 통계 조회 (현재 시즌 점수 포함)
   */
  async getUserStats(guildId, userId) {
    try {
      // 현재 시즌 정보 가져오기
      const currentSeason = await seasonManager.getCurrentSeason();
      
      let query = `
        SELECT 
          u.*,
          EXTRACT(EPOCH FROM (NOW() - u.created_at))/86400 as days_since_join`;
      
      let params = [guildId, userId];
      
      if (currentSeason) {
        query += `,
          COALESCE(season_data.current_season_score, 0) as current_season_score,
          COALESCE(season_data.season_voice_time, 0) as season_voice_time,
          COALESCE(season_data.season_messages, 0) as season_messages,
          COALESCE(season_data.season_reactions, 0) as season_reactions
        FROM users u
        LEFT JOIN (
          SELECT 
            a.user_id,
            SUM(a.score_awarded) as current_season_score,
            ROUND(SUM(CASE WHEN a.activity_type = 'voice_leave' THEN (a.details->>'duration')::numeric ELSE 0 END) / 60) as season_voice_time,
            COUNT(CASE WHEN a.activity_type = 'message_create' THEN 1 END) as season_messages,
            COUNT(CASE WHEN a.activity_type = 'reaction_add' THEN 1 END) as season_reactions
          FROM activities a 
          WHERE a.timestamp >= $3 AND a.timestamp <= $4
          GROUP BY a.user_id
        ) season_data ON u.id = season_data.user_id`;
        params.push(currentSeason.start_date, currentSeason.end_date);
      } else {
        query += `
        FROM users u`;
      }
      
      query += ` WHERE u.guild_id = $1 AND u.discord_id = $2`;
      
      const result = await db.query(query, params);

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('getUserStats 에러:', error);
      return null;
    }
  }

  /**
   * 사용자 순위 정보 조회 (현재 시즌 기간 점수 기반)
   */
  async getUserRank(guildId, userId) {
    try {
      // 현재 시즌 정보 가져오기
      const currentSeason = await seasonManager.getCurrentSeason();
      
      if (!currentSeason) {
        return null;
      }
      
      // 현재 시즌 기간의 점수를 기준으로 순위 계산
      const result = await db.query(`
        WITH season_scores AS (
          SELECT 
            u.discord_id,
            COALESCE(SUM(a.score_awarded), 0) as current_season_score
          FROM users u
          LEFT JOIN activities a ON u.id = a.user_id 
            AND a.timestamp >= $3 AND a.timestamp <= $4
          WHERE u.guild_id = $1
          GROUP BY u.id, u.discord_id
        ),
        ranked_users AS (
          SELECT 
            discord_id,
            current_season_score,
            RANK() OVER (ORDER BY current_season_score DESC) as current_rank
          FROM season_scores 
          WHERE current_season_score > 0
        ),
        total_count AS (
          SELECT COUNT(*) as total_users FROM season_scores WHERE current_season_score > 0
        )
        SELECT 
          r.current_rank,
          r.current_rank as lifetime_rank,
          t.total_users
        FROM ranked_users r
        CROSS JOIN total_count t
        WHERE r.discord_id = $2
      `, [guildId, userId, currentSeason.start_date, currentSeason.end_date]);

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('getUserRank 에러:', error);
      return null;
    }
  }

  /**
   * 라이프타임 통계 조회
   */
  async getLifetimeStats(guildId, userId) {
    try {
      const result = await db.query(`
        SELECT 
          ls.*,
          u.total_voice_time as current_voice_time,
          u.total_messages as current_messages
        FROM users u
        LEFT JOIN lifetime_stats ls ON u.id = ls.user_id
        WHERE u.guild_id = $1 AND u.discord_id = $2
      `, [guildId, userId]);

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('getLifetimeStats 에러:', error);
      return null;
    }
  }

  /**
   * 현재 시즌 통계 포맷
   */
  formatSeasonStats(userStats, currentSeason, rankInfo) {
    const score = Math.round(userStats.current_season_score || userStats.current_score || 0);
    const rank = rankInfo ? `${rankInfo.current_rank}위 / ${rankInfo.total_users}명` : 'N/A';
    
    // Season 기간의 음성 시간 (이미 분 단위로 계산됨)
    const totalVoiceMinutes = userStats.season_voice_time || 0;
    const voiceHours = Math.floor(totalVoiceMinutes / 60);
    const voiceMinutes = totalVoiceMinutes % 60;
    
    const messages = userStats.season_messages || 0;
    const reactions = userStats.season_reactions || 0;
    const timeLeft = Math.ceil((new Date(currentSeason.end_date) - new Date()) / (1000 * 60 * 60 * 24));

    let stats = '';
    stats += `현재 점수: **${score}점**\n`;
    stats += `현재 순위: **${rank}**\n`;
    stats += `음성 시간: **${voiceHours}시간 ${voiceMinutes}분**\n`;
    stats += `메시지: **${messages}개**\n`;
    stats += `반응: **${reactions}개**\n`;
    stats += `남은 기간: **${timeLeft}일**`;
    
    return stats;
  }

  /**
   * 라이프타임 통계 포맷
   */
  formatLifetimeStats(lifetimeStatsData) {
    // 라이프타임 데이터가 없으면 기본값 표시
    if (!lifetimeStatsData) {
      return '아직 라이프타임 통계가 없습니다.\n첫 시즌을 완주하면 기록이 시작됩니다.';
    }

    // 라이프타임 통계가 있으면 해당 데이터 사용, 없으면 현재 데이터 사용 (null 안전성 강화)
    const totalScore = Number(lifetimeStatsData.total_score) || 0;
    const totalSeasons = Number(lifetimeStatsData.total_seasons_participated) || 0;
    const totalVoiceSeconds = Number(lifetimeStatsData.total_voice_time || lifetimeStatsData.current_voice_time) || 0;
    const totalMessages = Number(lifetimeStatsData.total_messages || lifetimeStatsData.current_messages) || 0;
    const totalWins = Number(lifetimeStatsData.first_place_wins) || 0;
    const bestRank = lifetimeStatsData.best_rank || 'N/A';
    
    // 음성 시간을 시간:분 형태로 정확하게 변환
    const totalVoiceHours = Math.floor(totalVoiceSeconds / 3600);
    const totalVoiceMinutes = Math.floor((totalVoiceSeconds % 3600) / 60);
    const voiceTimeText = totalVoiceHours > 0 ? 
      `${totalVoiceHours}시간 ${totalVoiceMinutes}분` : 
      `${totalVoiceMinutes}분`;
    
    let stats = `누적 점수: **${totalScore.toFixed(1)}점**\n`;
    stats += `참여 시즌: **${totalSeasons}개**\n`;
    stats += `총 음성시간: **${voiceTimeText}**\n`;
    stats += `총 메시지: **${totalMessages}개**\n`;
    stats += `우승 횟수: **${totalWins}회**\n`;
    stats += `최고 순위: **${bestRank === 0 ? 'N/A' : bestRank}위**`;
    
    return stats;
  }

  /**
   * 활동 분석
   */
  async getActivityAnalysis(guildId, userId) {
    try {
      const result = await db.query(`
        SELECT 
          activity_type as type,
          COUNT(*) as count,
          SUM(score_awarded) as total_score,
          AVG(score_awarded) as avg_score
        FROM activities a
        JOIN users u ON a.user_id = u.id
        WHERE u.guild_id = $1 AND u.discord_id = $2
          AND a.timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY activity_type
        ORDER BY count DESC
      `, [guildId, userId]);

      if (result.rows.length === 0) return null;

      let analysis = '';
      const totalActivities = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);
      const totalScore = result.rows.reduce((sum, row) => sum + parseFloat(row.total_score), 0);

      analysis += `최근 7일간 **${totalActivities}회** 활동 • **${totalScore.toFixed(1)}점**\n`;
      
      // 주요 활동 타입
      const topActivity = result.rows[0];
      const activityNames = {
        voice: '음성 참여',
        message: '메시지 작성',
        reaction_given: '반응 달기',
        reaction_received: '반응 받기',
        streaming: '스트리밍',
        video_enabled: '비디오'
      };
      
      analysis += `주요 활동: **${activityNames[topActivity.type] || topActivity.type}** (${topActivity.count}회)`;

      return analysis;
    } catch (error) {
      logger.error('getActivityAnalysis 에러:', error);
      return null;
    }
  }

  /**
   * 상세 통계
   */
  async getDetailedStats(guildId, userId) {
    try {
      const result = await db.query(`
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as activities,
          SUM(score_awarded) as daily_score
        FROM activities a
        JOIN users u ON a.user_id = u.id
        WHERE u.guild_id = $1 AND u.discord_id = $2
          AND a.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
        LIMIT 7
      `, [guildId, userId]);

      if (result.rows.length === 0) return null;

      let detailed = '최근 7일 일별 활동:\n';
      result.rows.forEach(row => {
        const date = new Date(row.date).toLocaleDateString('ko-KR', { 
          month: 'numeric', 
          day: 'numeric' 
        });
        detailed += `• ${date}: ${row.activities}회 활동, ${Math.round(row.daily_score)}점\n`;
      });

      return detailed.trim();
    } catch (error) {
      logger.error('getDetailedStats 에러:', error);
      return null;
    }
  }

  /**
   * 최근 활동
   */
  async getRecentActivity(guildId, userId) {
    try {
      const result = await db.query(`
        SELECT 
          activity_type as type,
          score_awarded as score,
          timestamp
        FROM activities a
        JOIN users u ON a.user_id = u.id
        WHERE u.guild_id = $1 AND u.discord_id = $2
        ORDER BY timestamp DESC
        LIMIT 5
      `, [guildId, userId]);

      if (result.rows.length === 0) return null;

      let activity = '';
      const activityNames = {
        voice: '🎤 음성 참여',
        message: '💬 메시지',
        reaction_given: '👍 반응 달기',
        reaction_received: '💝 반응 받기',
        streaming: '📺 스트리밍',
        video_enabled: '📹 비디오'
      };

      result.rows.forEach(row => {
        const timeAgo = this.getTimeAgo(new Date(row.timestamp));
        activity += `${activityNames[row.type] || row.type} • ${timeAgo}\n`;
      });

      return activity.trim();
    } catch (error) {
      logger.error('getRecentActivity 에러:', error);
      return null;
    }
  }

  /**
   * 성취도 및 목표
   */
  getAchievements(userStats, rankInfo) {
    let achievements = '';

    // 현재 순위 기반 성취도
    if (rankInfo && rankInfo.current_rank) {
      if (rankInfo.current_rank === 1) {
        achievements += '👑 현재 1위! 시즌 우승까지 한 걸음!\n';
      } else if (rankInfo.current_rank <= 3) {
        achievements += '🥇 TOP 3 달성! 1위까지 도전해보세요!\n';
      } else if (rankInfo.current_rank <= 10) {
        achievements += '🏅 TOP 10 달성! TOP 3을 노려보세요!\n';
      }
    }

    // 활동 기반 성취도
    const voiceHours = Math.round((userStats.voice_time || 0) / 3600);
    if (voiceHours >= 100) {
      achievements += '🎤 음성 참여 마스터 (100시간+)\n';
    } else if (voiceHours >= 50) {
      achievements += '🎧 음성 참여 베테랑 (50시간+)\n';
    }

    if ((userStats.message_count || 0) >= 1000) {
      achievements += '💬 메시지 왕 (1000개+)\n';
    } else if ((userStats.message_count || 0) >= 500) {
      achievements += '💬 메시지 마스터 (500개+)\n';
    }

    // 목표 제시
    achievements += '\n🎯 **다음 목표:**\n';
    if (rankInfo && rankInfo.current_rank > 1) {
      achievements += `• ${rankInfo.current_rank - 1}위 달성하기\n`;
    }
    if (voiceHours < 50) {
      achievements += '• 음성 참여 50시간 달성하기\n';
    }
    if ((userStats.message_count || 0) < 500) {
      achievements += '• 메시지 500개 달성하기\n';
    }

    return achievements.trim() || null;
  }

  /**
   * 시간 경과 표시
   */
  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffHours >= 24) {
      return `${Math.floor(diffHours / 24)}일 전`;
    } else if (diffHours >= 1) {
      return `${diffHours}시간 전`;
    } else if (diffMins >= 1) {
      return `${diffMins}분 전`;
    } else {
      return '방금 전';
    }
  }
}

module.exports = new MyStatsCommand(); 