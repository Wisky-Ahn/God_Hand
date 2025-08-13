/**
 * 관리자 명령어 템플릿
 * 새로운 관리자 명령어를 만들 때 이 템플릿을 복사해서 사용하세요
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const BaseCommand = require('../BaseCommand');

class TemplateAdminCommand extends BaseCommand {
  constructor() {
    // 슬래시 명령어 정의 (관리자 권한 필요)
    const data = new SlashCommandBuilder()
      .setName('관리자템플릿')
      .setDescription('관리자 명령어 템플릿입니다')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(option =>
        option.setName('대상사용자')
          .setDescription('작업할 대상 사용자를 선택하세요')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('작업')
          .setDescription('실행할 작업을 선택하세요')
          .setRequired(true)
          .addChoices(
            { name: '점수 조회', value: 'view_score' },
            { name: '점수 수정', value: 'modify_score' },
            { name: '순위 초기화', value: 'reset_rank' }
          )
      )
      .addNumberOption(option =>
        option.setName('점수')
          .setDescription('수정할 점수 (작업이 점수 수정일 때만)')
          .setRequired(false)
      );

    super(data);

    // 명령어 설정
    this.category = 'admin'; // 관리자 카테고리
    this.cooldown = 5; // 관리자 명령어는 쿨다운 좀 더 길게
    this.adminOnly = true; // 필수: 관리자 전용
    this.musicCommand = false;
    this.requiresVoiceChannel = false;
  }

  /**
   * 관리자 명령어 실행
   * @param {CommandInteraction} interaction - Discord 인터랙션
   * @param {Object} validationData - 검증된 데이터
   */
  async execute(interaction, validationData) {
    try {
      // 옵션 값 가져오기
      const targetUser = interaction.options.getUser('대상사용자');
      const action = interaction.options.getString('작업');
      const score = interaction.options.getNumber('점수');

      // 사용자 및 길드 데이터
      const { userData, guildData } = validationData;

      // 작업에 따른 처리
      switch (action) {
        case 'view_score':
          await this.handleViewScore(interaction, targetUser, guildData);
          break;
        case 'modify_score':
          await this.handleModifyScore(interaction, targetUser, score, guildData);
          break;
        case 'reset_rank':
          await this.handleResetRank(interaction, guildData);
          break;
        default:
          throw new Error('알 수 없는 작업입니다.');
      }

    } catch (error) {
      throw error; // BaseCommand에서 에러 처리
    }
  }

  /**
   * 점수 조회 처리
   */
  async handleViewScore(interaction, targetUser, guildData) {
    const dbUtils = require('../../services/database/utils');

    if (!targetUser) {
      // 전체 순위 조회
      const rankings = await dbUtils.getGuildRankings(guildData.id, 10);
      
      if (rankings.length === 0) {
        const embed = this.createInfoEmbed(
          '📊 순위 정보',
          '아직 등록된 사용자가 없습니다.'
        );
        return await interaction.reply({ embeds: [embed] });
      }

      const rankingText = rankings.map((user, index) => 
        `${index + 1}. **${user.display_name}** - ${user.current_score}점`
      ).join('\n');

      const embed = this.createInfoEmbed(
        '🏆 서버 순위 TOP 10',
        rankingText,
        {
          footer: `총 ${rankings.length}명의 활성 사용자`
        }
      );

      await interaction.reply({ embeds: [embed] });
    } else {
      // 특정 사용자 조회
      const userStats = await dbUtils.getUserStats(targetUser.id, guildData.id);
      
      if (!userStats) {
        const embed = this.createErrorEmbed(
          '❌ 사용자 없음',
          '해당 사용자의 데이터를 찾을 수 없습니다.'
        );
        return await interaction.reply({ embeds: [embed] });
      }

      const embed = this.createInfoEmbed(
        `📊 ${targetUser.username}님의 통계`,
        `현재 점수: **${userStats.current_score}점**\n현재 순위: **${userStats.current_rank}위**`,
        {
          fields: [
            {
              name: '📈 세부 점수',
              value: `음성: ${userStats.voice_score}점\n메시지: ${userStats.message_score}점\n반응: ${userStats.reaction_score}점\n기타: ${userStats.other_score}점`,
              inline: true
            },
            {
              name: '⏰ 활동 정보',
              value: `음성 시간: ${Math.floor(userStats.total_voice_time / 60)}분\n메시지 수: ${userStats.total_messages}개`,
              inline: true
            }
          ]
        }
      );

      await interaction.reply({ embeds: [embed] });
    }
  }

  /**
   * 점수 수정 처리
   */
  async handleModifyScore(interaction, targetUser, score, guildData) {
    if (!targetUser) {
      const embed = this.createErrorEmbed(
        '❌ 오류',
        '점수를 수정할 대상 사용자를 선택해주세요.'
      );
      return await interaction.reply({ embeds: [embed] });
    }

    if (score === null || score === undefined) {
      const embed = this.createErrorEmbed(
        '❌ 오류',
        '수정할 점수를 입력해주세요.'
      );
      return await interaction.reply({ embeds: [embed] });
    }

    const dbUtils = require('../../services/database/utils');
    
    // 사용자 확인/생성 (예시)
    const userData = await dbUtils.findOrCreateUser(
      targetUser.id,
      guildData.id,
      {
        username: targetUser.username,
        discriminator: targetUser.discriminator,
        displayName: interaction.member.nickname || interaction.member.displayName || targetUser.username
      }
    );

    // 점수 업데이트
    await dbUtils.updateUserScore(userData.id, score, 'other');

    const embed = this.createSuccessEmbed(
      '✅ 점수 수정 완료',
      `${targetUser.username}님의 점수가 ${score}점 조정되었습니다.`,
      {
        footer: `관리자: ${interaction.user.username}`
      }
    );

    await interaction.reply({ embeds: [embed] });

    // 관리자 행동 로깅
    this.logActivity(
      interaction.user.id,
      'admin_modify_score',
      {
        targetUserId: targetUser.id,
        scoreChange: score,
        guildId: guildData.id
      }
    );
  }

  /**
   * 순위 초기화 처리
   */
  async handleResetRank(interaction, guildData) {
    // 확인 메시지
    const embed = this.createErrorEmbed(
      '⚠️ 경고',
      '정말로 모든 사용자의 순위를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.'
    );

    await interaction.reply({ 
      embeds: [embed], 
      ephemeral: true,
      content: '이 기능은 아직 구현되지 않았습니다. 데이터베이스에서 직접 작업해주세요.'
    });
  }
}

// 인스턴스 생성 및 내보내기
const command = new TemplateAdminCommand();

module.exports = {
  data: command.data,
  category: command.category,
  cooldown: command.cooldown,
  adminOnly: command.adminOnly,
  musicCommand: command.musicCommand,
  requiresVoiceChannel: command.requiresVoiceChannel,
  execute: (interaction) => command.run(interaction)
};

/*
관리자 명령어 만들기 가이드:

1. 이 파일을 복사해서 새 파일명으로 저장
2. 클래스명과 SlashCommandBuilder 내용 수정
3. execute() 메서드에 원하는 관리자 로직 구현
4. 필수 설정:
   - adminOnly: true (반드시 true)
   - setDefaultMemberPermissions() 설정

관리자 명령어 예시 카테고리:
- admin: 일반 관리
- moderation: 모더레이션
- system: 시스템 관리
- debug: 디버깅

보안 주의사항:
- 민감한 작업은 추가 확인 절차 구현
- 모든 관리자 행동을 로깅
- 사용자 입력 검증 철저히
- 에러 발생 시 자세한 정보 노출 금지
*/ 