/**
 * 데이터베이스 마이그레이션 시스템
 * 스키마 변경사항 적용 및 관리
 */
const fs = require('fs').promises;
const path = require('path');
const db = require('./index');
const logger = require('../../utils/logger');

/**
 * 마이그레이션 테이블 생성
 */
async function createMigrationTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        checksum VARCHAR(64),
        execution_time_ms INTEGER
      )
    `);
    
    logger.info('마이그레이션 테이블 확인/생성 완료');
  } catch (error) {
    logger.error('마이그레이션 테이블 생성 중 에러:', error);
    throw error;
  }
}

/**
 * 적용된 마이그레이션 목록 조회
 * @returns {Promise<Array>} 적용된 마이그레이션 목록
 */
async function getAppliedMigrations() {
  try {
    const result = await db.query(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    return result.rows.map(row => row.version);
  } catch (error) {
    logger.error('적용된 마이그레이션 조회 중 에러:', error);
    throw error;
  }
}

/**
 * 마이그레이션 파일 목록 조회
 * @returns {Promise<Array>} 마이그레이션 파일 목록
 */
async function getMigrationFiles() {
  try {
    const migrationsDir = path.join(__dirname, '../../../database/migrations');
    const files = await fs.readdir(migrationsDir);
    
    return files
      .filter(file => file.endsWith('.sql'))
      .sort()
      .map(file => ({
        version: file.split('_')[0],
        filename: file,
        filepath: path.join(migrationsDir, file)
      }));
  } catch (error) {
    logger.error('마이그레이션 파일 조회 중 에러:', error);
    throw error;
  }
}

/**
 * 마이그레이션 파일 실행
 * @param {Object} migration - 마이그레이션 정보
 * @returns {Promise<boolean>} 성공 여부
 */
async function executeMigration(migration) {
  const startTime = Date.now();
  
  try {
    logger.info(`마이그레이션 실행 시작: ${migration.filename}`);
    
    // 마이그레이션 파일 읽기
    const sqlContent = await fs.readFile(migration.filepath, 'utf8');
    
    // 체크섬 계산 (간단한 해시)
    const crypto = require('crypto');
    const checksum = crypto.createHash('md5').update(sqlContent).digest('hex');
    
    // 트랜잭션으로 실행
    await db.transaction(async (query) => {
      // SQL 실행 (여러 명령어 분리)
      const statements = sqlContent
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      
      for (const statement of statements) {
        if (statement.includes('\\i')) {
          // Include 파일 처리
          const includeMatch = statement.match(/\\i\s+['"]?([^'"]+)['"]?/);
          if (includeMatch) {
            const includePath = path.resolve(
              path.dirname(migration.filepath), 
              includeMatch[1]
            );
            
            try {
              const includeContent = await fs.readFile(includePath, 'utf8');
              const includeStatements = includeContent
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
              
              for (const includeStmt of includeStatements) {
                if (includeStmt.trim()) {
                  await query(includeStmt);
                }
              }
            } catch (includeError) {
              logger.warn(`Include 파일 실행 실패: ${includePath}`, includeError.message);
            }
          }
        } else if (statement.trim()) {
          await query(statement);
        }
      }
      
      // 마이그레이션 기록
      const executionTime = Date.now() - startTime;
      await query(
        `INSERT INTO schema_migrations (version, checksum, execution_time_ms) 
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO UPDATE SET
           applied_at = NOW(),
           checksum = EXCLUDED.checksum,
           execution_time_ms = EXCLUDED.execution_time_ms`,
        [migration.version, checksum, executionTime]
      );
    });
    
    const executionTime = Date.now() - startTime;
    logger.info(`마이그레이션 완료: ${migration.filename} (${executionTime}ms)`);
    
    return true;
  } catch (error) {
    logger.error(`마이그레이션 실행 실패: ${migration.filename}`, error);
    throw error;
  }
}

/**
 * 모든 대기 중인 마이그레이션 실행
 * @returns {Promise<number>} 실행된 마이그레이션 수
 */
async function runMigrations() {
  try {
    // 마이그레이션 테이블 확인/생성
    await createMigrationTable();
    
    // 적용된 마이그레이션과 파일 목록 조회
    const [appliedMigrations, migrationFiles] = await Promise.all([
      getAppliedMigrations(),
      getMigrationFiles()
    ]);
    
    // 대기 중인 마이그레이션 찾기
    const pendingMigrations = migrationFiles.filter(
      migration => !appliedMigrations.includes(migration.version)
    );
    
    if (pendingMigrations.length === 0) {
      logger.info('적용할 새 마이그레이션이 없습니다');
      return 0;
    }
    
    logger.info(`${pendingMigrations.length}개의 마이그레이션을 실행합니다`);
    
    // 순차적으로 마이그레이션 실행
    let executedCount = 0;
    for (const migration of pendingMigrations) {
      try {
        await executeMigration(migration);
        executedCount++;
      } catch (error) {
        logger.error(`마이그레이션 실행 중단: ${migration.filename}`);
        throw error;
      }
    }
    
    logger.info(`${executedCount}개의 마이그레이션이 성공적으로 적용되었습니다`);
    return executedCount;
    
  } catch (error) {
    logger.error('마이그레이션 실행 중 에러:', error);
    throw error;
  }
}

/**
 * 마이그레이션 상태 확인
 * @returns {Promise<Object>} 마이그레이션 상태 정보
 */
async function getMigrationStatus() {
  try {
    await createMigrationTable();
    
    const [appliedMigrations, migrationFiles] = await Promise.all([
      getAppliedMigrations(),
      getMigrationFiles()
    ]);
    
    const pendingMigrations = migrationFiles.filter(
      migration => !appliedMigrations.includes(migration.version)
    );
    
    return {
      applied: appliedMigrations.length,
      pending: pendingMigrations.length,
      total: migrationFiles.length,
      appliedList: appliedMigrations,
      pendingList: pendingMigrations.map(m => m.version),
      isUpToDate: pendingMigrations.length === 0
    };
  } catch (error) {
    logger.error('마이그레이션 상태 확인 중 에러:', error);
    throw error;
  }
}

/**
 * 특정 마이그레이션 롤백 (주의: 자동 롤백은 지원하지 않음)
 * @param {string} version - 롤백할 마이그레이션 버전
 * @returns {Promise<boolean>} 성공 여부
 */
async function rollbackMigration(version) {
  try {
    logger.warn(`마이그레이션 롤백 시도: ${version}`);
    
    // 롤백은 수동으로 처리해야 함
    await db.query(
      'DELETE FROM schema_migrations WHERE version = $1',
      [version]
    );
    
    logger.warn(`마이그레이션 기록 제거됨: ${version}`);
    logger.warn('⚠️  실제 스키마 변경사항은 수동으로 롤백해야 합니다!');
    
    return true;
  } catch (error) {
    logger.error(`마이그레이션 롤백 중 에러: ${version}`, error);
    throw error;
  }
}

/**
 * CLI에서 실행할 때의 메인 함수
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
      case 'status':
        const status = await getMigrationStatus();
        console.log('\n📊 마이그레이션 상태:');
        console.log(`   적용됨: ${status.applied}개`);
        console.log(`   대기중: ${status.pending}개`);
        console.log(`   전체: ${status.total}개`);
        console.log(`   최신상태: ${status.isUpToDate ? '✅' : '❌'}`);
        
        if (status.pendingList.length > 0) {
          console.log('\n⏳ 대기 중인 마이그레이션:');
          status.pendingList.forEach(version => console.log(`   - ${version}`));
        }
        break;
        
      case 'run':
        await runMigrations();
        break;
        
      case 'rollback':
        const version = args[1];
        if (!version) {
          console.error('❌ 롤백할 마이그레이션 버전을 지정해주세요');
          process.exit(1);
        }
        await rollbackMigration(version);
        break;
        
      default:
        console.log(`
🗄️  GodHand 마이그레이션 시스템

사용법:
  node migration.js status     - 마이그레이션 상태 확인
  node migration.js run        - 대기 중인 마이그레이션 실행
  node migration.js rollback <version> - 특정 마이그레이션 롤백

예시:
  node migration.js run
  node migration.js rollback 001
        `);
    }
    
    await db.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('마이그레이션 명령 실행 중 에러:', error);
    await db.close();
    process.exit(1);
  }
}

// CLI에서 직접 실행되는 경우
if (require.main === module) {
  main();
}

module.exports = {
  runMigrations,
  getMigrationStatus,
  executeMigration,
  rollbackMigration,
  createMigrationTable
}; 