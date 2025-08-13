/**
 * 통합 모니터링 서비스
 * 시스템 모니터링과 Discord 알림을 통합 관리
 */

const SystemMonitor = require('./systemMonitor');
const DiscordAlertService = require('./discordAlertService');
const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');

class MonitoringService {
  constructor(config = {}) {
    this.config = {
      // 시스템 모니터 설정
      systemMonitor: {
        interval: config.systemMonitor?.interval || 30,
        thresholds: {
          memory: 85,
          cpu: 80,
          disk: 90,
          temperature: 75,
          swap: 50,
          load: 2.0,
          ...config.systemMonitor?.thresholds
        },
        alerts: {
          enabled: true,
          cooldown: 300,
          maxAlertsPerHour: 12,
          ...config.systemMonitor?.alerts
        }
      },
      
      // Discord 알림 설정
      discordAlert: {
        webhook: {
          enabled: true,
          ...config.discordAlert?.webhook
        },
        channels: {
          enabled: true,
          ...config.discordAlert?.channels
        },
        format: {
          includeTimestamp: true,
          includeSystemInfo: true,
          mentionRoles: [],
          ...config.discordAlert?.format
        }
      },
      
      // 헬스체크 설정
      healthCheck: {
        enabled: config.healthCheck?.enabled !== false,
        interval: config.healthCheck?.interval || 300, // 5분
        endpoint: config.healthCheck?.endpoint || '/health'
      },
      
      // 자동 시작 설정
      autoStart: config.autoStart !== false
    };
    
    // 서비스 인스턴스
    this.systemMonitor = null;
    this.discordAlert = null;
    this.discordClient = null;
    
    // 상태 추적
    this.isRunning = false;
    this.healthCheckInterval = null;
    this.lastHealthCheck = null;
    
    // 통계 추적
    this.stats = {
      alerts: {
        total: 0,
        byType: {},
        byLevel: {}
      },
      uptime: Date.now(),
      lastAlert: null,
      healthChecks: 0
    };
    
    this.initialize();
  }

  /**
   * 모니터링 서비스 초기화
   */
  initialize() {
    logger.info('모니터링 서비스 초기화 시작');
    
    try {
      // 시스템 모니터 초기화
      this.systemMonitor = new SystemMonitor(this.config.systemMonitor);
      
      // Discord 알림 서비스 초기화
      this.discordAlert = new DiscordAlertService(this.config.discordAlert);
      
      // 이벤트 핸들러 설정
      this.setupEventHandlers();
      
      // 자동 시작
      if (this.config.autoStart) {
        this.start();
      }
      
      logger.info('모니터링 서비스 초기화 완료');
      
    } catch (error) {
      logger.error('모니터링 서비스 초기화 실패:', error);
      throw error;
    }
  }

  /**
   * 모니터링 서비스 시작
   */
  start() {
    if (this.isRunning) {
      logger.warn('모니터링 서비스가 이미 실행 중입니다.');
      return;
    }

    logger.info('통합 모니터링 서비스 시작');
    
    try {
      // 시스템 모니터 시작
      this.systemMonitor.start();
      
      // 헬스체크 시작
      if (this.config.healthCheck.enabled) {
        this.startHealthCheck();
      }
      
      this.isRunning = true;
      this.stats.uptime = Date.now();
      
      logger.info('통합 모니터링 서비스 시작 완료');
      
    } catch (error) {
      logger.error('모니터링 서비스 시작 실패:', error);
      throw error;
    }
  }

  /**
   * 모니터링 서비스 중지
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('통합 모니터링 서비스 중지');
    
    try {
      // 시스템 모니터 중지
      if (this.systemMonitor) {
        this.systemMonitor.stop();
      }
      
      // 헬스체크 중지
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      this.isRunning = false;
      
      logger.info('통합 모니터링 서비스 중지 완료');
      
    } catch (error) {
      logger.error('모니터링 서비스 중지 실패:', error);
    }
  }

  /**
   * Discord 클라이언트 설정
   */
  setDiscordClient(client) {
    this.discordClient = client;
    
    if (this.discordAlert) {
      this.discordAlert.setDiscordClient(client);
    }
    
    logger.info('Discord 클라이언트 설정 완료');
  }

