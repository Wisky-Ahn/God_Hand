/**
 * 시즌 관리 유틸리티 함수들
 * 시즌 데이터 조작 및 조회를 위한 헬퍼 함수들
 */
const db = require('../database');
const logger = require('../../utils/logger');

/**
 * 시즌 정보 포맷팅
 */
function formatSeasonInfo(season, includeStats = false) {
  if (!season) return null;

  const now = new Date();
  const startDate = new Date(season.start_date);
  const endDate = new Date(season.end_date);
  const isActive = season.status === 'active';
  
  // 진행률 계산
  const totalDuration = endDate - startDate;
  const elapsed = now - startDate;
  const progressPercent = isActive ? Math.min(Math.max(elapsed / totalDuration * 100, 0), 100) : 100;
  
  // 남은 시간 계산
  const timeLeft = isActive ? Math.max(endDate - now, 0) : 0;
  const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const formatted = {
    id: season.id,
    name: season.name,
    seasonNumber: season.season_number,
    status: season.status,
    startDate: startDate.toLocaleDateString('ko-KR'),
    endDate: endDate.toLocaleDateString('ko-KR'),
    isActive,
    progress: {
      percent: Math.round(progressPercent),
      daysLeft,
      hoursLeft,
      timeLeftText: isActive ? (daysLeft > 0 ? `${daysLeft}일 ${hoursLeft}시간` : `${hoursLeft}시간`) : '완료됨'
    }
  };

  if (includeStats) {
    formatted.stats = {
      totalParticipants: season.total_participants || 0,
      totalActivities: season.total_activities || 0,
      settings: season.settings || {}
    };
  }

  return formatted;
}

/**
 * 시즌 순위 데이터 포맷팅
 */
function formatSeasonRankings(rankings) {
  return rankings.map((ranking, index) => ({
    rank: ranking.final_rank || (index + 1),
    userId: ranking.user_id,
    discordId: ranking.discord_id,
    username: ranking.username,
    displayName: ranking.display_name || ranking.username,
    score: {
      total: ranking.final_score || 0,
      voice: ranking.voice_score || 0,
      message: ranking.message_score || 0,
      reaction: ranking.reaction_score || 0,
      other: ranking.other_score || 0
    },
    activity: {
      voiceTime: ranking.total_voice_time || 0,
      voiceTimeFormatted: formatDuration(ranking.total_voice_time || 0),
      messageCount: ranking.total_messages || 0
    },
    achievements: {
      isWinner: ranking.is_winner || false,
      isTop3: ranking.is_top_3 || false,
      isTop10: ranking.is_top_10 || false
    }
  }));
}

/**
 * 평생 통계 데이터 포맷팅
 */
function formatLifetimeStats(stats) {
  if (!stats) return null;

  return {
    userId: stats.user_id,
    totalScore: stats.total_score || 0,
    totalVoiceTime: stats.total_voice_time || 0,
    totalVoiceTimeFormatted: formatDuration(stats.total_voice_time || 0),
    totalMessages: stats.total_messages || 0,
    seasonsParticipated: stats.total_seasons_participated || 0,
    achievements: {
      firstPlaceWins: stats.first_place_wins || 0,
      top3Finishes: stats.top_3_finishes || 0,
      top10Finishes: stats.top_10_finishes || 0,
      bestRank: stats.best_rank || 0,
      worstRank: stats.worst_rank || 0,
      averageRank: stats.average_rank || 0,
      currentStreak: stats.current_season_streak || 0,
      longestStreak: stats.longest_season_streak || 0
    }
  };
}

/**
 * 시간 포맷팅 (초 단위를 읽기 쉬운 형태로)
 */
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0분';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  } else if (minutes > 0) {
    return `${minutes}분 ${remainingSeconds}초`;
  } else {
    return `${remainingSeconds}초`;
  }
}

/**
 * 시즌 상태 검증
 */
