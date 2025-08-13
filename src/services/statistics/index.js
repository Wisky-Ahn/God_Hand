/**
 * 통계 및 차트 생성 서비스
 * 사용자 활동 데이터를 시각화하고 고급 통계 분석을 제공합니다.
 */

const { createCanvas } = require('canvas');
const db = require('../database');
const dbUtils = require('../database/utils');
const logger = require('../../utils/logger');

// 차트 설정 상수
const CHART_CONFIG = {
  DEFAULT_WIDTH: 800,
  DEFAULT_HEIGHT: 400,
  PADDING: 50,
  COLORS: {
    VOICE: '#3498db',
    MESSAGE: '#2ecc71', 
    REACTION: '#e74c3c',
    STREAMING: '#9b59b6',
    OTHER: '#e67e22',
    BACKGROUND: '#ffffff',
    TEXT: '#2c3e50',
    GRID: '#bdc3c7',
    AXIS: '#34495e'
  },
  FONTS: {
    TITLE: '20px Arial',
    LABEL: '14px Arial',
    LEGEND: '12px Arial',
    AXIS: '10px Arial'
  }
};

/**
 * 사용자 활동 차트 생성
 * @param {string} userId - 사용자 ID
 * @param {number} days - 분석 기간 (일)
 * @param {string} chartType - 차트 타입 ('bar', 'line', 'stacked')
 * @returns {Buffer} 차트 이미지 버퍼
 */
async function generateUserActivityChart(userId, days = 7, chartType = 'bar') {
  try {
    logger.info(`사용자 활동 차트 생성 시작: ${userId}, ${days}일, ${chartType}`);

    // 사용자 활동 데이터 조회
    const activityData = await getUserActivityData(userId, days);
    
    if (!activityData || activityData.length === 0) {
      return generateNoDataChart('활동 데이터가 없습니다');
    }

    // 차트 타입에 따른 생성
    switch (chartType) {
      case 'line':
        return generateLineChart(activityData, `${days}일간 활동 추이`);
      case 'stacked':
        return generateStackedBarChart(activityData, `${days}일간 활동 분석`);
      default:
        return generateBarChart(activityData, `${days}일간 활동 분석`);
    }

  } catch (error) {
    logger.error('사용자 활동 차트 생성 중 오류:', error);
    return generateErrorChart('차트 생성 중 오류가 발생했습니다');
  }
}

/**
 * 서버 전체 활동 분석 차트 생성
 * @param {string} guildId - 길드 ID
 * @param {number} days - 분석 기간 (일)
 * @returns {Buffer} 차트 이미지 버퍼
 */
async function generateServerActivityChart(guildId, days = 30) {
  try {
    logger.info(`서버 활동 차트 생성 시작: ${guildId}, ${days}일`);

    // 서버 전체 활동 데이터 조회
    const serverData = await getServerActivityData(guildId, days);
    
    if (!serverData || serverData.length === 0) {
      return generateNoDataChart('서버 활동 데이터가 없습니다');
    }

    return generateServerLineChart(serverData, `${days}일간 서버 활동 추이`);

  } catch (error) {
    logger.error('서버 활동 차트 생성 중 오류:', error);
    return generateErrorChart('차트 생성 중 오류가 발생했습니다');
  }
}

/**
 * 사용자 비교 차트 생성
 * @param {Array} userIds - 비교할 사용자 ID 배열
 * @param {number} days - 분석 기간 (일)
 * @returns {Buffer} 차트 이미지 버퍼
 */
async function generateUserComparisonChart(userIds, days = 7) {
  try {
    logger.info(`사용자 비교 차트 생성 시작: ${userIds.length}명, ${days}일`);

    // 각 사용자의 활동 데이터 조회
    const comparisonData = await getUserComparisonData(userIds, days);
    
    if (!comparisonData || comparisonData.length === 0) {
      return generateNoDataChart('비교할 사용자 데이터가 없습니다');
    }

    return generateComparisonBarChart(comparisonData, `${days}일간 사용자 활동 비교`);

  } catch (error) {
    logger.error('사용자 비교 차트 생성 중 오류:', error);
    return generateErrorChart('차트 생성 중 오류가 발생했습니다');
  }
}

/**
 * 사용자 활동 데이터 조회
 * @param {string} userId - 사용자 ID
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 활동 데이터 배열
 */
