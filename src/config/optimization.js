/**
 * 라즈베리파이 최적화 시스템
 * 제한된 리소스 환경에서의 효율적인 봇 운영을 위한 최적화 모듈
 */

const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('../utils/logger');

// 라즈베리파이 최적화 설정
const OPTIMIZATION_CONFIG = {
  // 메모리 관리
  MEMORY: {
    MAX_USAGE: 450 * 1024 * 1024,    // 450MB 최대 메모리 사용량
    WARNING_THRESHOLD: 350 * 1024 * 1024,  // 350MB 경고 임계값
    CRITICAL_THRESHOLD: 400 * 1024 * 1024, // 400MB 위험 임계값
    GC_INTERVAL: 10 * 60 * 1000,     // 10분마다 GC 실행
    MONITOR_INTERVAL: 30 * 1000      // 30초마다 메모리 모니터링
  },
  
  // 음악 다운로드 최적화
  MUSIC: {
    MAX_CONCURRENT_DOWNLOADS: 1,     // 동시 다운로드 제한
    MAX_QUEUE_SIZE: 10,              // 최대 대기열 크기
    DOWNLOAD_TIMEOUT: 30 * 1000,     // 30초 다운로드 타임아웃
    TEMP_DIR: '/tmp/godhand-music',  // 임시 파일 디렉토리
    MAX_FILE_SIZE: 50 * 1024 * 1024  // 50MB 최대 파일 크기
  },
  
  // 데이터베이스 최적화
  DATABASE: {
    MAX_CONNECTIONS: 5,              // 최대 연결 수
    IDLE_TIMEOUT: 30 * 1000,         // 유휴 연결 타임아웃
    QUERY_TIMEOUT: 10 * 1000,        // 쿼리 타임아웃
    CLEANUP_INTERVAL: '0 2 * * *'    // 매일 새벽 2시 정리
  },
  
  // 시스템 정리
  CLEANUP: {
    LOG_RETENTION_DAYS: 7,           // 로그 보관 기간
    TEMP_FILE_MAX_AGE: 60 * 60 * 1000, // 1시간 후 임시 파일 삭제
    CACHE_CLEANUP_INTERVAL: '0 */6 * * *', // 6시간마다 캐시 정리
    SYSTEM_CLEANUP_INTERVAL: '0 3 * * *'   // 매일 새벽 3시 시스템 정리
  },
  
  // 성능 모니터링
  MONITORING: {
    CPU_CHECK_INTERVAL: 60 * 1000,   // 1분마다 CPU 확인
    DISK_CHECK_INTERVAL: 5 * 60 * 1000, // 5분마다 디스크 확인
    NETWORK_CHECK_INTERVAL: 2 * 60 * 1000, // 2분마다 네트워크 확인
    MAX_CPU_USAGE: 80,               // 최대 CPU 사용률 (%)
    MIN_DISK_SPACE: 500 * 1024 * 1024 // 최소 디스크 공간 (500MB)
  }
};

// 전역 상태 관리
const systemState = {
  // 다운로드 관리
  activeDownloads: 0,
  downloadQueue: [],
  
  // 메모리 관리
  memoryWarningShown: false,
  lastGCTime: 0,
  
  // 성능 모니터링
  performanceStats: {
    memoryUsage: 0,
    cpuUsage: 0,
    diskUsage: 0,
    networkLatency: 0
  },
  
  // 시스템 상태
  isOptimized: false,
  lastCleanup: null,
  
  // 모니터링 인터벌
  intervals: {}
};

/**
 * 최적화 시스템 초기화
 */
async function initialize() {
  try {
    logger.info('🍓 라즈베리파이 최적화 시스템 초기화 시작...');
    
    // 시스템 정보 로깅
    await logSystemInfo();
    
    // 임시 디렉토리 생성
    await ensureTempDirectories();
    
    // 메모리 모니터링 시작
    startMemoryMonitoring();
    
    // 성능 모니터링 시작
    startPerformanceMonitoring();
    
    // 정리 작업 스케줄링
    scheduleCleanupTasks();
    
    // 가비지 컬렉션 최적화
    optimizeGarbageCollection();
    
    // 프로세스 신호 핸들러 설정
    setupProcessHandlers();
    
    systemState.isOptimized = true;
    logger.info('✅ 라즈베리파이 최적화 시스템 초기화 완료');
    
    return {
      success: true,
      config: OPTIMIZATION_CONFIG,
      systemInfo: await getSystemInfo()
    };
    
  } catch (error) {
    logger.error('❌ 최적화 시스템 초기화 실패:', error);
    throw error;
  }
}

