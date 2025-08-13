/**
 * Discord 알림 서비스
 * 시스템 모니터링 알림을 Discord 채널로 전송
 */

const { EmbedBuilder, WebhookClient } = require('discord.js');
const logger = require('../../utils/logger');

class DiscordAlertService {
  constructor(config = {}) {
    this.config = {
      // Discord 웹훅 설정
      webhook: {
        id: config.webhook?.id || process.env.ALERT_WEBHOOK_ID,
        token: config.webhook?.token || process.env.ALERT_WEBHOOK_TOKEN,
        enabled: config.webhook?.enabled !== false
      },
      
      // 알림 채널 설정 (기존 봇 채널 사용)
      channels: {
        alerts: config.channels?.alerts || process.env.ALERT_CHANNEL_ID,
        status: config.channels?.status || process.env.STATUS_CHANNEL_ID,
        enabled: config.channels?.enabled !== false
      },
      
      // 알림 레벨별 설정
      alertLevels: {
        info: { color: 0x00FF00, emoji: '💡' },     // 초록색
        warning: { color: 0xFFFF00, emoji: '⚠️' }, // 노란색
        critical: { color: 0xFF0000, emoji: '🚨' }, // 빨간색
        error: { color: 0xFF4500, emoji: '❌' }     // 주황색
      },
      
      // 메시지 형식 설정
      format: {
        includeTimestamp: config.format?.includeTimestamp !== false,
        includeSystemInfo: config.format?.includeSystemInfo !== false,
        mentionRoles: config.format?.mentionRoles || [],
        threadSupport: config.format?.threadSupport !== false
      }
    };
    
    // Discord 클라이언트 설정
    this.client = null;
    this.webhook = null;
    
    this.initializeClients();
  }

  /**
   * Discord 클라이언트 초기화
   */
  initializeClients() {
    try {
      // 웹훅 클라이언트 설정
      if (this.config.webhook.enabled && this.config.webhook.id && this.config.webhook.token) {
        this.webhook = new WebhookClient({
          id: this.config.webhook.id,
          token: this.config.webhook.token
        });
        logger.info('Discord 웹훅 클라이언트 초기화 완료');
      }
      
    } catch (error) {
      logger.error('Discord 클라이언트 초기화 실패:', error);
    }
  }

  /**
   * Discord 봇 클라이언트 설정 (외부에서 주입)
   */
  setDiscordClient(client) {
    this.client = client;
    logger.info('Discord 봇 클라이언트 설정 완료');
  }

  /**
   * 시스템 알림 전송
   */
  async sendAlert(alert, systemInfo = {}) {
    try {
      const embed = this.createAlertEmbed(alert, systemInfo);
      
      // 역할 멘션 추가
      let content = '';
      if (this.config.format.mentionRoles.length > 0 && alert.level === 'critical') {
        content = this.config.format.mentionRoles.map(roleId => `<@&${roleId}>`).join(' ');
      }
      
      // 웹훅을 통한 전송 (우선순위)
      if (this.webhook) {
        await this.webhook.send({
          content,
          embeds: [embed],
          username: 'GodHand 시스템 모니터',
          avatarURL: 'https://cdn.discordapp.com/emojis/🤖.png'
        });
        
        logger.info(`Discord 웹훅으로 알림 전송: ${alert.type} - ${alert.level}`);
        return;
      }
      
      // 봇 클라이언트를 통한 전송
      if (this.client && this.config.channels.enabled) {
        const channelId = this.config.channels.alerts;
        const channel = await this.client.channels.fetch(channelId);
        
        if (channel) {
          await channel.send({
            content,
            embeds: [embed]
          });
          
          logger.info(`Discord 채널로 알림 전송: ${alert.type} - ${alert.level}`);
          return;
        }
      }
      
      logger.warn('Discord 알림 전송 실패: 사용 가능한 클라이언트 없음');
      
    } catch (error) {
      logger.error('Discord 알림 전송 실패:', error);
    }
  }

  /**
   * 시스템 상태 업데이트 전송
   */
  async sendStatusUpdate(metrics, summary = {}) {
    try {
      const embed = this.createStatusEmbed(metrics, summary);
      
      // 웹훅을 통한 전송
      if (this.webhook) {
        await this.webhook.send({
          embeds: [embed],
          username: 'GodHand 시스템 상태',
          avatarURL: 'https://cdn.discordapp.com/emojis/📊.png'
        });
        return;
      }
      
      // 봇 클라이언트를 통한 전송
      if (this.client && this.config.channels.enabled) {
        const channelId = this.config.channels.status;
        const channel = await this.client.channels.fetch(channelId);
        
        if (channel) {
          await channel.send({
            embeds: [embed]
          });
          return;
        }
      }
      
    } catch (error) {
      logger.error('Discord 상태 업데이트 전송 실패:', error);
    }
  }

