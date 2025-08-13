/**
 * InteractionCreate 이벤트 핸들러
 * 슬래시 명령어 및 기타 인터랙션 처리
 */
const logger = require('../utils/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      // 슬래시 명령어 처리
      if (interaction.isChatInputCommand()) {
        await this.handleChatInputCommand(interaction, client);
      }
      // 버튼 인터랙션 처리
      else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction, client);
      }
      // 선택 메뉴 인터랙션 처리
      else if (interaction.isSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction, client);
      }
      // 모달 제출 처리
      else if (interaction.isModalSubmit()) {
        await this.handleModalSubmitInteraction(interaction, client);
      }
      
    } catch (error) {
      logger.error('인터랙션 처리 중 예상치 못한 에러:', error);
      
      try {
        const errorMessage = {
          content: '❌ 시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          ephemeral: true
        };
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        logger.error('에러 메시지 전송 실패:', replyError);
      }
    }
  },

  /**
   * 슬래시 명령어 처리
   */
  async handleChatInputCommand(interaction, client) {
    const command = client.commands.get(interaction.commandName);
    
    if (!command) {
      logger.warn(`알 수 없는 명령어: ${interaction.commandName}`);
      return await interaction.reply({
        content: '❌ 알 수 없는 명령어입니다.',
        ephemeral: true
      });
    }
    
    // 명령어 실행 시간 측정
    const startTime = Date.now();
    
    try {
      // 명령어 사용 로깅
      logger.userActivity(
        interaction.user.id, 
        `command_${interaction.commandName}`,
        {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          options: interaction.options.data
        }
      );
      
      // 명령어 실행
      const validationData = {
        member: interaction.member,
        voiceChannel: interaction.member?.voice?.channel,
        guild: interaction.guild,
        user: interaction.user
      };
      await command.execute(interaction, validationData);
      
      // 성능 로깅
      const duration = Date.now() - startTime;
      logger.performance(`command_${interaction.commandName}`, duration, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
    } catch (error) {
      logger.error(`명령어 실행 에러: ${interaction.commandName}`, {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const errorMessage = {
        content: '❌ 명령어 실행 중 오류가 발생했습니다.',
        ephemeral: true
      };
      
      // 응답 상태에 따라 다르게 처리
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  },

  /**
   * 버튼 인터랙션 처리
   */
  async handleButtonInteraction(interaction, client) {
    logger.debug(`버튼 클릭: ${interaction.customId} by ${interaction.user.tag}`);
    
    try {
      const [action, ...params] = interaction.customId.split('_');
      
      switch (action) {
        case 'music':
          await this.handleMusicButton(interaction, params, client);
          break;
        case 'ranking':
          await this.handleRankingButton(interaction, params, client);
          break;
        case 'stats':
          await this.handleStatsButton(interaction, params, client);
          break;
        default:
          await interaction.reply({
            content: '❌ 알 수 없는 버튼 액션입니다.',
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error(`버튼 인터랙션 에러: ${interaction.customId}`, error);
      await interaction.reply({
        content: '❌ 버튼 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  },

  /**
   * 선택 메뉴 인터랙션 처리
   */
  async handleSelectMenuInteraction(interaction, client) {
    logger.debug(`선택 메뉴: ${interaction.customId} by ${interaction.user.tag}`);
    
    try {
      const [type, ...params] = interaction.customId.split('_');
      
      switch (type) {
        case 'filter':
          await this.handleFilterMenu(interaction, params, client);
          break;
        case 'settings':
          await this.handleSettingsMenu(interaction, params, client);
          break;
        default:
          await interaction.reply({
            content: '❌ 알 수 없는 메뉴 타입입니다.',
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error(`선택 메뉴 에러: ${interaction.customId}`, error);
      await interaction.reply({
        content: '❌ 메뉴 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  },

  /**
   * 모달 제출 처리
   */
  async handleModalSubmitInteraction(interaction, client) {
    logger.debug(`모달 제출: ${interaction.customId} by ${interaction.user.tag}`);
    
    try {
      const [type, ...params] = interaction.customId.split('_');
      
      switch (type) {
        case 'feedback':
          await this.handleFeedbackModal(interaction, params, client);
          break;
        case 'settings':
          await this.handleSettingsModal(interaction, params, client);
          break;
        default:
          await interaction.reply({
            content: '❌ 알 수 없는 모달 타입입니다.',
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error(`모달 제출 에러: ${interaction.customId}`, error);
      await interaction.reply({
        content: '❌ 모달 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  },

  // 구체적인 핸들러들 (향후 구현)
  async handleMusicButton(interaction, params, client) {
    await interaction.reply({ content: '🎵 음악 버튼 기능은 개발 중입니다.', ephemeral: true });
  },

  async handleRankingButton(interaction, params, client) {
    await interaction.reply({ content: '🏆 순위 버튼 기능은 개발 중입니다.', ephemeral: true });
  },

  async handleStatsButton(interaction, params, client) {
    await interaction.reply({ content: '📊 통계 버튼 기능은 개발 중입니다.', ephemeral: true });
  },

  async handleFilterMenu(interaction, params, client) {
    await interaction.reply({ content: '🔍 필터 메뉴 기능은 개발 중입니다.', ephemeral: true });
  },

  async handleSettingsMenu(interaction, params, client) {
    await interaction.reply({ content: '⚙️ 설정 메뉴 기능은 개발 중입니다.', ephemeral: true });
  },

  async handleFeedbackModal(interaction, params, client) {
    await interaction.reply({ content: '💬 피드백 제출 기능은 개발 중입니다.', ephemeral: true });
  },

  async handleSettingsModal(interaction, params, client) {
    await interaction.reply({ content: '⚙️ 설정 저장 기능은 개발 중입니다.', ephemeral: true });
  }
}; 