async function getUserActivityData(userId, days) {
  try {
    const result = await db.query(`
      SELECT 
        DATE(timestamp) as date,
        SUM(CASE WHEN type = 'voice' THEN score ELSE 0 END) as voice_score,
        SUM(CASE WHEN type = 'message' THEN score ELSE 0 END) as message_score,
        SUM(CASE WHEN type IN ('reaction_given', 'reaction_received') THEN score ELSE 0 END) as reaction_score,
        SUM(CASE WHEN type IN ('streaming', 'video_enabled', 'screen_share', 'go_live') THEN score ELSE 0 END) as streaming_score,
        SUM(CASE WHEN type NOT IN ('voice', 'message', 'reaction_given', 'reaction_received', 'streaming', 'video_enabled', 'screen_share', 'go_live') THEN score ELSE 0 END) as other_score,
        COUNT(*) as activity_count
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE u.discord_id = $1 
        AND a.timestamp >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `, [userId]);

    return result.rows;
  } catch (error) {
    logger.error('사용자 활동 데이터 조회 중 오류:', error);
    return [];
  }
}

/**
 * 서버 활동 데이터 조회
 * @param {string} guildId - 길드 ID
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 서버 활동 데이터 배열
 */
async function getServerActivityData(guildId, days) {
  try {
    const result = await db.query(`
      SELECT 
        DATE(a.timestamp) as date,
        COUNT(DISTINCT u.id) as active_users,
        SUM(a.score) as total_score,
        COUNT(a.id) as total_activities,
        AVG(a.score) as avg_score_per_activity
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE u.guild_id = $1 
        AND a.timestamp >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(a.timestamp)
      ORDER BY date ASC
    `, [guildId]);

    return result.rows;
  } catch (error) {
    logger.error('서버 활동 데이터 조회 중 오류:', error);
    return [];
  }
}

/**
 * 사용자 비교 데이터 조회
 * @param {Array} userIds - 사용자 ID 배열
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 비교 데이터 배열
 */
async function getUserComparisonData(userIds, days) {
  try {
    const placeholders = userIds.map((_, index) => `$${index + 2}`).join(',');
    
    const result = await db.query(`
      SELECT 
        u.discord_id,
        u.display_name,
        SUM(CASE WHEN a.type = 'voice' THEN a.score ELSE 0 END) as voice_score,
        SUM(CASE WHEN a.type = 'message' THEN a.score ELSE 0 END) as message_score,
        SUM(CASE WHEN a.type IN ('reaction_given', 'reaction_received') THEN a.score ELSE 0 END) as reaction_score,
        SUM(CASE WHEN a.type IN ('streaming', 'video_enabled', 'screen_share', 'go_live') THEN a.score ELSE 0 END) as streaming_score,
        SUM(a.score) as total_score,
        COUNT(a.id) as total_activities
      FROM users u
      LEFT JOIN activities a ON u.id = a.user_id 
        AND a.timestamp >= NOW() - INTERVAL '${days} days'
      WHERE u.discord_id IN (${placeholders})
      GROUP BY u.id, u.discord_id, u.display_name
      ORDER BY total_score DESC
    `, [days, ...userIds]);

    return result.rows;
  } catch (error) {
    logger.error('사용자 비교 데이터 조회 중 오류:', error);
    return [];
  }
}

/**
 * 바 차트 생성
 * @param {Array} data - 차트 데이터
 * @param {string} title - 차트 제목
 * @returns {Buffer} 차트 이미지 버퍼
 */
