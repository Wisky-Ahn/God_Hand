#!/usr/bin/env node

/**
 * 데이터베이스 백업 및 복원 관리자
 * GodHand Discord Bot의 PostgreSQL 데이터베이스 백업/복원 자동화
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// 설정 상수
const CONFIG = {
  BACKUP_DIR: path.join(process.cwd(), 'backups'),
  LOG_DIR: path.join(process.cwd(), 'logs'),
  MAX_BACKUP_COUNT: {
    daily: 7,    // 일일 백업 7개 보관
    weekly: 4,   // 주간 백업 4개 보관
    monthly: 3   // 월간 백업 3개 보관
  },
  BACKUP_SCHEDULE: {
    daily: '0 2 * * *',     // 매일 새벽 2시
    weekly: '0 3 * * 0',    // 매주 일요일 새벽 3시
    monthly: '0 4 1 * *'    // 매월 1일 새벽 4시
  },
  DB_CONFIG: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || '5432',
    database: process.env.DB_NAME || 'godhand',
    username: process.env.DB_USER || 'godhand',
    password: process.env.DB_PASSWORD
  },
  COMPRESSION_LEVEL: 6 // gzip 압축 레벨 (1-9)
};

/**
 * 필요한 디렉토리 생성
 */
function ensureDirectories() {
  const directories = [
    CONFIG.BACKUP_DIR,
    path.join(CONFIG.BACKUP_DIR, 'daily'),
    path.join(CONFIG.BACKUP_DIR, 'weekly'),
    path.join(CONFIG.BACKUP_DIR, 'monthly'),
    CONFIG.LOG_DIR
  ];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 디렉토리 생성: ${dir}`);
    }
  });
}

/**
 * 백업 파일명 생성
 */
function generateBackupFilename(type = 'manual') {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  
  return `godhand-${type}-${dateStr}-${timeStr}.sql`;
}

/**
 * 데이터베이스 백업 생성
 */
function createBackup(type = 'manual', customFilename = null) {
  console.log(`💾 ${type} 백업 생성 시작...`);
  
  try {
    ensureDirectories();
    
    // 백업 파일 경로 설정
    const filename = customFilename || generateBackupFilename(type);
    const backupDir = type === 'manual' ? CONFIG.BACKUP_DIR : path.join(CONFIG.BACKUP_DIR, type);
    const backupFile = path.join(backupDir, filename);
    
    // PostgreSQL 연결 테스트
    console.log('🔍 데이터베이스 연결 확인 중...');
    const testCommand = `PGPASSWORD="${CONFIG.DB_CONFIG.password}" psql -h ${CONFIG.DB_CONFIG.host} -p ${CONFIG.DB_CONFIG.port} -U ${CONFIG.DB_CONFIG.username} -d ${CONFIG.DB_CONFIG.database} -c "SELECT version();" > /dev/null 2>&1`;
    
    try {
      execSync(testCommand);
      console.log('✅ 데이터베이스 연결 성공');
    } catch (error) {
      throw new Error('데이터베이스 연결 실패. 연결 정보를 확인하세요.');
    }
    
    // pg_dump를 사용한 백업 생성
    console.log('📤 데이터베이스 덤프 생성 중...');
    const dumpCommand = [
      `PGPASSWORD="${CONFIG.DB_CONFIG.password}"`,
      'pg_dump',
      `-h ${CONFIG.DB_CONFIG.host}`,
      `-p ${CONFIG.DB_CONFIG.port}`,
      `-U ${CONFIG.DB_CONFIG.username}`,
      `-d ${CONFIG.DB_CONFIG.database}`,
      '--verbose',
      '--no-password',
      '--format=custom',
      '--compress=9',
      '--no-privileges',
      '--no-owner',
      `--file="${backupFile}.dump"`
    ].join(' ');
    
    execSync(dumpCommand, { stdio: 'pipe' });
    
    // SQL 형태로도 백업 생성 (복원 편의성을 위해)
    const sqlCommand = [
      `PGPASSWORD="${CONFIG.DB_CONFIG.password}"`,
      'pg_dump',
      `-h ${CONFIG.DB_CONFIG.host}`,
      `-p ${CONFIG.DB_CONFIG.port}`,
      `-U ${CONFIG.DB_CONFIG.username}`,
      `-d ${CONFIG.DB_CONFIG.database}`,
      '--no-password',
      '--no-privileges',
      '--no-owner',
      `> "${backupFile}"`
    ].join(' ');
    
    execSync(sqlCommand, { stdio: 'pipe' });
    
    // 백업 파일 압축
    console.log('🗜️  백업 파일 압축 중...');
    execSync(`gzip -${CONFIG.COMPRESSION_LEVEL} "${backupFile}"`, { stdio: 'pipe' });
    execSync(`gzip -${CONFIG.COMPRESSION_LEVEL} "${backupFile}.dump"`, { stdio: 'pipe' });
    
    const compressedSqlFile = `${backupFile}.gz`;
    const compressedDumpFile = `${backupFile}.dump.gz`;
    
    // 백업 파일 정보 확인
    const sqlStats = fs.statSync(compressedSqlFile);
    const dumpStats = fs.statSync(compressedDumpFile);
    
    console.log(`✅ 백업 완료!`);
    console.log(`📄 SQL 백업: ${compressedSqlFile} (${formatFileSize(sqlStats.size)})`);
    console.log(`📦 바이너리 백업: ${compressedDumpFile} (${formatFileSize(dumpStats.size)})`);
    
    // 백업 메타데이터 저장
    const metadata = {
      type,
      timestamp: new Date().toISOString(),
      sqlFile: compressedSqlFile,
      dumpFile: compressedDumpFile,
      sqlSize: sqlStats.size,
      dumpSize: dumpStats.size,
      database: CONFIG.DB_CONFIG.database,
      host: CONFIG.DB_CONFIG.host
    };
    
    const metadataFile = `${backupFile}.meta.json`;
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    
    // 오래된 백업 정리
    if (type !== 'manual') {
      cleanupOldBackups(type);
    }
    
    return {
      success: true,
      sqlFile: compressedSqlFile,
      dumpFile: compressedDumpFile,
      metadata: metadataFile
    };
    
  } catch (error) {
    console.error('❌ 백업 실패:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 백업에서 데이터베이스 복원
 */
function restoreDatabase(backupFile, options = {}) {
  console.log(`🔄 데이터베이스 복원 시작: ${backupFile}`);
  
  try {
    // 백업 파일 존재 확인
    if (!fs.existsSync(backupFile)) {
      throw new Error(`백업 파일을 찾을 수 없습니다: ${backupFile}`);
    }
    
    // 백업 타입 감지
    const isDumpFile = backupFile.includes('.dump');
    const isCompressed = backupFile.endsWith('.gz');
    
    // 압축 해제 (필요한 경우)
    let workingFile = backupFile;
    if (isCompressed) {
      console.log('📤 백업 파일 압축 해제 중...');
      const uncompressedFile = backupFile.replace('.gz', '');
      execSync(`gunzip -c "${backupFile}" > "${uncompressedFile}"`, { stdio: 'pipe' });
      workingFile = uncompressedFile;
    }
    
    // 기존 연결 종료 (옵션)
    if (options.dropConnections) {
      console.log('🔌 기존 데이터베이스 연결 종료 중...');
      const dropConnectionsCommand = [
        `PGPASSWORD="${CONFIG.DB_CONFIG.password}"`,
        'psql',
        `-h ${CONFIG.DB_CONFIG.host}`,
        `-p ${CONFIG.DB_CONFIG.port}`,
        `-U ${CONFIG.DB_CONFIG.username}`,
        '-d postgres',
        '-c',
        `"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${CONFIG.DB_CONFIG.database}' AND pid <> pg_backend_pid();"`
      ].join(' ');
      
      try {
        execSync(dropConnectionsCommand, { stdio: 'pipe' });
      } catch (error) {
        console.warn('⚠️  일부 연결 종료에 실패했습니다.');
      }
    }
    
    // 데이터베이스 백업 (복원 전 안전장치)
    if (options.createBackupBeforeRestore) {
      console.log('🛡️  복원 전 현재 데이터베이스 백업 생성...');
      const preRestoreBackup = createBackup('pre-restore');
      if (preRestoreBackup.success) {
        console.log(`✅ 복원 전 백업 완료: ${preRestoreBackup.sqlFile}`);
      }
    }
    
    // 복원 명령어 구성
    let restoreCommand;
    
    if (isDumpFile) {
      // pg_restore를 사용한 바이너리 복원
      console.log('🔄 pg_restore를 사용한 복원 중...');
      restoreCommand = [
        `PGPASSWORD="${CONFIG.DB_CONFIG.password}"`,
        'pg_restore',
        `--host=${CONFIG.DB_CONFIG.host}`,
        `--port=${CONFIG.DB_CONFIG.port}`,
        `--username=${CONFIG.DB_CONFIG.username}`,
        `--dbname=${CONFIG.DB_CONFIG.database}`,
        '--verbose',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        `"${workingFile}"`
      ].join(' ');
    } else {
      // psql를 사용한 SQL 복원
      console.log('🔄 psql를 사용한 복원 중...');
      restoreCommand = [
        `PGPASSWORD="${CONFIG.DB_CONFIG.password}"`,
        'psql',
        `-h ${CONFIG.DB_CONFIG.host}`,
        `-p ${CONFIG.DB_CONFIG.port}`,
        `-U ${CONFIG.DB_CONFIG.username}`,
        `-d ${CONFIG.DB_CONFIG.database}`,
        `< "${workingFile}"`
      ].join(' ');
    }
    
    execSync(restoreCommand, { stdio: 'inherit' });
    
    // 임시 파일 정리
    if (isCompressed && workingFile !== backupFile) {
      fs.unlinkSync(workingFile);
    }
    
    console.log('✅ 데이터베이스 복원 완료!');
    return { success: true };
    
  } catch (error) {
    console.error('❌ 복원 실패:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 오래된 백업 파일 정리
 */
function cleanupOldBackups(type) {
  try {
    const backupDir = path.join(CONFIG.BACKUP_DIR, type);
    const maxCount = CONFIG.MAX_BACKUP_COUNT[type];
    
    if (!fs.existsSync(backupDir)) {
      return;
    }
    
    // 백업 파일 목록 가져오기 (SQL 파일만)
    const backupFiles = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('godhand-') && file.endsWith('.sql.gz'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        stats: fs.statSync(path.join(backupDir, file))
      }))
      .sort((a, b) => b.stats.mtime - a.stats.mtime);
    
    if (backupFiles.length > maxCount) {
      const filesToDelete = backupFiles.slice(maxCount);
      
      filesToDelete.forEach(file => {
        const baseName = file.name.replace('.sql.gz', '');
        const relatedFiles = [
          file.path, // SQL 백업
          file.path.replace('.sql.gz', '.dump.gz'), // 바이너리 백업
          file.path.replace('.sql.gz', '.meta.json') // 메타데이터
        ];
        
        relatedFiles.forEach(filePath => {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  오래된 백업 파일 삭제: ${path.basename(filePath)}`);
          }
        });
      });
    }
  } catch (error) {
    console.warn('⚠️  백업 파일 정리 실패:', error.message);
  }
}