/**
 * 시스템 정보 로깅
 */
async function logSystemInfo() {
  try {
    const systemInfo = await getSystemInfo();
    
    logger.info('🔍 시스템 정보:', {
      platform: systemInfo.platform,
      arch: systemInfo.arch,
      nodeVersion: systemInfo.nodeVersion,
      totalMemory: `${Math.round(systemInfo.totalMemory / 1024 / 1024)}MB`,
      availableMemory: `${Math.round(systemInfo.availableMemory / 1024 / 1024)}MB`,
      cpuCount: systemInfo.cpuCount,
      isRaspberryPi: systemInfo.isRaspberryPi
    });
    
  } catch (error) {
    logger.error('시스템 정보 로깅 실패:', error);
  }
}

/**
 * 시스템 정보 조회
 */
async function getSystemInfo() {
  try {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    // 라즈베리파이 감지
    let isRaspberryPi = false;
    try {
      const cpuInfo = await fs.readFile('/proc/cpuinfo', 'utf8');
      isRaspberryPi = cpuInfo.includes('Raspberry Pi') || cpuInfo.includes('BCM');
    } catch {
      // /proc/cpuinfo를 읽을 수 없는 경우 (macOS 등)
      isRaspberryPi = os.arch() === 'arm' || os.arch() === 'arm64';
    }
    
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      totalMemory: totalMemory,
      availableMemory: freeMemory,
      usedMemory: totalMemory - freeMemory,
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Unknown',
      isRaspberryPi: isRaspberryPi,
      uptime: os.uptime(),
      loadAverage: os.loadavg()
    };
    
  } catch (error) {
    logger.error('시스템 정보 조회 실패:', error);
    return {};
  }
}

/**
 * 임시 디렉토리 생성
 */
async function ensureTempDirectories() {
  try {
    const tempDirs = [
      OPTIMIZATION_CONFIG.MUSIC.TEMP_DIR,
      '/tmp/godhand-logs',
      '/tmp/godhand-cache'
    ];
    
    for (const dir of tempDirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
        logger.debug(`임시 디렉토리 생성: ${dir}`);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          logger.warn(`임시 디렉토리 생성 실패: ${dir}`, error);
        }
      }
    }
    
  } catch (error) {
    logger.error('임시 디렉토리 생성 중 오류:', error);
  }
}

/**
 * 현재 메모리 사용량 조회
 */
function getCurrentMemoryUsage() {
  const memoryUsage = process.memoryUsage();
  return {
    rss: memoryUsage.rss,                    // 실제 메모리 사용량
    heapUsed: memoryUsage.heapUsed,         // 힙 사용량
    heapTotal: memoryUsage.heapTotal,       // 총 힙 크기
    external: memoryUsage.external,         // 외부 메모리 사용량
    arrayBuffers: memoryUsage.arrayBuffers  // ArrayBuffer 사용량
  };
}

/**
 * 메모리 사용 가능 여부 확인
 */
function isMemoryAvailable() {
  const memoryUsage = getCurrentMemoryUsage();
  return memoryUsage.rss < OPTIMIZATION_CONFIG.MEMORY.MAX_USAGE;
}

/**
 * 메모리 모니터링 시작
 */
function startMemoryMonitoring() {
  systemState.intervals.memoryMonitor = setInterval(async () => {
    try {
      const memoryUsage = getCurrentMemoryUsage();
      const memoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
      
      systemState.performanceStats.memoryUsage = memoryUsage.rss;
      
      // 경고 임계값 확인
      if (memoryUsage.rss > OPTIMIZATION_CONFIG.MEMORY.WARNING_THRESHOLD) {
        if (!systemState.memoryWarningShown) {
          logger.warn(`⚠️ 메모리 사용량 경고: ${memoryMB}MB / ${Math.round(OPTIMIZATION_CONFIG.MEMORY.MAX_USAGE / 1024 / 1024)}MB`);
          systemState.memoryWarningShown = true;
          
          // 가비지 컬렉션 강제 실행
          await forceGarbageCollection();
        }
      } else {
        systemState.memoryWarningShown = false;
      }
      
      // 위험 임계값 확인
      if (memoryUsage.rss > OPTIMIZATION_CONFIG.MEMORY.CRITICAL_THRESHOLD) {
        logger.error(`🚨 메모리 사용량 위험: ${memoryMB}MB`);
        await emergencyCleanup();
      }
      
      logger.debug(`메모리 사용량: ${memoryMB}MB (힙: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB)`);
      
    } catch (error) {
      logger.error('메모리 모니터링 중 오류:', error);
    }
  }, OPTIMIZATION_CONFIG.MEMORY.MONITOR_INTERVAL);
  
  logger.info('📊 메모리 모니터링 시작');
}