  /**
   * 이벤트 핸들러 설정
   */
  setupEventHandlers() {
    if (!this.systemMonitor) return;
    
    // 시스템 알림 처리
    this.systemMonitor.on('alert', async (alert) => {
      await this.handleAlert(alert);
    });
    
    // 시스템 메트릭 처리
    this.systemMonitor.on('metrics', (metrics) => {
      this.handleMetrics(metrics);
    });
    
    // 시스템 모니터 에러 처리
    this.systemMonitor.on('error', (error) => {
      logger.error('시스템 모니터 에러:', error);
    });
    
    // 시스템 모니터 시작/중지 이벤트
    this.systemMonitor.on('started', () => {
      logger.info('시스템 모니터 시작됨');
    });
    
    this.systemMonitor.on('stopped', () => {
      logger.info('시스템 모니터 중지됨');
    });
  }

  /**
   * 알림 처리
   */
  async handleAlert(alert) {
    try {
      // 통계 업데이트
      this.updateAlertStats(alert);
      
      // 시스템 정보 수집
      const systemInfo = this.systemMonitor.getSystemSummary().info;
      
      // Discord 알림 전송
      if (this.discordAlert) {
        await this.discordAlert.sendAlert(alert, systemInfo);
      }
      
      // 크리티컬 알림의 경우 추가 처리
      if (alert.level === 'critical') {
        await this.handleCriticalAlert(alert);
      }
      
    } catch (error) {
      logger.error('알림 처리 실패:', error);
    }
  }

  /**
   * 크리티컬 알림 특별 처리
   */
  async handleCriticalAlert(alert) {
    try {
      // 상세 시스템 상태 수집
      const detailedMetrics = await this.systemMonitor.collectMetrics();
      
      // 자동 복구 시도 (필요한 경우)
      if (alert.type === 'memory' && alert.value >= 95) {
        logger.warn('심각한 메모리 부족 감지, 자동 복구 시도');
        await this.triggerMemoryCleanup();
      }
      
      if (alert.type === 'temperature' && alert.value >= 80) {
        logger.warn('심각한 온도 상승 감지, 성능 제한 권장');
        await this.triggerPerformanceReduction();
      }
      
    } catch (error) {
      logger.error('크리티컬 알림 처리 실패:', error);
    }
  }

  /**
   * 메트릭 처리
   */
  handleMetrics(metrics) {
    // 메트릭을 로그에 기록 (DEBUG 레벨)
    logger.debug('시스템 메트릭 수집됨', {
      memory: `${metrics.memory.usagePercent}%`,
      cpu: `${metrics.cpu.usage.toFixed(1)}%`,
      disk: metrics.disk ? `${metrics.disk.usagePercent}%` : 'N/A',
      temperature: metrics.raspberryPi?.temperature ? `${metrics.raspberryPi.temperature}°C` : 'N/A'
    });
    
    // 필요시 메트릭을 파일로 저장 (성능 분석용)
    this.saveMetricsToFile(metrics);
  }

