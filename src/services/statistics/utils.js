/**
 * 통계 계산 및 분석을 위한 유틸리티 함수들
 * 일일 집계 데이터를 우선 사용하고, 없을 경우 원시 데이터를 사용하는 하이브리드 접근법
 */

const db = require('../database');
const { getAggregatedStats, getGuildSummaryStats } = require('./daily');

/**
 * 사용자 통계 요약 조회 (집계 데이터 우선 사용)
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {number} days - 조회할 일수
 */
async function getUserStatsSummary(userId, guildId, days = 30) {
  try {
    // 먼저 집계된 데이터 시도
    const aggregatedData = await getAggregatedStats(userId, days, guildId);
    
    if (aggregatedData && aggregatedData.length > 0) {
      // 집계 데이터가 있는 경우
      return await buildUserSummaryFromAggregated(userId, guildId, aggregatedData, days);
    } else {
      // 집계 데이터가 없는 경우 원시 데이터 사용
      return await buildUserSummaryFromRaw(userId, guildId, days);
    }
  } catch (error) {
    console.error('Error getting user stats summary:', error);
    return null;
  }
}

/**
 * 집계 데이터에서 사용자 요약 구성
 */
async function buildUserSummaryFromAggregated(userId, guildId, aggregatedData, days) {
  // 집계 데이터 합산
  const totals = aggregatedData.reduce((acc, day) => {
    acc.voiceScore += parseFloat(day.voice_score) || 0;
    acc.voiceTime += parseInt(day.voice_time) || 0;
    acc.voiceSessions += parseInt(day.voice_sessions) || 0;
    acc.messageScore += parseFloat(day.message_score) || 0;
    acc.messageCount += parseInt(day.message_count) || 0;
    acc.reactionScore += parseFloat(day.reaction_score) || 0;
    acc.reactionCount += parseInt(day.reaction_count) || 0;
    acc.streamingScore += parseFloat(day.streaming_score) || 0;
    acc.streamingTime += parseInt(day.streaming_time) || 0;
    acc.otherScore += parseFloat(day.other_score) || 0;
    acc.otherCount += parseInt(day.other_count) || 0;
    acc.totalScore += parseFloat(day.total_score) || 0;
    acc.totalActivities += parseInt(day.total_activities) || 0;
    return acc;
  }, {
    voiceScore: 0, voiceTime: 0, voiceSessions: 0,
    messageScore: 0, messageCount: 0,
    reactionScore: 0, reactionCount: 0,
    streamingScore: 0, streamingTime: 0,
    otherScore: 0, otherCount: 0,
    totalScore: 0, totalActivities: 0
  });

  // 사용자 기본 정보 조회
  const userInfo = await db.query(
    'SELECT * FROM users WHERE discord_id = $1',
    [userId]
  );

  // 길드 내 순위 조회 (현재 점수 기준)
  const rankQuery = await db.query(`
    SELECT COUNT(*) + 1 as rank 
    FROM users 
    WHERE guild_id = $1 AND current_score > (
      SELECT current_score FROM users WHERE discord_id = $2
    )
  `, [guildId, userId]);

  return {
    basic: {
      user: userInfo.rows[0] || null,
      rank: parseInt(rankQuery.rows[0]?.rank) || 1,
      days: days
    },
    activity: {
      voice: {
        score: totals.voiceScore,
        time: totals.voiceTime,
        sessions: totals.voiceSessions,
        avgSessionTime: totals.voiceSessions > 0 ? Math.round(totals.voiceTime / totals.voiceSessions) : 0
      },
      message: {
        score: totals.messageScore,
        count: totals.messageCount,
        avgScore: totals.messageCount > 0 ? (totals.messageScore / totals.messageCount).toFixed(1) : 0
      },
      reaction: {
        score: totals.reactionScore,
        count: totals.reactionCount
      },
      streaming: {
        score: totals.streamingScore,
        time: totals.streamingTime
      },
      other: {
        score: totals.otherScore,
        count: totals.otherCount
      },
      total: {
        score: totals.totalScore,
        activities: totals.totalActivities,
        avgDailyScore: aggregatedData.length > 0 ? (totals.totalScore / aggregatedData.length).toFixed(1) : 0
      }
    },
    isConsistent: calculateConsistency(aggregatedData),
    activeDays: aggregatedData.filter(day => parseFloat(day.total_score) > 0).length,
    source: 'aggregated'
  };
}

