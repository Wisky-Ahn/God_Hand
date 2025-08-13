/**
 * 모니터링 관리 명령어
 * 시스템 모니터링 상태 확인 및 제어
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const BaseCommand = require('../BaseCommand');

class MonitoringCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('모니터링')
      .setDescription('시스템 모니터링 관리')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand =>
        subcommand
          .setName('상태')
          .setDescription('모니터링 시스템 전체 상태 확인 (메트릭, 알림, 설정, 헬스체크 포함)')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('시작')
          .setDescription('모니터링 시스템 시작')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('중지')
          .setDescription('모니터링 시스템 중지')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('재시작')
          .setDescription('모니터링 시스템 재시작')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('테스트')
          .setDescription('테스트 알림 전송')
          .addStringOption(option =>
            option
              .setName('레벨')
              .setDescription('알림 레벨')
              .setRequired(true)
              .addChoices(
                { name: '정보', value: 'info' },
                { name: '경고', value: 'warning' },
                { name: '심각', value: 'critical' },
                { name: '오류', value: 'error' }
              )
          )
      );
  }

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    try {
      // 모니터링 서비스 가져오기
      const monitoringService = interaction.client.monitoringService;
      
      if (!monitoringService) {
        return await interaction.reply({
          content: '❌ 모니터링 서비스가 초기화되지 않았습니다.',
          ephemeral: true
        });
      }
      
      switch (subcommand) {
        case '상태':
          await this.handleStatus(interaction, monitoringService);
          break;
        case '시작':
          await this.handleStart(interaction, monitoringService);
          break;
        case '중지':
          await this.handleStop(interaction, monitoringService);
          break;
        case '재시작':
          await this.handleRestart(interaction, monitoringService);
          break;
        case '테스트':
          await this.handleTest(interaction, monitoringService);
          break;
        default:
          await interaction.reply({
            content: '❌ 알 수 없는 하위 명령어입니다.',
            ephemeral: true
          });
      }
      
    } catch (error) {
      console.error('모니터링 명령어 실행 오류:', error);
      
      if (!interaction.replied) {
        await interaction.reply({
          content: '❌ 명령어 실행 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * 통합 모니터링 상태 확인 (메트릭, 알림, 설정, 헬스체크 포함)
   */
  async handleStatus(interaction, monitoringService) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const status = monitoringService.getStatus();
      
      // 1. 기본 상태 정보
      const mainEmbed = new EmbedBuilder()
        .setTitle('📊 모니터링 시스템 통합 상태')
        .setColor(status.isRunning ? 0x00FF00 : 0xFF0000)
        .setTimestamp();

      // 서비스 상태
      mainEmbed.addFields([
        {
          name: '🔧 서비스 상태',
          value: [
            `**실행 상태**: ${status.isRunning ? '🟢 실행중' : '🔴 중지됨'}`,
            `**가동시간**: ${this.formatUptime(status.uptime)}`,
            `**헬스체크**: ${status.lastHealthCheck ? '🟢 정상' : '🟡 확인 필요'}`
          ].join('\n'),
          inline: true
        }
      ]);

      // 시스템 정보
      if (status.systemMonitor) {
        const sysInfo = status.systemMonitor.info;
        mainEmbed.addFields([
          {
            name: '🖥️ 시스템 정보',
            value: [
              `**호스트**: ${sysInfo.hostname || 'Unknown'}`,
              `**플랫폼**: ${sysInfo.platform || 'Unknown'}`,
              `**CPU 코어**: ${sysInfo.cpuCount || 'Unknown'}개`,
              `**Node.js**: ${sysInfo.nodeVersion || 'Unknown'}`
            ].join('\n'),
            inline: true
          }
        ]);
      }

      // 알림 통계
      mainEmbed.addFields([
        {
          name: '📈 알림 통계',
          value: [
            `**총 알림**: ${status.stats.alerts.total}개`,
            `**마지막 알림**: ${status.stats.lastAlert ? 
              `${status.stats.lastAlert.type} (${status.stats.lastAlert.level})` : 
              '없음'}`,
            `**헬스체크**: ${status.stats.healthChecks}회`
          ].join('\n'),
          inline: false
        }
      ]);

      // 2. 실시간 메트릭 정보
      let metricsContent = '';
      if (monitoringService.isRunning && monitoringService.systemMonitor) {
        const metrics = await monitoringService.systemMonitor.collectMetrics();
        
        // 메모리 정보
        if (metrics.memory) {
          const memoryColor = this.getMetricColor(metrics.memory.usagePercent, 85);
          metricsContent += `**${memoryColor} 메모리**\n`;
          metricsContent += `사용률: ${metrics.memory.usagePercent}% | `;
          metricsContent += `사용량: ${this.formatBytes(metrics.memory.used)} / ${this.formatBytes(metrics.memory.total)}\n\n`;
        }

        // CPU 정보
        if (metrics.cpu) {
          const cpuColor = this.getMetricColor(metrics.cpu.usage, 80);
          metricsContent += `**${cpuColor} CPU**\n`;
          metricsContent += `사용률: ${metrics.cpu.usage.toFixed(1)}% | `;
          metricsContent += `온도: ${metrics.cpu.temperature || 'N/A'}°C | `;
          metricsContent += `로드: ${metrics.cpu.loadAverage[0].toFixed(2)}\n\n`;
        }

        // 디스크 정보
        if (metrics.disk) {
          const diskColor = this.getMetricColor(metrics.disk.usagePercent, 90);
          metricsContent += `**${diskColor} 디스크**\n`;
          metricsContent += `사용률: ${metrics.disk.usagePercent}% | `;
          metricsContent += `여유공간: ${this.formatBytes(metrics.disk.available)}\n\n`;
        }

        // Raspberry Pi 정보
        if (metrics.raspberryPi) {
          const tempColor = this.getTemperatureColor(metrics.raspberryPi.temperature);
          metricsContent += `**${tempColor} Raspberry Pi**\n`;
          metricsContent += `온도: ${metrics.raspberryPi.temperature || 'N/A'}°C | `;
          metricsContent += `스로틀링: ${metrics.raspberryPi.throttling?.isThrottled ? '⚠️ 활성' : '✅ 정상'}\n`;
        }
      } else {
        metricsContent = '❌ 모니터링이 실행되지 않고 있습니다.';
      }

      mainEmbed.addFields([
        {
          name: '📊 실시간 메트릭',
          value: metricsContent || '데이터를 수집할 수 없습니다.',
          inline: false
        }
      ]);

      // 3. 설정 정보
      const config = status.config.systemMonitor;
      mainEmbed.addFields([
        {
          name: '⚙️ 모니터링 설정',
          value: [
            `**간격**: ${config.interval}초 | **쿨다운**: ${config.alerts.cooldown}초`,
            `**임계치** - 메모리: ${config.thresholds.memory}% | CPU: ${config.thresholds.cpu}% | 디스크: ${config.thresholds.disk}%`,
            `**온도**: ${config.thresholds.temperature}°C | **스왑**: ${config.thresholds.swap}% | **로드**: ${config.thresholds.load}`,
            `**Discord 웹훅**: ${status.config.discordAlert.webhook.configured ? '✅ 설정됨' : '❌ 설정되지 않음'}`
          ].join('\n'),
          inline: false
        }
      ]);

      // 4. 최근 알림 정보
      let alertContent = '';
      if (status.stats.lastAlert) {
        const alert = status.stats.lastAlert;
        alertContent = [
          `**타입**: ${alert.type} | **레벨**: ${alert.level}`,
          `**메시지**: ${alert.message}`,
          `**시간**: ${new Date(alert.timestamp).toLocaleString('ko-KR')}`
        ].join('\n');
      } else {
        alertContent = '아직 알림이 없습니다.';
      }

      mainEmbed.addFields([
        {
          name: '🚨 최근 알림',
          value: alertContent,
          inline: false
        }
      ]);

      // 5. 헬스체크 결과
      let healthContent = '';
      try {
        await monitoringService.performHealthCheck();
        const healthStatus = monitoringService.lastHealthCheck;
        
        healthContent = [
          `**시스템 모니터**: ${healthStatus.systemMonitor ? '✅ 정상' : '❌ 오류'}`,
          `**Discord 웹훅**: ${healthStatus.discordAlert.webhook ? '✅ 정상' : '❌ 오류'}`,
          `**Discord 봇**: ${healthStatus.discordAlert.botClient ? '✅ 정상' : '❌ 오류'}`
        ].join(' | ');
      } catch (error) {
        healthContent = '❌ 헬스체크 수행 실패';
      }

      mainEmbed.addFields([
        {
          name: '🩺 헬스체크',
          value: healthContent,
          inline: false
        }
      ]);

      await interaction.editReply({ embeds: [mainEmbed] });
      
    } catch (error) {
      console.error('통합 상태 확인 오류:', error);
      await interaction.editReply('❌ 모니터링 상태 확인에 실패했습니다.');
    }
  }

  /**
   * 모니터링 시작
   */
  async handleStart(interaction, monitoringService) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      if (monitoringService.isRunning) {
        await interaction.editReply('⚠️ 모니터링 시스템이 이미 실행 중입니다.');
        return;
      }
      
      monitoringService.start();
      await interaction.editReply('✅ 모니터링 시스템이 시작되었습니다.');
      
    } catch (error) {
      await interaction.editReply('❌ 모니터링 시스템 시작에 실패했습니다.');
    }
  }

  /**
   * 모니터링 중지
   */
  async handleStop(interaction, monitoringService) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      if (!monitoringService.isRunning) {
        await interaction.editReply('⚠️ 모니터링 시스템이 이미 중지되어 있습니다.');
        return;
      }
      
      monitoringService.stop();
      await interaction.editReply('✅ 모니터링 시스템이 중지되었습니다.');
      
    } catch (error) {
      await interaction.editReply('❌ 모니터링 시스템 중지에 실패했습니다.');
    }
  }

  /**
   * 모니터링 재시작
   */
  async handleRestart(interaction, monitoringService) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      monitoringService.stop();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
      monitoringService.start();
      
      await interaction.editReply('✅ 모니터링 시스템이 재시작되었습니다.');
      
    } catch (error) {
      await interaction.editReply('❌ 모니터링 시스템 재시작에 실패했습니다.');
    }
  }

  /**
   * 테스트 알림 전송
   */
  async handleTest(interaction, monitoringService) {
    await interaction.deferReply({ ephemeral: true });
    
    const level = interaction.options.getString('레벨');
    
    try {
      const testAlert = {
        type: 'test',
        level: level,
        message: `테스트 알림 (${level} 레벨)`,
        value: 50,
        threshold: 80
      };
      
      await monitoringService.handleAlert(testAlert);
      
      await interaction.editReply(`✅ ${level} 레벨 테스트 알림이 전송되었습니다.`);
      
    } catch (error) {
      await interaction.editReply('❌ 테스트 알림 전송에 실패했습니다.');
    }
  }

  // 헬퍼 메서드들
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
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

  getMetricColor(value, threshold) {
    if (value >= threshold) return '🔴';
    if (value >= threshold * 0.8) return '🟡';
    return '🟢';
  }

  getTemperatureColor(temperature) {
    if (!temperature) return '❓';
    if (temperature >= 75) return '🔴';
    if (temperature >= 65) return '🟡';
    return '🟢';
  }
}

module.exports = new MonitoringCommand(); 