/**
 * 성능 모니터링 시작
 */
function startPerformanceMonitoring() {
  // CPU 모니터링
  systemState.intervals.cpuMonitor = setInterval(async () => {
    try {
      const loadAvg = os.loadavg();
      const cpuUsage = (loadAvg[0] / os.cpus().length) * 100;
      
      systemState.performanceStats.cpuUsage = cpuUsage;
      
      if (cpuUsage > OPTIMIZATION_CONFIG.MONITORING.MAX_CPU_USAGE) {
        logger.warn(`⚠️ CPU 사용률 높음: ${cpuUsage.toFixed(1)}%`);
      }
      
    } catch (error) {
      logger.error('CPU 모니터링 중 오류:', error);
    }
  }, OPTIMIZATION_CONFIG.MONITORING.CPU_CHECK_INTERVAL);
  
  // 디스크 모니터링
  systemState.intervals.diskMonitor = setInterval(async () => {
    try {
      const diskSpace = await getDiskUsage();
      systemState.performanceStats.diskUsage = diskSpace.used;
      
      if (diskSpace.available < OPTIMIZATION_CONFIG.MONITORING.MIN_DISK_SPACE) {
        logger.warn(`⚠️ 디스크 공간 부족: ${Math.round(diskSpace.available / 1024 / 1024)}MB 남음`);
        await performCleanup();
      }
      
    } catch (error) {
      logger.error('디스크 모니터링 중 오류:', error);
    }
  }, OPTIMIZATION_CONFIG.MONITORING.DISK_CHECK_INTERVAL);
  
  logger.info('📈 성능 모니터링 시작');
}

/**
 * 디스크 사용량 조회
 */
async function getDiskUsage() {
  try {
    const { stdout } = await execAsync('df -k /');
    const lines = stdout.trim().split('\n');
    const data = lines[1].split(/\s+/);
    
    return {
      total: parseInt(data[1]) * 1024,      // 바이트로 변환
      used: parseInt(data[2]) * 1024,
      available: parseInt(data[3]) * 1024,
      percentage: parseInt(data[4].replace('%', ''))
    };
    
  } catch (error) {
    logger.error('디스크 사용량 조회 실패:', error);
    return { total: 0, used: 0, available: 0, percentage: 0 };
  }
}

/**
 * 다운로드 대기열 관리
 */
function queueDownload(downloadFn, ...args) {
  return new Promise((resolve, reject) => {
    const queueItem = {
      downloadFn,
      args,
      resolve,
      reject,
      timestamp: Date.now(),
      timeout: setTimeout(() => {
        reject(new Error('다운로드 타임아웃'));
      }, OPTIMIZATION_CONFIG.MUSIC.DOWNLOAD_TIMEOUT)
    };
    
    // 대기열 크기 확인
    if (systemState.downloadQueue.length >= OPTIMIZATION_CONFIG.MUSIC.MAX_QUEUE_SIZE) {
      clearTimeout(queueItem.timeout);
      reject(new Error('다운로드 대기열이 가득참'));
      return;
    }
    
    if (canStartDownload()) {
      processDownload(queueItem);
    } else {
      systemState.downloadQueue.push(queueItem);
      logger.debug(`다운로드 대기열에 추가 (대기: ${systemState.downloadQueue.length})`);
    }
  });
}

/**
 * 다운로드 시작 가능 여부 확인
 */
function canStartDownload() {
  return systemState.activeDownloads < OPTIMIZATION_CONFIG.MUSIC.MAX_CONCURRENT_DOWNLOADS && 
         isMemoryAvailable();
}

/**
 * 다운로드 처리
 */
async function processDownload(queueItem) {
  systemState.activeDownloads++;
  
  try {
    logger.debug(`다운로드 시작 (활성: ${systemState.activeDownloads})`);
    const result = await queueItem.downloadFn(...queueItem.args);
    
    clearTimeout(queueItem.timeout);
    queueItem.resolve(result);
    
  } catch (error) {
    clearTimeout(queueItem.timeout);
    queueItem.reject(error);
    
  } finally {
    systemState.activeDownloads--;
    
    // 다음 대기열 아이템 처리
    if (systemState.downloadQueue.length > 0 && canStartDownload()) {
      const nextItem = systemState.downloadQueue.shift();
      processDownload(nextItem);
    }
    
    logger.debug(`다운로드 완료 (활성: ${systemState.activeDownloads}, 대기: ${systemState.downloadQueue.length})`);
  }
}