/**
 * 백업 목록 조회
 */
function listBackups(type = null) {
  console.log('📋 백업 파일 목록');
  console.log('='.repeat(60));
  
  const backupTypes = type ? [type] : ['manual', 'daily', 'weekly', 'monthly'];
  
  backupTypes.forEach(backupType => {
    const backupDir = backupType === 'manual' ? CONFIG.BACKUP_DIR : path.join(CONFIG.BACKUP_DIR, backupType);
    
    if (!fs.existsSync(backupDir)) {
      return;
    }
    
    const backups = fs.readdirSync(backupDir)
      .filter(file => file.endsWith('.meta.json'))
      .map(file => {
        try {
          const metadata = JSON.parse(fs.readFileSync(path.join(backupDir, file), 'utf8'));
          return metadata;
        } catch {
          return null;
        }
      })
      .filter(metadata => metadata)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (backups.length > 0) {
      console.log(`\n📂 ${backupType.toUpperCase()} 백업:`);
      backups.forEach(backup => {
        const date = new Date(backup.timestamp).toLocaleString('ko-KR');
        const sqlSize = formatFileSize(backup.sqlSize);
        const dumpSize = formatFileSize(backup.dumpSize);
        console.log(`  🗄️  ${date} - SQL: ${sqlSize}, DUMP: ${dumpSize}`);
        console.log(`      📄 SQL: ${backup.sqlFile}`);
        console.log(`      📦 DUMP: ${backup.dumpFile}`);
      });
    }
  });
}

