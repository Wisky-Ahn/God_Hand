/**
 * guildMemberUpdate 이벤트 핸들러
 * Discord 서버에서 사용자 정보 변경 시 자동 감지 및 동기화
 * 주요 감지 대상: 닉네임 변경, 역할 변경, 기타 멤버 정보 변경
 */

const logger = require('../utils/logger');
const { updateUserDisplayNameInDB, clearAllCache } = require('../utils/nickname');

module.exports = {
  name: 'guildMemberUpdate',
  once: false,

  async execute(oldMember, newMember) {
    try {
      // 봇 계정은 무시
      if (newMember.user.bot) return;

      const discordId = newMember.user.id;
      const guildId = newMember.guild.id;
      const guildName = newMember.guild.name;

      // 변경사항 감지 및 처리
      await this.handleMemberChanges(oldMember, newMember);

    } catch (error) {
      logger.error('guildMemberUpdate 이벤트 처리 중 오류:', error);
    }
  },

  /**
   * 멤버 변경사항 처리
   * @param {GuildMember} oldMember - 이전 멤버 정보
   * @param {GuildMember} newMember - 새 멤버 정보
   */
  async handleMemberChanges(oldMember, newMember) {
    const changes = this.detectChanges(oldMember, newMember);
    
    if (changes.length === 0) {
      logger.debug(`멤버 업데이트 감지되었지만 추적 대상 변경사항 없음: ${newMember.user.tag}`);
      return;
    }

    logger.info(`멤버 정보 변경 감지: ${newMember.user.tag} in ${newMember.guild.name}`, {
      changes: changes.map(c => c.type),
      userId: newMember.user.id,
      guildId: newMember.guild.id
    });

    // 각 변경사항 처리
    for (const change of changes) {
      try {
        await this.handleSpecificChange(change, oldMember, newMember);
      } catch (error) {
        logger.error(`변경사항 처리 실패 (${change.type}):`, error);
      }
    }
  },

  /**
   * 변경사항 감지
   * @param {GuildMember} oldMember - 이전 멤버 정보
   * @param {GuildMember} newMember - 새 멤버 정보
   * @returns {Array} 변경사항 배열
   */
  detectChanges(oldMember, newMember) {
    const changes = [];

    // 1. 닉네임 변경 감지
    const oldDisplayName = oldMember.nickname || oldMember.displayName || oldMember.user.username;
    const newDisplayName = newMember.nickname || newMember.displayName || newMember.user.username;
    
    if (oldDisplayName !== newDisplayName) {
      changes.push({
        type: 'nickname',
        old: oldDisplayName,
        new: newDisplayName,
        priority: 1 // 높은 우선순위
      });
    }

    // 2. 사용자명 변경 감지 (Discord 사용자명 자체가 변경된 경우)
    if (oldMember.user.username !== newMember.user.username) {
      changes.push({
        type: 'username',
        old: oldMember.user.username,
        new: newMember.user.username,
        priority: 1
      });
    }

    // 3. 역할 변경 감지 (로깅용)
    const oldRoles = new Set(oldMember.roles.cache.keys());
    const newRoles = new Set(newMember.roles.cache.keys());
    
    if (oldRoles.size !== newRoles.size || 
        ![...oldRoles].every(role => newRoles.has(role))) {
      changes.push({
        type: 'roles',
        old: [...oldRoles],
        new: [...newRoles],
        priority: 3 // 낮은 우선순위
      });
    }

    // 4. 기타 변경사항 (아바타, 상태 등)
    if (oldMember.user.avatar !== newMember.user.avatar) {
      changes.push({
        type: 'avatar',
        old: oldMember.user.avatar,
        new: newMember.user.avatar,
        priority: 3
      });
    }

    // 우선순위별 정렬
    return changes.sort((a, b) => a.priority - b.priority);
  },

  /**
   * 특정 변경사항 처리
   * @param {Object} change - 변경사항 객체
   * @param {GuildMember} oldMember - 이전 멤버 정보
   * @param {GuildMember} newMember - 새 멤버 정보
   */
  async handleSpecificChange(change, oldMember, newMember) {
    const discordId = newMember.user.id;
    const guildId = newMember.guild.id;

    switch (change.type) {
      case 'nickname':
      case 'username':
        await this.handleNicknameChange(change, discordId, guildId, newMember);
        break;
        
      case 'roles':
        await this.handleRoleChange(change, discordId, guildId, newMember);
        break;
        
      case 'avatar':
        await this.handleAvatarChange(change, discordId, guildId, newMember);
        break;
        
      default:
        logger.debug(`알 수 없는 변경사항 타입: ${change.type}`);
    }
  },

  /**
   * 닉네임/사용자명 변경 처리
   * @param {Object} change - 변경사항
   * @param {string} discordId - Discord 사용자 ID
   * @param {string} guildId - 길드 ID
   * @param {GuildMember} newMember - 새 멤버 정보
   */
  async handleNicknameChange(change, discordId, guildId, newMember) {
    try {
      // 새 표시명 결정
      const newDisplayName = newMember.nickname || newMember.displayName || newMember.user.username;
      
      // DB 업데이트
      await updateUserDisplayNameInDB(
        discordId, 
        guildId, 
        newDisplayName, 
        newMember.user.username
      );

      // 닉네임 캐시에서 해당 사용자 제거 (다음 조회 시 새 정보 사용)
      const { clearAllCache } = require('../utils/nickname');
      clearAllCache(); // 간단히 전체 캐시 클리어

      logger.info(`🔄 닉네임 자동 동기화 완료`, {
        discordId,
        guildId,
        guildName: newMember.guild.name,
        changeType: change.type,
        oldValue: change.old,
        newValue: change.new,
        finalDisplayName: newDisplayName
      });

      // 활동 로깅 (선택사항)
      await this.logNicknameChange(discordId, guildId, change.old, change.new);

    } catch (error) {
      logger.error(`닉네임 변경 처리 실패: ${discordId}`, {
        error: error.message,
        guildId,
        changeType: change.type,
        oldValue: change.old,
        newValue: change.new
      });
    }
  },

  /**
   * 역할 변경 처리 (로깅용)
   * @param {Object} change - 변경사항
   * @param {string} discordId - Discord 사용자 ID
   * @param {string} guildId - 길드 ID
   * @param {GuildMember} newMember - 새 멤버 정보
   */
  async handleRoleChange(change, discordId, guildId, newMember) {
    try {
      const addedRoles = change.new.filter(role => !change.old.includes(role));
      const removedRoles = change.old.filter(role => !change.new.includes(role));

      if (addedRoles.length > 0 || removedRoles.length > 0) {
        logger.info(`🎭 역할 변경 감지: ${newMember.user.tag}`, {
          discordId,
          guildId,
          addedRoles: addedRoles.length,
          removedRoles: removedRoles.length
        });

        // 역할 변경 로깅 (필요시 구현)
        await this.logRoleChange(discordId, guildId, addedRoles, removedRoles);
      }
    } catch (error) {
      logger.warn(`역할 변경 처리 실패: ${discordId}`, error);
    }
  },

  /**
   * 아바타 변경 처리 (로깅용)
   * @param {Object} change - 변경사항
   * @param {string} discordId - Discord 사용자 ID
   * @param {string} guildId - 길드 ID
   * @param {GuildMember} newMember - 새 멤버 정보
   */
  async handleAvatarChange(change, discordId, guildId, newMember) {
    try {
      logger.debug(`🖼️ 아바타 변경 감지: ${newMember.user.tag}`, {
        discordId,
        guildId
      });
      
      // 아바타 변경 로깅 (필요시 구현)
      // await this.logAvatarChange(discordId, guildId, change.old, change.new);
    } catch (error) {
      logger.debug(`아바타 변경 처리 실패: ${discordId}`, error);
    }
  },

  /**
   * 닉네임 변경 활동 로깅
   * @param {string} discordId - Discord 사용자 ID
   * @param {string} guildId - 길드 ID
   * @param {string} oldName - 이전 이름
   * @param {string} newName - 새 이름
   */
  async logNicknameChange(discordId, guildId, oldName, newName) {
    try {
      const db = require('../services/database');
      
      // activities 테이블에 닉네임 변경 로그 추가 (선택사항)
      await db.query(`
        INSERT INTO activities (
          user_id, guild_id, activity_type, score_awarded, details
        ) 
        SELECT 
          u.id, u.guild_id, 'nickname_change', 0, $3
        FROM users u 
        WHERE u.discord_id = $1 AND u.guild_id = $2
      `, [
        discordId, 
        guildId, 
        JSON.stringify({
          oldName,
          newName,
          timestamp: new Date().toISOString(),
          source: 'auto_sync'
        })
      ]);

    } catch (error) {
      logger.debug(`닉네임 변경 로깅 실패: ${discordId}`, error);
      // 로깅 실패는 중요하지 않으므로 에러를 던지지 않음
    }
  },

  /**
   * 역할 변경 활동 로깅 (선택사항)
   * @param {string} discordId - Discord 사용자 ID
   * @param {string} guildId - 길드 ID
   * @param {Array} addedRoles - 추가된 역할 ID 배열
   * @param {Array} removedRoles - 제거된 역할 ID 배열
   */
  async logRoleChange(discordId, guildId, addedRoles, removedRoles) {
    try {
      // 역할 변경 로깅 로직 (필요시 구현)
      logger.debug(`역할 변경 로깅: ${discordId}`, {
        added: addedRoles.length,
        removed: removedRoles.length
      });
    } catch (error) {
      logger.debug(`역할 변경 로깅 실패: ${discordId}`, error);
    }
  }
};