/**
 * 가비지 컬렉션 최적화
 */
function optimizeGarbageCollection() {
  if (global.gc) {
    // 정기적인 가비지 컬렉션
    systemState.intervals.gcTimer = setInterval(() => {
      const now = Date.now();
      if (now - systemState.lastGCTime > OPTIMIZATION_CONFIG.MEMORY.GC_INTERVAL) {
        forceGarbageCollection();
      }
    }, OPTIMIZATION_CONFIG.MEMORY.GC_INTERVAL);
    
    logger.info('🗑️ 가비지 컬렉션 최적화 활성화');
  } else {
    logger.warn('⚠️ 가비지 컬렉션을 사용하려면 --expose-gc 플래그로 실행하세요');
  }
}

/**
 * 강제 가비지 컬렉션
 */
async function forceGarbageCollection() {
  if (global.gc) {
    try {
      const beforeMemory = getCurrentMemoryUsage();
      global.gc();
      const afterMemory = getCurrentMemoryUsage();
      
      const freed = beforeMemory.rss - afterMemory.rss;
      systemState.lastGCTime = Date.now();
      
      logger.debug(`가비지 컬렉션 완료 (해제: ${Math.round(freed / 1024 / 1024)}MB)`);
      
    } catch (error) {
      logger.error('가비지 컬렉션 실행 중 오류:', error);
    }
  }
}

/**
 * 정리 작업 스케줄링
 */
function scheduleCleanupTasks() {
  // 캐시 정리
  cron.schedule(OPTIMIZATION_CONFIG.CLEANUP.CACHE_CLEANUP_INTERVAL, async () => {
    logger.info('🧹 캐시 정리 시작...');
    await cleanupCache();
  });
  
  // 시스템 정리
  cron.schedule(OPTIMIZATION_CONFIG.CLEANUP.SYSTEM_CLEANUP_INTERVAL, async () => {
    logger.info('🧹 시스템 정리 시작...');
    await performCleanup();
  });
  
  // 데이터베이스 정리
  cron.schedule(OPTIMIZATION_CONFIG.DATABASE.CLEANUP_INTERVAL, async () => {
    logger.info('🧹 데이터베이스 정리 시작...');
    await cleanupDatabase();
  });
  
  logger.info('⏰ 정리 작업 스케줄러 설정 완료');
}

/**
 * 캐시 정리
 */
async function cleanupCache() {
  try {
    const cacheDir = '/tmp/godhand-cache';
    const files = await fs.readdir(cacheDir).catch(() => []);
    
    for (const file of files) {
      try {
        const filePath = path.join(cacheDir, file);
        const stats = await fs.stat(filePath);
        const age = Date.now() - stats.mtime.getTime();
        
        if (age > OPTIMIZATION_CONFIG.CLEANUP.TEMP_FILE_MAX_AGE) {
          await fs.unlink(filePath);
          logger.debug(`캐시 파일 삭제: ${file}`);
        }
      } catch (error) {
        logger.warn(`캐시 파일 삭제 실패: ${file}`, error);
      }
    }
    
  } catch (error) {
    logger.error('캐시 정리 중 오류:', error);
  }
}

/**
 * 시스템 정리
 */
async function performCleanup() {
  try {
    logger.info('🧹 시스템 정리 시작...');
    
    // 임시 파일 정리
    await cleanupTempFiles();
    
    // 오래된 로그 파일 정리
    await cleanupLogFiles();
    
    // 강제 가비지 컬렉션
    await forceGarbageCollection();
    
    systemState.lastCleanup = new Date();
    logger.info('✅ 시스템 정리 완료');
    
  } catch (error) {
    logger.error('시스템 정리 중 오류:', error);
  }
}

/**
 * 임시 파일 정리
 */
async function cleanupTempFiles() {
  try {
    const tempDirs = [
      OPTIMIZATION_CONFIG.MUSIC.TEMP_DIR,
      '/tmp/ytdl-*',
      '/tmp/godhand-*'
    ];
    
    for (const pattern of tempDirs) {
      try {
        if (pattern.includes('*')) {
          await execAsync(`rm -rf ${pattern}`);
        } else {
          const files = await fs.readdir(pattern).catch(() => []);
          for (const file of files) {
            const filePath = path.join(pattern, file);
            await fs.unlink(filePath);
          }
        }
      } catch (error) {
        logger.debug(`임시 파일 정리 실패: ${pattern}`, error);
      }
    }
    
  } catch (error) {
    logger.error('임시 파일 정리 중 오류:', error);
  }
}

/**
 * 로그 파일 정리
 */
