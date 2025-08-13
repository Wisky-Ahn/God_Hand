/**
 * 로그 로테이션 시스템
 * 로그 파일 크기 및 날짜 기반 관리
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { promisify } = require('util');
const logger = require('./logger');

const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const rename = promisify(fs.rename);

/**
 * 로그 로테이션 관리자 클래스
 */
class LogRotationManager {
  constructor(options = {}) {
    this.logsDir = options.logsDir || path.join(__dirname, '../../logs');
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB
    this.maxFiles = options.maxFiles || 10;
    this.maxAge = options.maxAge || 30; // 30일
    this.compressionEnabled = options.compressionEnabled || false;
    this.schedule = options.schedule || '0 2 * * *'; // 매일 새벽 2시
    
    this.cronJob = null;
    this.isRunning = false;
  }

  /**
   * 로그 로테이션 시스템 초기화
   */
  async initialize() {
    try {
      // logs 디렉토리 확인/생성
      await this.ensureLogsDirectory();

      // 기존 로그 파일 정리 (startup cleanup)
      await this.cleanupOldLogs();

      // 크론 작업 설정
      this.setupCronJob();

      // 파일 크기 기반 로테이션 모니터링 시작
      this.startSizeBasedRotation();

      logger.info('✅ 로그 로테이션 시스템 초기화 완료', {
        logsDir: this.logsDir,
        maxFileSize: `${Math.round(this.maxFileSize / 1024 / 1024)}MB`,
        maxFiles: this.maxFiles,
        maxAge: `${this.maxAge}일`,
        schedule: this.schedule
      });

    } catch (error) {
      logger.error('로그 로테이션 시스템 초기화 실패', error, {
        logsDir: this.logsDir
      });
      throw error;
    }
  }

  /**
   * logs 디렉토리 확인 및 생성
   */
  async ensureLogsDirectory() {
    try {
      await stat(this.logsDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        fs.mkdirSync(this.logsDir, { recursive: true });
        logger.info(`logs 디렉토리 생성: ${this.logsDir}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * 크론 작업 설정 (일일 로테이션)
   */
  setupCronJob() {
    this.cronJob = cron.schedule(this.schedule, async () => {
      if (this.isRunning) {
        logger.warn('로그 로테이션이 이미 실행 중입니다. 스킵...');
        return;
      }

      try {
        this.isRunning = true;
        logger.info('🔄 일일 로그 로테이션 시작');
        
        await this.performDailyRotation();
        await this.cleanupOldLogs();
        
        logger.info('✅ 일일 로그 로테이션 완료');
      } catch (error) {
        logger.error('일일 로그 로테이션 실패', error);
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });

    logger.info(`로그 로테이션 스케줄 설정: ${this.schedule}`);
  }

  /**
   * 파일 크기 기반 로테이션 모니터링
   */
  startSizeBasedRotation() {
    // 5분마다 파일 크기 체크
    setInterval(async () => {
      try {
        await this.checkFileSizes();
      } catch (error) {
        logger.error('파일 크기 체크 중 에러', error);
      }
    }, 5 * 60 * 1000);

    logger.info('파일 크기 기반 로테이션 모니터링 시작');
  }

  /**
   * 파일 크기 체크 및 로테이션
   */
  async checkFileSizes() {
    const logFiles = ['error.log', 'combined.log'];
    
    for (const filename of logFiles) {
      const filepath = path.join(this.logsDir, filename);
      
      try {
        const stats = await stat(filepath);
        
        if (stats.size > this.maxFileSize) {
          logger.info(`파일 크기 제한 초과: ${filename} (${Math.round(stats.size / 1024 / 1024)}MB)`);
          await this.rotateSingleFile(filename);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error(`파일 크기 체크 실패: ${filename}`, error);
        }
      }
    }
  }

  /**
   * 일일 로테이션 수행
   */
  async performDailyRotation() {
    const logFiles = ['error.log', 'combined.log'];
    
    for (const filename of logFiles) {
      await this.rotateSingleFile(filename, 'daily');
    }
  }

  /**
   * 개별 파일 로테이션
   */
  async rotateSingleFile(filename, reason = 'size') {
    const currentPath = path.join(this.logsDir, filename);
    
    try {
      // 파일이 존재하는지 확인
      await stat(currentPath);
      
      // 백업 파일 이름 생성
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const backupFilename = `${path.parse(filename).name}-${timestamp}.log`;
      const backupPath = path.join(this.logsDir, backupFilename);
      
      // 파일 이동
      await rename(currentPath, backupPath);
      
      logger.info(`로그 파일 로테이션 완료: ${filename} -> ${backupFilename}`, {
        reason,
        originalSize: (await stat(backupPath)).size
      });
      
      // 압축 옵션이 활성화된 경우
      if (this.compressionEnabled) {
        await this.compressLogFile(backupPath);
      }
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug(`로테이션할 파일이 없음: ${filename}`);
      } else {
        logger.error(`파일 로테이션 실패: ${filename}`, error);
      }
    }
  }

  /**
   * 로그 파일 압축
   */
  async compressLogFile(filepath) {
    try {
      const zlib = require('zlib');
      const { pipeline } = require('stream');
      const { promisify } = require('util');
      const pipelineAsync = promisify(pipeline);
      
      const gzipPath = `${filepath}.gz`;
      
      await pipelineAsync(
        fs.createReadStream(filepath),
        zlib.createGzip(),
        fs.createWriteStream(gzipPath)
      );
      
      // 원본 파일 삭제
      await unlink(filepath);
      
      logger.info(`로그 파일 압축 완료: ${path.basename(gzipPath)}`);
      
    } catch (error) {
      logger.error(`로그 파일 압축 실패: ${filepath}`, error);
    }
  }

  /**
   * 오래된 로그 파일 정리
   */
  async cleanupOldLogs() {
    try {
      const files = await readdir(this.logsDir);
      const now = new Date();
      const maxAgeMs = this.maxAge * 24 * 60 * 60 * 1000;
      
      // 로그 파일별로 분류
      const logGroups = this.groupLogFiles(files);
      
      for (const [baseName, fileList] of Object.entries(logGroups)) {
        // 날짜 기준 정리
        await this.cleanupByAge(fileList, maxAgeMs, now);
        
        // 개수 기준 정리
        await this.cleanupByCount(fileList);
      }
      
    } catch (error) {
      logger.error('오래된 로그 파일 정리 실패', error);
    }
  }

  /**
   * 로그 파일 그룹화
   */
  groupLogFiles(files) {
    const groups = {};
    
    for (const file of files) {
      // 현재 활성 로그 파일은 제외
      if (['error.log', 'combined.log'].includes(file)) {
        continue;
      }
      
      // 백업 로그 파일 패턴 매칭
      const match = file.match(/^(error|combined)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.log(\.gz)?$/);
      if (match) {
        const baseName = match[1];
        if (!groups[baseName]) {
          groups[baseName] = [];
        }
        groups[baseName].push({
          filename: file,
          filepath: path.join(this.logsDir, file),
          timestamp: match[2],
          compressed: !!match[3]
        });
      }
    }
    
    // 타임스탬프로 정렬 (최신순)
    for (const fileList of Object.values(groups)) {
      fileList.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    
    return groups;
  }

  /**
   * 날짜 기준 정리
   */
  async cleanupByAge(fileList, maxAgeMs, now) {
    for (const file of fileList) {
      try {
        const stats = await stat(file.filepath);
        const ageMs = now.getTime() - stats.mtime.getTime();
        
        if (ageMs > maxAgeMs) {
          await unlink(file.filepath);
          logger.info(`오래된 로그 파일 삭제: ${file.filename} (${Math.round(ageMs / (24 * 60 * 60 * 1000))}일 경과)`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error(`로그 파일 삭제 실패: ${file.filename}`, error);
        }
      }
    }
  }

  /**
   * 개수 기준 정리
   */
  async cleanupByCount(fileList) {
    if (fileList.length <= this.maxFiles) {
      return;
    }
    
    // 최신 파일들은 유지하고 나머지 삭제
    const filesToDelete = fileList.slice(this.maxFiles);
    
    for (const file of filesToDelete) {
      try {
        await unlink(file.filepath);
        logger.info(`개수 제한 초과로 로그 파일 삭제: ${file.filename}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error(`로그 파일 삭제 실패: ${file.filename}`, error);
        }
      }
    }
  }

