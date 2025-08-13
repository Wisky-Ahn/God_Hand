/**
 * 기본 명령어 클래스
 * 모든 명령어가 상속받는 공통 기능 제공
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const dbUtils = require('../services/database/utils');

class BaseCommand {
  constructor(data) {
    this.data = data;
    this.category = 'general';
    this.cooldown = 3; // 기본 3초 쿨다운
    this.permissions = []; // 필요한 권한들
    this.adminOnly = false; // 관리자 전용 여부
    this.musicCommand = false; // 음악 명령어 여부
    this.requiresVoiceChannel = false; // 음성 채널 필요 여부
    this.logger = logger; // logger 인스턴스 설정
  }

  /**
   * 명령어 실행 전 검증
   * @param {CommandInteraction} interaction - Discord 인터랙션
   * @returns {Promise<Object>} 검증 결과
   */
  async validateExecution(interaction) {
    const validationResult = {
      success: true,
      error: null,
      userData: null
    };

    try {
      // 1. 사용자 데이터 조회/생성
      const guildData = await this.getGuildData(interaction.guildId);
      const userData = await dbUtils.findOrCreateUser(
        interaction.user.id,
        guildData.id,
        {
          username: interaction.user.username,
          discriminator: interaction.user.discriminator,
          displayName: interaction.member.nickname || interaction.member.displayName || interaction.user.username
        }
      );

      validationResult.userData = userData;
      validationResult.guildData = guildData;

      // 2. 관리자 권한 확인
      if (this.adminOnly && !this.isAdmin(interaction.member)) {
        validationResult.success = false;
        validationResult.error = '❌ 이 명령어는 관리자만 사용할 수 있습니다.';
        return validationResult;
      }

      // 3. 음성 채널 확인
      if (this.requiresVoiceChannel && !interaction.member.voice.channel) {
        validationResult.success = false;
        validationResult.error = '🔊 이 명령어를 사용하려면 음성 채널에 접속해야 합니다.';
        return validationResult;
      }

      // 4. 쿨다운 확인
      const cooldownCheck = await this.checkCooldown(interaction);
      if (!cooldownCheck.success) {
        validationResult.success = false;
        validationResult.error = cooldownCheck.error;
        return validationResult;
      }

      return validationResult;

    } catch (error) {
      logger.error('명령어 검증 중 에러:', error);
      validationResult.success = false;
      validationResult.error = '❌ 명령어 실행 중 오류가 발생했습니다.';
      return validationResult;
    }
  }

  /**
   * 길드 데이터 조회/생성
   * @param {string} guildId - Discord 길드 ID
   * @returns {Promise<Object>} 길드 데이터
   */
  async getGuildData(guildId) {
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
          [guildId, 'Unknown Guild']
        );
      }

      return result.rows[0];
    } catch (error) {
      logger.error('길드 데이터 조회/생성 중 에러:', error);
      throw error;
    }
  }

  /**
   * 사용자가 관리자인지 확인
   * @param {GuildMember} member - 길드 멤버
   * @returns {boolean} 관리자 여부
   */
  isAdmin(member) {
    if (!member) return false;
    return member.permissions.has('Administrator');
  }

  /**
   * 관리자 권한 확인
   * @param {CommandInteraction} interaction - Discord 인터랙션
   * @returns {boolean} 관리자 여부
   */
  checkAdminPermission(interaction) {
    return this.isAdmin(interaction.member);
  }

  /**
   * 쿨다운 확인
   * @param {CommandInteraction} interaction - Discord 인터랙션
   * @returns {Promise<Object>} 쿨다운 확인 결과
   */
  async checkCooldown(interaction) {
    // 간단한 메모리 기반 쿨다운 (실제로는 Redis 등 사용 권장)
    const cooldowns = global.commandCooldowns || (global.commandCooldowns = new Map());
    const commandName = this.data.name;
    const userId = interaction.user.id;
    const key = `${commandName}_${userId}`;

    if (cooldowns.has(key)) {
      const expirationTime = cooldowns.get(key) + (this.cooldown * 1000);
      const now = Date.now();

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        return {
          success: false,
          error: `⏰ 명령어 쿨다운 중입니다. ${timeLeft.toFixed(1)}초 후에 다시 시도해주세요.`
        };
      }
    }

    cooldowns.set(key, Date.now());
    
    // 쿨다운 정리 (1시간 후)
    setTimeout(() => cooldowns.delete(key), 3600000);

    return { success: true };
  }

  /**
   * 성공 임베드 생성
   * @param {string} title - 제목
   * @param {string} description - 설명
   * @param {Object} options - 추가 옵션
   * @returns {EmbedBuilder} 임베드
   */
  createSuccessEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    if (options.footer) {
      embed.setFooter({ text: options.footer });
    }

    if (options.fields) {
      embed.addFields(options.fields);
    }

    return embed;
  }

  /**
   * 에러 임베드 생성
   * @param {string} title - 제목
   * @param {string} description - 설명
   * @param {Object} options - 추가 옵션
   * @returns {EmbedBuilder} 임베드
   */
  createErrorEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    if (options.footer) {
      embed.setFooter({ text: options.footer });
    }

    return embed;
  }

  /**
   * 정보 임베드 생성
   * @param {string} title - 제목
   * @param {string} description - 설명
   * @param {Object} options - 추가 옵션
   * @returns {EmbedBuilder} 임베드
   */
  createInfoEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    if (options.footer) {
      embed.setFooter({ text: options.footer });
    }

    if (options.fields) {
      embed.addFields(options.fields);
    }

    return embed;
  }

  /**
   * 음악 권한 확인 (위계적 시스템)
   * @param {string} controllerDiscordId - 제어자 Discord ID
   * @param {string} targetDiscordId - 대상 Discord ID
   * @param {number} guildId - 길드 ID
   * @returns {Promise<Object>} 권한 확인 결과
   */
  async checkMusicPermission(controllerDiscordId, targetDiscordId, guildId) {
    return await dbUtils.checkMusicPermission(
      controllerDiscordId, 
      targetDiscordId, 
      guildId
    );
  }

  /**
   * 활동 로깅
   * @param {string} userId - 사용자 ID
   * @param {string} activityType - 활동 타입
   * @param {Object} details - 활동 세부사항
   */
  logActivity(userId, activityType, details = {}) {
    logger.userActivity(userId, activityType, details);
  }

  /**
   * 실제 명령어 실행 함수 (하위 클래스에서 구현)
   * @param {CommandInteraction} interaction - Discord 인터랙션
   * @param {Object} validationData - 검증 데이터
   */
  async execute(interaction, validationData) {
    throw new Error('execute() 메서드는 하위 클래스에서 구현되어야 합니다.');
  }

  /**
   * 메인 실행 함수 (모든 검증 포함)
   * @param {CommandInteraction} interaction - Discord 인터랙션
   */
  async run(interaction) {
    try {
      // 검증 실행
      const validation = await this.validateExecution(interaction);
      
      if (!validation.success) {
        return await interaction.reply({
          content: validation.error,
          ephemeral: true
        });
      }

      // 실제 명령어 실행
      await this.execute(interaction, validation);

      // 활동 로깅
      this.logActivity(
        interaction.user.id,
        `command_${this.data.name}`,
        {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          commandName: this.data.name,
          options: interaction.options.data
        }
      );

    } catch (error) {
      logger.error(`명령어 실행 에러 [${this.data.name}]:`, error);

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
}

module.exports = BaseCommand; 