async function cleanupLogFiles() {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    const files = await fs.readdir(logDir).catch(() => []);
    const cutoffDate = Date.now() - (OPTIMIZATION_CONFIG.CLEANUP.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    for (const file of files) {
      try {
        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffDate) {
          await fs.unlink(filePath);
          logger.debug(`오래된 로그 파일 삭제: ${file}`);
        }
      } catch (error) {
        logger.debug(`로그 파일 삭제 실패: ${file}`, error);
      }
    }
    
  } catch (error) {
    logger.error('로그 파일 정리 중 오류:', error);
  }
}

/**
 * 데이터베이스 정리
 */
async function cleanupDatabase() {
  try {
    const db = require('../services/database');
    
    // 오래된 활동 기록 정리 (30일 이상)
    await db.query(`
      DELETE FROM activities 
      WHERE timestamp < NOW() - INTERVAL '30 days'
    `);
    
    // 오래된 음악 로그 정리 (7일 이상)
    await db.query(`
      DELETE FROM music_logs 
      WHERE timestamp < NOW() - INTERVAL '7 days'
    `);
    
    // 데이터베이스 최적화
    await db.query('VACUUM ANALYZE');
    
    logger.info('✅ 데이터베이스 정리 완료');
    
  } catch (error) {
    logger.error('데이터베이스 정리 중 오류:', error);
  }
}

/**
 * 응급 정리
 */
async function emergencyCleanup() {
  try {
    logger.warn('🚨 응급 정리 실행...');
    
    // 모든 다운로드 중단
    systemState.downloadQueue = [];
    
    // 강제 가비지 컬렉션
    await forceGarbageCollection();
    
    // 임시 파일 즉시 정리
    await cleanupTempFiles();
    
    logger.warn('⚠️ 응급 정리 완료');
    
  } catch (error) {
    logger.error('응급 정리 중 오류:', error);
  }
}

/**
 * 프로세스 신호 핸들러 설정
 */
function setupProcessHandlers() {
  const cleanup = async () => {
    logger.info('🛑 최적화 시스템 종료 중...');
    
    // 모든 인터벌 정리
    Object.values(systemState.intervals).forEach(interval => {
      if (interval) clearInterval(interval);
    });
    
    // 마지막 정리 작업
    await performCleanup();
    
    logger.info('✅ 최적화 시스템 종료 완료');
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
  
  logger.info('🔄 프로세스 신호 핸들러 설정 완료');
}

/**
 * 성능 통계 조회
 */
function getPerformanceStats() {
  return {
    ...systemState.performanceStats,
    activeDownloads: systemState.activeDownloads,
    queuedDownloads: systemState.downloadQueue.length,
    isOptimized: systemState.isOptimized,
    lastCleanup: systemState.lastCleanup,
    uptime: process.uptime(),
    memoryMB: Math.round(systemState.performanceStats.memoryUsage / 1024 / 1024),
    cpuUsage: systemState.performanceStats.cpuUsage.toFixed(1)
  };
}

/**
 * 최적화 시스템 상태 조회
 */
async function getOptimizationStatus() {
  try {
    const systemInfo = await getSystemInfo();
    const performanceStats = getPerformanceStats();
    const memoryUsage = getCurrentMemoryUsage();
    
    return {
      isActive: systemState.isOptimized,
      systemInfo,
      performanceStats,
      memoryUsage: {
        current: Math.round(memoryUsage.rss / 1024 / 1024),
        limit: Math.round(OPTIMIZATION_CONFIG.MEMORY.MAX_USAGE / 1024 / 1024),
        percentage: (memoryUsage.rss / OPTIMIZATION_CONFIG.MEMORY.MAX_USAGE * 100).toFixed(1)
      },
      downloads: {
        active: systemState.activeDownloads,
        queued: systemState.downloadQueue.length,
        maxConcurrent: OPTIMIZATION_CONFIG.MUSIC.MAX_CONCURRENT_DOWNLOADS
      },
      lastCleanup: systemState.lastCleanup,
      config: OPTIMIZATION_CONFIG
    };
    
  } catch (error) {
    logger.error('최적화 상태 조회 중 오류:', error);
    return { isActive: false, error: error.message };
  }
}

module.exports = {
  initialize,
  queueDownload,
  getCurrentMemoryUsage,
  isMemoryAvailable,
  performCleanup,
  forceGarbageCollection,
  getPerformanceStats,
  getOptimizationStatus,
  getSystemInfo,
  emergencyCleanup,
  canStartDownload,
  
  // 설정 접근
  config: OPTIMIZATION_CONFIG,
  state: systemState
}; 