/**
 * 원시 데이터에서 사용자 요약 구성 (폴백)
 */
async function buildUserSummaryFromRaw(userId, guildId, days) {
  // 원시 데이터 쿼리들
  const voiceQuery = await db.query(`
    SELECT 
      COALESCE(SUM(score_awarded), 0) as total_score,
      COUNT(CASE WHEN activity_type LIKE 'voice_%' THEN 1 END) as sessions
    FROM activities 
    WHERE user_id = $1 AND activity_type LIKE 'voice%' 
    AND timestamp >= NOW() - INTERVAL '${days} days'
  `, [userId]);

  const messageQuery = await db.query(`
    SELECT 
      COALESCE(SUM(score_awarded), 0) as total_score,
      COUNT(*) as message_count
    FROM activities 
    WHERE user_id = $1 AND activity_type = 'message_create' 
    AND timestamp >= NOW() - INTERVAL '${days} days'
  `, [userId]);

  const reactionQuery = await db.query(`
    SELECT 
      COALESCE(SUM(score_awarded), 0) as total_score,
      COUNT(*) as reaction_count
    FROM activities 
    WHERE user_id = $1 AND activity_type IN ('reaction_add', 'reaction_remove')
    AND timestamp >= NOW() - INTERVAL '${days} days'
  `, [userId]);

  const otherQuery = await db.query(`
    SELECT 
      COALESCE(SUM(score_awarded), 0) as total_score,
      COUNT(*) as activity_count
    FROM activities 
    WHERE user_id = $1 AND activity_type NOT LIKE 'voice%' AND activity_type != 'message_create' 
    AND activity_type NOT IN ('reaction_add', 'reaction_remove')
    AND timestamp >= NOW() - INTERVAL '${days} days'
  `, [userId]);

  const totalQuery = await db.query(`
    SELECT 
      COALESCE(SUM(score_awarded), 0) as total_score,
      COUNT(*) as total_activities
    FROM activities 
    WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '${days} days'
  `, [userId]);

  // 일별 활동 조회 (일관성 계산용)
  const dailyQuery = await db.query(`
    SELECT 
      DATE(timestamp) as date,
      SUM(score_awarded) as daily_score
    FROM activities 
    WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(timestamp)
    ORDER BY date
  `, [userId]);

  const voice = voiceQuery.rows[0];
  const message = messageQuery.rows[0];
  const reaction = reactionQuery.rows[0];
  const other = otherQuery.rows[0];
  const total = totalQuery.rows[0];
  const dailyData = dailyQuery.rows;

  // 사용자 기본 정보 조회
  const userInfo = await db.query(
    'SELECT * FROM users WHERE discord_id = $1',
    [userId]
  );

  // 길드 내 순위 조회
  const rankQuery = await db.query(`
    SELECT COUNT(*) + 1 as rank 
    FROM users 
    WHERE guild_id = $1 AND current_score > (
      SELECT current_score FROM users WHERE discord_id = $2
    )
  `, [guildId, userId]);

  return {
    basic: {
      user: userInfo.rows[0] || null,
      rank: parseInt(rankQuery.rows[0]?.rank) || 1,
      days: days
    },
    activity: {
      voice: {
        score: parseFloat(voice.total_score) || 0,
        time: parseInt(voice.total_time) || 0,
        sessions: parseInt(voice.sessions) || 0,
        avgSessionTime: voice.sessions > 0 ? Math.round(voice.total_time / voice.sessions) : 0
      },
      message: {
        score: parseFloat(message.total_score) || 0,
        count: parseInt(message.message_count) || 0,
        avgScore: message.message_count > 0 ? (message.total_score / message.message_count).toFixed(1) : 0
      },
      reaction: {
        score: parseFloat(reaction.total_score) || 0,
        count: parseInt(reaction.reaction_count) || 0
      },
      streaming: {
        score: 0,  // 스트리밍은 other에 포함
        time: 0
      },
      other: {
        score: parseFloat(other.total_score) || 0,
        count: parseInt(other.activity_count) || 0
      },
      total: {
        score: parseFloat(total.total_score) || 0,
        activities: parseInt(total.total_activities) || 0,
        avgDailyScore: dailyData.length > 0 ? (total.total_score / dailyData.length).toFixed(1) : 0
      }
    },
    isConsistent: calculateConsistency(dailyData),
    activeDays: dailyData.filter(day => parseFloat(day.daily_score || day.total_score) > 0).length,
    source: 'raw'
  };
}

