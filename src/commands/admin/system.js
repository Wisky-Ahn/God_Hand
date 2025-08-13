/**
 * 시스템 재시작 명령어
 * 봇을 안전하게 재시작하는 기능을 제공
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class SystemCommand extends BaseCommand {
  constructor() {
    super();
    this.data = new SlashCommandBuilder()
      .setName('시스템')
      .setDescription('[관리자] 시스템 관리')
      .setDefaultMemberPermissions(0)
      .addSubcommand(subcommand =>
        subcommand
          .setName('재시작')
          .setDescription('봇을 재시작합니다 (pm2 restart)')
          .addBooleanOption(option =>
            option
              .setName('확인')
              .setDescription('재시작을 확인합니다')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('사유')
              .setDescription('재시작 사유 (선택사항)')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('메모리정리')
          .setDescription('시스템 메모리를 정리합니다')
          .addBooleanOption(option =>
            option
              .setName('확인')
              .setDescription('메모리 정리를 확인합니다')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('로그정리')
          .setDescription('시스템 로그를 정리합니다')
          .addBooleanOption(option =>
            option
              .setName('확인')
              .setDescription('로그 정리를 확인합니다')
              .setRequired(true)
          )
          .addIntegerOption(option =>
            option
              .setName('보관일수')
              .setDescription('며칠간의 로그를 보관할지 설정 (기본: 7일)')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(30)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('로그확인')
          .setDescription('중요한 시스템 로그를 확인합니다')
          .addIntegerOption(option =>
            option
              .setName('라인수')
              .setDescription('확인할 로그 라인 수 (기본: 50)')
              .setRequired(false)
              .setMinValue(10)
              .setMaxValue(200)
          )
      );
  }

  async execute(interaction) {
    try {
      // 관리자 권한 확인
      if (!this.checkAdminPermission(interaction)) {
        return await interaction.reply({
          content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.',
          ephemeral: true
        });
      }

      await interaction.deferReply();

      const subcommand = interaction.options.getSubcommand();
      const reason = interaction.options.getString('사유') || '관리자 요청';
      const confirm = interaction.options.getBoolean('확인');

      // 디버깅 로그 추가
      this.logger.info(`시스템 명령어 실행: 서브커맨드='${subcommand}', 요청자=${interaction.user.username}`);

      if (subcommand === '재시작') {
        return await this.handleRestart(interaction, reason, confirm);
      } else if (subcommand === '메모리정리') {
        return await this.handleMemoryCleanup(interaction, confirm);
      } else if (subcommand === '로그정리') {
        const keepDays = interaction.options.getInteger('보관일수') || 7;
        return await this.handleLogCleanup(interaction, confirm, keepDays);
      } else if (subcommand === '로그확인') {
        const lines = interaction.options.getInteger('라인수') || 50;
        return await this.handleLogCheck(interaction, lines);
      }

      // 인식되지 않은 서브커맨드 로그
      this.logger.warn(`알 수 없는 시스템 서브커맨드: ${subcommand}`);

      await interaction.editReply({
        content: '❌ 알 수 없는 명령어입니다.'
      });

    } catch (error) {
      this.logger.error('시스템 명령어 실행 실패:', error);
      
      const errorMessage = '❌ 명령어 실행 중 오류가 발생했습니다.';
      
      if (interaction.deferred) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }

  /**
   * 봇 재시작 처리
   */
  async handleRestart(interaction, reason, confirm) {
    const embed = new EmbedBuilder()
      .setTitle('🔄 시스템 재시작')
      .setColor(0xe74c3c)
      .setTimestamp();

    if (!confirm) {
      embed.addFields([
        {
          name: '❌ 재시작 취소',
          value: '확인 옵션을 true로 설정해야 재시작됩니다.',
          inline: false
        }
      ]);

      return await interaction.editReply({ embeds: [embed] });
    }

    embed.setColor(0xf39c12);
    embed.addFields([
      {
        name: '⚠️ 봇 재시작 진행',
        value: `사유: ${reason}\n\n3초 후 pm2 restart를 실행합니다...`,
        inline: false
      }
    ]);

    await interaction.editReply({ embeds: [embed] });

    // 3초 후 실제 재시작 실행
    setTimeout(() => {
      this.logger.info(`봇 재시작 실행 - 사유: ${reason}`);
      this.logger.info('pm2 restart 실행 중...');
      
      exec('pm2 restart godhand-bot', (error, stdout, stderr) => {
        if (error) {
          this.logger.error('pm2 restart 실패:', error);
        } else {
          this.logger.info('pm2 restart 성공:', stdout);
        }
      });
    }, 3000);

    return;
  }

  /**
   * 메모리 정리 처리
   */
  async handleMemoryCleanup(interaction, confirm) {
    const embed = new EmbedBuilder()
      .setTitle('🧹 메모리 정리')
      .setColor(0x3498db)
      .setTimestamp();

    if (!confirm) {
      embed.addFields([
        {
          name: '❌ 메모리 정리 취소',
          value: '확인 옵션을 true로 설정해야 메모리 정리가 실행됩니다.',
          inline: false
        }
      ]);

      return await interaction.editReply({ embeds: [embed] });
    }

    const beforeMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    // 가비지 컬렉션 실행
    if (global.gc) {
      global.gc();
    }
    
    const afterMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const clearedMB = beforeMB - afterMB;

    embed.setColor(0x27ae60);
    embed.addFields([
      {
        name: '✅ 메모리 정리 완료',
        value: `정리 전: ${beforeMB}MB\n정리 후: ${afterMB}MB\n정리된 메모리: ${clearedMB > 0 ? '+' : ''}${clearedMB}MB`,
        inline: false
      }
    ]);

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * 로그 정리 처리
   */
  async handleLogCleanup(interaction, confirm, keepDays) {
    const embed = new EmbedBuilder()
      .setTitle('🗂️ 로그 정리')
      .setColor(0x3498db)
      .setTimestamp();

    if (!confirm) {
      embed.addFields([
        {
          name: '❌ 로그 정리 취소',
          value: '확인 옵션을 true로 설정해야 로그 정리가 실행됩니다.',
          inline: false
        }
      ]);

      return await interaction.editReply({ embeds: [embed] });
    }

    embed.addFields([
      {
        name: '⏳ 로그 정리 중...',
        value: `${keepDays}일 이전 로그를 정리하고 있습니다...`,
        inline: false
      }
    ]);

    await interaction.editReply({ embeds: [embed] });

    try {
      // PM2 로그 정리
      exec(`pm2 flush godhand-bot`, (error, stdout, stderr) => {
        if (error) {
          this.logger.error('PM2 로그 정리 실패:', error);
        } else {
          this.logger.info('PM2 로그 정리 완료');
        }
      });

      let cleanedFiles = 0;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);

      // 임시 파일들 정리
      const tempDirs = ['/tmp/godhand-music', '/tmp/godhand-logs', '/tmp/godhand-cache'];
      
      for (const tempDir of tempDirs) {
        try {
          const files = await fs.readdir(tempDir);
          for (const file of files) {
            const filePath = path.join(tempDir, file);
            const stat = await fs.stat(filePath);
            if (stat.mtime < cutoffDate) {
              await fs.unlink(filePath);
              cleanedFiles++;
            }
          }
        } catch (err) {
          // 디렉토리가 없거나 접근 불가능한 경우 무시
        }
      }

      embed.setColor(0x27ae60);
      embed.setFields([
        {
          name: '✅ 로그 정리 완료',
          value: `${keepDays}일 이전 파일 ${cleanedFiles}개를 정리했습니다.\nPM2 로그도 정리되었습니다.`,
          inline: false
        }
      ]);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      this.logger.error('로그 정리 실패:', error);
      
      embed.setColor(0xe74c3c);
      embed.setFields([
        {
          name: '❌ 로그 정리 실패',
          value: `로그 정리 중 오류가 발생했습니다: ${error.message}`,
          inline: false
        }
      ]);

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * 로그 확인 처리 (중요한 정보만)
   */
  async handleLogCheck(interaction, lines) {
    const embed = new EmbedBuilder()
      .setTitle('📋 시스템 로그 확인')
      .setColor(0x3498db)
      .setTimestamp();

    embed.addFields([
      {
        name: '⏳ 로그 수집 중...',
        value: `중요한 정보만 (최근 ${lines}줄)`,
        inline: false
      }
    ]);

    await interaction.editReply({ embeds: [embed] });

    try {
      // 로그 파일을 직접 읽기
      const outLogPath = '/home/silla/.pm2/logs/godhand-bot-out.log';
      const errorLogPath = '/home/silla/.pm2/logs/godhand-bot-error.log';
      
      let allLogs = [];
      
      try {
        const outLogs = await fs.readFile(outLogPath, 'utf8');
        const outLines = outLogs.split('\n').slice(-lines);
        allLogs.push(...outLines);
      } catch (err) {
        this.logger.warn('Out 로그 파일 읽기 실패:', err.message);
      }
      
      try {
        const errorLogs = await fs.readFile(errorLogPath, 'utf8');
        const errorLines = errorLogs.split('\n').slice(-lines);
        allLogs.push(...errorLines);
      } catch (err) {
        this.logger.warn('Error 로그 파일 읽기 실패:', err.message);
      }

      // 중요한 정보만 필터링
      const importantLogs = allLogs.filter(line => {
        if (!line.trim()) return false;
        const lowerLine = line.toLowerCase();
        return lowerLine.includes('초기화') || 
               lowerLine.includes('시작') ||
               lowerLine.includes('완료') ||
               lowerLine.includes('성공') ||
               lowerLine.includes('실패') ||
               lowerLine.includes('error') ||
               line.includes('✅') ||
               line.includes('❌') ||
               line.includes('🚀') ||
               line.includes('🔄');
      }).slice(-lines);

      if (importantLogs.length === 0) {
        embed.setColor(0xf39c12);
        embed.setFields([
          {
            name: '📭 로그 없음',
            value: '중요한 정보에 해당하는 로그가 없습니다.',
            inline: false
          }
        ]);
      } else {
        // 로그가 너무 길면 잘라내기
        const maxLength = 4000;
        let logText = importantLogs.join('\n');
        
        if (logText.length > maxLength) {
          const truncatedLines = Math.floor(maxLength / (logText.length / importantLogs.length));
          logText = importantLogs.slice(-truncatedLines).join('\n');
          logText += `\n\n... (${importantLogs.length - truncatedLines}줄 더 있음)`;
        }

        embed.setColor(0x27ae60);
        embed.setFields([
          {
            name: `🔍 중요한 정보만 (${importantLogs.length}줄)`,
            value: `\`\`\`\n${logText}\n\`\`\``,
            inline: false
          }
        ]);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      this.logger.error('로그 확인 실행 실패:', error);
      
      embed.setColor(0xe74c3c);
      embed.setFields([
        {
          name: '❌ 로그 확인 실패',
          value: `로그 확인 중 오류가 발생했습니다: ${error.message}`,
          inline: false
        }
      ]);

      await interaction.editReply({ embeds: [embed] });
    }
  }
}

module.exports = new SystemCommand(); 