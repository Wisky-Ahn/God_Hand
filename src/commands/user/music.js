/**
 * 통합 음악 명령어
 * /노래 접두사로 모든 음악 관련 기능 제공
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const musicPlayer = require('../../services/music');

class MusicCommand extends BaseCommand {
  constructor() {
    super();
    
    this.data = new SlashCommandBuilder()
      .setName('노래')
      .setDescription('음악 재생 및 제어 명령어')
      .addSubcommand(subcommand =>
        subcommand
          .setName('재생')
          .setDescription('YouTube 음악을 재생합니다')
          .addStringOption(option =>
            option
              .setName('url')
              .setDescription('YouTube URL 또는 검색어')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('중지')
          .setDescription('음악 재생을 중지하고 대기열을 정리합니다')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('건너뛰기')
          .setDescription('현재 재생 중인 음악을 건너뜁니다')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('대기열')
          .setDescription('현재 대기열을 확인합니다')
          .addIntegerOption(option =>
            option
              .setName('페이지')
              .setDescription('페이지 번호 (기본값: 1)')
              .setMinValue(1)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('제거')
          .setDescription('대기열에서 특정 트랙을 제거합니다')
          .addIntegerOption(option =>
            option
              .setName('위치')
              .setDescription('제거할 트랙의 위치 (2부터 시작)')
              .setRequired(true)
              .setMinValue(2)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('권한')
          .setDescription('현재 음악 제어 권한을 확인합니다')
          .addUserOption(option =>
            option
              .setName('사용자')
              .setDescription('권한을 확인할 사용자 (비어두면 자신의 권한 확인)')
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('반복')
          .setDescription('음악 반복 모드를 설정합니다')
          .addStringOption(option =>
            option
              .setName('모드')
              .setDescription('반복 모드를 선택하세요')
              .addChoices(
                { name: '반복 없음', value: 'off' },
                { name: '한 곡 반복', value: 'track' },
                { name: '전체 반복', value: 'queue' }
              )
          )
      );

    this.category = 'music';
    this.cooldown = 3;
    this.adminOnly = false;
    this.musicCommand = true;
    this.requiresVoiceChannel = true;
  }

  async execute(interaction, validationData) {
    const subcommand = interaction.options.getSubcommand();
    this.logger.info(`MusicCommand.execute 시작 - 서브커맨드: ${subcommand}`);

    try {
      this.logger.info(`switch 문 진입 - 서브커맨드: ${subcommand}`);
      switch (subcommand) {
        case '재생':
          this.logger.info('재생 케이스 진입');
          return await this.handlePlay(interaction, validationData);
        case '중지':
          this.logger.info('중지 케이스 진입');
          return await this.handleStop(interaction, validationData);
        case '건너뛰기':
          this.logger.info('건너뛰기 케이스 진입');
          return await this.handleSkip(interaction, validationData);
        case '대기열':
          this.logger.info('대기열 케이스 진입');
          return await this.handleQueue(interaction, validationData);
        case '제거':
          this.logger.info('제거 케이스 진입');
          return await this.handleRemove(interaction, validationData);
        case '반복':
          this.logger.info('반복 케이스 진입');
          return await this.handleRepeat(interaction, validationData);
        case '현재재생':
          this.logger.info('현재재생 케이스 진입');
          return await this.handleNowPlaying(interaction, validationData);
        case '권한':
          this.logger.info('권한 케이스 진입');
          return await this.handlePermissions(interaction, validationData);
        default:
          this.logger.error(`알 수 없는 서브커맨드: ${subcommand}`);
          return await interaction.reply({
            content: '❌ 알 수 없는 명령어입니다.',
            ephemeral: true
          });
      }
    } catch (error) {
      this.logger.error(`음악 명령어 실행 실패 (${subcommand}):`, {
        error: error?.message || 'Unknown error',
        stack: error?.stack || 'No stack trace',
        name: error?.name || 'Unknown error type',
        fullError: error
      });
      
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply({
          content: '❌ 명령어 실행 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }

  // 재생 처리
  async handlePlay(interaction, validationData) {
    this.logger.info('handlePlay 시작');
    const url = interaction.options.getString('url');
    
    // 음성 채널 참여 확인
    if (!validationData.voiceChannel) {
      this.logger.info('handlePlay: 음성 채널 없음으로 조기 반환');
      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ 오류')
        .setDescription('음성 채널에 참여한 후 음악을 재생할 수 있습니다.');
      
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      this.logger.info('handlePlay: musicPlayer.play 호출 시작');
      
      // 현재 재생 상태 확인
      const isCurrentlyPlaying = musicPlayer.isPlaying(interaction.guild.id);
      const hasQueue = musicPlayer.getQueue && musicPlayer.getQueue(interaction.guild.id) && 
                      musicPlayer.getQueue(interaction.guild.id).length > 0;
      
      this.logger.info(`handlePlay: isPlaying=${isCurrentlyPlaying}, hasQueue=${hasQueue}`);
      
      // await을 제거하고, 에러 처리를 위해 .catch() 사용
      musicPlayer.play(
        interaction.guild.id,
        validationData.voiceChannel.id,
        url,
        interaction.user,
        {
          voiceChannel: validationData.voiceChannel,
          textChannel: interaction.channel
        }
      ).catch(error => {
        this.logger.error('musicPlayer.play에서 치명적인 에러 발생:', error);
      });
      
      // 재생 상태에 따라 다른 메시지 제공
      if (isCurrentlyPlaying || hasQueue) {
        return await interaction.reply({
          content: `📝 **요청하신 곡이 대기열에 추가되었습니다!**\n🎵 ${url}\n\n\`/노래 대기열\` 명령어로 확인하세요.`
        });
      } else {
        return await interaction.reply({
          content: `🎵 **음악 재생을 시작합니다!**\n${url}\n\n잠시만 기다려주세요...`
        });
      }
      
    } catch (error) {
      this.logger.error('handlePlay 음악 재생 중 예외 발생:', {
        error: error?.message || 'Unknown error',
        stack: error?.stack || 'No stack trace',
        name: error?.name || 'Unknown error type',
        code: error?.code || 'No error code',
        fullError: error
      });
      
      return await interaction.reply({
        content: `❌ 음악 재생 실패: ${error?.message || '알 수 없는 오류가 발생했습니다.'}`,
        ephemeral: true
      });
    }
  }

  // 중지 처리
  async handleStop(interaction, validationData) {
    try {
      // 권한 확인
      const hasPermission = await this.checkMusicPermission(interaction, validationData);
      if (!hasPermission) {
        return await interaction.reply({
          content: '❌ 현재 재생 중인 음악을 중지할 권한이 없습니다.',
          ephemeral: true
        });
      }

      const result = await musicPlayer.stop(interaction.guild.id, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('⏹️ 음악 중지')
        .setDescription('음악 재생이 중지되었고 대기열이 정리되었습니다.')
        .addFields({
          name: '🚪 자동 퇴장',
          value: '잠시 후 음성 채널에서 나갑니다.',
          inline: false
        })
        .setTimestamp();

      // 자동으로 음성 채널에서 나가기 (즉시)
      setTimeout(async () => {
        try {
          await musicPlayer.disconnect(interaction.guild.id);
          this.logger.info(`자동 퇴장: 음악 중지 후 음성 채널에서 나감 (길드: ${interaction.guild.id})`);
        } catch (disconnectError) {
          this.logger.error('자동 퇴장 중 오류:', disconnectError);
        }
      }, 500); // 0.5초 후 즉시 퇴장

      return await interaction.reply({ embeds: [embed] });
    } catch (error) {
      return await interaction.reply({
        content: `❌ 음악 중지 실패: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // 건너뛰기 처리
  async handleSkip(interaction, validationData) {
    try {
      // 권한 확인
      const hasPermission = await this.checkMusicPermission(interaction, validationData);
      if (!hasPermission) {
        return await interaction.reply({
          content: '❌ 현재 재생 중인 음악을 건너뛸 권한이 없습니다.',
          ephemeral: true
        });
      }

      const result = await musicPlayer.skip(interaction.guild.id, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#ffff00')
        .setTitle('⏭️ 곡 건너뛰기')
        .setDescription(`**${result.track.title}**을(를) 건너뛰었습니다.`)
        .setTimestamp();

      if (result.nextTrack) {
        embed.addFields({
          name: '다음 곡',
          value: result.nextTrack.title,
          inline: false
        });
      } else {
        // 다음 곡이 없으면 대기열 비어있음을 표시하고 자동 퇴장
        embed.addFields({
          name: '🚪 자동 퇴장',
          value: '대기열이 비어있어 음성 채널에서 나갑니다.',
          inline: false
        });
        
        // 자동으로 음성 채널에서 나가기 (즉시)
        setTimeout(async () => {
          try {
            await musicPlayer.disconnect(interaction.guild.id);
            this.logger.info(`자동 퇴장: 대기열이 비어서 음성 채널에서 나감 (길드: ${interaction.guild.id})`);
          } catch (disconnectError) {
            this.logger.error('자동 퇴장 중 오류:', disconnectError);
          }
        }, 500); // 0.5초 후 즉시 퇴장
      }

      return await interaction.reply({ embeds: [embed] });
    } catch (error) {
      return await interaction.reply({
        content: `❌ 곡 건너뛰기 실패: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // 대기열 처리
  async handleQueue(interaction, validationData) {
    try {
      const page = interaction.options.getInteger('페이지') || 1;
      const result = await musicPlayer.getQueue(interaction.guild.id, page);

      if (!result.currentTrack && result.queue.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#666666')
          .setTitle('📋 대기열')
          .setDescription('재생 중인 음악이 없습니다.')
          .setTimestamp();

        return await interaction.reply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📋 대기열')
        .setTimestamp();

      if (result.currentTrack) {
        const requesterName = result.currentTrack.requester?.displayName || 
                             result.currentTrack.requester?.tag || 
                             result.currentTrack.requestedBy?.tag ||
                             '알 수 없음';
        
        embed.addFields({
          name: '🎵 현재 재생 중',
          value: `**${result.currentTrack.title}**\n요청자: ${requesterName}`,
          inline: false
        });
      }

      if (result.queue.length > 0) {
        const queueList = result.queue
          .map((track, index) => {
            const requesterName = track.requester?.displayName || 
                                 track.requester?.tag || 
                                 track.requestedBy?.tag ||
                                 '알 수 없음';
            return `${index + 2}. **${track.title}** - ${requesterName}`;
          })
          .join('\n');

        embed.addFields({
          name: `⏭️ 다음 곡들 (${result.totalCount || result.queue.length}곡)`,
          value: queueList.length > 1024 ? queueList.substring(0, 1021) + '...' : queueList,
          inline: false
        });

        if (result.hasMore) {
          embed.addFields({
            name: '📄 페이지 정보',
            value: `${page}/${result.totalPages} 페이지`,
            inline: true
          });
        }
      }

      return await interaction.reply({ embeds: [embed] });
    } catch (error) {
      return await interaction.reply({
        content: `❌ 대기열 조회 실패: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // 제거 처리
  async handleRemove(interaction, validationData) {
    try {
      const position = interaction.options.getInteger('위치');

      // 권한 확인
      const hasPermission = await this.checkMusicPermission(interaction, validationData);
      if (!hasPermission) {
        return await interaction.reply({
          content: '❌ 대기열에서 곡을 제거할 권한이 없습니다.',
          ephemeral: true
        });
      }

      const result = await musicPlayer.remove(interaction.guild.id, position);

      const embed = new EmbedBuilder()
        .setColor('#ff6600')
        .setTitle('🗑️ 곡 제거')
        .setDescription(`**${result.removedTrack.title}**이(가) 대기열에서 제거되었습니다.`)
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    } catch (error) {
      return await interaction.reply({
        content: `❌ 곡 제거 실패: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // 권한 확인 처리
  async handlePermissions(interaction, validationData) {
    try {
      const targetUser = interaction.options.getUser('사용자') || interaction.user;
      const permission = await this.getMusicPermission(interaction.guild.id, targetUser.id);

      const embed = new EmbedBuilder()
        .setColor('#00ccff')
        .setTitle('🎵 음악 제어 권한')
        .addFields(
          { name: '사용자', value: targetUser.displayName, inline: true },
          { name: '현재 순위', value: `${permission.rank}위`, inline: true },
          { name: '제어 가능 범위', value: permission.canControl, inline: false }
        )
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    } catch (error) {
      return await interaction.reply({
        content: `❌ 권한 조회 실패: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // 반복 처리
  async handleRepeat(interaction, validationData) {
    try {
      const mode = interaction.options.getString('모드');

      if (!mode) {
        // 현재 반복 모드 확인
        const currentMode = await musicPlayer.getRepeatMode(interaction.guild.id);
        const modeDescriptions = {
          'off': '반복 없음',
          'track': '한 곡 반복',
          'queue': '전체 반복'
        };

        const embed = new EmbedBuilder()
          .setColor('#00ccff')
          .setTitle('🔁 현재 반복 모드')
          .setDescription(`현재 반복 모드: **${modeDescriptions[currentMode]}**`)
          .setTimestamp();

        return await interaction.reply({ embeds: [embed] });
      }

      // 권한 확인
      const hasPermission = await this.checkMusicPermission(interaction, validationData);
      if (!hasPermission) {
        return await interaction.reply({
          content: '❌ 반복 모드를 변경할 권한이 없습니다.',
          ephemeral: true
        });
      }

      const result = await musicPlayer.setRepeatMode(interaction.guild.id, mode);
      const modeDescriptions = {
        'off': '반복 없음',
        'track': '한 곡 반복',
        'queue': '전체 반복'
      };

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🔁 반복 모드 설정')
        .setDescription(`반복 모드가 **${modeDescriptions[result.mode]}**로 설정되었습니다.`)
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    } catch (error) {
      return await interaction.reply({
        content: `❌ 반복 모드 설정 실패: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // 음악 권한 확인 헬퍼 메서드
  async checkMusicPermission(interaction, validationData) {
    // 실제 권한 확인 로직은 음악 서비스에서 구현
    // 여기서는 기본적인 구조만 제공
    try {
      const permission = await musicPlayer.checkPermission(
        interaction.guild.id,
        interaction.user.id
      );
      return permission.hasControl;
    } catch (error) {
      this.logger.error('음악 권한 확인 실패:', error);
      return false;
    }
  }

  // 음악 권한 정보 조회 헬퍼 메서드
  async getMusicPermission(guildId, userId) {
    try {
      return await musicPlayer.getPermissionInfo(guildId, userId);
    } catch (error) {
      this.logger.error('음악 권한 정보 조회 실패:', error);
      return {
        rank: '알 수 없음',
        canControl: '알 수 없음'
      };
    }
  }
}

module.exports = new MusicCommand(); 