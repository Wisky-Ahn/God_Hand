/**
 * 사용자 명령어 템플릿
 * 새로운 사용자 명령어를 만들 때 이 템플릿을 복사해서 사용하세요
 */
const { SlashCommandBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');

class TemplateUserCommand extends BaseCommand {
  constructor() {
    // 슬래시 명령어 정의
    const data = new SlashCommandBuilder()
      .setName('템플릿')
      .setDescription('사용자 명령어 템플릿입니다')
      .addStringOption(option =>
        option.setName('옵션1')
          .setDescription('예시 옵션입니다')
          .setRequired(false)
      );

    super(data);

    // 명령어 설정
    this.category = 'general'; // 카테고리 설정
    this.cooldown = 3; // 쿨다운 (초)
    this.adminOnly = false; // 관리자 전용 여부
    this.musicCommand = false; // 음악 명령어 여부
    this.requiresVoiceChannel = false; // 음성 채널 필요 여부
  }

  /**
   * 명령어 실행
   * @param {CommandInteraction} interaction - Discord 인터랙션
   * @param {Object} validationData - 검증된 데이터
   */
  async execute(interaction, validationData) {
    try {
      // 옵션 값 가져오기
      const option1 = interaction.options.getString('옵션1');

      // 사용자 및 길드 데이터
      const { userData, guildData } = validationData;

      // 여기에 명령어 로직 구현
      const embed = this.createSuccessEmbed(
        '🎯 템플릿 명령어',
        `안녕하세요 ${interaction.user.username}님!\n입력하신 옵션: ${option1 || '없음'}`,
        {
          footer: `현재 점수: ${userData.current_score}점 | 순위: ${userData.current_rank}위`,
          fields: [
            {
              name: '📊 사용자 정보',
              value: `ID: ${userData.id}\n길드: ${guildData.name}`,
              inline: true
            }
          ]
        }
      );

      await interaction.reply({ embeds: [embed] });

    } catch (error) {
      throw error; // BaseCommand에서 에러 처리
    }
  }
}

// 인스턴스 생성 및 내보내기
const command = new TemplateUserCommand();

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
새 명령어 만들기 가이드:

1. 이 파일을 복사해서 새 파일명으로 저장
2. 클래스명과 SlashCommandBuilder 내용 수정
3. execute() 메서드에 원하는 로직 구현
4. 필요에 따라 설정 값들 수정:
   - category: 명령어 카테고리
   - cooldown: 쿨다운 시간 (초)
   - adminOnly: 관리자 전용 여부
   - musicCommand: 음악 명령어 여부
   - requiresVoiceChannel: 음성 채널 필요 여부

예시 카테고리:
- general: 일반 명령어
- ranking: 순위 관련
- music: 음악 관련
- stats: 통계 관련
- fun: 재미 관련

음악 명령어 예시:
- musicCommand: true
- requiresVoiceChannel: true
- 음악 권한 확인: await this.checkMusicPermission(...)
*/ 