/**
 * 메시지 생성 이벤트 핸들러
 * 새로운 메시지가 생성될 때마다 메시지 활동 추적 시스템 호출
 */

const { trackMessageActivity } = require('../services/activity/message');
const logger = require('../utils/logger');

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    try {
      // 메시지 활동 추적
      const result = await trackMessageActivity(message);
      
      if (result.success) {
        logger.debug(`메시지 활동 추적: ${message.author.tag} (+${result.score.toFixed(3)}점)`);
      } else if (result.reason !== 'bot_message' && result.reason !== 'system_message') {
        // 봇/시스템 메시지가 아닌 경우에만 로그
        logger.warn(`메시지 활동 추적 실패: ${result.reason}`, {
          userId: message.author.id,
          guildId: message.guild?.id,
          error: result.error
        });
      }
      
    } catch (error) {
      logger.error('messageCreate 이벤트 처리 중 오류:', error);
    }
  }
}; 