/**
 * 서버 통계 요약 조회 (집계 데이터 우선 사용)
 * @param {string} guildId - 길드 ID
 * @param {number} days - 조회할 일수
 */
async function getServerStatsSummary(guildId, days = 30) {
  try {
    // 먼저 길드 요약 데이터 시도
    const guildSummary = await getGuildSummaryStats(guildId, days);
    
    if (guildSummary && guildSummary.length > 0) {
      // 집계 데이터가 있는 경우
      return await buildServerSummaryFromAggregated(guildId, guildSummary, days);
    } else {
      // 집계 데이터가 없는 경우 원시 데이터 사용
      return await buildServerSummaryFromRaw(guildId, days);
    }
  } catch (error) {
    console.error('Error getting server stats summary:', error);
    return null;
  }
}

/**
 * 집계 데이터에서 서버 요약 구성
 */
async function buildServerSummaryFromAggregated(guildId, guildSummary, days) {
  // 집계 데이터 합산
  const totals = guildSummary.reduce((acc, day) => {
    acc.activeUsers += parseInt(day.active_users) || 0;
    acc.totalScore += parseFloat(day.total_score) || 0;
    acc.totalActivities += parseInt(day.total_activities) || 0;
    return acc;
  }, {
    activeUsers: 0,
    totalScore: 0,
    totalActivities: 0
  });

  // 평균값 계산
  const avgActiveUsers = guildSummary.length > 0 ? totals.activeUsers / guildSummary.length : 0;
  const avgDailyScore = guildSummary.length > 0 ? totals.totalScore / guildSummary.length : 0;
  const avgActivities = guildSummary.length > 0 ? totals.totalActivities / guildSummary.length : 0;

  // 전체 사용자 수 조회
  const totalUsersQuery = await db.query(
    'SELECT COUNT(*) as total FROM users WHERE guild_id = $1',
    [guildId]
  );

  // 활동 타입별 분석을 위해 집계 데이터 조회
  const typeBreakdownQuery = await db.query(`
    SELECT 
      'voice' as type,
      SUM(voice_score) as total_score,
      SUM(voice_time) as total_duration,
      COUNT(*) as count
    FROM daily_stats 
    WHERE guild_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
    AND voice_score > 0
    UNION ALL
    SELECT 
      'message' as type,
      SUM(message_score) as total_score,
      SUM(message_count) as total_duration,
      COUNT(*) as count
    FROM daily_stats 
    WHERE guild_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
    AND message_score > 0
    UNION ALL
    SELECT 
      'reaction' as type,
      SUM(reaction_given_score + reaction_received_score) as total_score,
      SUM(reaction_given_count + reaction_received_count) as total_duration,
      COUNT(*) as count
    FROM daily_stats 
    WHERE guild_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
    AND (reaction_given_score > 0 OR reaction_received_score > 0)
    ORDER BY total_score DESC
  `, [guildId]);

  return {
    basic: {
      total_users: parseInt(totalUsersQuery.rows[0]?.total) || 0,
      active_users: Math.round(avgActiveUsers),
      days: days
    },
    activity: {
      total_score: totals.totalScore,
      total_activities: totals.totalActivities,
      avg_daily_score: avgDailyScore.toFixed(1),
      avg_daily_activities: avgActivities.toFixed(1)
    },
    typeBreakdown: typeBreakdownQuery.rows.map(row => ({
      type: row.type,
      score: parseFloat(row.total_score) || 0,
      count: parseInt(row.count) || 0
    })),
    source: 'aggregated'
  };
}