  /**
   * 수동 로테이션 실행
   */
  async forceRotation() {
    if (this.isRunning) {
      throw new Error('로그 로테이션이 이미 실행 중입니다');
    }
    
    try {
      this.isRunning = true;
      logger.info('🔄 수동 로그 로테이션 시작');
      
      await this.performDailyRotation();
      await this.cleanupOldLogs();
      
      logger.info('✅ 수동 로그 로테이션 완료');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 로그 통계 조회
   */
  async getLogStats() {
    try {
      const files = await readdir(this.logsDir);
      const stats = {
        totalFiles: 0,
        totalSize: 0,
        activeFiles: [],
        archivedFiles: [],
        oldestFile: null,
        newestFile: null
      };
      
      let oldestTime = Infinity;
      let newestTime = 0;
      
      for (const file of files) {
        const filepath = path.join(this.logsDir, file);
        try {
          const fileStat = await stat(filepath);
          stats.totalFiles++;
          stats.totalSize += fileStat.size;
          
          if (fileStat.mtime.getTime() < oldestTime) {
            oldestTime = fileStat.mtime.getTime();
            stats.oldestFile = {
              name: file,
              date: fileStat.mtime,
              size: fileStat.size
            };
          }
          
          if (fileStat.mtime.getTime() > newestTime) {
            newestTime = fileStat.mtime.getTime();
            stats.newestFile = {
              name: file,
              date: fileStat.mtime,
              size: fileStat.size
            };
          }
          
          if (['error.log', 'combined.log'].includes(file)) {
            stats.activeFiles.push({
              name: file,
              size: fileStat.size,
              modified: fileStat.mtime
            });
          } else {
            stats.archivedFiles.push({
              name: file,
              size: fileStat.size,
              modified: fileStat.mtime
            });
          }
        } catch (error) {
          logger.error(`파일 통계 수집 실패: ${file}`, error);
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('로그 통계 조회 실패', error);
      return null;
    }
  }

  /**
   * 로그 로테이션 시스템 종료
   */
  async shutdown() {
    if (this.cronJob) {
      this.cronJob.destroy();
      logger.info('로그 로테이션 크론 작업 종료');
    }
    
    // 진행 중인 로테이션 대기
    while (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info('로그 로테이션 시스템 종료 완료');
  }
}

/**
 * 싱글톤 인스턴스 생성
 */
let rotationManager = null;

/**
 * 로그 로테이션 매니저 초기화
 */
async function initializeLogRotation(options = {}) {
  if (rotationManager) {
    logger.warn('로그 로테이션 매니저가 이미 초기화되었습니다');
    return rotationManager;
  }
  
  rotationManager = new LogRotationManager(options);
  await rotationManager.initialize();
  
  return rotationManager;
}

/**
 * 로그 로테이션 매니저 인스턴스 반환
 */
function getLogRotationManager() {
  return rotationManager;
}

module.exports = {
  LogRotationManager,
  initializeLogRotation,
  getLogRotationManager
}; 