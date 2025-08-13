/**
 * 통합된 서버 통계 명령어
 * 날짜 선택 가능한 서버 통계를 제공합니다.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserStatsSummary, getServerStatsSummary, getHourlyActivityAnalysis } = require('../../services/statistics/utils');
const { getAggregatedStats, getGuildSummaryStats } = require('../../services/statistics/daily');
const db = require('../../services/database');
const BaseCommand = require('../BaseCommand');

class ServerStatsCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('서버통계')
      .setDescription('[관리자] 서버 통계 (날짜 선택 가능)')
      .addStringOption(option =>
        option.setName('기간')
          .setDescription('통계 기간 선택')
          .setRequired(false)
          .addChoices(
            { name: '1일', value: '1' },
            { name: '3일', value: '3' },
            { name: '7일 (기본)', value: '7' },
            { name: '14일', value: '14' },
            { name: '30일', value: '30' },
            { name: '90일', value: '90' }
          )
      )
      .addStringOption(option =>
        option.setName('타입')
          .setDescription('통계 타입 선택')
          .setRequired(false)
          .addChoices(
            { name: '전체 요약 (기본)', value: 'summary' },
            { name: '상세 분석', value: 'detailed' },
            { name: '시간대별', value: 'hourly' },
            { name: '채널별', value: 'channels' },
            { name: '비활성 사용자', value: 'inactive' }
          )
      )
      .addUserOption(option =>
        option.setName('사용자')
          .setDescription('특정 사용자 분석 (선택사항)')
          .setRequired(false)
      );
  }

  async execute(interaction) {
    try {
      // 관리자 권한 확인
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        return await interaction.reply({
          content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.',
          ephemeral: true
        });
      }

      await interaction.deferReply();

      const days = parseInt(interaction.options.getString('기간') || '7');
      const type = interaction.options.getString('타입') || 'summary';
      const targetUser = interaction.options.getUser('사용자');

      this.logger.info(`서버통계 명령어 실행: 기간=${days}일, 타입=${type}, 사용자=${targetUser?.id || '없음'}`);

      let embed;
      
      switch (type) {
        case 'summary':
          embed = await this.createSummaryEmbed(interaction.guild, days);
          break;
        case 'detailed':
          embed = await this.createDetailedEmbed(interaction.guild, days);
          break;
        case 'hourly':
          embed = await this.createHourlyEmbed(interaction.guild, days);
          break;
        case 'channels':
          embed = await this.createChannelsEmbed(interaction.guild, days);
          break;
        case 'inactive':
          embed = await this.createInactiveEmbed(interaction.guild, days);
          break;
        default:
          embed = await this.createSummaryEmbed(interaction.guild, days);
      }

      // 특정 사용자 분석이 요청된 경우
      if (targetUser) {
        const userEmbed = await this.createUserAnalysisEmbed(interaction.guild, targetUser, days);
        await interaction.editReply({ embeds: [embed, userEmbed] });
      } else {
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      this.logger.error('서버통계 명령어 실행 실패:', error);
      const errorMessage = '서버 통계를 가져오는 중 오류가 발생했습니다.';
      
      if (interaction.deferred) {
        await interaction.editReply({ content: `❌ ${errorMessage}` });
      } else {
        await interaction.reply({ content: `❌ ${errorMessage}`, ephemeral: true });
      }
    }
  }

  /**
   * 요약 통계 임베드 생성
   */
  async createSummaryEmbed(guild, days) {
    const stats = await getGuildSummaryStats(guild.id, days);
    const serverStats = await getServerStatsSummary(guild.id, days);
    
    const embed = new EmbedBuilder()
      .setTitle(`📊 서버 통계 요약 (${days}일간)`)
      .setColor(0x3498db)
      .setTimestamp()
      .setFooter({ text: `${guild.name} 서버` });

    // 기본 통계
    embed.addFields([
      {
        name: '👥 멤버 현황',
        value: [
          `총 멤버: ${stats?.totalUsers || 0}명`,
          `활성 멤버: ${stats?.activeUsers || 0}명`,
          `신규 가입: ${stats?.newUsers || 0}명`
        ].join('\n'),
        inline: true
      },
      {
        name: '💬 활동 통계',
        value: [
          `총 메시지: ${stats?.totalMessages || 0}개`,
          `총 반응: ${stats?.totalReactions || 0}개`,
          `총 음성시간: ${this.formatMinutes(stats?.totalVoiceTime || 0)}`
        ].join('\n'),
        inline: true
      },
      {
        name: '🏆 점수 현황',
        value: [
          `총 점수: ${stats?.totalScore || 0}점`,
          `평균 점수: ${Math.round((stats?.totalScore || 0) / (stats?.activeUsers || 1))}점`,
          `최고 점수: ${stats?.topScore || 0}점`
        ].join('\n'),
        inline: true
      }
    ]);

    // 일일 평균
    const dailyAvg = {
      messages: Math.round((stats?.totalMessages || 0) / days),
      reactions: Math.round((stats?.totalReactions || 0) / days),
      voiceMinutes: Math.round((stats?.totalVoiceTime || 0) / days)
    };

    embed.addFields([
      {
        name: '📈 일일 평균',
        value: [
          `메시지: ${dailyAvg.messages}개/일`,
          `반응: ${dailyAvg.reactions}개/일`,
          `음성: ${this.formatMinutes(dailyAvg.voiceMinutes)}/일`
        ].join('\n'),
        inline: false
      }
    ]);

    return embed;
  }

  /**
   * 상세 분석 임베드 생성
   */
  async createDetailedEmbed(guild, days) {
    const stats = await getAggregatedStats(guild.id, days);
    
    const embed = new EmbedBuilder()
      .setTitle(`📈 서버 상세 분석 (${days}일간)`)
      .setColor(0x2ecc71)
      .setTimestamp()
      .setFooter({ text: `${guild.name} 서버` });

    // 활동 트렌드
    if (stats && stats.length > 0) {
      const recentStats = stats.slice(-7); // 최근 7일
      const totalMessages = recentStats.reduce((sum, day) => sum + (day.message_count || 0), 0);
      const totalReactions = recentStats.reduce((sum, day) => sum + (day.reaction_count || 0), 0);
      const totalVoiceTime = recentStats.reduce((sum, day) => sum + (day.voice_time || 0), 0);

      embed.addFields([
        {
          name: '📊 최근 7일 트렌드',
          value: [
            `일일 메시지: ${Math.round(totalMessages / 7)}개`,
            `일일 반응: ${Math.round(totalReactions / 7)}개`,
            `일일 음성: ${this.formatMinutes(Math.round(totalVoiceTime / 7))}`
          ].join('\n'),
          inline: true
        }
      ]);
    }

    return embed;
  }

  /**
   * 시간대별 분석 임베드 생성
   */
  async createHourlyEmbed(guild, days) {
    const hourlyData = await getHourlyActivityAnalysis(guild.id, days);
    
    const embed = new EmbedBuilder()
      .setTitle(`🕐 시간대별 활동 분석 (${days}일간)`)
      .setColor(0x9b59b6)
      .setTimestamp()
      .setFooter({ text: `${guild.name} 서버` });

    if (hourlyData && hourlyData.length > 0) {
      // 가장 활발한 시간대 찾기
      const peakHour = hourlyData.reduce((max, current) => 
        (current.total_activity > max.total_activity) ? current : max
      );

      // 가장 조용한 시간대 찾기
      const quietHour = hourlyData.reduce((min, current) => 
        (current.total_activity < min.total_activity) ? current : min
      );

      embed.addFields([
        {
          name: '⏰ 활동 패턴',
          value: [
            `가장 활발: ${peakHour.hour}시 (${peakHour.total_activity}건)`,
            `가장 조용: ${quietHour.hour}시 (${quietHour.total_activity}건)`,
            `분석 기간: ${days}일`
          ].join('\n'),
          inline: false
        }
      ]);

      // 시간대별 상위 5개
      const topHours = hourlyData
        .sort((a, b) => b.total_activity - a.total_activity)
        .slice(0, 5);

      embed.addFields([
        {
          name: '🔥 활발한 시간대 TOP 5',
          value: topHours.map((hour, index) => 
            `${index + 1}. ${hour.hour}시 - ${hour.total_activity}건`
          ).join('\n'),
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 채널별 분석 임베드 생성
   */
  async createChannelsEmbed(guild, days) {
    const query = `
      SELECT 
        channel_id,
        COUNT(*) as activity_count,
        SUM(CASE WHEN activity_type = 'message_create' THEN 1 ELSE 0 END) as messages,
        SUM(CASE WHEN activity_type = 'reaction_add' THEN 1 ELSE 0 END) as reactions
      FROM activities 
      WHERE guild_id = $1 
        AND created_at >= NOW() - INTERVAL '${days} days'
        AND channel_id IS NOT NULL
      GROUP BY channel_id 
      ORDER BY activity_count DESC 
      LIMIT 10
    `;

    const result = await db.query(query, [guild.id]);
    
    const embed = new EmbedBuilder()
      .setTitle(`💬 채널별 활동 분석 (${days}일간)`)
      .setColor(0xe74c3c)
      .setTimestamp()
      .setFooter({ text: `${guild.name} 서버` });

    if (result.rows.length > 0) {
      const channelList = await Promise.all(
        result.rows.map(async (row, index) => {
          try {
            const channel = await guild.channels.fetch(row.channel_id);
            return `${index + 1}. ${channel?.name || '알 수 없음'} - ${row.activity_count}건`;
          } catch {
            return `${index + 1}. 삭제된 채널 - ${row.activity_count}건`;
          }
        })
      );

      embed.addFields([
        {
          name: '📈 활발한 채널 TOP 10',
          value: channelList.join('\n') || '데이터 없음',
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 비활성 사용자 임베드 생성
   */
  async createInactiveEmbed(guild, days) {
    const query = `
      SELECT 
        u.discord_id,
        u.username,
        MAX(a.created_at) as last_activity
      FROM users u
      LEFT JOIN activities a ON u.id = a.user_id AND a.guild_id = $1
      WHERE u.guild_id = $1
      GROUP BY u.id, u.discord_id, u.username
      HAVING MAX(a.created_at) < NOW() - INTERVAL '${days} days' OR MAX(a.created_at) IS NULL
      ORDER BY last_activity DESC NULLS LAST
      LIMIT 20
    `;

    const result = await db.query(query, [guild.id]);
    
    const embed = new EmbedBuilder()
      .setTitle(`😴 비활성 사용자 (${days}일 이상)`)
      .setColor(0x95a5a6)
      .setTimestamp()
      .setFooter({ text: `${guild.name} 서버` });

    if (result.rows.length > 0) {
      const inactiveList = result.rows.map((row, index) => {
        const lastActivity = row.last_activity ? 
          new Date(row.last_activity).toLocaleDateString('ko-KR') : '활동 없음';
        return `${index + 1}. ${row.username} (${lastActivity})`;
      });

      embed.addFields([
        {
          name: `👥 비활성 사용자 (${result.rows.length}명)`,
          value: inactiveList.join('\n') || '없음',
          inline: false
        }
      ]);
    } else {
      embed.addFields([
        {
          name: '✅ 모든 사용자 활성',
          value: `${days}일 내에 모든 사용자가 활동했습니다.`,
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 특정 사용자 분석 임베드 생성
   */
  async createUserAnalysisEmbed(guild, user, days) {
    const userStats = await getUserStatsSummary(user.id, guild.id, days);
    
    const embed = new EmbedBuilder()
      .setTitle(`👤 ${user.displayName} 분석 (${days}일간)`)
      .setColor(0xf39c12)
      .setTimestamp()
      .setThumbnail(user.displayAvatarURL());

    if (userStats) {
      embed.addFields([
        {
          name: '📊 활동 통계',
          value: [
            `메시지: ${userStats.messageCount || 0}개`,
            `반응: ${userStats.reactionCount || 0}개`,
            `음성시간: ${this.formatMinutes(userStats.voiceTime || 0)}`
          ].join('\n'),
          inline: true
        },
        {
          name: '🏆 점수 현황',
          value: [
            `총 점수: ${userStats.totalScore || 0}점`,
            `일일 평균: ${Math.round((userStats.totalScore || 0) / days)}점`,
            `활동일: ${userStats.activeDays || 0}일`
          ].join('\n'),
          inline: true
        }
      ]);
    }

    return embed;
  }

  /**
   * 분 단위를 시간:분 형식으로 변환
   */
  formatMinutes(minutes) {
    if (!minutes || minutes === 0) return '0분';
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours > 0) {
      return `${hours}시간 ${mins}분`;
    } else {
      return `${mins}분`;
    }
  }
}

module.exports = new ServerStatsCommand(); 