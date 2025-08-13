/**
 * 시스템 모니터링 서비스
 * Raspberry Pi 환경에 최적화된 리소스 모니터링 및 알림 시스템
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const logger = require('../../utils/logger');

class SystemMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // 기본 설정
    this.config = {
      // 모니터링 간격 (초)
      interval: config.interval || 30,
      
      // 임계치 설정 (Raspberry Pi에 최적화)
      thresholds: {
        memory: config.thresholds?.memory || 85,      // 메모리 사용률 85%
        cpu: config.thresholds?.cpu || 80,            // CPU 사용률 80%
        disk: config.thresholds?.disk || 90,          // 디스크 사용률 90%
        temperature: config.thresholds?.temperature || 75, // CPU 온도 75°C
        swap: config.thresholds?.swap || 50,          // 스왑 사용률 50%
        load: config.thresholds?.load || 2.0          // 시스템 로드 2.0
      },
      
      // 알림 설정
      alerts: {
        enabled: config.alerts?.enabled !== false,
        cooldown: config.alerts?.cooldown || 300,     // 알림 쿨다운 5분
        maxAlertsPerHour: config.alerts?.maxAlertsPerHour || 12
      },
      
      // 로그 설정
      logging: {
        enabled: config.logging?.enabled !== false,
        logFile: config.logging?.logFile || path.join(process.cwd(), 'logs', 'system-monitor.log'),
        maxLogSize: config.logging?.maxLogSize || 10 * 1024 * 1024 // 10MB
      }
    };
    
    // 상태 추적
    this.isRunning = false;
    this.monitorInterval = null;
    this.lastAlerts = new Map(); // 알림 쿨다운 추적
    this.alertCount = new Map();  // 시간당 알림 횟수 추적
    this.systemInfo = {};
    
    // 이벤트 핸들러 설정
    this.setupEventHandlers();
  }

  /**
   * 모니터링 시작
   */
  start() {
    if (this.isRunning) {
      logger.warn('시스템 모니터가 이미 실행 중입니다.');
      return;
    }

    logger.info('시스템 모니터링 시작', {
      interval: this.config.interval,
      thresholds: this.config.thresholds
    });

    this.isRunning = true;
    
    // 초기 시스템 정보 수집
    this.collectSystemInfo();
    
    // 정기적인 모니터링 시작
    this.monitorInterval = setInterval(() => {
      this.performMonitoringCheck();
    }, this.config.interval * 1000);

    // 즉시 첫 번째 검사 실행
    this.performMonitoringCheck();
    
    this.emit('started');
  }

  /**
   * 모니터링 중지
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('시스템 모니터링 중지');
    
    this.isRunning = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.emit('stopped');
  }

  /**
   * 시스템 정보 수집
   */
  collectSystemInfo() {
    try {
      this.systemInfo = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        totalMemory: os.totalmem(),
        cpuCount: os.cpus().length,
        uptime: os.uptime()
      };
      
      // Raspberry Pi 특화 정보
      if (this.isRaspberryPi()) {
        this.systemInfo.raspberryPi = this.getRaspberryPiInfo();
      }
      
    } catch (error) {
      logger.error('시스템 정보 수집 실패:', error);
    }
  }

  /**
   * 모니터링 검사 수행
   */
  async performMonitoringCheck() {
    try {
      const metrics = await this.collectMetrics();
      
      // 로그 기록
      if (this.config.logging.enabled) {
        this.logMetrics(metrics);
      }
      
      // 임계치 검사 및 알림
      this.checkThresholds(metrics);
      
      // 이벤트 발생
      this.emit('metrics', metrics);
      
    } catch (error) {
      logger.error('모니터링 검사 실패:', error);
      this.emit('error', error);
    }
  }

  /**
   * 시스템 메트릭 수집
   */
  async collectMetrics() {
    const metrics = {
      timestamp: new Date().toISOString(),
      memory: this.getMemoryMetrics(),
      cpu: await this.getCpuMetrics(),
      disk: this.getDiskMetrics(),
      network: this.getNetworkMetrics(),
      system: this.getSystemMetrics()
    };
    
    // Raspberry Pi 특화 메트릭
    if (this.isRaspberryPi()) {
      metrics.raspberryPi = this.getRaspberryPiMetrics();
    }
    
    return metrics;
  }

  /**
   * 메모리 메트릭 수집
   */
  getMemoryMetrics() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    
    return {
      total: totalMemory,
      used: usedMemory,
      free: freeMemory,
      usagePercent: Math.round((usedMemory / totalMemory) * 100),
      available: freeMemory,
      buffers: this.getBuffersMemory(),
      cached: this.getCachedMemory(),
      swap: this.getSwapMetrics()
    };
  }

  /**
   * CPU 메트릭 수집
   */
  async getCpuMetrics() {
    return new Promise((resolve) => {
      const startMeasure = this.getCpuUsage();
      
      setTimeout(() => {
        const endMeasure = this.getCpuUsage();
        const cpuPercent = this.calculateCpuPercent(startMeasure, endMeasure);
        
        resolve({
          usage: cpuPercent,
          loadAverage: os.loadavg(),
          cores: os.cpus().length,
          temperature: this.getCpuTemperature()
        });
      }, 1000);
    });
  }

  /**
   * 디스크 메트릭 수집
   */
  getDiskMetrics() {
    try {
      const diskUsage = execSync('df -h /', { encoding: 'utf8' });
      const lines = diskUsage.trim().split('\n');
      const data = lines[1].split(/\s+/);
      
      const total = this.parseSize(data[1]);
      const used = this.parseSize(data[2]);
      const available = this.parseSize(data[3]);
      const usagePercent = parseInt(data[4].replace('%', ''));
      
      return {
        total,
        used,
        available,
        usagePercent,
        mountPoint: data[5] || '/'
      };
    } catch (error) {
      logger.error('디스크 메트릭 수집 실패:', error);
      return null;
    }
  }

  /**
   * 네트워크 메트릭 수집
   */
  getNetworkMetrics() {
    try {
      const networkInterfaces = os.networkInterfaces();
      const metrics = {};
      
      Object.keys(networkInterfaces).forEach(name => {
        const interfaces = networkInterfaces[name];
        interfaces.forEach(networkInterface => {
          if (!networkInterface.internal && networkInterface.family === 'IPv4') {
            metrics[name] = {
              address: networkInterface.address,
              netmask: networkInterface.netmask,
              mac: networkInterface.mac
            };
          }
        });
      });
      
      return metrics;
    } catch (error) {
      logger.error('네트워크 메트릭 수집 실패:', error);
      return {};
    }
  }

  /**
   * 시스템 메트릭 수집
   */
  getSystemMetrics() {
    return {
      uptime: os.uptime(),
      processes: this.getProcessCount(),
      bootTime: Date.now() - (os.uptime() * 1000),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  /**
   * Raspberry Pi 특화 메트릭 수집
   */
  getRaspberryPiMetrics() {
    const metrics = {};
    
    try {
      // CPU 온도
      metrics.temperature = this.getCpuTemperature();
      
      // GPU 메모리
      metrics.gpu = this.getGpuMetrics();
      
      // 전압 정보
      metrics.voltage = this.getVoltageMetrics();
      
      // 스로틀링 상태
      metrics.throttling = this.getThrottlingStatus();
      
    } catch (error) {
      logger.error('Raspberry Pi 메트릭 수집 실패:', error);
    }
    
    return metrics;
  }

  /**
   * 임계치 검사 및 알림
   */
  checkThresholds(metrics) {
    const alerts = [];
    
    // 메모리 사용률 검사
    if (metrics.memory.usagePercent >= this.config.thresholds.memory) {
      alerts.push({
        type: 'memory',
        level: 'warning',
        message: `메모리 사용률이 높습니다: ${metrics.memory.usagePercent}%`,
        value: metrics.memory.usagePercent,
        threshold: this.config.thresholds.memory
      });
    }
    
    // CPU 사용률 검사
    if (metrics.cpu.usage >= this.config.thresholds.cpu) {
      alerts.push({
        type: 'cpu',
        level: 'warning',
        message: `CPU 사용률이 높습니다: ${metrics.cpu.usage.toFixed(1)}%`,
        value: metrics.cpu.usage,
        threshold: this.config.thresholds.cpu
      });
    }
    
    // 디스크 사용률 검사
    if (metrics.disk && metrics.disk.usagePercent >= this.config.thresholds.disk) {
      alerts.push({
        type: 'disk',
        level: 'critical',
        message: `디스크 사용률이 높습니다: ${metrics.disk.usagePercent}%`,
        value: metrics.disk.usagePercent,
        threshold: this.config.thresholds.disk
      });
    }
    
    // CPU 온도 검사 (Raspberry Pi)
    if (metrics.raspberryPi?.temperature && metrics.raspberryPi.temperature >= this.config.thresholds.temperature) {
      alerts.push({
        type: 'temperature',
        level: 'critical',
        message: `CPU 온도가 높습니다: ${metrics.raspberryPi.temperature}°C`,
        value: metrics.raspberryPi.temperature,
        threshold: this.config.thresholds.temperature
      });
    }
    
    // 시스템 로드 검사
    const loadAvg = metrics.cpu.loadAverage[0];
    if (loadAvg >= this.config.thresholds.load) {
      alerts.push({
        type: 'load',
        level: 'warning',
        message: `시스템 로드가 높습니다: ${loadAvg.toFixed(2)}`,
        value: loadAvg,
        threshold: this.config.thresholds.load
      });
    }
    
    // 알림 발송
    alerts.forEach(alert => {
      this.sendAlert(alert);
    });
  }

  /**
   * 알림 발송
   */
  sendAlert(alert) {
    const alertKey = `${alert.type}-${alert.level}`;
    const now = Date.now();
    
    // 쿨다운 검사
    const lastAlert = this.lastAlerts.get(alertKey);
    if (lastAlert && (now - lastAlert) < (this.config.alerts.cooldown * 1000)) {
      return; // 쿨다운 중
    }
    
    // 시간당 알림 횟수 검사
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    const alertCountKey = `${alertKey}-${currentHour}`;
    const currentCount = this.alertCount.get(alertCountKey) || 0;
    
    if (currentCount >= this.config.alerts.maxAlertsPerHour) {
      return; // 시간당 최대 알림 횟수 초과
    }
    
    // 알림 발송
    logger.warn(`시스템 알림: ${alert.message}`, {
      type: alert.type,
      level: alert.level,
      value: alert.value,
      threshold: alert.threshold
    });
    
    this.emit('alert', alert);
    
    // 쿨다운 및 카운터 업데이트
    this.lastAlerts.set(alertKey, now);
    this.alertCount.set(alertCountKey, currentCount + 1);
    
    // 오래된 카운터 정리
    this.cleanupAlertCounters();
  }

  /**
   * 헬퍼 메서드들
   */
  
  isRaspberryPi() {
    try {
      return fs.existsSync('/sys/firmware/devicetree/base/model') ||
             fs.existsSync('/proc/device-tree/model');
    } catch {
      return false;
    }
  }
  
  getRaspberryPiInfo() {
    try {
      const model = fs.readFileSync('/sys/firmware/devicetree/base/model', 'utf8').trim().replace(/\0/g, '');
      return { model };
    } catch {
      return {};
    }
  }
  
  getCpuTemperature() {
    try {
      if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
        const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        return Math.round(parseInt(temp) / 1000);
      }
    } catch {
      // CPU 온도 정보 없음
    }
    return null;
  }
  
  getGpuMetrics() {
    try {
      const gpuMem = execSync('vcgencmd get_mem gpu', { encoding: 'utf8' });
      const match = gpuMem.match(/gpu=(\d+)M/);
      return match ? { memory: parseInt(match[1]) } : null;
    } catch {
      return null;
    }
  }
  
  getVoltageMetrics() {
    try {
      const voltage = execSync('vcgencmd measure_volts core', { encoding: 'utf8' });
      const match = voltage.match(/volt=([0-9.]+)V/);
      return match ? { core: parseFloat(match[1]) } : null;
    } catch {
      return null;
    }
  }
  
  getThrottlingStatus() {
    try {
      const throttled = execSync('vcgencmd get_throttled', { encoding: 'utf8' });
      const match = throttled.match(/throttled=0x([0-9A-Fa-f]+)/);
      return match ? { status: match[1], isThrottled: match[1] !== '0' } : null;
    } catch {
      return null;
    }
  }
  
  getCpuUsage() {
    const cpus = os.cpus();
    return cpus.map(cpu => {
      const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
      return {
        idle: cpu.times.idle,
        total
      };
    });
  }
  
  calculateCpuPercent(start, end) {
    let totalPercent = 0;
    
    for (let i = 0; i < start.length; i++) {
      const startTotal = start[i].total;
      const startIdle = start[i].idle;
      const endTotal = end[i].total;
      const endIdle = end[i].idle;
      
      const totalDiff = endTotal - startTotal;
      const idleDiff = endIdle - startIdle;
      
      const cpuPercent = 100 - (100 * idleDiff / totalDiff);
      totalPercent += cpuPercent;
    }
    
    return totalPercent / start.length;
  }
  
  getBuffersMemory() {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const match = meminfo.match(/Buffers:\s+(\d+) kB/);
      return match ? parseInt(match[1]) * 1024 : 0;
    } catch {
      return 0;
    }
  }
  
  getCachedMemory() {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const match = meminfo.match(/Cached:\s+(\d+) kB/);
      return match ? parseInt(match[1]) * 1024 : 0;
    } catch {
      return 0;
    }
  }
  
  getSwapMetrics() {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const totalMatch = meminfo.match(/SwapTotal:\s+(\d+) kB/);
      const freeMatch = meminfo.match(/SwapFree:\s+(\d+) kB/);
      
      if (totalMatch && freeMatch) {
        const total = parseInt(totalMatch[1]) * 1024;
        const free = parseInt(freeMatch[1]) * 1024;
        const used = total - free;
        
        return {
          total,
          used,
          free,
          usagePercent: total > 0 ? Math.round((used / total) * 100) : 0
        };
      }
    } catch {
      // 스왑 정보 없음
    }
    
    return { total: 0, used: 0, free: 0, usagePercent: 0 };
  }
  
  getProcessCount() {
    try {
      const processes = execSync('ps aux | wc -l', { encoding: 'utf8' });
      return parseInt(processes) - 1; // 헤더 제외
    } catch {
      return 0;
    }
  }
  
  parseSize(sizeStr) {
    const units = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024, T: 1024 * 1024 * 1024 * 1024 };
    const match = sizeStr.match(/^([0-9.]+)([KMGT])?$/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2] || '';
      return Math.round(value * (units[unit] || 1));
    }
    return 0;
  }
  
  logMetrics(metrics) {
    const logEntry = {
      timestamp: metrics.timestamp,
      memory: `${metrics.memory.usagePercent}%`,
      cpu: `${metrics.cpu.usage.toFixed(1)}%`,
      disk: metrics.disk ? `${metrics.disk.usagePercent}%` : 'N/A',
      temperature: metrics.raspberryPi?.temperature ? `${metrics.raspberryPi.temperature}°C` : 'N/A',
      load: metrics.cpu.loadAverage[0].toFixed(2)
    };
    
    // 로그 파일에 기록 (필요시 구현)
    logger.debug('시스템 메트릭', logEntry);
  }
  
  cleanupAlertCounters() {
    const currentHour = Math.floor(Date.now() / (60 * 60 * 1000));
    
    for (const [key] of this.alertCount) {
      const keyHour = parseInt(key.split('-').pop());
      if (currentHour - keyHour > 1) {
        this.alertCount.delete(key);
      }
    }
  }
  
  setupEventHandlers() {
    this.on('alert', (alert) => {
      // Discord 알림 등 추가 처리가 필요한 경우 여기서 구현
    });
  }

  /**
   * 현재 시스템 상태 요약
   */
  getSystemSummary() {
    return {
      info: this.systemInfo,
      isRunning: this.isRunning,
      config: this.config,
      alertCounts: Object.fromEntries(this.alertCount)
    };
  }
}

module.exports = SystemMonitor; 