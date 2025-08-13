/**
 * voiceStateUpdate 이벤트 핸들러
 * 음성 채널 활동을 추적하고 점수를 계산
 */

const { trackVoiceActivity, handleSpeakingActivity } = require('../services/activity/voice');
const logger = require('../utils/logger');

module.exports = {
  name: 'voiceStateUpdate',
  once: false,
  
  async execute(oldState, newState) {
    try {
      // 메인 음성 활동 추적 처리
      await trackVoiceActivity(oldState, newState);
      
      // 기타 음성 활동 추적 (스트리밍, 비디오, 화면공유)
      await trackOtherVoiceActivities(oldState, newState);
      
    } catch (error) {
      logger.error('voiceStateUpdate 이벤트 처리 중 오류:', error);
    }
  },

  /**
   * 클라이언트 초기화 시 호출되는 함수
   * @param {Client} client - Discord.js 클라이언트
   */
  initialize(client) {
    try {
      logger.info('음성 활동 추적 시스템 초기화 완료 (AFK 감지 제거됨)');
      
    } catch (error) {
      logger.error('음성 활동 추적 시스템 초기화 중 오류:', error);
    }
  }
};

/**
 * 기타 음성 활동 추적 (스트리밍, 비디오, 화면공유)
 * @param {VoiceState} oldState - 이전 음성 상태
 * @param {VoiceState} newState - 새로운 음성 상태
 */
async function trackOtherVoiceActivities(oldState, newState) {
  try {
    const userId = newState.id || oldState.id;
    const guildId = newState.guild?.id || oldState.guild?.id;
    
    if (!userId || !guildId) return;

    const { trackStreaming, trackVoiceActivity } = require('../services/activity/other');

    // 스트리밍 상태 변화 감지
    if (!oldState.streaming && newState.streaming) {
      // 스트리밍 시작
      await trackStreaming(userId, guildId, {
        type: 'stream',
        quality: 'medium' // Discord에서 정확한 화질 정보를 얻기 어려우므로 기본값
      });
      logger.info(`스트리밍 시작 감지: 사용자 ${userId}`);
    }

    // 비디오 상태 변화 감지
    if (!oldState.selfVideo && newState.selfVideo) {
      // 비디오 켜기
      await trackVoiceActivity(userId, guildId, 'stream_start', {
        channelId: newState.channelId,
        channelName: newState.channel?.name
      });
      logger.info(`비디오 켜기 감지: 사용자 ${userId}`);
    }

    // 화면 공유 상태 변화 감지 (스트리밍과 구분)
    if (!oldState.selfVideo && newState.selfVideo && newState.streaming) {
      // 화면 공유 시작 (스트리밍 + 비디오가 동시에 켜진 경우)
      await trackVoiceActivity(userId, guildId, 'screen_share_start', {
        channelId: newState.channelId,
        channelName: newState.channel?.name
      });
      logger.info(`화면 공유 시작 감지: 사용자 ${userId}`);
    }

    // Go Live (방송) 상태 감지
    if (!oldState.streaming && newState.streaming && !newState.selfVideo) {
      // Go Live 시작 (스트리밍만 켜진 경우)
      await trackVoiceActivity(userId, guildId, 'stream_start', {
        channelId: newState.channelId,
        channelName: newState.channel?.name
      });
      logger.info(`방송 시작 감지: 사용자 ${userId}`);
    }

  } catch (error) {
    logger.error('기타 음성 활동 추적 중 오류:', error);
  }
} 