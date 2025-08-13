/**
 * 데이터베이스 서비스
 * PostgreSQL 연결 풀 관리 및 쿼리 실행
 */
const { Pool } = require('pg');
const logger = require('../../utils/logger');
const config = require('../../config/database');

// 연결 풀 생성
const pool = new Pool(config);

// 연결 풀 이벤트 핸들러
pool.on('connect', (client) => {
  logger.database('새 클라이언트가 연결되었습니다', 0, { 
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  });
});

pool.on('acquire', (client) => {
  logger.debug('클라이언트가 풀에서 획득되었습니다');
});

pool.on('remove', (client) => {
  logger.debug('클라이언트가 풀에서 제거되었습니다');
});

pool.on('error', (err, client) => {
  logger.error('데이터베이스 풀에서 예상치 못한 에러 발생:', err);
});

/**
 * 기본 쿼리 실행 함수
 * @param {string} text - SQL 쿼리
 * @param {Array} params - 쿼리 매개변수
 * @returns {Promise<Object>} 쿼리 결과
 */
async function query(text, params = []) {
  // 풀 상태 확인
  if (pool.ended) {
    throw new Error('Database pool has been terminated');
  }

  const start = Date.now();
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      
      // 성능 로깅
      logger.database(
        `쿼리 실행 완료`,
        duration,
        {
          rowCount: result.rowCount,
          command: result.command,
          queryLength: text.length,
          retryCount: retryCount
        }
      );
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      retryCount++;
      
      // 연결 관련 오류인 경우 재시도
      if ((error.message.includes('pool') || error.message.includes('connect')) && retryCount < maxRetries) {
        logger.warn(`데이터베이스 연결 오류 (${retryCount}/${maxRetries}회 재시도):`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // 점진적 대기
        continue;
             }
      
      // 에러 로깅
      logger.error('데이터베이스 쿼리 에러:', {
        error: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        query: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        duration,
        retryCount
      });
      
      // 에러 재발생
      throw error;
    }
  }
}

/**
 * 트랜잭션 실행 함수
 * @param {Function} callback - 트랜잭션 내에서 실행할 함수
 * @returns {Promise<any>} 콜백 함수의 결과
 */
async function transaction(callback) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 트랜잭션 전용 쿼리 함수
    const transactionQuery = async (text, params) => {
      const start = Date.now();
      try {
        const result = await client.query(text, params);
        const duration = Date.now() - start;
        
        logger.database(
          `트랜잭션 쿼리 실행`,
          duration,
          { rowCount: result.rowCount }
        );
        
        return result;
      } catch (error) {
        logger.error('트랜잭션 쿼리 에러:', error);
        throw error;
      }
    };
    
    const result = await callback(transactionQuery);
    await client.query('COMMIT');
    
    logger.info('트랜잭션 성공적으로 커밋됨');
    return result;
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('트랜잭션 롤백됨:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 연결 상태 확인
 * @returns {Promise<boolean>} 연결 상태
 */
async function checkConnection() {
  try {
    const result = await query('SELECT NOW() as current_time, version()');
    logger.info('데이터베이스 연결 확인 성공:', {
      time: result.rows[0].current_time,
      version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]
    });
    return true;
  } catch (error) {
    logger.error('데이터베이스 연결 확인 실패:', error);
    return false;
  }
}

/**
 * 연결 풀 상태 조회
 * @returns {Object} 풀 상태 정보
 */
function getPoolStatus() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    config: {
      max: config.max,
      min: config.min,
      database: config.database,
      host: config.host,
      port: config.port
    }
  };
}

/**
 * 준비된 문장 실행 (성능 최적화)
 * @param {string} name - 준비된 문장 이름
 * @param {string} text - SQL 쿼리
 * @param {Array} params - 매개변수
 * @returns {Promise<Object>} 쿼리 결과
 */
async function preparedQuery(name, text, params = []) {
  const client = await pool.connect();
  
  try {
    const start = Date.now();
    
    // 준비된 문장이 있는지 확인하고 없으면 생성
    try {
      await client.query(`DEALLOCATE ${name}`);
    } catch (err) {
      // 준비된 문장이 없으면 무시
    }
    
    await client.query(`PREPARE ${name} AS ${text}`);
    const result = await client.query(`EXECUTE ${name}`, params);
    
    const duration = Date.now() - start;
    
    logger.database(
      `준비된 쿼리 실행: ${name}`,
      duration,
      { rowCount: result.rowCount }
    );
    
    return result;
  } catch (error) {
    logger.error(`준비된 쿼리 에러 (${name}):`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 배치 삽입 (대량 데이터 처리용)
 * @param {string} table - 테이블 이름
 * @param {Array} columns - 컬럼 이름 배열
 * @param {Array} values - 값 배열의 배열
 * @returns {Promise<Object>} 삽입 결과
 */
async function batchInsert(table, columns, values) {
  if (!values.length) return { rowCount: 0 };
  
  const placeholders = values.map((_, index) => {
    const rowPlaceholders = columns.map((_, colIndex) => 
      `$${index * columns.length + colIndex + 1}`
    ).join(', ');
    return `(${rowPlaceholders})`;
  }).join(', ');
  
  const flatValues = values.flat();
  const text = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`;
  
  logger.info(`배치 삽입 시작: ${table} (${values.length}개 행)`);
  
  return await query(text, flatValues);
}

/**
 * 안전한 연결 종료
 */
async function close() {
  try {
    await pool.end();
    logger.info('데이터베이스 연결 풀이 안전하게 종료되었습니다');
  } catch (error) {
    logger.error('데이터베이스 연결 풀 종료 중 에러:', error);
  }
}

// 프로세스 종료 시 연결 풀 정리 (명시적 종료 시에만)
let isShuttingDown = false;

process.on('SIGINT', async () => {
  if (!isShuttingDown) {
    isShuttingDown = true;
    logger.info('📴 SIGINT 신호 받음 - 데이터베이스 연결 정리 중...');
    await close();
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  if (!isShuttingDown) {
    isShuttingDown = true;
    logger.info('📴 SIGTERM 신호 받음 - 데이터베이스 연결 정리 중...');
    await close();
    process.exit(0);
  }
});

// 초기 연결 테스트
(async () => {
  try {
    await checkConnection();
    logger.info('데이터베이스 서비스 초기화 완료', getPoolStatus());
  } catch (error) {
    logger.error('데이터베이스 서비스 초기화 실패:', error);
  }
})();

module.exports = {
  query,
  transaction,
  checkConnection,
  getPoolStatus,
  preparedQuery,
  batchInsert,
  close,
  pool // 직접 풀 접근이 필요한 경우
}; 