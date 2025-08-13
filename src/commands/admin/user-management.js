/**
 * 통합된 사용자 관리 명령어
 * 사용자 점수, 순위 조회 및 관리를 통합
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const dbUtils = require('../../services/database/utils');
const db = require('../../services/database');
const BaseCommand = require('../BaseCommand');

class UserManagementCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('사용자관리')
      .setDescription('[관리자] 사용자 관리 및 순위 조회 (통합)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(option =>
        option.setName('작업')
          .setDescription('수행할 작업 선택')
          .setRequired(true)
          .addChoices(
            { name: '📊 순위 조회', value: 'ranking' },
            { name: '👤 사용자 조회', value: 'user_info' },
            { name: '🎯 점수 관리', value: 'score' },
            { name: '⚙️ 계정 관리', value: 'account' },
            { name: '🔧 대량 관리', value: 'bulk' }
          )
      )
      .addUserOption(option =>
        option.setName('사용자')
          .setDescription('대상 사용자 (사용자 조회, 점수/계정 관리시 필요)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('세부작업')
          .setDescription('세부 작업 (선택사항)')
          .setRequired(false)
          .addChoices(
            // 점수 관리
            { name: '🎯 점수 조회', value: 'score_view' },
            { name: '🎯 점수 설정', value: 'score_set' },
            { name: '🎯 점수 추가', value: 'score_add' },
            { name: '🎯 점수 차감', value: 'score_subtract' },
            { name: '🎯 점수 초기화', value: 'score_reset' },
            // 계정 관리
            { name: '⚙️ 정보 조회', value: 'account_info' },
            { name: '⚙️ 닉네임 변경', value: 'account_nickname' },
            { name: '⚙️ 계정 초기화', value: 'account_reset' },
            { name: '⚙️ 활동 기록 삭제', value: 'account_clear' },
            // 대량 관리
            { name: '🔧 순위 재계산', value: 'bulk_recalc' },
            { name: '🔧 비활성 정리', value: 'bulk_cleanup' },
            { name: '🔧 중복 확인', value: 'bulk_duplicates' },
            { name: '🔧 무결성 검사', value: 'bulk_integrity' }
          )
      )
      .addNumberOption(option =>
        option.setName('값')
          .setDescription('점수 값 또는 개수')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('타입')
          .setDescription('순위/점수 타입')
          .setRequired(false)
          .addChoices(
            { name: '현재 시즌', value: 'current' },
            { name: '라이프타임', value: 'lifetime' },
            { name: '음성 활동', value: 'voice' },
            { name: '메시지 활동', value: 'message' },
            { name: '반응 활동', value: 'reaction' }
          )
      )
      .addStringOption(option =>
        option.setName('사유')
          .setDescription('변경 사유')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option.setName('확인')
          .setDescription('위험한 작업 확인')
          .setRequired(false)
      );
  }

  async execute(interaction) {
    try {
      // 관리자 권한 확인
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
          content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.',
          ephemeral: true
        });
      }

      await interaction.deferReply();

      const action = interaction.options.getString('작업');
      const subAction = interaction.options.getString('세부작업');
      const targetUser = interaction.options.getUser('사용자');
      const value = interaction.options.getNumber('값');
      const type = interaction.options.getString('타입') || 'current';
      const reason = interaction.options.getString('사유') || '관리자 요청';
      const confirm = interaction.options.getBoolean('확인');

      this.logger.info(`사용자관리 명령어 실행: 작업=${action}, 세부작업=${subAction || '없음'}, 사용자=${targetUser?.id || '없음'}`);

      let embed;

      switch (action) {
        case 'ranking':
          embed = await this.handleRanking(interaction.guild, type, value || 10);
          break;
        case 'user_info':
          if (!targetUser) {
            return await interaction.editReply({ content: '❌ 사용자를 선택해주세요.' });
          }
          embed = await this.handleUserInfo(interaction.guild, targetUser, type);
          break;
        case 'score':
          if (!targetUser) {
            return await interaction.editReply({ content: '❌ 사용자를 선택해주세요.' });
          }
          embed = await this.handleScoreManagement(interaction.guild, targetUser, subAction, value, type, reason);
          break;
        case 'account':
          if (!targetUser) {
            return await interaction.editReply({ content: '❌ 사용자를 선택해주세요.' });
          }
          embed = await this.handleAccountManagement(interaction.guild, targetUser, subAction, interaction.options.getString('새값'), confirm);
          break;
        case 'bulk':
          embed = await this.handleBulkManagement(interaction.guild, subAction, value, confirm);
          break;
        default:
          embed = await this.handleRanking(interaction.guild, 'current', 10);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      this.logger.error('사용자관리 명령어 실행 실패:', error);
      const errorMessage = '사용자 관리 작업 중 오류가 발생했습니다.';
      
      if (interaction.deferred) {
        await interaction.editReply({ content: `❌ ${errorMessage}` });
      } else {
        await interaction.reply({ content: `❌ ${errorMessage}`, ephemeral: true });
      }
    }
  }

  /**
   * 순위 조회 처리
   */
  async handleRanking(guild, type, limit = 10) {
    const embed = new EmbedBuilder()
      .setTitle('📊 서버 순위')
      .setColor(0x3498db)
      .setTimestamp()
      .setFooter({ text: `${guild.name} 서버` });

    try {
      let query;
      let title;

      switch (type) {
        case 'current':
          title = '🏆 현재 시즌 순위';
          query = `
            SELECT u.username, u.current_score, u.total_voice_time, u.total_messages, u.total_reactions_given,
                   ROW_NUMBER() OVER (ORDER BY u.current_score DESC) as rank
            FROM users u 
            WHERE u.guild_id = $1 AND u.current_score > 0
            ORDER BY u.current_score DESC 
            LIMIT $2
          `;
          break;
        case 'lifetime':
          title = '🏛️ 라이프타임 순위';
          query = `
            SELECT u.username, u.lifetime_score as score, u.total_voice_time, u.total_messages, u.total_reactions_given,
                   ROW_NUMBER() OVER (ORDER BY u.lifetime_score DESC) as rank
            FROM users u 
            WHERE u.guild_id = $1 AND u.lifetime_score > 0
            ORDER BY u.lifetime_score DESC 
            LIMIT $2
          `;
          break;
        case 'voice':
          title = '🎤 음성 활동 순위';
          query = `
            SELECT u.username, u.voice_score as score, u.total_voice_time, u.total_messages, u.total_reactions_given,
                   ROW_NUMBER() OVER (ORDER BY u.total_voice_time DESC) as rank
            FROM users u 
            WHERE u.guild_id = $1 AND u.total_voice_time > 0
            ORDER BY u.total_voice_time DESC 
            LIMIT $2
          `;
          break;
        case 'message':
          title = '💬 메시지 활동 순위';
          query = `
            SELECT u.username, u.message_score as score, u.total_voice_time, u.total_messages, u.total_reactions_given,
                   ROW_NUMBER() OVER (ORDER BY u.total_messages DESC) as rank
            FROM users u 
            WHERE u.guild_id = $1 AND u.total_messages > 0
            ORDER BY u.total_messages DESC 
            LIMIT $2
          `;
          break;
        case 'reaction':
          title = '👍 반응 활동 순위';
          query = `
            SELECT u.username, u.reaction_score as score, u.total_voice_time, u.total_messages, u.total_reactions_given,
                   ROW_NUMBER() OVER (ORDER BY u.total_reactions_given DESC) as rank
            FROM users u 
            WHERE u.guild_id = $1 AND u.total_reactions_given > 0
            ORDER BY u.total_reactions_given DESC 
            LIMIT $2
          `;
          break;
        default:
          title = '🏆 현재 시즌 순위';
          query = `
            SELECT u.username, u.current_score, u.total_voice_time, u.total_messages, u.total_reactions_given,
                   ROW_NUMBER() OVER (ORDER BY u.current_score DESC) as rank
            FROM users u 
            WHERE u.guild_id = $1 AND u.current_score > 0
            ORDER BY u.current_score DESC 
            LIMIT $2
          `;
      }

      const result = await db.query(query, [guild.id, limit]);

      embed.setTitle(title);

      if (result.rows.length > 0) {
        const rankingList = result.rows.map((row, index) => {
          const medal = this.getRankMedal(index + 1);
          const voiceTime = this.formatVoiceTime(row.total_voice_time || 0);
          return `${medal} **${row.username}**\n` +
                 `   📊 점수: ${row.score || row.current_score || 0}점\n` +
                 `   🎤 ${voiceTime} | 💬 ${row.total_messages || 0}개 | 👍 ${row.total_reactions_given || 0}개`;
        });

        embed.addFields([
          {
            name: `📈 TOP ${result.rows.length}`,
            value: rankingList.join('\n\n'),
            inline: false
          }
        ]);
      } else {
        embed.addFields([
          {
            name: '📭 데이터 없음',
            value: '해당 타입의 순위 데이터가 없습니다.',
            inline: false
          }
        ]);
      }

    } catch (error) {
      this.logger.error('순위 조회 실패:', error);
      embed.setColor(0xff0000);
      embed.addFields([
        {
          name: '❌ 오류',
          value: '순위 조회 중 오류가 발생했습니다.',
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 사용자 정보 조회 처리
   */
  async handleUserInfo(guild, user, type) {
    // 서버별 닉네임 우선 표시명 결정
    let displayName = user.displayName || user.username;
    try {
      const member = await guild.members.fetch(user.id);
      displayName = member.nickname || member.displayName || user.username;
    } catch (error) {
      // 멤버 정보 가져오기 실패 시 기본값 사용
      this.logger.debug('관리자 명령어에서 멤버 정보 가져오기 실패, 기본 이름 사용');
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`👤 ${displayName} 정보`)
      .setColor(0x9b59b6)
      .setTimestamp()
      .setThumbnail(user.displayAvatarURL());

    try {
      const query = `
        SELECT * FROM users WHERE discord_id = $1 AND guild_id = $2
      `;
      const result = await db.query(query, [user.id, guild.id]);

      if (result.rows.length > 0) {
        const userData = result.rows[0];

        // 순위 계산
        const rankQuery = `
          SELECT COUNT(*) + 1 as rank 
          FROM users 
          WHERE guild_id = $1 AND current_score > $2
        `;
        const rankResult = await db.query(rankQuery, [guild.id, userData.current_score]);
        const rank = rankResult.rows[0].rank;

        embed.addFields([
          {
            name: '🏆 현재 시즌 정보',
            value: [
              `**순위**: ${rank}위`,
              `**현재 점수**: ${userData.current_score || 0}점`,
              `**라이프타임 점수**: ${userData.lifetime_score || 0}점`
            ].join('\n'),
            inline: true
          },
          {
            name: '📊 활동 통계',
            value: [
              `**음성 시간**: ${this.formatVoiceTime(userData.total_voice_time || 0)}`,
              `**메시지**: ${userData.total_messages || 0}개`,
              `**반응**: ${userData.total_reactions_given || 0}개`
            ].join('\n'),
            inline: true
          },
          {
            name: '🎯 세부 점수',
            value: [
              `**음성 점수**: ${userData.voice_score || 0}점`,
              `**메시지 점수**: ${userData.message_score || 0}점`,
              `**반응 점수**: ${userData.reaction_score || 0}점`
            ].join('\n'),
            inline: true
          }
        ]);

        // 최근 활동
        const activityQuery = `
          SELECT activity_type, created_at 
          FROM activities 
          WHERE user_id = $1 AND guild_id = $2 
          ORDER BY created_at DESC 
          LIMIT 5
        `;
        const activityResult = await db.query(activityQuery, [userData.id, guild.id]);

        if (activityResult.rows.length > 0) {
          const recentActivities = activityResult.rows.map(activity => {
            const timeAgo = this.getTimeAgo(new Date(activity.created_at));
            return `• ${this.getActivityEmoji(activity.activity_type)} ${activity.activity_type} - ${timeAgo}`;
          });

          embed.addFields([
            {
              name: '⏰ 최근 활동',
              value: recentActivities.join('\n'),
              inline: false
            }
          ]);
        }

      } else {
        embed.addFields([
          {
            name: '❌ 사용자 없음',
            value: '해당 사용자의 데이터를 찾을 수 없습니다.',
            inline: false
          }
        ]);
      }

    } catch (error) {
      this.logger.error('사용자 정보 조회 실패:', error);
      embed.setColor(0xff0000);
      embed.addFields([
        {
          name: '❌ 오류',
          value: '사용자 정보 조회 중 오류가 발생했습니다.',
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 점수 관리 처리
   */
  async handleScoreManagement(guild, user, action, value, type, reason) {
    const embed = new EmbedBuilder()
      .setTitle('🎯 점수 관리')
      .setColor(0xe67e22)
      .setTimestamp();

    try {
      // 사용자 데이터 조회
      const userQuery = `
        SELECT * FROM users WHERE discord_id = $1 AND guild_id = $2
      `;
      const userResult = await db.query(userQuery, [user.id, guild.id]);

      if (userResult.rows.length === 0) {
        embed.setColor(0xff0000);
        embed.addFields([
          {
            name: '❌ 사용자 없음',
            value: '해당 사용자의 데이터를 찾을 수 없습니다.',
            inline: false
          }
        ]);
        return embed;
      }

      const userData = userResult.rows[0];

      if (!action) {
        action = 'score_view';
      }

      switch (action) {
        case 'score_view':
          embed.addFields([
            {
              name: `👤 ${user.displayName} 점수 정보`,
              value: [
                `**현재 점수**: ${userData.current_score || 0}점`,
                `**라이프타임 점수**: ${userData.lifetime_score || 0}점`,
                `**음성 점수**: ${userData.voice_score || 0}점`,
                `**메시지 점수**: ${userData.message_score || 0}점`,
                `**반응 점수**: ${userData.reaction_score || 0}점`
              ].join('\n'),
              inline: false
            }
          ]);
          break;

        case 'score_set':
        case 'score_add':
        case 'score_subtract':
          if (value === null || value === undefined) {
            embed.setColor(0xff0000);
            embed.addFields([
              {
                name: '❌ 값 필요',
                value: '점수 값을 입력해주세요.',
                inline: false
              }
            ]);
            return embed;
          }

          let newScore;
          const currentScore = userData.current_score || 0;

          switch (action) {
            case 'score_set':
              newScore = Math.max(0, value);
              break;
            case 'score_add':
              newScore = Math.max(0, currentScore + value);
              break;
            case 'score_subtract':
              newScore = Math.max(0, currentScore - value);
              break;
          }

          // 점수 업데이트
          const updateQuery = `
            UPDATE users 
            SET current_score = $1, 
                lifetime_score = GREATEST(lifetime_score, $1)
            WHERE discord_id = $2 AND guild_id = $3
          `;
          await db.query(updateQuery, [newScore, user.id, guild.id]);

          // 활동 로그 기록
          const logQuery = `
            INSERT INTO activities (user_id, guild_id, activity_type, details, score_awarded)
            VALUES ($1, $2, 'admin_score_change', $3, $4)
          `;
          await db.query(logQuery, [
            userData.id,
            guild.id,
            `${action}: ${currentScore} → ${newScore} (${reason})`,
            newScore - currentScore
          ]);

          embed.setColor(0x00ff00);
          embed.addFields([
            {
              name: '✅ 점수 수정 완료',
              value: [
                `**사용자**: ${user.displayName}`,
                `**이전 점수**: ${currentScore}점`,
                `**새 점수**: ${newScore}점`,
                `**변경량**: ${newScore - currentScore > 0 ? '+' : ''}${newScore - currentScore}점`,
                `**사유**: ${reason}`
              ].join('\n'),
              inline: false
            }
          ]);
          break;

        case 'score_reset':
          // 점수 초기화
          const resetQuery = `
            UPDATE users 
            SET current_score = 0, voice_score = 0, message_score = 0, reaction_score = 0
            WHERE discord_id = $1 AND guild_id = $2
          `;
          await db.query(resetQuery, [user.id, guild.id]);

          embed.setColor(0x00ff00);
          embed.addFields([
            {
              name: '✅ 점수 초기화 완료',
              value: [
                `**사용자**: ${user.displayName}`,
                `**모든 점수가 0점으로 초기화되었습니다.**`,
                `**사유**: ${reason}`
              ].join('\n'),
              inline: false
            }
          ]);
          break;

        default:
          embed.addFields([
            {
              name: '❓ 알 수 없는 작업',
              value: '지원하지 않는 점수 관리 작업입니다.',
              inline: false
            }
          ]);
      }

    } catch (error) {
      this.logger.error('점수 관리 실패:', error);
      embed.setColor(0xff0000);
      embed.addFields([
        {
          name: '❌ 점수 관리 실패',
          value: `오류가 발생했습니다: ${error.message}`,
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 계정 관리 처리
   */
  async handleAccountManagement(guild, user, action, newValue, confirm) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ 계정 관리')
      .setColor(0x95a5a6)
      .setTimestamp();

    // 구현 생략 (기존 user-management.js의 handleAccount 로직 참조)
    embed.addFields([
      {
        name: '🚧 준비 중',
        value: '계정 관리 기능을 준비 중입니다.',
        inline: false
      }
    ]);

    return embed;
  }

  /**
   * 대량 관리 처리
   */
  async handleBulkManagement(guild, action, value, confirm) {
    const embed = new EmbedBuilder()
      .setTitle('🔧 대량 관리')
      .setColor(0x34495e)
      .setTimestamp();

    // 구현 생략 (기존 user-management.js의 handleBulk 로직 참조)
    embed.addFields([
      {
        name: '🚧 준비 중',
        value: '대량 관리 기능을 준비 중입니다.',
        inline: false
      }
    ]);

    return embed;
  }

  /**
   * 헬퍼 메서드들
   */
  
  getRankMedal(rank) {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `${rank}.`;
    }
  }

  formatVoiceTime(minutes) {
    if (!minutes || minutes === 0) return '0분';
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours > 0) {
      return `${hours}시간 ${mins}분`;
    } else {
      return `${mins}분`;
    }
  }

  getActivityEmoji(activityType) {
    const emojis = {
      'voice_join': '🎤',
      'voice_leave': '🚪',
      'message_create': '💬',
      'reaction_add': '👍',
      'stream_start': '📺',
      'admin_score_change': '⚙️'
    };
    return emojis[activityType] || '📝';
  }

  getTimeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  }
}

module.exports = new UserManagementCommand(); 