function generateBarChart(data, title) {
  const canvas = createCanvas(CHART_CONFIG.DEFAULT_WIDTH, CHART_CONFIG.DEFAULT_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  // 배경 설정
  ctx.fillStyle = CHART_CONFIG.COLORS.BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const padding = CHART_CONFIG.PADDING;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2 - 40; // 제목 공간
  
  // 제목 그리기
  ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
  ctx.font = CHART_CONFIG.FONTS.TITLE;
  ctx.textAlign = 'center';
  ctx.fillText(title, canvas.width / 2, 30);
  
  // 최대값 계산
  const maxScore = Math.max(...data.map(d => 
    parseFloat(d.voice_score) + parseFloat(d.message_score) + 
    parseFloat(d.reaction_score) + parseFloat(d.streaming_score) + parseFloat(d.other_score)
  ));
  
  if (maxScore === 0) {
    ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
    ctx.font = CHART_CONFIG.FONTS.LABEL;
    ctx.textAlign = 'center';
    ctx.fillText('데이터가 없습니다', canvas.width / 2, canvas.height / 2);
    return canvas.toBuffer();
  }
  
  // 축 그리기
  drawAxes(ctx, padding, padding + 40, chartWidth, chartHeight);
  
  // 데이터 바 그리기
  const barWidth = chartWidth / (data.length * 5 + data.length + 1); // 5개 카테고리 + 간격
  const groupWidth = barWidth * 5 + barWidth;
  
  data.forEach((day, i) => {
    const x = padding + (i * groupWidth) + barWidth;
    
    drawBar(ctx, x, padding + 40, barWidth, chartHeight, parseFloat(day.voice_score), maxScore, CHART_CONFIG.COLORS.VOICE);
    drawBar(ctx, x + barWidth, padding + 40, barWidth, chartHeight, parseFloat(day.message_score), maxScore, CHART_CONFIG.COLORS.MESSAGE);
    drawBar(ctx, x + barWidth * 2, padding + 40, barWidth, chartHeight, parseFloat(day.reaction_score), maxScore, CHART_CONFIG.COLORS.REACTION);
    drawBar(ctx, x + barWidth * 3, padding + 40, barWidth, chartHeight, parseFloat(day.streaming_score), maxScore, CHART_CONFIG.COLORS.STREAMING);
    drawBar(ctx, x + barWidth * 4, padding + 40, barWidth, chartHeight, parseFloat(day.other_score), maxScore, CHART_CONFIG.COLORS.OTHER);
    
    // 날짜 라벨
    ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
    ctx.font = CHART_CONFIG.FONTS.AXIS;
    ctx.textAlign = 'center';
    const date = new Date(day.date);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    ctx.fillText(dateStr, x + groupWidth / 2 - barWidth / 2, padding + 40 + chartHeight + 15);
  });
  
  // 범례 그리기
  drawLegend(ctx, padding, canvas.height - 30);
  
  return canvas.toBuffer();
}

/**
 * 라인 차트 생성
 * @param {Array} data - 차트 데이터
 * @param {string} title - 차트 제목
 * @returns {Buffer} 차트 이미지 버퍼
 */
function generateLineChart(data, title) {
  const canvas = createCanvas(CHART_CONFIG.DEFAULT_WIDTH, CHART_CONFIG.DEFAULT_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  // 배경 설정
  ctx.fillStyle = CHART_CONFIG.COLORS.BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const padding = CHART_CONFIG.PADDING;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2 - 40;
  
  // 제목 그리기
  ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
  ctx.font = CHART_CONFIG.FONTS.TITLE;
  ctx.textAlign = 'center';
  ctx.fillText(title, canvas.width / 2, 30);
  
  // 최대값 계산
  const maxScore = Math.max(...data.map(d => 
    parseFloat(d.voice_score) + parseFloat(d.message_score) + 
    parseFloat(d.reaction_score) + parseFloat(d.streaming_score) + parseFloat(d.other_score)
  ));
  
  if (maxScore === 0) {
    ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
    ctx.font = CHART_CONFIG.FONTS.LABEL;
    ctx.textAlign = 'center';
    ctx.fillText('데이터가 없습니다', canvas.width / 2, canvas.height / 2);
    return canvas.toBuffer();
  }
  
  // 축 그리기
  drawAxes(ctx, padding, padding + 40, chartWidth, chartHeight);
  
  // 라인 그리기
  const stepX = chartWidth / (data.length - 1);
  
  // 각 활동 타입별 라인 그리기
  drawLine(ctx, data, 'voice_score', CHART_CONFIG.COLORS.VOICE, padding, padding + 40, stepX, chartHeight, maxScore);
  drawLine(ctx, data, 'message_score', CHART_CONFIG.COLORS.MESSAGE, padding, padding + 40, stepX, chartHeight, maxScore);
  drawLine(ctx, data, 'reaction_score', CHART_CONFIG.COLORS.REACTION, padding, padding + 40, stepX, chartHeight, maxScore);
  drawLine(ctx, data, 'streaming_score', CHART_CONFIG.COLORS.STREAMING, padding, padding + 40, stepX, chartHeight, maxScore);
  
  // 범례 그리기
  drawLegend(ctx, padding, canvas.height - 30);
  
  return canvas.toBuffer();
}

/**
 * 서버 라인 차트 생성
 * @param {Array} data - 서버 활동 데이터
 * @param {string} title - 차트 제목
 * @returns {Buffer} 차트 이미지 버퍼
 */
function generateServerLineChart(data, title) {
  const canvas = createCanvas(CHART_CONFIG.DEFAULT_WIDTH, CHART_CONFIG.DEFAULT_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  // 배경 설정
  ctx.fillStyle = CHART_CONFIG.COLORS.BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const padding = CHART_CONFIG.PADDING;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2 - 40;
  
  // 제목 그리기
  ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
  ctx.font = CHART_CONFIG.FONTS.TITLE;
  ctx.textAlign = 'center';
  ctx.fillText(title, canvas.width / 2, 30);
  
  // 최대값 계산
  const maxUsers = Math.max(...data.map(d => parseInt(d.active_users)));
  const maxScore = Math.max(...data.map(d => parseFloat(d.total_score)));
  
  if (maxUsers === 0 && maxScore === 0) {
    ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
    ctx.font = CHART_CONFIG.FONTS.LABEL;
    ctx.textAlign = 'center';
    ctx.fillText('서버 활동 데이터가 없습니다', canvas.width / 2, canvas.height / 2);
    return canvas.toBuffer();
  }
  
  // 축 그리기
  drawAxes(ctx, padding, padding + 40, chartWidth, chartHeight);
  
  // 듀얼 축 라인 그리기 (활성 사용자 수 vs 총 점수)
  const stepX = chartWidth / (data.length - 1);
  
  // 활성 사용자 수 라인 (파란색)
  ctx.strokeStyle = CHART_CONFIG.COLORS.VOICE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  
  data.forEach((point, i) => {
    const x = padding + i * stepX;
    const y = padding + 40 + chartHeight - (parseInt(point.active_users) / maxUsers) * chartHeight;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  
  // 총 점수 라인 (초록색, 우측 축 기준)
  ctx.strokeStyle = CHART_CONFIG.COLORS.MESSAGE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  
  data.forEach((point, i) => {
    const x = padding + i * stepX;
    const y = padding + 40 + chartHeight - (parseFloat(point.total_score) / maxScore) * chartHeight;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  
  // 날짜 라벨
  data.forEach((point, i) => {
    if (i % Math.ceil(data.length / 7) === 0) { // 최대 7개 라벨만 표시
      const x = padding + i * stepX;
      const date = new Date(point.date);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      
      ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
      ctx.font = CHART_CONFIG.FONTS.AXIS;
      ctx.textAlign = 'center';
      ctx.fillText(dateStr, x, padding + 40 + chartHeight + 15);
    }
  });
  
  // 범례
  ctx.fillStyle = CHART_CONFIG.COLORS.VOICE;
  ctx.fillRect(padding, canvas.height - 30, 15, 15);
  ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
  ctx.font = CHART_CONFIG.FONTS.LEGEND;
  ctx.textAlign = 'left';
  ctx.fillText('활성 사용자', padding + 20, canvas.height - 20);
  
  ctx.fillStyle = CHART_CONFIG.COLORS.MESSAGE;
  ctx.fillRect(padding + 120, canvas.height - 30, 15, 15);
  ctx.fillText('총 점수', padding + 140, canvas.height - 20);
  
  return canvas.toBuffer();
}

/**
 * 비교 바 차트 생성
 * @param {Array} data - 비교 데이터
 * @param {string} title - 차트 제목
 * @returns {Buffer} 차트 이미지 버퍼
 */
function generateComparisonBarChart(data, title) {
  const canvas = createCanvas(CHART_CONFIG.DEFAULT_WIDTH, CHART_CONFIG.DEFAULT_HEIGHT + 100); // 더 큰 높이
  const ctx = canvas.getContext('2d');
  
  // 배경 설정
  ctx.fillStyle = CHART_CONFIG.COLORS.BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const padding = CHART_CONFIG.PADDING;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2 - 60; // 제목과 라벨 공간
  
  // 제목 그리기
  ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
  ctx.font = CHART_CONFIG.FONTS.TITLE;
  ctx.textAlign = 'center';
  ctx.fillText(title, canvas.width / 2, 30);
  
  // 최대값 계산
  const maxScore = Math.max(...data.map(d => parseFloat(d.total_score) || 0));
  
  if (maxScore === 0) {
    ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
    ctx.font = CHART_CONFIG.FONTS.LABEL;
    ctx.textAlign = 'center';
    ctx.fillText('비교할 데이터가 없습니다', canvas.width / 2, canvas.height / 2);
    return canvas.toBuffer();
  }
  
  // 축 그리기
  drawAxes(ctx, padding, padding + 40, chartWidth, chartHeight);
  
  // 사용자별 바 그리기
  const barWidth = chartWidth / (data.length * 5 + data.length + 1);
  const groupWidth = barWidth * 5 + barWidth;
  
  data.forEach((user, i) => {
    const x = padding + (i * groupWidth) + barWidth;
    
    drawBar(ctx, x, padding + 40, barWidth, chartHeight, parseFloat(user.voice_score) || 0, maxScore, CHART_CONFIG.COLORS.VOICE);
    drawBar(ctx, x + barWidth, padding + 40, barWidth, chartHeight, parseFloat(user.message_score) || 0, maxScore, CHART_CONFIG.COLORS.MESSAGE);
    drawBar(ctx, x + barWidth * 2, padding + 40, barWidth, chartHeight, parseFloat(user.reaction_score) || 0, maxScore, CHART_CONFIG.COLORS.REACTION);
    drawBar(ctx, x + barWidth * 3, padding + 40, barWidth, chartHeight, parseFloat(user.streaming_score) || 0, maxScore, CHART_CONFIG.COLORS.STREAMING);
    
    // 사용자 이름 라벨
    ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
    ctx.font = CHART_CONFIG.FONTS.AXIS;
    ctx.textAlign = 'center';
    const userName = user.display_name || user.discord_id;
    const shortName = userName.length > 8 ? userName.substring(0, 8) + '...' : userName;
    ctx.fillText(shortName, x + groupWidth / 2 - barWidth / 2, padding + 40 + chartHeight + 15);
    
    // 총점 표시
    ctx.fillText(`${Math.round(parseFloat(user.total_score) || 0)}점`, x + groupWidth / 2 - barWidth / 2, padding + 40 + chartHeight + 30);
  });
  
  // 범례 그리기
  drawLegend(ctx, padding, canvas.height - 30);
  
  return canvas.toBuffer();
}

/**
 * 데이터 없음 차트 생성
 * @param {string} message - 표시할 메시지
 * @returns {Buffer} 차트 이미지 버퍼
 */
function generateNoDataChart(message) {
  const canvas = createCanvas(CHART_CONFIG.DEFAULT_WIDTH, CHART_CONFIG.DEFAULT_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = CHART_CONFIG.COLORS.BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
  ctx.font = CHART_CONFIG.FONTS.TITLE;
  ctx.textAlign = 'center';
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
  
  return canvas.toBuffer();
}

/**
 * 오류 차트 생성
 * @param {string} message - 오류 메시지
 * @returns {Buffer} 차트 이미지 버퍼
 */
function generateErrorChart(message) {
  const canvas = createCanvas(CHART_CONFIG.DEFAULT_WIDTH, CHART_CONFIG.DEFAULT_HEIGHT);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = CHART_CONFIG.COLORS.BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#e74c3c';
  ctx.font = CHART_CONFIG.FONTS.TITLE;
  ctx.textAlign = 'center';
  ctx.fillText('❌ ' + message, canvas.width / 2, canvas.height / 2);
  
  return canvas.toBuffer();
}

/**
 * 축 그리기 헬퍼 함수
 */
function drawAxes(ctx, x, y, width, height) {
  ctx.strokeStyle = CHART_CONFIG.COLORS.AXIS;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();
}

/**
 * 바 그리기 헬퍼 함수
 */
function drawBar(ctx, x, y, width, maxHeight, value, maxValue, color) {
  if (maxValue === 0) return;
  
  const height = (value / maxValue) * maxHeight;
  ctx.fillStyle = color;
  ctx.fillRect(x, y + maxHeight - height, width, height);
}

/**
 * 라인 그리기 헬퍼 함수
 */
function drawLine(ctx, data, field, color, startX, startY, stepX, chartHeight, maxValue) {
  if (maxValue === 0) return;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  data.forEach((point, i) => {
    const x = startX + i * stepX;
    const y = startY + chartHeight - (parseFloat(point[field]) / maxValue) * chartHeight;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  
  ctx.stroke();
}

/**
 * 범례 그리기 헬퍼 함수
 */
function drawLegend(ctx, x, y) {
  const legends = [
    { color: CHART_CONFIG.COLORS.VOICE, label: '음성' },
    { color: CHART_CONFIG.COLORS.MESSAGE, label: '메시지' },
    { color: CHART_CONFIG.COLORS.REACTION, label: '반응' },
    { color: CHART_CONFIG.COLORS.STREAMING, label: '스트리밍' },
    { color: CHART_CONFIG.COLORS.OTHER, label: '기타' }
  ];
  
  legends.forEach((legend, i) => {
    const legendX = x + i * 80;
    ctx.fillStyle = legend.color;
    ctx.fillRect(legendX, y, 15, 15);
    ctx.fillStyle = CHART_CONFIG.COLORS.TEXT;
    ctx.font = CHART_CONFIG.FONTS.LEGEND;
    ctx.textAlign = 'left';
    ctx.fillText(legend.label, legendX + 20, y + 12);
  });
}

module.exports = {
  generateUserActivityChart,
  generateServerActivityChart,
  generateUserComparisonChart,
  getUserActivityData,
  getServerActivityData,
  getUserComparisonData
}; 