  /**
   * 배포 알림 전송
   */
  async sendDeploymentNotification(deployment) {
    try {
      const embed = this.createDeploymentEmbed(deployment);
      
      const channels = [this.config.channels.alerts, this.config.channels.status];
      
      for (const channelId of channels) {
        if (!channelId) continue;
        
        try {
          if (this.webhook) {
            await this.webhook.send({
              embeds: [embed],
              username: 'GodHand 배포 알림',
              avatarURL: 'https://cdn.discordapp.com/emojis/🚀.png'
            });
          } else if (this.client) {
            const channel = await this.client.channels.fetch(channelId);
            if (channel) {
              await channel.send({ embeds: [embed] });
            }
          }
        } catch (channelError) {
          logger.error(`채널 ${channelId}로 배포 알림 전송 실패:`, channelError);
        }
      }
      
    } catch (error) {
      logger.error('배포 알림 전송 실패:', error);
    }
  }

  /**
   * 알림 임베드 생성
   */
  createAlertEmbed(alert, systemInfo = {}) {
    const levelConfig = this.config.alertLevels[alert.level] || this.config.alertLevels.warning;
    
    const embed = new EmbedBuilder()
      .setTitle(`${levelConfig.emoji} 시스템 알림`)
      .setDescription(alert.message)
      .setColor(levelConfig.color)
      .addFields([
        {
          name: '📊 상세 정보',
          value: [
            `**타입**: ${this.getAlertTypeLabel(alert.type)}`,
            `**현재 값**: ${this.formatAlertValue(alert.value, alert.type)}`,
            `**임계치**: ${this.formatAlertValue(alert.threshold, alert.type)}`,
            `**레벨**: ${alert.level.toUpperCase()}`
          ].join('\n'),
          inline: true
        }
      ]);

    // 시스템 정보 추가
    if (this.config.format.includeSystemInfo && Object.keys(systemInfo).length > 0) {
      embed.addFields([
        {
          name: '🖥️ 시스템 정보',
          value: this.formatSystemInfo(systemInfo),
          inline: true
        }
      ]);
    }

    // 타임스탬프 추가
    if (this.config.format.includeTimestamp) {
      embed.setTimestamp();
    }

    // 권장 조치사항 추가
    const recommendations = this.getRecommendations(alert);
    if (recommendations.length > 0) {
      embed.addFields([
        {
          name: '💡 권장 조치사항',
          value: recommendations.join('\n'),
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 상태 임베드 생성
   */
  createStatusEmbed(metrics, summary = {}) {
    const embed = new EmbedBuilder()
      .setTitle('📊 시스템 상태 보고서')
      .setColor(0x00FF7F)
      .setTimestamp();

    // 메모리 정보
    if (metrics.memory) {
      const memoryStatus = this.getStatusIndicator(metrics.memory.usagePercent, 85);
      embed.addFields([
        {
          name: `${memoryStatus} 메모리`,
          value: [
            `**사용률**: ${metrics.memory.usagePercent}%`,
            `**사용량**: ${this.formatBytes(metrics.memory.used)}`,
            `**전체**: ${this.formatBytes(metrics.memory.total)}`
          ].join('\n'),
          inline: true
        }
      ]);
    }

    // CPU 정보
    if (metrics.cpu) {
      const cpuStatus = this.getStatusIndicator(metrics.cpu.usage, 80);
      embed.addFields([
        {
          name: `${cpuStatus} CPU`,
          value: [
            `**사용률**: ${metrics.cpu.usage.toFixed(1)}%`,
            `**로드**: ${metrics.cpu.loadAverage[0].toFixed(2)}`,
            `**코어**: ${metrics.cpu.cores}개`
          ].join('\n'),
          inline: true
        }
      ]);
    }

    // 디스크 정보
    if (metrics.disk) {
      const diskStatus = this.getStatusIndicator(metrics.disk.usagePercent, 90);
      embed.addFields([
        {
          name: `${diskStatus} 디스크`,
          value: [
            `**사용률**: ${metrics.disk.usagePercent}%`,
            `**사용량**: ${this.formatBytes(metrics.disk.used)}`,
            `**여유공간**: ${this.formatBytes(metrics.disk.available)}`
          ].join('\n'),
          inline: true
        }
      ]);
    }

    // Raspberry Pi 특화 정보
    if (metrics.raspberryPi) {
      const tempStatus = this.getTemperatureIndicator(metrics.raspberryPi.temperature);
      embed.addFields([
        {
          name: `${tempStatus} Raspberry Pi`,
          value: [
            `**CPU 온도**: ${metrics.raspberryPi.temperature}°C`,
            `**스로틀링**: ${metrics.raspberryPi.throttling?.isThrottled ? '⚠️ 활성' : '✅ 정상'}`,
            `**전압**: ${metrics.raspberryPi.voltage?.core || 'N/A'}V`
          ].join('\n'),
          inline: true
        }
      ]);
    }

    // 시스템 가동시간
    if (metrics.system) {
      embed.addFields([
        {
          name: '⏱️ 시스템 정보',
          value: [
            `**가동시간**: ${this.formatUptime(metrics.system.uptime)}`,
            `**프로세스**: ${metrics.system.processes}개`,
            `**시간대**: ${metrics.system.timezone}`
          ].join('\n'),
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 배포 임베드 생성
   */
  createDeploymentEmbed(deployment) {
    const isSuccess = deployment.success;
    const embed = new EmbedBuilder()
      .setTitle(`🚀 배포 ${isSuccess ? '성공' : '실패'}`)
      .setColor(isSuccess ? 0x00FF00 : 0xFF0000)
      .setTimestamp();

    embed.addFields([
      {
        name: '📝 배포 정보',
        value: [
          `**상태**: ${isSuccess ? '✅ 성공' : '❌ 실패'}`,
          `**버전**: ${deployment.version || 'Unknown'}`,
          `**시작 시간**: ${deployment.startTime || 'Unknown'}`,
          `**소요 시간**: ${deployment.duration || 'Unknown'}`
        ].join('\n'),
        inline: true
      }
    ]);

    if (deployment.changes && deployment.changes.length > 0) {
      embed.addFields([
        {
          name: '📋 변경사항',
          value: deployment.changes.slice(0, 5).map(change => `• ${change}`).join('\n'),
          inline: false
        }
      ]);
    }

    if (!isSuccess && deployment.error) {
      embed.addFields([
        {
          name: '❌ 오류 정보',
          value: deployment.error.substring(0, 1000),
          inline: false
        }
      ]);
    }

    if (deployment.rollback) {
      embed.addFields([
        {
          name: '🔄 롤백 정보',
          value: `이전 버전 ${deployment.rollback.version}로 롤백됨`,
          inline: false
        }
      ]);
    }

    return embed;
  }

  /**
   * 헬퍼 메서드들
   */
  
  getAlertTypeLabel(type) {
    const labels = {
      memory: '메모리',
      cpu: 'CPU',
      disk: '디스크',
      temperature: '온도',
      load: '시스템 로드',
      swap: '스왑'
    };
    return labels[type] || type;
  }
  
  formatAlertValue(value, type) {
    if (type === 'temperature') {
      return `${value}°C`;
    } else if (type === 'memory' || type === 'cpu' || type === 'disk' || type === 'swap') {
      return `${value}%`;
    } else {
      return value.toString();
    }
  }
  
  formatSystemInfo(systemInfo) {
    const info = [];
    
    if (systemInfo.hostname) info.push(`**호스트**: ${systemInfo.hostname}`);
    if (systemInfo.uptime) info.push(`**가동시간**: ${this.formatUptime(systemInfo.uptime)}`);
    if (systemInfo.nodeVersion) info.push(`**Node.js**: ${systemInfo.nodeVersion}`);
    
    return info.join('\n') || '정보 없음';
  }
  
  getRecommendations(alert) {
    const recommendations = {
      memory: [
        '• 불필요한 프로세스 종료',
        '• 메모리 사용량이 많은 애플리케이션 확인',
        '• `pm2 restart godhand-bot` 으로 봇 재시작'
      ],
      cpu: [
        '• CPU 사용량이 높은 프로세스 확인',
        '• 시스템 로드 분산 고려',
        '• 불필요한 백그라운드 작업 중지'
      ],
      disk: [
        '• 불필요한 파일 정리',
        '• 로그 파일 압축 또는 삭제',
        '• 백업 파일 정리',
        '• `df -h` 명령어로 상세 확인'
      ],
      temperature: [
        '• 시스템 쿨링 확인',
        '• CPU 사용률 모니터링',
        '• 환기 상태 점검',
        '• 필요시 시스템 재시작'
      ],
      load: [
        '• 실행 중인 프로세스 확인',
        '• 시스템 리소스 모니터링',
        '• 불필요한 서비스 중지'
      ]
    };
    
    return recommendations[alert.type] || [];
  }
  
  getStatusIndicator(value, threshold) {
    if (value >= threshold) return '🔴';
    if (value >= threshold * 0.8) return '🟡';
    return '🟢';
  }
  
  getTemperatureIndicator(temperature) {
    if (!temperature) return '❓';
    if (temperature >= 75) return '🔴';
    if (temperature >= 65) return '🟡';
    return '🟢';
  }
  
  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
  
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}일 ${hours}시간 ${minutes}분`;
    } else if (hours > 0) {
      return `${hours}시간 ${minutes}분`;
    } else {
      return `${minutes}분`;
    }
  }

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.initializeClients();
  }

  /**
   * 헬스체크
   */
  async healthCheck() {
    const status = {
      webhook: false,
      botClient: false
    };
    
    try {
      // 웹훅 헬스체크
      if (this.webhook) {
        // 웹훅 테스트는 실제 메시지 없이는 어려우므로 존재 여부만 확인
        status.webhook = true;
      }
      
      // 봇 클라이언트 헬스체크
      if (this.client) {
        // Discord.js v14에서는 readyAt 속성으로 준비 상태 확인
        if (this.client.readyAt && this.client.user) {
          status.botClient = true;
        }
      }
    } catch (error) {
      logger.error('Discord 알림 서비스 헬스체크 실패:', error);
    }
    
    return status;
  }
}

module.exports = DiscordAlertService; 