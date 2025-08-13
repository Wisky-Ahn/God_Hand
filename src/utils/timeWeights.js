/**
 * 시간대별 가중치 계산 유틸리티
 * PRD에 따른 시간대별 점수 배율을 적용
 */

const logger = require('./logger');

// 시간대별 가중치 설정 (환경변수에서 로드)
const TIME_WEIGHTS = {
  DAWN: parseFloat(process.env.TIME_WEIGHT_DAWN) || 0.2,      // 00:00-06:00 새벽 시간대 (낮은 가중치)
  MORNING: parseFloat(process.env.TIME_WEIGHT_MORNING) || 0.8,   // 06:00-09:00 아침 시간대
  DAY: parseFloat(process.env.TIME_WEIGHT_DAY) || 1.0,       // 09:00-18:00 주간 시간대 (기본 가중치)
  EVENING: parseFloat(process.env.TIME_WEIGHT_EVENING) || 1.4,   // 18:00-23:00 저녁 시간대 (높은 가중치)
  LATE_NIGHT: parseFloat(process.env.TIME_WEIGHT_LATE_NIGHT) || 0.6 // 23:00-24:00 늦은 밤 시간대
};

const TIME_BOUNDARIES = {
  DAWN_START: parseInt(process.env.TIME_DAWN_START) || 0,
  DAWN_END: parseInt(process.env.TIME_DAWN_END) || 6,
  MORNING_START: parseInt(process.env.TIME_MORNING_START) || 6,
  MORNING_END: parseInt(process.env.TIME_MORNING_END) || 9,
  DAY_START: parseInt(process.env.TIME_DAY_START) || 9,
  DAY_END: parseInt(process.env.TIME_DAY_END) || 18,
  EVENING_START: parseInt(process.env.TIME_EVENING_START) || 18,
  EVENING_END: parseInt(process.env.TIME_EVENING_END) || 23,
  LATE_NIGHT_START: parseInt(process.env.TIME_LATE_NIGHT_START) || 23,
  LATE_NIGHT_END: parseInt(process.env.TIME_LATE_NIGHT_END) || 24
};

/**
 * 주어진 시간에 해당하는 가중치를 반환
 * @param {Date} date - 점수를 계산할 시간
 * @returns {number} 해당 시간대의 가중치
 */
function getTimeWeight(date) {
  try {
    const hour = date.getHours();
    
    if (hour >= TIME_BOUNDARIES.DAWN_START && hour < TIME_BOUNDARIES.DAWN_END) {
      return TIME_WEIGHTS.DAWN;
    } else if (hour >= TIME_BOUNDARIES.MORNING_START && hour < TIME_BOUNDARIES.MORNING_END) {
      return TIME_WEIGHTS.MORNING;
    } else if (hour >= TIME_BOUNDARIES.DAY_START && hour < TIME_BOUNDARIES.DAY_END) {
      return TIME_WEIGHTS.DAY;
    } else if (hour >= TIME_BOUNDARIES.EVENING_START && hour < TIME_BOUNDARIES.EVENING_END) {
      return TIME_WEIGHTS.EVENING;
    } else {
      return TIME_WEIGHTS.LATE_NIGHT;
    }
  } catch (error) {
    logger.error('시간 가중치 계산 중 오류 발생:', error);
    return TIME_WEIGHTS.DAY; // 기본값 반환
  }
}

/**
 * 시간대별 가중치 정보를 반환
 * @returns {Object} 시간대별 가중치 설정
 */
function getTimeWeightInfo() {
  return TIME_WEIGHTS;
}

/**
 * 현재 시간의 가중치를 반환
 * @returns {number} 현재 시간대의 가중치
 */
function getCurrentTimeWeight() {
  return getTimeWeight(new Date());
}

/**
 * 시간대 이름을 반환
 * @param {Date} date - 확인할 시간
 * @returns {string} 시간대 이름
 */
function getTimePeriodName(date) {
  const hour = date.getHours();
  
  if (hour >= TIME_BOUNDARIES.DAWN_START && hour < TIME_BOUNDARIES.DAWN_END) {
    return 'DAWN';
  } else if (hour >= TIME_BOUNDARIES.MORNING_START && hour < TIME_BOUNDARIES.MORNING_END) {
    return 'MORNING';
  } else if (hour >= TIME_BOUNDARIES.DAY_START && hour < TIME_BOUNDARIES.DAY_END) {
    return 'DAY';
  } else if (hour >= TIME_BOUNDARIES.EVENING_START && hour < TIME_BOUNDARIES.EVENING_END) {
    return 'EVENING';
  } else {
    return 'LATE_NIGHT';
  }
}

module.exports = {
  getTimeWeight,
  getTimeWeightInfo,
  getCurrentTimeWeight,
  getTimePeriodName,
  TIME_WEIGHTS,
  TIME_BOUNDARIES
}; 