/**
 * 파일 크기 포맷팅
 */
function formatFileSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 자동 백업 스케줄링 시작
 */
function startBackupScheduler() {
  console.log('⏰ 자동 백업 스케줄링 시작...');
  
  // 일일 백업
  cron.schedule(CONFIG.BACKUP_SCHEDULE.daily, () => {
    console.log('🌅 일일 자동 백업 시작');
    createBackup('daily');
  }, {
    timezone: 'Asia/Seoul'
  });
  
  // 주간 백업
  cron.schedule(CONFIG.BACKUP_SCHEDULE.weekly, () => {
    console.log('📅 주간 자동 백업 시작');
    createBackup('weekly');
  }, {
    timezone: 'Asia/Seoul'
  });
  
  // 월간 백업
  cron.schedule(CONFIG.BACKUP_SCHEDULE.monthly, () => {
    console.log('📆 월간 자동 백업 시작');
    createBackup('monthly');
  }, {
    timezone: 'Asia/Seoul'
  });
  
  console.log('✅ 백업 스케줄러 활성화됨');
  console.log(`  📅 일일 백업: ${CONFIG.BACKUP_SCHEDULE.daily} (매일 새벽 2시)`);
  console.log(`  📅 주간 백업: ${CONFIG.BACKUP_SCHEDULE.weekly} (일요일 새벽 3시)`);
  console.log(`  📅 월간 백업: ${CONFIG.BACKUP_SCHEDULE.monthly} (매월 1일 새벽 4시)`);
}

