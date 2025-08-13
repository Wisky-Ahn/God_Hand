/**
 * 이벤트 로딩 시스템
 * Discord 이벤트 핸들러들을 동적으로 로드하고 등록
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * 이벤트 로더 클래스
 */
class EventLoader {
  constructor(client) {
    this.client = client;
    this.events = new Map();
    this.eventsPath = path.join(__dirname, '../events');
  }

  /**
   * 모든 이벤트 로드 및 등록
   */
  async loadEvents() {
    try {
      logger.info('📋 이벤트 핸들러 로딩을 시작합니다...');

      // 이벤트 디렉토리에서 파일 목록 가져오기
      const eventFiles = fs.readdirSync(this.eventsPath)
        .filter(file => file.endsWith('.js'));

      let loadedCount = 0;
      let errorCount = 0;

      for (const file of eventFiles) {
        try {
          await this.loadEvent(file);
          loadedCount++;
        } catch (error) {
          logger.error(`❌ 이벤트 로드 실패: ${file}`, error);
          errorCount++;
        }
      }

      logger.info(`✅ 이벤트 로딩 완료: ${loadedCount}개 성공, ${errorCount}개 실패`);
      
      if (loadedCount > 0) {
        this.logLoadedEvents();
      }

      return { loaded: loadedCount, errors: errorCount };

    } catch (error) {
      logger.error('이벤트 로딩 시스템 에러:', error);
      throw error;
    }
  }

  /**
   * 개별 이벤트 파일 로드
   */
  async loadEvent(fileName) {
    const filePath = path.join(this.eventsPath, fileName);
    
    try {
      // 캐시 제거 (개발 중 리로딩을 위해)
      delete require.cache[require.resolve(filePath)];
      
      const eventModule = require(filePath);
      
      // 이벤트 모듈 유효성 검사
      if (!this.validateEventModule(eventModule, fileName)) {
        throw new Error('이벤트 모듈 구조가 올바르지 않습니다');
      }

      const { name, once = false, execute } = eventModule;

      // 이벤트 리스너 등록
      if (once) {
        this.client.once(name, (...args) => this.executeEvent(eventModule, args));
      } else {
        this.client.on(name, (...args) => this.executeEvent(eventModule, args));
      }

      // 이벤트 맵에 저장
      this.events.set(name, {
        module: eventModule,
        fileName,
        once,
        registered: true
      });

      logger.debug(`✅ 이벤트 등록됨: ${name} (${fileName})`);

    } catch (error) {
      logger.error(`이벤트 로드 에러 [${fileName}]:`, error);
      throw error;
    }
  }

  /**
   * 이벤트 모듈 유효성 검사
   */
  validateEventModule(eventModule, fileName) {
    if (!eventModule || typeof eventModule !== 'object') {
      logger.error(`잘못된 이벤트 모듈 구조: ${fileName} - 모듈이 객체가 아닙니다`);
      return false;
    }

    if (!eventModule.name || typeof eventModule.name !== 'string') {
      logger.error(`잘못된 이벤트 모듈 구조: ${fileName} - name 속성이 필요합니다`);
      return false;
    }

    if (!eventModule.execute || typeof eventModule.execute !== 'function') {
      logger.error(`잘못된 이벤트 모듈 구조: ${fileName} - execute 함수가 필요합니다`);
      return false;
    }

    return true;
  }

  /**
   * 이벤트 실행 래퍼
   */
  async executeEvent(eventModule, args) {
    const startTime = Date.now();
    
    try {
      // 클라이언트를 마지막 인수로 추가
      await eventModule.execute(...args, this.client);
      
      // 성능 로깅
      const duration = Date.now() - startTime;
      if (duration > 100) { // 100ms 이상 걸린 이벤트만 로깅
        logger.performance(`event_${eventModule.name}`, duration);
      }
      
    } catch (error) {
      logger.error(`이벤트 실행 에러 [${eventModule.name}]:`, error);
      
      // 치명적인 에러인 경우 추가 처리
      if (this.isCriticalError(error)) {
        logger.error('치명적인 이벤트 에러 발생, 봇 재시작이 필요할 수 있습니다', error);
      }
    }
  }

  /**
   * 치명적인 에러 판별
   */
  isCriticalError(error) {
    const criticalErrors = [
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'CONNECTION_DESTROYED'
    ];
    
    return criticalErrors.some(criticalError => 
      error.message.includes(criticalError) || error.code === criticalError
    );
  }

  /**
   * 로드된 이벤트 목록 로깅
   */
  logLoadedEvents() {
    logger.info('\n📋 등록된 이벤트 목록:');
    
    for (const [eventName, eventInfo] of this.events) {
      const typeText = eventInfo.once ? 'once' : 'on';
      logger.info(`   • ${eventName} (${typeText}) - ${eventInfo.fileName}`);
    }
  }

  /**
   * 이벤트 리로드 (개발용)
   */
  async reloadEvent(eventName) {
    try {
      const eventInfo = this.events.get(eventName);
      if (!eventInfo) {
        throw new Error(`이벤트를 찾을 수 없습니다: ${eventName}`);
      }

      // 기존 리스너 제거
      this.client.removeAllListeners(eventName);
      
      // 이벤트 재로드
      await this.loadEvent(eventInfo.fileName);
      
      logger.info(`🔄 이벤트 리로드 완료: ${eventName}`);
      
    } catch (error) {
      logger.error(`이벤트 리로드 실패 [${eventName}]:`, error);
      throw error;
    }
  }

  /**
   * 모든 이벤트 리로드 (개발용)
   */
  async reloadAllEvents() {
    try {
      logger.info('🔄 모든 이벤트 리로드 중...');
      
      // 모든 리스너 제거
      this.client.removeAllListeners();
      
      // 이벤트 맵 초기화
      this.events.clear();
      
      // 이벤트 재로드
      const result = await this.loadEvents();
      
      logger.info('✅ 모든 이벤트 리로드 완료');
      return result;
      
    } catch (error) {
      logger.error('이벤트 리로드 실패:', error);
      throw error;
    }
  }

  /**
   * 이벤트 통계 정보
   */
  getEventStats() {
    const stats = {
      total: this.events.size,
      once: 0,
      on: 0,
      events: []
    };

    for (const [name, info] of this.events) {
      if (info.once) {
        stats.once++;
      } else {
        stats.on++;
      }
      
      stats.events.push({
        name,
        type: info.once ? 'once' : 'on',
        fileName: info.fileName
      });
    }

    return stats;
  }
}

module.exports = EventLoader; 