function validateSeasonData(seasonData) {
  const errors = [];

  if (!seasonData.name || seasonData.name.trim().length === 0) {
    errors.push('시즌 이름이 필요합니다');
  }

  if (!seasonData.start_date) {
    errors.push('시작 날짜가 필요합니다');
  }

  if (!seasonData.end_date) {
    errors.push('종료 날짜가 필요합니다');
  }

  if (seasonData.start_date && seasonData.end_date) {
    const start = new Date(seasonData.start_date);
    const end = new Date(seasonData.end_date);
    
    if (end <= start) {
      errors.push('종료 날짜는 시작 날짜보다 뒤여야 합니다');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * 순위 변동 계산
 */
async function calculateRankChanges(currentSeasonId, previousSeasonId) {
  try {
    if (!previousSeasonId) return [];

    const currentRankings = await db.query(`
      SELECT user_id, final_rank as current_rank 
      FROM season_rankings 
      WHERE season_id = $1
      ORDER BY final_rank
    `, [currentSeasonId]);

    const previousRankings = await db.query(`
      SELECT user_id, final_rank as previous_rank 
      FROM season_rankings 
      WHERE season_id = $1
    `, [previousSeasonId]);

    // 이전 시즌 순위를 맵으로 변환
    const previousRankMap = new Map();
    previousRankings.rows.forEach(row => {
      previousRankMap.set(row.user_id, row.previous_rank);
    });

    // 순위 변동 계산
    return currentRankings.rows.map(current => {
      const previousRank = previousRankMap.get(current.user_id);
      
      return {
        userId: current.user_id,
        currentRank: current.current_rank,
        previousRank: previousRank || null,
        change: previousRank ? (previousRank - current.current_rank) : null, // 양수면 상승, 음수면 하락
        isNew: !previousRank,
        changeText: previousRank 
          ? (previousRank === current.current_rank ? '변동없음' 
             : previousRank > current.current_rank ? `${previousRank - current.current_rank}등 상승` 
             : `${current.current_rank - previousRank}등 하락`)
          : '신규'
      };
    });

  } catch (error) {
    logger.error('순위 변동 계산 중 에러:', error);
    return [];
  }
}

/**
 * 시즌별 통계 집계
 */
async function aggregateSeasonStats(seasonId) {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(DISTINCT sr.user_id) as total_participants,
        SUM(sr.final_score) as total_score,
        AVG(sr.final_score) as average_score,
        MAX(sr.final_score) as highest_score,
        SUM(sr.total_voice_time) as total_voice_time,
        SUM(sr.total_messages) as total_messages,
        COUNT(CASE WHEN sr.is_top_3 THEN 1 END) as top_3_count,
        COUNT(CASE WHEN sr.is_top_10 THEN 1 END) as top_10_count
      FROM season_rankings sr
      WHERE sr.season_id = $1
    `, [seasonId]);

    const activities = await db.query(`
      SELECT 
        COUNT(*) as total_activities,
        COUNT(CASE WHEN activity_type = 'voice_join' THEN 1 END) as voice_activities,
        COUNT(CASE WHEN activity_type = 'message_create' THEN 1 END) as message_activities,
        COUNT(CASE WHEN activity_type = 'reaction_add' THEN 1 END) as reaction_activities
      FROM activities a
      WHERE a.timestamp >= (SELECT start_date FROM seasons WHERE id = $1)
        AND a.timestamp < (SELECT end_date FROM seasons WHERE id = $1)
    `, [seasonId]);

    return {
      participants: stats.rows[0],
      activities: activities.rows[0]
    };

  } catch (error) {
    logger.error('시즌 통계 집계 중 에러:', error);
    return null;
  }
}

/**
 * 시즌 성과 요약 생성
 */
function generateSeasonSummary(season, rankings, stats) {
  const winner = rankings.find(r => r.achievements.isWinner);
  const top3 = rankings.filter(r => r.achievements.isTop3);
  
  return {
    season: formatSeasonInfo(season, true),
    winner: winner ? {
      username: winner.username,
      displayName: winner.displayName,
      score: winner.score.total,
      voiceTime: winner.activity.voiceTimeFormatted
    } : null,
    top3: top3.map(r => ({
      rank: r.rank,
      username: r.username,
      displayName: r.displayName,
      score: r.score.total
    })),
    statistics: stats ? {
      totalParticipants: stats.participants.total_participants,
      totalActivities: stats.activities.total_activities,
      averageScore: Math.round(stats.participants.average_score || 0),
      highestScore: stats.participants.highest_score || 0,
      totalVoiceTime: formatDuration(stats.participants.total_voice_time || 0),
      totalMessages: stats.participants.total_messages || 0
    } : null
  };
}

/**
 * 다음 시즌 예측 정보
 */
function predictNextSeason(currentSeason) {
  if (!currentSeason || currentSeason.status !== 'active') {
    return null;
  }

  const endDate = new Date(currentSeason.end_date);
  const nextStartDate = new Date(endDate);
  nextStartDate.setDate(nextStartDate.getDate() + 1);
  
  const nextEndDate = new Date(nextStartDate);
  nextEndDate.setDate(nextEndDate.getDate() + 14);
  
  // 다음 일요일로 조정
  const daysUntilSunday = (7 - nextEndDate.getDay()) % 7;
  nextEndDate.setDate(nextEndDate.getDate() + daysUntilSunday);
  nextEndDate.setHours(0, 0, 0, 0);

  return {
    seasonNumber: currentSeason.season_number + 1,
    predictedStartDate: nextStartDate.toLocaleDateString('ko-KR'),
    predictedEndDate: nextEndDate.toLocaleDateString('ko-KR'),
    daysUntilStart: Math.max(Math.ceil((nextStartDate - new Date()) / (1000 * 60 * 60 * 24)), 0)
  };
}

/**
 * 시즌 알림 메시지 생성
 */
function createSeasonNotificationMessages(season, type = 'new') {
  const messages = {
    new: {
      title: '🆕 새로운 시즌이 시작되었습니다!',
      description: `**${season.name}**이 시작되었습니다!\n모든 점수가 초기화되었으며, 새로운 순위 경쟁이 시작됩니다.`,
      color: 0x00FF00
    },
    ending_soon: {
      title: '⏰ 시즌 종료 임박!',
      description: `**${season.name}**이 곧 종료됩니다!\n마지막 순위 상승의 기회를 놓치지 마세요.`,
      color: 0xFFAA00
    },
    completed: {
      title: '🏁 시즌이 완료되었습니다!',
      description: `**${season.name}**이 종료되었습니다!\n최종 순위가 확정되었으며, 평생 통계에 반영되었습니다.`,
      color: 0x0099FF
    }
  };

  return messages[type] || messages.new;
}

module.exports = {
  // 포맷팅 함수들
  formatSeasonInfo,
  formatSeasonRankings,
  formatLifetimeStats,
  formatDuration,
  
  // 검증 함수들
  validateSeasonData,
  
  // 계산 함수들
  calculateRankChanges,
  aggregateSeasonStats,
  
  // 유틸리티 함수들
  generateSeasonSummary,
  predictNextSeason,
  createSeasonNotificationMessages
}; 