/**
 * 도움말 표시
 */
function showHelp() {
  console.log(`
🗄️  GodHand Discord Bot 데이터베이스 백업 관리자

사용법:
  node scripts/backup-manager.js <명령어> [옵션]

명령어:
  backup [type]           백업 생성 (type: manual, daily, weekly, monthly)
  restore <파일경로>      백업에서 복원
  list [type]            백업 목록 조회
  cleanup [type]         오래된 백업 정리
  schedule              자동 백업 스케줄러 시작
  help                  이 도움말 표시

백업 옵션:
  --filename <이름>      사용자 정의 백업 파일명

복원 옵션:
  --drop-connections    복원 전 기존 연결 종료
  --backup-before       복원 전 현재 DB 백업
  --force              확인 없이 복원 실행

예시:
  node scripts/backup-manager.js backup manual
  node scripts/backup-manager.js backup daily --filename "before-update"
  node scripts/backup-manager.js restore backups/godhand-manual-2024-01-01.sql.gz --backup-before
  node scripts/backup-manager.js list daily
  node scripts/backup-manager.js schedule

백업 스케줄:
  📅 일일 백업: 매일 새벽 2시 (최대 7개 보관)
  📅 주간 백업: 매주 일요일 새벽 3시 (최대 4개 보관)
  📅 월간 백업: 매월 1일 새벽 4시 (최대 3개 보관)
  `);
}

// CLI 인터페이스
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // 명령어별 처리
  switch (command) {
    case 'backup': {
      const type = args[1] || 'manual';
      const filenameIndex = args.indexOf('--filename');
      const filename = filenameIndex !== -1 ? args[filenameIndex + 1] : null;
      
      const result = createBackup(type, filename);
      process.exit(result.success ? 0 : 1);
      break;
    }
    
    case 'restore': {
      if (!args[1]) {
        console.error('❌ 복원할 백업 파일을 지정하세요.');
        showHelp();
        process.exit(1);
      }
      
      const backupFile = args[1];
      const options = {
        dropConnections: args.includes('--drop-connections'),
        createBackupBeforeRestore: args.includes('--backup-before'),
        force: args.includes('--force')
      };
      
      if (!options.force) {
        console.log('⚠️  데이터베이스 복원은 기존 데이터를 덮어씁니다.');
        console.log('계속하려면 --force 옵션을 사용하세요.');
        process.exit(1);
      }
      
      const result = restoreDatabase(backupFile, options);
      process.exit(result.success ? 0 : 1);
      break;
    }
    
    case 'list': {
      const type = args[1] || null;
      listBackups(type);
      break;
    }
    
    case 'cleanup': {
      const type = args[1];
      if (type) {
        cleanupOldBackups(type);
      } else {
        ['daily', 'weekly', 'monthly'].forEach(cleanupOldBackups);
      }
      break;
    }
    
    case 'schedule': {
      startBackupScheduler();
      
      // 프로세스가 종료되지 않도록 유지
      process.on('SIGINT', () => {
        console.log('\n⏹️  백업 스케줄러 종료');
        process.exit(0);
      });
      
      // 무한 대기
      setInterval(() => {}, 1000);
      break;
    }
    
    case 'help':
    case '--help':
    case '-h':
    default: {
      showHelp();
      process.exit(command && command !== 'help' ? 1 : 0);
    }
  }
}

module.exports = {
  createBackup,
  restoreDatabase,
  listBackups,
  cleanupOldBackups,
  startBackupScheduler,
  ensureDirectories,
  CONFIG
}; 