/**
 * 원시 데이터에서 서버 요약 구성 (폴백)
 */
async function buildServerSummaryFromRaw(guildId, days) {
  // 먼저 길드 내부 ID 조회
  const guildResult = await db.query(
    'SELECT id FROM guilds WHERE guild_id = $1',
    [guildId]
  );
  
  if (guildResult.rows.length === 0) {
    logger.warn(`Guild not found: ${guildId}`);
    return {
      basic: { total_users: 0, active_users: 0, days: days },
      activity: { total_score: 0, total_activities: 0, avg_daily_score: '0', avg_daily_activities: '0' },
      typeBreakdown: [],
      source: 'raw'
    };
  }
  
  const internalGuildId = guildResult.rows[0].id;

  // 기본 서버 통계 (내부 길드 ID 사용)
  const basicQuery = await db.query(`
    SELECT 
      COUNT(DISTINCT u.discord_id) as total_users,
      COUNT(DISTINCT CASE WHEN a.timestamp >= NOW() - INTERVAL '${days} days' THEN a.user_id END) as active_users
    FROM users u
    LEFT JOIN activities a ON u.id = a.user_id AND a.guild_id = $2
    WHERE u.guild_id = $1
  `, [internalGuildId, guildId]);

  // 활동 통계
  const activityQuery = await db.query(`
    SELECT 
      COALESCE(SUM(a.score_awarded), 0) as total_score,
      COUNT(*) as total_activities
    FROM activities a
    INNER JOIN users u ON a.user_id = u.id 
    WHERE u.guild_id = $1 AND a.timestamp >= NOW() - INTERVAL '${days} days'
  `, [internalGuildId]);

  // 활동 타입별 분석
  const typeBreakdownQuery = await db.query(`
    SELECT 
      CASE 
        WHEN a.activity_type LIKE 'voice%' THEN 'voice'
        WHEN a.activity_type = 'message_create' THEN 'message'
        WHEN a.activity_type IN ('reaction_add', 'reaction_remove') THEN 'reaction_given'
        ELSE 'other'
      END as activity_type,
      SUM(a.score_awarded) as total_score,
      COUNT(*) as count
    FROM activities a
    INNER JOIN users u ON a.user_id = u.id 
    WHERE u.guild_id = $1 AND a.timestamp >= NOW() - INTERVAL '${days} days'
    GROUP BY activity_type
    ORDER BY total_score DESC
  `, [internalGuildId]);

  const basic = basicQuery.rows[0];
  const activity = activityQuery.rows[0];

  return {
    basic: {
      total_users: parseInt(basic.total_users) || 0,
      active_users: parseInt(basic.active_users) || 0,
      days: days
    },
    activity: {
      total_score: parseFloat(activity.total_score) || 0,
      total_activities: parseInt(activity.total_activities) || 0,
      avg_daily_score: days > 0 ? (activity.total_score / days).toFixed(1) : '0',
      avg_daily_activities: days > 0 ? (activity.total_activities / days).toFixed(1) : '0'
    },
    typeBreakdown: typeBreakdownQuery.rows.map(row => ({
      type: row.activity_type,
      score: parseFloat(row.total_score) || 0,
      count: parseInt(row.count) || 0
    })),
    source: 'raw'
  };
}

/**
 * 일관성 계산 (변이계수 기반)
 */