  /**
   * 헬스체크 시작
   */
  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheck.interval * 1000);
    
    logger.info(`헬스체크 시작됨 (간격: ${this.config.healthCheck.interval}초)`);
  }

  /**
   * 헬스체크 수행
   */
  async performHealthCheck() {
    try {
      this.stats.healthChecks++;
      
      const healthStatus = {
        timestamp: new Date().toISOString(),
        systemMonitor: this.systemMonitor?.isRunning || false,
        discordAlert: await this.discordAlert?.healthCheck() || { webhook: false, botClient: false },
        uptime: Date.now() - this.stats.uptime,
        alertStats: this.stats.alerts
      };
      
      this.lastHealthCheck = healthStatus;
      
      // 헬스체크 결과 로깅
      logger.debug('헬스체크 완료', healthStatus);
      
      // 문제 감지 시 알림
      if (!healthStatus.systemMonitor) {
        logger.warn('시스템 모니터가 실행되지 않고 있습니다.');
      }
      
      if (!healthStatus.discordAlert.webhook && !healthStatus.discordAlert.botClient) {
        logger.warn('Discord 알림 서비스가 사용할 수 없습니다.');
      }
      
    } catch (error) {
      logger.error('헬스체크 수행 실패:', error);
    }
  }

  /**
   * 메모리 정리 트리거
   */
  async triggerMemoryCleanup() {
    try {
      // 가비지 컬렉션 강제 실행
      if (global.gc) {
        global.gc();
        logger.info('가비지 컬렉션 강제 실행됨');
      }
      
      // PM2 메모리 재시작 권장
      logger.warn('PM2 메모리 재시작을 권장합니다: pm2 restart godhand-bot');
      
    } catch (error) {
      logger.error('메모리 정리 실패:', error);
    }
  }

  /**
   * 성능 제한 트리거
   */
  async triggerPerformanceReduction() {
    try {
      // CPU 집약적인 작업 일시 중단 등의 조치
      logger.warn('성능 제한 모드 권장: CPU 집약적인 작업을 일시 중단하세요');
      
    } catch (error) {
      logger.error('성능 제한 트리거 실패:', error);
    }
  }

  /**
   * 알림 통계 업데이트
   */
  updateAlertStats(alert) {
    this.stats.alerts.total++;
    this.stats.alerts.byType[alert.type] = (this.stats.alerts.byType[alert.type] || 0) + 1;
    this.stats.alerts.byLevel[alert.level] = (this.stats.alerts.byLevel[alert.level] || 0) + 1;
    this.stats.lastAlert = {
      ...alert,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 메트릭을 파일로 저장
   */
  saveMetricsToFile(metrics) {
    try {
      const metricsDir = path.join(process.cwd(), 'logs', 'metrics');
      if (!fs.existsSync(metricsDir)) {
        fs.mkdirSync(metricsDir, { recursive: true });
      }
      
      const today = new Date().toISOString().split('T')[0];
      const metricsFile = path.join(metricsDir, `metrics-${today}.json`);
      
      // 간단한 메트릭만 저장 (파일 크기 고려)
      const simplifiedMetrics = {
        timestamp: metrics.timestamp,
        memory: metrics.memory.usagePercent,
        cpu: Math.round(metrics.cpu.usage * 10) / 10,
        disk: metrics.disk?.usagePercent,
        temperature: metrics.raspberryPi?.temperature,
        load: Math.round(metrics.cpu.loadAverage[0] * 100) / 100
      };
      
      // 파일이 존재하면 추가, 없으면 새로 생성
      let existingData = [];
      if (fs.existsSync(metricsFile)) {
        try {
          const content = fs.readFileSync(metricsFile, 'utf8');
          existingData = JSON.parse(content);
        } catch {
          existingData = [];
        }
      }
      
      existingData.push(simplifiedMetrics);
      
      // 최근 288개 항목만 유지 (30초 간격으로 24시간)
      if (existingData.length > 288) {
        existingData = existingData.slice(-288);
      }
      
      fs.writeFileSync(metricsFile, JSON.stringify(existingData, null, 2));
      
    } catch (error) {
      // 메트릭 저장 실패는 치명적이지 않으므로 DEBUG 레벨로 로깅
      logger.debug('메트릭 파일 저장 실패:', error);
    }
  }

  /**
   * 시스템 상태 요약 가져오기
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: Date.now() - this.stats.uptime,
      systemMonitor: this.systemMonitor?.getSystemSummary() || null,
      stats: this.stats,
      lastHealthCheck: this.lastHealthCheck,
      config: {
        systemMonitor: this.config.systemMonitor,
        discordAlert: {
          ...this.config.discordAlert,
          // 민감한 정보 제외
          webhook: {
            enabled: this.config.discordAlert.webhook.enabled,
            configured: !!(this.config.discordAlert.webhook.id && this.config.discordAlert.webhook.token)
          }
        }
      }
    };
  }

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // 시스템 모니터 설정 업데이트
    if (this.systemMonitor && newConfig.systemMonitor) {
      this.systemMonitor.config = { ...this.systemMonitor.config, ...newConfig.systemMonitor };
    }
    
    // Discord 알림 서비스 설정 업데이트
    if (this.discordAlert && newConfig.discordAlert) {
      this.discordAlert.updateConfig(newConfig.discordAlert);
    }
    
    logger.info('모니터링 서비스 설정 업데이트됨');
  }

  /**
   * 수동 상태 업데이트 전송
   */
  async sendStatusUpdate() {
    try {
      if (!this.systemMonitor || !this.discordAlert) {
        throw new Error('모니터링 서비스가 초기화되지 않았습니다.');
      }
      
      const metrics = await this.systemMonitor.collectMetrics();
      const summary = this.getStatus();
      
      await this.discordAlert.sendStatusUpdate(metrics, summary);
      
      logger.info('수동 상태 업데이트 전송 완료');
      
    } catch (error) {
      logger.error('상태 업데이트 전송 실패:', error);
      throw error;
    }
  }

  /**
   * 수동 배포 알림 전송
   */
  async sendDeploymentNotification(deployment) {
    try {
      if (!this.discordAlert) {
        throw new Error('Discord 알림 서비스가 초기화되지 않았습니다.');
      }
      
      await this.discordAlert.sendDeploymentNotification(deployment);
      
      logger.info('배포 알림 전송 완료');
      
    } catch (error) {
      logger.error('배포 알림 전송 실패:', error);
      throw error;
    }
  }
}

module.exports = MonitoringService; 