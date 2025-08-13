/**
 * GuildMemberAdd 이벤트 핸들러
 * 새 멤버 가입 시 환영 및 초기 설정
 */
const logger = require('../utils/logger');
const dbUtils = require('../services/database/utils');
const { getDisplayName } = require('../utils/nickname');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    try {
      const user = member.user;
      const guild = member.guild;
      
      // 봇은 무시
      if (user.bot) return;
      
      logger.info(`새 멤버 가입: ${user.tag} (${guild.name})`);
      
      // 활동 로깅
      logger.userActivity(user.id, 'guild_member_add', {
        guildId: guild.id,
        guildName: guild.name,
        memberCount: guild.memberCount,
        timestamp: new Date().toISOString()
      });
      
      // 길드 데이터 확인/생성
      const guildData = await this.getGuildData(guild.id, guild.name);
      
      // 새 사용자 데이터 생성 - 새로운 닉네임 시스템 사용
      const displayName = await getDisplayName(guild, user.id, {
        fallback: user.username
      });
      
      const userData = await dbUtils.findOrCreateUser(
        user.id,
        guildData.id,
        {
          username: user.username,
          discriminator: user.discriminator,
          displayName: displayName
        }
      );
      
      // 환영 메시지 발송 (설정되어 있는 경우)
      await this.sendWelcomeMessage(member, guild);
      
      // 새 멤버 역할 부여 (설정되어 있는 경우)
      await this.assignNewMemberRole(member, guild);
      
      // 통계 업데이트
      await this.updateGuildStats(guild);
      
      logger.info(`새 멤버 초기화 완료: ${user.tag}`);
      
    } catch (error) {
      logger.error('GuildMemberAdd 이벤트 처리 중 에러:', error);
    }
  },

  /**
   * 환영 메시지 발송
   */
  async sendWelcomeMessage(member, guild) {
    try {
      const settings = await this.getGuildSettings(guild.id);
      
      // 환영 메시지가 비활성화된 경우
      if (!settings.welcomeEnabled) return;
      
      const welcomeChannelId = settings.welcomeChannelId;
      if (!welcomeChannelId) return;
      
      const welcomeChannel = guild.channels.cache.get(welcomeChannelId);
      if (!welcomeChannel || !welcomeChannel.isTextBased()) return;
      
      // 환영 메시지 생성
      const welcomeEmbed = await this.createWelcomeEmbed(member, guild);
      
      await welcomeChannel.send({
        content: `${member}님, ${guild.name}에 오신 것을 환영합니다! 🎉`,
        embeds: [welcomeEmbed]
      });
      
      logger.debug(`환영 메시지 발송: ${member.user.tag} in #${welcomeChannel.name}`);
      
    } catch (error) {
      logger.error('환영 메시지 발송 중 에러:', error);
    }
  },

  /**
   * 환영 메시지 임베드 생성
   */
  async createWelcomeEmbed(member, guild) {
    const { EmbedBuilder } = require('discord.js');
    
    // 새로운 닉네임 시스템 사용
    const displayName = await getDisplayName(guild, member.user.id, {
      fallback: member.user.username
    });
    
    return new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(`🎉 ${guild.name}에 오신 것을 환영합니다!`)
      .setDescription(`안녕하세요 ${displayName}님!\n\n**GodHand Bot**과 함께 활동하고 순위를 쌓아보세요!`)
      .addFields(
        {
          name: '🎤 음성 활동',
          value: '음성 채널에서 활동하시면 점수를 획득할 수 있습니다',
          inline: true
        },
        {
          name: '💬 메시지 활동',
          value: '의미있는 대화로 추가 점수를 얻어보세요',
          inline: true
        },
        {
          name: '🎵 음악 시스템',
          value: '순위에 따라 음악을 제어할 수 있습니다',
          inline: true
        },
        {
          name: '📊 명령어',
          value: '`/핑` - 봇 상태 확인\n`/순위` - 현재 순위 확인 (개발 예정)',
          inline: false
        }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({
        text: `멤버 #${guild.memberCount}`,
        iconURL: guild.iconURL()
      })
      .setTimestamp();
  },

  /**
   * 새 멤버 역할 부여
   */
  async assignNewMemberRole(member, guild) {
    try {
      const settings = await this.getGuildSettings(guild.id);
      
      const newMemberRoleId = settings.newMemberRoleId;
      if (!newMemberRoleId) return;
      
      const role = guild.roles.cache.get(newMemberRoleId);
      if (!role) return;
      
      await member.roles.add(role, 'New member auto-role');
      
      logger.debug(`새 멤버 역할 부여: ${member.user.tag} -> ${role.name}`);
      
    } catch (error) {
      logger.error('새 멤버 역할 부여 중 에러:', error);
    }
  },

  /**
   * 길드 통계 업데이트
   */
  async updateGuildStats(guild) {
    try {
      const db = require('../services/database');
      
      await db.query(
        `UPDATE guilds 
         SET settings = jsonb_set(
           COALESCE(settings, '{}'), 
           '{memberCount}', 
           $2
         )
         WHERE guild_id = $1`,
        [guild.id, guild.memberCount.toString()]
      );
      
    } catch (error) {
      logger.error('길드 통계 업데이트 중 에러:', error);
    }
  },

  /**
   * 길드 설정 조회
   */
  async getGuildSettings(guildId) {
    try {
      const db = require('../services/database');
      
      const result = await db.query(
        'SELECT settings FROM guilds WHERE guild_id = $1',
        [guildId]
      );

      if (result.rows.length > 0) {
        return result.rows[0].settings || {};
      }

      return {};
    } catch (error) {
      logger.error('길드 설정 조회 중 에러:', error);
      return {};
    }
  },

  /**
   * 길드 데이터 조회/생성
   */
  async getGuildData(guildId, guildName = 'Unknown Guild') {
    const db = require('../services/database');
    
    try {
      let result = await db.query(
        'SELECT * FROM guilds WHERE guild_id = $1',
        [guildId]
      );

      if (result.rows.length === 0) {
        // 새 길드 생성
        result = await db.query(
          `INSERT INTO guilds (guild_id, name) 
           VALUES ($1, $2) 
           RETURNING *`,
          [guildId, guildName]
        );
      } else {
        // 길드 이름 업데이트
        result = await db.query(
          `UPDATE guilds 
           SET name = $2 
           WHERE guild_id = $1 
           RETURNING *`,
          [guildId, guildName]
        );
      }

      return result.rows[0];
    } catch (error) {
      logger.error('길드 데이터 조회/생성 중 에러:', error);
      throw error;
    }
  }
}; 