function calculateConsistency(dailyData) {
  if (!dailyData || dailyData.length < 3) return false;

  const scores = dailyData.map(day => parseFloat(day.daily_score || day.total_score) || 0);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  
  if (mean === 0) return false;

  const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean; // 변이계수

  // 변이계수가 0.5 미만이면 일관적으로 간주
  return cv < 0.5;
}

/**
 * 시간대별 활동 분석 (원시 데이터 사용 - 집계 데이터에는 시간 정보 없음)
 * @param {string} guildId - 길드 ID
 * @param {number} days - 조회할 일수
 */
async function getHourlyActivityAnalysis(guildId, days = 30) {
  try {
    const hourlyQuery = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM timestamp) as hour,
        COUNT(*) as activity_count,
        SUM(score_awarded) as total_score,
        COUNT(DISTINCT user_id) as unique_users
      FROM activities 
      WHERE guild_id = $1 AND timestamp >= NOW() - INTERVAL '${days} days'
      GROUP BY EXTRACT(HOUR FROM timestamp)
      ORDER BY hour
    `, [guildId]);

    const hourlyData = hourlyQuery.rows;
    
    if (hourlyData.length === 0) return null;

    // 시간대별 분류
    const categories = {
      dawn: { name: '새벽 (0-6시)', hours: [0,1,2,3,4,5,6], data: [], summary: {} },
      morning: { name: '오전 (7-12시)', hours: [7,8,9,10,11,12], data: [], summary: {} },
      afternoon: { name: '오후 (13-18시)', hours: [13,14,15,16,17,18], data: [], summary: {} },
      evening: { name: '저녁 (19-23시)', hours: [19,20,21,22,23], data: [], summary: {} }
    };

    // 데이터 분류
    hourlyData.forEach(hour => {
      const h = parseInt(hour.hour);
      for (const [key, category] of Object.entries(categories)) {
        if (category.hours.includes(h)) {
          category.data.push(hour);
          break;
        }
      }
    });

    // 각 시간대별 요약 계산
    Object.keys(categories).forEach(key => {
      const category = categories[key];
      const data = category.data;
      
      category.summary = {
        totalActivities: data.reduce((sum, h) => sum + parseInt(h.activity_count), 0),
        totalScore: data.reduce((sum, h) => sum + parseFloat(h.total_score), 0),
        avgScore: 0,
        peakHour: null
      };

      if (data.length > 0) {
        category.summary.avgScore = category.summary.totalScore / category.summary.totalActivities;
        category.summary.peakHour = data.reduce((max, h) => 
          parseInt(h.activity_count) > parseInt(max.activity_count) ? h : max
        );
      }
    });

    // 최고 활동 시간 찾기
    const mostActiveHour = hourlyData.reduce((max, hour) => 
      parseInt(hour.activity_count) > parseInt(max.activity_count) ? hour : max
    );

    return {
      hourly: hourlyData,
      categories,
      mostActiveHour,
      source: 'raw' // 시간대 분석은 항상 원시 데이터 사용
    };
  } catch (error) {
    console.error('Error getting hourly activity analysis:', error);
    return null;
  }
}

// 기존 함수들은 그대로 유지하되, 집계 데이터를 우선 사용하도록 수정

/**
 * 사용자 성장 트렌드 분석 (집계 데이터 우선 사용)
 * @param {string} userId - 사용자 ID
 * @param {string} guildId - 길드 ID
 * @param {number} days - 분석 기간
 */
async function getUserGrowthTrend(userId, guildId, days = 30) {
  try {
    // 먼저 집계된 데이터 시도
    const aggregatedData = await getAggregatedStats(userId, days, guildId);
    
    if (aggregatedData && aggregatedData.length >= 7) {
      // 집계 데이터가 충분한 경우
      return analyzeGrowthFromAggregated(aggregatedData);
    } else {
      // 집계 데이터가 부족한 경우 원시 데이터 사용
      return await analyzeGrowthFromRaw(userId, guildId, days);
    }
  } catch (error) {
    console.error('Error getting user growth trend:', error);
    return null;
  }
}

/**
 * 집계 데이터에서 성장 트렌드 분석
 */
function analyzeGrowthFromAggregated(aggregatedData) {
  // 일별 점수 배열
  const dailyScores = aggregatedData.map(day => parseFloat(day.total_score) || 0);
  
  // 성장률 계산 (첫 주 vs 마지막 주)
  const firstWeek = dailyScores.slice(0, 7);
  const lastWeek = dailyScores.slice(-7);
  
  const firstWeekAvg = firstWeek.reduce((sum, score) => sum + score, 0) / firstWeek.length;
  const lastWeekAvg = lastWeek.reduce((sum, score) => sum + score, 0) / lastWeek.length;
  
  const growthRate = firstWeekAvg > 0 ? ((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100 : 0;

  // 일관성 계산
  const mean = dailyScores.reduce((sum, score) => sum + score, 0) / dailyScores.length;
  const variance = dailyScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / dailyScores.length;
  const consistency = Math.sqrt(variance);

  // 주별 트렌드 계산
  const weeklyTrend = [];
  for (let i = 0; i < aggregatedData.length; i += 7) {
    const week = aggregatedData.slice(i, i + 7);
    const weekTotal = week.reduce((sum, day) => sum + parseFloat(day.total_score), 0);
    const weekActivities = week.reduce((sum, day) => sum + parseInt(day.total_activities), 0);
    
    weeklyTrend.push({
      week: Math.floor(i / 7) + 1,
      total_score: weekTotal,
      total_activities: weekActivities,
      avg_score: weekTotal / week.length
    });
  }

  return {
    dailyTrend: aggregatedData.map(day => ({
      date: day.date,
      score: parseFloat(day.total_score) || 0,
      activities: parseInt(day.total_activities) || 0
    })),
    weeklyTrend,
    growthRate,
    consistency,
    analysis: {
      avgDailyScore: mean,
      totalDays: aggregatedData.length,
      activeDays: aggregatedData.filter(day => parseFloat(day.total_score) > 0).length,
      isConsistent: consistency / mean < 0.5
    },
    source: 'aggregated'
  };
}

/**
 * 원시 데이터에서 성장 트렌드 분석 (폴백)
 */
async function analyzeGrowthFromRaw(userId, guildId, days) {
  const dailyQuery = await db.query(`
    SELECT 
      DATE(timestamp) as date,
      SUM(score_awarded) as total_score,
      COUNT(*) as total_activities
    FROM activities 
    WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(timestamp)
    ORDER BY date
  `, [userId]);

  const dailyData = dailyQuery.rows;
  
  if (dailyData.length < 7) return null;

  return analyzeGrowthFromAggregated(dailyData.map(day => ({
    date: day.date,
    total_score: day.total_score,
    total_activities: day.total_activities
  })));
}

/**
 * 트렌드 예측 (기존 함수 유지)
 */
function predictTrend(dailyData, futureDays = 7) {
  if (!dailyData || dailyData.length < 7) {
    return null;
  }

  const scores = dailyData.map(day => parseFloat(day.score || day.total_score) || 0);
  const n = scores.length;

  // 선형 회귀 계산
  const xValues = Array.from({length: n}, (_, i) => i);
  const yValues = scores;

  const sumX = xValues.reduce((sum, x) => sum + x, 0);
  const sumY = yValues.reduce((sum, y) => sum + y, 0);
  const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
  const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // 미래 예측
  const predictions = [];
  for (let i = 0; i < futureDays; i++) {
    const futureX = n + i;
    const predictedValue = slope * futureX + intercept;
    predictions.push({
      day: i + 1,
      predicted_value: Math.max(0, predictedValue)
    });
  }

  // R² 계산 (신뢰도)
  const yMean = sumY / n;
  const ssTotal = yValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
  const ssResidual = yValues.reduce((sum, y, i) => {
    const predicted = slope * i + intercept;
    return sum + Math.pow(y - predicted, 2);
  }, 0);
  
  const rSquared = 1 - (ssResidual / ssTotal);
  
  let reliability = 'low';
  if (rSquared > 0.7) reliability = 'high';
  else if (rSquared > 0.4) reliability = 'medium';

  // 트렌드 방향
  let trend = 'stable';
  if (slope > 0.5) trend = 'increasing';
  else if (slope < -0.5) trend = 'decreasing';

  return {
    predictions,
    reliability,
    trend,
    rSquared,
    slope
  };
}

/**
 * 점수 분포 분석 (집계 데이터 우선 사용)
 * @param {string} guildId - 길드 ID  
 * @param {number} days - 분석 기간
 */
async function getScoreDistributionAnalysis(guildId, days = 30) {
  try {
    // 먼저 집계 데이터 시도
    const aggregatedQuery = await db.query(`
      SELECT 
        user_id,
        SUM(total_score) as total_score,
        u.display_name
      FROM daily_stats ds
      LEFT JOIN users u ON ds.user_id = u.discord_id
      WHERE ds.guild_id = $1 AND ds.date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY user_id, u.display_name
      HAVING SUM(total_score) > 0
      ORDER BY total_score DESC
    `, [guildId]);

    if (aggregatedQuery.rows.length > 0) {
      return buildDistributionFromData(aggregatedQuery.rows, 'aggregated');
    } else {
      // 집계 데이터가 없는 경우 원시 데이터 사용
      const rawQuery = await db.query(`
        SELECT 
          user_id,
          SUM(score_awarded) as total_score,
          u.display_name
        FROM activities a
        LEFT JOIN users u ON a.user_id = u.discord_id
        WHERE a.guild_id = $1 AND a.timestamp >= NOW() - INTERVAL '${days} days'
        GROUP BY user_id, u.display_name
        HAVING SUM(score_awarded) > 0
        ORDER BY total_score DESC
      `, [guildId]);

      return buildDistributionFromData(rawQuery.rows, 'raw');
    }
  } catch (error) {
    console.error('Error getting score distribution analysis:', error);
    return null;
  }
}

/**
 * 데이터에서 분포 분석 구성
 */
function buildDistributionFromData(userData, source) {
  if (userData.length === 0) return null;

  const scores = userData.map(user => parseFloat(user.total_score) || 0).sort((a, b) => a - b);
  
  // 기본 통계
  const n = scores.length;
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 0 ? (scores[n/2 - 1] + scores[n/2]) / 2 : scores[Math.floor(n/2)];
  
  // 사분위수
  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  const q1 = scores[q1Index];
  const q3 = scores[q3Index];
  const iqr = q3 - q1;
  
  // 표준편차
  const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  
  // 최빈값 (가장 가까운 값들의 범위에서)
  const mode = calculateMode(scores);

  return {
    statistics: {
      mean,
      median,
      mode,
      stdDev,
      min: scores[0],
      max: scores[n-1],
      q1,
      q3,
      iqr
    },
    users: userData,
    source
  };
}

/**
 * 최빈값 계산 (근사값)
 */
function calculateMode(scores) {
  if (scores.length === 0) return 0;
  
  // 점수를 구간별로 나누어 빈도 계산
  const binSize = Math.max(1, Math.ceil((Math.max(...scores) - Math.min(...scores)) / 10));
  const bins = {};
  
  scores.forEach(score => {
    const bin = Math.floor(score / binSize) * binSize;
    bins[bin] = (bins[bin] || 0) + 1;
  });
  
  const maxBin = Object.keys(bins).reduce((max, bin) => 
    bins[bin] > bins[max] ? bin : max
  );
  
  return parseFloat(maxBin) + binSize / 2;
}

module.exports = {
  getUserStatsSummary,
  getServerStatsSummary,
  getHourlyActivityAnalysis,
  getUserGrowthTrend,
  predictTrend,
  getScoreDistributionAnalysis
};