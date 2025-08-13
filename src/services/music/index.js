/**
 * 코어 음악 플레이어 서비스
 * 라즈베리파이 최적화된 YouTube 음악 재생 시스템
 * YouTube API + yt-dlp 사용
 */

const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  demuxProbe,
  StreamType
} = require('@discordjs/voice');
const youtubeAPI = require('./youtube-api');
const { spawn } = require('child_process');
const { Readable, PassThrough } = require('stream');
const db = require('../database');
const dbUtils = require('../database/utils');
const permissions = require('./permissions');
const logger = require('../../utils/logger');

/**
 * 음악 플레이어 클래스
 */
class MusicPlayer {
  constructor() {
    this.queues = new Map();      // guildId -> 대기열
    this.connections = new Map(); // guildId -> 음성 연결
    this.players = new Map();     // guildId -> 오디오 플레이어
    this.currentTracks = new Map(); // guildId -> 현재 재생 중인 트랙
    this.volumes = new Map();     // guildId -> 볼륨 설정
    this.repeatModes = new Map(); // guildId -> 반복 모드
    
    // 라즈베리파이 최적화 설정 (최적화 시스템과 통합)
    this.config = {
      audioQuality: 'highest',     // 최고음질로 설정 (고음 깨짐 방지 처리 포함)
      connectionTimeout: 15000,    // 연결 타임아웃
      retryAttempts: 3,           // 재시도 횟수
      ytdlpPath: '/usr/local/bin/yt-dlp', // yt-dlp 경로
      autoDisconnectDelay: 3000    // 대기열 없을 때 자동 종료 지연 시간 (ms) - 3초
    };
    
    // 자동 종료 타이머 관리
    this.disconnectTimers = new Map(); // guildId -> 타이머 ID
    
    // 다운로드 관리는 최적화 시스템에서 처리
  }

  /**
   * 음악 재생 요청 처리
   * @param {string} guildId - 길드 ID
   * @param {string} channelId - 음성 채널 ID
   * @param {string} query - YouTube URL 또는 검색어
   * @param {Object} requestedBy - 요청한 사용자 정보
   * @param {Object} options - 재생 옵션
   * @returns {Object} 재생 결과
   */
  async play(guildId, channelId, query, requestedBy, options = {}) {
    try {
      // 서버별 닉네임 우선 표시명 결정 (간단한 방식 사용)
      let requesterName = requestedBy.displayName || requestedBy.username;
      
      logger.info(`음악 재생 요청: ${query} (요청자: ${requesterName})`);
      
      // 사용자 권한 확인 (Task 12에서 구현될 예정)
      const hasPermission = await this.checkUserPermission(guildId, requestedBy.id, 'add');
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: hasPermission.reason,
          code: 'PERMISSION_DENIED'
        };
      }
      
      // 트랙 정보 추출
      const trackInfo = await this.getTrackInfo(query);
      if (!trackInfo) {
        return { 
          status: 'error', 
          message: '유효한 YouTube URL을 찾을 수 없습니다.',
          code: 'INVALID_URL'
        };
      }
      
      // 트랙 객체 생성
      const track = {
        id: this.generateTrackId(),
        title: trackInfo.title,
        url: trackInfo.url,
        duration: trackInfo.duration,
        thumbnail: trackInfo.thumbnail,
        requestedBy: {
          id: requestedBy.id,
          tag: requestedBy.tag,
          rank: await this.getUserRank(guildId, requestedBy.id)
        },
        addedAt: new Date(),
        source: 'youtube'
      };
      
      // 대기열에 추가
      await this.addToQueue(guildId, track);
      
      // 음악 로그 기록
      await this.logMusicActivity(guildId, requestedBy.id, 'queue', {
        track: track.title,
        url: track.url,
        duration: track.duration
      });
      
      // 현재 재생 중이 아니면 재생 시작
      if (!this.isPlaying(guildId)) {
        const playResult = await this.startPlaying(guildId, channelId);
        if (playResult.status === 'error') {
          return playResult;
        }
        
        return {
          status: 'playing',
          track: track,
          message: `🎵 **${track.title}** 재생을 시작합니다!`
        };
      } else {
        const queuePosition = this.queues.get(guildId).length;
        return {
          status: 'queued',
          track: track,
          position: queuePosition,
          message: `📝 **${track.title}**이(가) 대기열 ${queuePosition}번째에 추가되었습니다.`
        };
      }
      
    } catch (error) {
      logger.error('음악 재생 요청 처리 중 오류:', error);
      return { 
        status: 'error', 
        message: '음악 재생 중 오류가 발생했습니다.',
        code: 'PLAYBACK_ERROR'
      };
    }
  }

  /**
   * 음성 채널 연결 및 재생 시작
   * @param {string} guildId - 길드 ID
   * @param {string} channelId - 음성 채널 ID
   * @returns {Object} 재생 결과
   */
  async startPlaying(guildId, channelId) {
    try {
      const queue = this.queues.get(guildId);
      if (!queue || queue.length === 0) {
        return { status: 'error', message: '재생할 트랙이 없습니다.' };
      }
      
      const track = queue[0];
      
      // 음성 채널 연결
      const connection = await this.connectToVoiceChannel(guildId, channelId);
      if (!connection) {
        return { status: 'error', message: '음성 채널 연결에 실패했습니다.' };
      }
      
      // 오디오 플레이어 생성 및 설정
      const player = await this.createAudioPlayer(guildId);
      
      // 오디오 스트림 생성
      const audioStream = await this.createAudioStream(track.url);
      if (!audioStream) {
        return { status: 'error', message: '오디오 스트림 생성에 실패했습니다.' };
      }
      
      // Discord.js v14 - 테스트에서 성공한 방식 적용
      logger.debug('테스트 검증된 방식으로 오디오 리소스 생성...');
      
      // 테스트에서 성공한 방식: raw 타입으로 직접 생성 (demuxProbe 제거)
      const resource = createAudioResource(audioStream, {
        inputType: 'raw',        // 테스트에서 성공한 타입
        inlineVolume: false      // 테스트에서 성공한 설정
      });
      
      logger.debug(`오디오 리소스 생성 완료 (타입: raw, 길드: ${guildId})`);
      
      // 볼륨 설정 (inlineVolume: false이므로 생략)
      logger.debug(`볼륨 설정 생략 (raw 타입 사용, 길드: ${guildId})`);
      
      // 현재 트랙 설정
      this.currentTracks.set(guildId, track);
      
      // 재생 시작 전 연결 상태 확인
      if (connection.state.status !== VoiceConnectionStatus.Ready) {
        logger.warn(`음성 연결 상태가 Ready가 아님: ${connection.state.status}`);
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 5000);
          logger.debug('음성 연결 Ready 상태 확인됨');
        } catch (stateError) {
          logger.error('음성 연결 Ready 상태 대기 실패:', stateError);
          return { status: 'error', message: '음성 연결 상태 확인 실패' };
        }
      }
      
      // 재생 시작
      player.play(resource);
      const subscription = connection.subscribe(player);
      
      if (!subscription) {
        logger.error('음성 연결 구독 실패');
        return { status: 'error', message: '음성 연결 구독 실패' };
      }
      
      logger.info(`재생 시작: ${track.title} (길드: ${guildId})`);
      
      // 재생 시작 후 상태 모니터링
      setTimeout(() => {
        const currentStatus = player.state.status;
        if (currentStatus === AudioPlayerStatus.Playing) {
          logger.debug(`재생 상태 확인: ${track.title} 정상 재생 중`);
        } else if (currentStatus === AudioPlayerStatus.Buffering) {
          logger.debug(`재생 상태 확인: ${track.title} 버퍼링 중 (정상)`);
        } else if (currentStatus === AudioPlayerStatus.AutoPaused) {
          logger.debug(`재생 상태 확인: ${track.title} 자동 일시정지 (정상)`);
        } else {
          logger.warn(`재생 상태 이상: ${currentStatus}`);
        }
      }, 1000);
      
      return { status: 'playing', track };
      
    } catch (error) {
      logger.error('재생 시작 중 오류:', error);
      return { status: 'error', message: '재생 시작에 실패했습니다.' };
    }
  }

  /**
   * 음성 채널 연결
   * @param {string} guildId - 길드 ID
   * @param {string} channelId - 음성 채널 ID
   * @returns {VoiceConnection|null} 음성 연결 객체
   */
  async connectToVoiceChannel(guildId, channelId) {
    try {
      // 기존 연결 확인
      let connection = getVoiceConnection(guildId);
      
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        // 이미 연결되어 있으면 기존 연결 사용
        if (connection.joinConfig.channelId === channelId) {
          return connection;
        }
        // 다른 채널에 연결되어 있으면 연결 해제 후 새로 연결
        connection.destroy();
      }
      
      // 새 연결 생성
      connection = joinVoiceChannel({
        channelId: channelId,
        guildId: guildId,
        adapterCreator: this.getGuildVoiceAdapter(guildId),
        selfDeaf: false,
        selfMute: false
      });
      
      // 연결 상태 확인
      await entersState(connection, VoiceConnectionStatus.Ready, this.config.connectionTimeout);
      
      // 연결 이벤트 핸들러 설정
      this.setupConnectionHandlers(guildId, connection);
      
      this.connections.set(guildId, connection);
      
      logger.info(`음성 채널 연결 성공: ${guildId} -> ${channelId}`);
      return connection;
      
    } catch (error) {
      logger.error('음성 채널 연결 실패:', error);
      return null;
    }
  }

  /**
   * 오디오 플레이어 생성 및 설정
   * @param {string} guildId - 길드 ID
   * @returns {AudioPlayer} 오디오 플레이어
   */
  async createAudioPlayer(guildId) {
    try {
      let player = this.players.get(guildId);
      
      if (!player) {
        player = createAudioPlayer();
        this.players.set(guildId, player);
        
        // 플레이어 이벤트 핸들러 설정
        this.setupPlayerHandlers(guildId, player);
      }
      
      return player;
      
    } catch (error) {
      logger.error('오디오 플레이어 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 오디오 스트림 생성 (YouTube API + yt-dlp 사용) - 개선된 버전
   * @param {string} url - YouTube URL
   * @returns {Readable|null} 오디오 스트림
   */
  async createAudioStream(url) {
    try {
      // 라즈베리파이 최적화 시스템 사용
      const optimization = require('../../config/optimization');
      
      // 메모리 확인
      if (!optimization.isMemoryAvailable()) {
        logger.warn('메모리 부족으로 오디오 스트림 생성 지연');
        await optimization.forceGarbageCollection();
        
        // 메모리가 여전히 부족하면 거부
        if (!optimization.isMemoryAvailable()) {
          throw new Error('메모리 부족으로 스트림 생성 불가');
        }
      }
      
      // 최적화된 다운로드 대기열 사용
      return await optimization.queueDownload(async (url) => {
        logger.debug(`오디오 스트림 생성 시작: ${url}`);
        
        try {
          // 1. YouTube API로 비디오 정보 확인
          let verifiedUrl = url;
          try {
            const videoInfo = await youtubeAPI.getVideoFromQuery(url);
            logger.info(`✅ YouTube API 확인: ${videoInfo.title} (${youtubeAPI.formatDuration(videoInfo.durationSeconds)})`);
            verifiedUrl = videoInfo.url;
          } catch (apiError) {
            logger.warn('YouTube API 실패, 원본 URL 사용:', apiError.message);
          }
          
          // 2. yt-dlp → FFmpeg → Discord 파이프라인 구성
          logger.debug('yt-dlp → FFmpeg → Discord 파이프라인 생성');
          
          // yt-dlp 프로세스 (오디오 URL 추출 및 스트림)
          const ytdlpProcess = spawn(this.config.ytdlpPath, [
            verifiedUrl,
            '--format', 'bestaudio[ext=webm]/bestaudio/best',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--buffer-size', '16384',
            '--http-chunk-size', '524288',
            '--retries', '5',
            '--fragment-retries', '5',
            '--ignore-errors',
            '--no-abort-on-error',
            '--output', '-'  // stdout으로 출력
          ], {
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          // FFmpeg 프로세스 (Discord 호환 포맷으로 변환) - 고음 깨짐 방지 최적화
          const ffmpegProcess = spawn('ffmpeg', [
            '-i', 'pipe:0',           // yt-dlp 출력을 입력으로 받음
            '-f', 's16le',            // Discord 호환 포맷
            '-ar', '48000',           // 48kHz 샘플링 레이트 (Discord 표준)
            '-ac', '2',               // 스테레오
            '-af', 'volume=0.85',     // 85% 볼륨으로 헤드룸 확보 (클리핑 방지)
            '-loglevel', 'error',     // 에러만 로그
            '-buffer_size', '128k',   // 큰 버퍼로 안정성 확보
            '-avoid_negative_ts', 'make_zero', // 타임스탬프 정규화
            'pipe:1'                  // stdout으로 출력
          ], {
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          // PassThrough 스트림으로 최종 출력 안정화
          const passThrough = new PassThrough();
          let hasStarted = false;
          let ytdlpError = '';
          let ffmpegError = '';
          let dataChunks = 0;
          
          ytdlpProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();
            if (!errorMsg.includes('Deleting original file') && 
                !errorMsg.includes('WARNING') &&
                !errorMsg.includes('[download]')) {
              ytdlpError += errorMsg;
              logger.debug('yt-dlp stderr:', errorMsg.trim());
            }
          });
          
          ffmpegProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();
            if (!errorMsg.includes('Deleting original file') && 
                !errorMsg.includes('WARNING') &&
                !errorMsg.includes('[download]')) {
              ffmpegError += errorMsg;
              logger.debug('ffmpeg stderr:', errorMsg.trim());
            }
          });
          
          // yt-dlp → FFmpeg 파이프 연결
          ytdlpProcess.stdout.pipe(ffmpegProcess.stdin);
          
          // FFmpeg 출력을 PassThrough로 파이프
          ffmpegProcess.stdout.on('data', (chunk) => {
            if (!hasStarted) {
              hasStarted = true;
              logger.debug('FFmpeg 처리된 스트림 데이터 수신 시작');
            }
            
            dataChunks++;
            if (dataChunks % 100 === 0) {
              logger.debug(`FFmpeg 스트림 청크 수신: ${dataChunks}개`);
            }
            
            // PassThrough 스트림으로 데이터 전달
            if (!passThrough.destroyed) {
              passThrough.write(chunk);
            }
          });
          
          // yt-dlp 프로세스 모니터링
          ytdlpProcess.stdout.on('data', () => {
            // yt-dlp가 데이터를 생성하고 있음을 확인
            logger.debug('yt-dlp 원시 데이터 수신 중...');
          });
          
          // 스트림 종료 처리
          ytdlpProcess.stdout.on('end', () => {
            logger.debug('yt-dlp 스트림 종료, FFmpeg stdin 닫기');
            ffmpegProcess.stdin.end();
          });
          
          // EPIPE 에러 처리
          ytdlpProcess.stdout.on('error', (error) => {
            if (error.code === 'EPIPE') {
              logger.debug('EPIPE 에러 감지 - PassThrough 스트림으로 처리');
              if (!passThrough.destroyed) {
                passThrough.end();
              }
            } else {
              logger.error('스트림 에러:', error);
              if (!passThrough.destroyed) {
                passThrough.destroy(error);
              }
            }
          });

          ffmpegProcess.stdout.on('end', () => {
            logger.debug(`ffmpeg 스트림 종료 (총 청크: ${dataChunks}개)`);
            if (!passThrough.destroyed) {
              passThrough.end();
            }
          });

          ffmpegProcess.stdout.on('error', (error) => {
            if (error.code === 'EPIPE') {
              logger.debug('EPIPE 에러 감지 - PassThrough 스트림으로 처리');
              if (!passThrough.destroyed) {
                passThrough.end();
              }
            } else {
              logger.error('스트림 에러:', error);
              if (!passThrough.destroyed) {
                passThrough.destroy(error);
              }
            }
          });
          
          // PassThrough 스트림 에러 처리
          passThrough.on('error', (error) => {
            logger.error('PassThrough 스트림 에러:', error);
          });
          
          ytdlpProcess.on('error', (error) => {
            if (!hasStarted) {
              logger.error('yt-dlp 프로세스 오류:', error);
              if (!passThrough.destroyed) {
                passThrough.destroy(error);
              }
              throw error;
            } else {
              logger.debug('yt-dlp 프로세스 오류 (스트림 시작 후):', error.message);
            }
          });

          ffmpegProcess.on('error', (error) => {
            if (!hasStarted) {
              logger.error('ffmpeg 프로세스 오류:', error);
              if (!passThrough.destroyed) {
                passThrough.destroy(error);
              }
              throw error;
            } else {
              logger.debug('ffmpeg 프로세스 오류 (스트림 시작 후):', error.message);
            }
          });
          
          // 프로세스 종료 시 로그
          ytdlpProcess.on('close', (code) => {
            if (code !== 0 && !hasStarted) {
              logger.error(`yt-dlp 프로세스 실패 (코드: ${code}):`, ytdlpError);
              const error = new Error(`yt-dlp failed with code ${code}: ${ytdlpError}`);
              if (!passThrough.destroyed) {
                passThrough.destroy(error);
              }
              throw error;
            }
            logger.debug(`yt-dlp 프로세스 종료 (코드: ${code}, 스트림 시작됨: ${hasStarted}, 청크: ${dataChunks}개)`);
          });

          ffmpegProcess.on('close', (code) => {
            if (code !== 0 && !hasStarted) {
              logger.error(`ffmpeg 프로세스 실패 (코드: ${code}):`, ffmpegError);
              const error = new Error(`ffmpeg failed with code ${code}: ${ffmpegError}`);
              if (!passThrough.destroyed) {
                passThrough.destroy(error);
              }
              throw error;
            }
            logger.debug(`ffmpeg 프로세스 종료 (코드: ${code}, 스트림 시작됨: ${hasStarted}, 청크: ${dataChunks}개)`);
          });
          
                      logger.debug('yt-dlp → FFmpeg → PassThrough 파이프라인 생성 성공');
            return passThrough;
          
        } catch (error) {
          logger.error('스트림 생성 실패:', error);
          throw error;
        }
        
      }, url);
      
    } catch (error) {
      logger.error('오디오 스트림 생성 실패:', error);
      
      // 오류 발생 시 응급 정리
      if (error.message.includes('메모리') || error.message.includes('타임아웃')) {
        try {
          const optimization = require('../../config/optimization');
          await optimization.emergencyCleanup();
        } catch (cleanupError) {
          logger.error('응급 정리 실패:', cleanupError);
        }
      }
      
      return null;
    }
  }

  /**
   * 트랙 정보 추출 (YouTube API 전용)
   * @param {string} query - YouTube URL 또는 검색어
   * @returns {Object|null} 트랙 정보
   */
  async getTrackInfo(query) {
    try {
      // YouTube API로 정보 추출 (URL과 검색어 모두 지원)
      const videoInfo = await youtubeAPI.getVideoFromQuery(query);
      
      return {
        title: videoInfo.title,
        url: videoInfo.url,
        duration: videoInfo.durationSeconds,
        thumbnail: videoInfo.thumbnails.medium?.url || videoInfo.thumbnails.default?.url,
        channelTitle: videoInfo.channelTitle,
        publishedAt: videoInfo.publishedAt
      };
      
    } catch (error) {
      logger.error('트랙 정보 추출 실패:', error);
      return null;
    }
  }

  /**
   * 대기열에 트랙 추가
   * @param {string} guildId - 길드 ID
   * @param {Object} track - 트랙 정보
   */
  async addToQueue(guildId, track) {
    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, []);
    }
    
    const queue = this.queues.get(guildId);
    queue.push(track);
    
    // 새로운 트랙이 추가되면 자동 종료 타이머 취소
    this.cancelAutoDisconnect(guildId);
    
    logger.debug(`트랙 대기열 추가: ${track.title} (위치: ${queue.length})`);
  }

  /**
   * 다음 트랙으로 건너뛰기
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 요청한 사용자 ID
   * @returns {Object} 건너뛰기 결과
   */
  async skip(guildId, userId) {
    try {
      // 권한 확인
      const hasPermission = await this.checkSkipPermission(guildId, userId);
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: hasPermission.reason,
          code: 'PERMISSION_DENIED'
        };
      }
      
      const player = this.players.get(guildId);
      const currentTrack = this.currentTracks.get(guildId);
      
      if (!player || !currentTrack) {
        return { 
          status: 'error', 
          message: '현재 재생 중인 트랙이 없습니다.',
          code: 'NO_TRACK_PLAYING'
        };
      }
      
      // 건너뛰기 플래그 설정 (반복 모드 무시)
      this.skipFlags = this.skipFlags || new Map();
      this.skipFlags.set(guildId, true);
      
      // 현재 트랙 건너뛰기 로그
      await this.logMusicActivity(guildId, userId, 'skip', {
        skippedTrack: currentTrack.title,
        skippedBy: userId
      });
      
      // 플레이어 정지 (idle 이벤트가 다음 트랙 재생을 처리)
      player.stop();
      
      logger.info(`트랙 건너뛰기: ${currentTrack.title} (요청자: ${userId})`);
      
      return { 
        status: 'skipped', 
        track: currentTrack,
        message: `⏭️ **${currentTrack.title}**을(를) 건너뛰었습니다.`
      };
      
    } catch (error) {
      logger.error('트랙 건너뛰기 중 오류:', error);
      return { 
        status: 'error', 
        message: '건너뛰기 중 오류가 발생했습니다.',
        code: 'SKIP_ERROR'
      };
    }
  }

  /**
   * 재생 중지
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 요청한 사용자 ID
   * @returns {Object} 중지 결과
   */
  async stop(guildId, userId) {
    try {
      // 권한 확인
      const hasPermission = await this.checkStopPermission(guildId, userId);
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: hasPermission.reason,
          code: 'PERMISSION_DENIED'
        };
      }
      
      // 대기열 및 현재 트랙 정리
      this.queues.set(guildId, []);
      this.currentTracks.delete(guildId);
      
      // 플레이어 정지
      const player = this.players.get(guildId);
      if (player) {
        player.stop();
      }
      
      // 연결 해제
      await this.disconnect(guildId);
      
      // 중지 로그
      await this.logMusicActivity(guildId, userId, 'stop', {
        stoppedBy: userId
      });
      
      logger.info(`음악 재생 중지 (길드: ${guildId}, 요청자: ${userId})`);
      
      return { 
        status: 'stopped',
        message: '🛑 음악 재생이 중지되었습니다.'
      };
      
    } catch (error) {
      logger.error('음악 중지 중 오류:', error);
      return { 
        status: 'error', 
        message: '중지 중 오류가 발생했습니다.',
        code: 'STOP_ERROR'
      };
    }
  }

  /**
   * 음성 채널 연결 해제
   * @param {string} guildId - 길드 ID
   */
  async disconnect(guildId) {
    try {
      const connection = this.connections.get(guildId);
      if (connection) {
        connection.destroy();
        this.connections.delete(guildId);
      }
      
      // 플레이어 정리
      const player = this.players.get(guildId);
      if (player) {
        player.stop();
        this.players.delete(guildId);
      }
      
      // 상태 정리
      this.currentTracks.delete(guildId);
      
      // 자동 종료 타이머 취소
      this.cancelAutoDisconnect(guildId);
      
      logger.debug(`음성 연결 해제: ${guildId}`);
      
    } catch (error) {
      logger.error('연결 해제 중 오류:', error);
    }
  }

  // ==================== 헬퍼 메소드 ====================

  /**
   * YouTube URL 유효성 검사
   * @param {string} url - URL 문자열
   * @returns {boolean} 유효성 여부
   */
  isValidYouTubeUrl(url) {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+/;
    return youtubeRegex.test(url);
  }

  /**
   * 고유 트랙 ID 생성
   * @returns {string} 트랙 ID
   */
  generateTrackId() {
    return `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 현재 재생 상태 확인
   * @param {string} guildId - 길드 ID
   * @returns {boolean} 재생 중 여부
   */
  isPlaying(guildId) {
    const player = this.players.get(guildId);
    return player && player.state.status === AudioPlayerStatus.Playing;
  }

  // 다운로드 대기는 최적화 시스템에서 처리

  /**
   * 길드 음성 어댑터 가져오기
   * @param {string} guildId - 길드 ID
   * @returns {Function} 음성 어댑터
   */
  getGuildVoiceAdapter(guildId) {
    // 글로벌 클라이언트에서 길드 정보 가져오기
    const client = global.discordClient;
    const guild = client?.guilds?.cache?.get(guildId);
    return guild?.voiceAdapterCreator;
  }

  // ==================== 권한 검사 메소드 ====================

  /**
   * 사용자 권한 확인
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {string} action - 액션 타입
   * @returns {Object} 권한 확인 결과
   */
  async checkUserPermission(guildId, userId, action) {
    try {
      const permissions = require('./permissions');
      const result = await permissions.canControlMusic(guildId, userId, action);
      
      // 권한 액션 로그 기록
      await permissions.logMusicPermissionAction(guildId, userId, action, result);
      
      return result;
      
    } catch (error) {
      logger.error('권한 확인 중 오류:', error);
      return { 
        allowed: false, 
        reason: 'error',
        message: '권한 확인 중 오류가 발생했습니다.' 
      };
    }
  }

  /**
   * 건너뛰기 권한 확인
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {Object} 권한 확인 결과
   */
  async checkSkipPermission(guildId, userId) {
    return await this.checkUserPermission(guildId, userId, 'skip');
  }

  /**
   * 중지 권한 확인
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {Object} 권한 확인 결과
   */
  async checkStopPermission(guildId, userId) {
    return await this.checkUserPermission(guildId, userId, 'stop');
  }

  /**
   * 사용자 순위 조회
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {number} 사용자 순위
   */
  async getUserRank(guildId, userId) {
    try {
      const permissions = require('./permissions');
      return await permissions.getUserRank(guildId, userId);
      
    } catch (error) {
      logger.error('사용자 순위 조회 중 오류:', error);
      return 9999; // 기본값
    }
  }

  // ==================== 이벤트 핸들러 ====================

  /**
   * 연결 이벤트 핸들러 설정
   * @param {string} guildId - 길드 ID
   * @param {VoiceConnection} connection - 음성 연결
   */
  setupConnectionHandlers(guildId, connection) {
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await entersState(connection, VoiceConnectionStatus.Connecting, 5000);
      } catch {
        connection.destroy();
        this.connections.delete(guildId);
        logger.info(`음성 연결 해제됨: ${guildId}`);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.connections.delete(guildId);
      this.players.delete(guildId);
      this.currentTracks.delete(guildId);
      logger.info(`음성 연결 소멸됨: ${guildId}`);
    });
  }

  /**
   * 플레이어 이벤트 핸들러 설정
   * @param {string} guildId - 길드 ID
   * @param {AudioPlayer} player - 오디오 플레이어
   */
  setupPlayerHandlers(guildId, player) {
    // 기존 리스너 제거 (중복 방지)
    player.removeAllListeners();
    
    player.on(AudioPlayerStatus.Idle, async () => {
      await this.handleTrackEnd(guildId);
    });

    player.on(AudioPlayerStatus.Playing, () => {
      const track = this.currentTracks.get(guildId);
      if (track) {
        logger.info(`재생 중: ${track.title} (길드: ${guildId})`);
      }
    });

    player.on(AudioPlayerStatus.Buffering, () => {
      const track = this.currentTracks.get(guildId);
      if (track) {
        logger.debug(`버퍼링 중: ${track.title} (길드: ${guildId})`);
      }
    });

    player.on(AudioPlayerStatus.AutoPaused, () => {
      const track = this.currentTracks.get(guildId);
      if (track) {
        logger.warn(`자동 일시정지: ${track.title} (길드: ${guildId})`);
      }
    });

    player.on('error', (error) => {
      logger.error(`오디오 플레이어 오류 (길드: ${guildId}):`, error);
      
      // 에러 타입에 따른 처리
      if (error.message.includes('EPIPE') || error.message.includes('ECONNRESET')) {
        logger.warn('네트워크 연결 에러 감지, 다음 트랙으로 이동');
      }
      
      this.handleTrackEnd(guildId);
    });

    // 상태 변경 디버그 로그
    player.on('stateChange', (oldState, newState) => {
      logger.debug(`플레이어 상태 변경 (길드: ${guildId}): ${oldState.status} -> ${newState.status}`);
    });
  }

  /**
   * 트랙 종료 처리
   * @param {string} guildId - 길드 ID
   */
  async handleTrackEnd(guildId) {
    try {
      const queue = this.queues.get(guildId);
      const finishedTrack = this.currentTracks.get(guildId);
      
      if (finishedTrack) {
        // 완료된 트랙 로그 (스키마에 없는 타입이므로 제거)
        logger.debug(`트랙 완료: ${finishedTrack.title} (길드: ${guildId})`);
      }
      
      // 대기열에서 완료된 트랙 제거
      if (queue && queue.length > 0) {
        queue.shift();
      }
      
      // 건너뛰기 플래그 확인
      const isSkipped = this.skipFlags && this.skipFlags.get(guildId);
      if (isSkipped) {
        // 건너뛰기인 경우 반복 모드 무시
        this.skipFlags.delete(guildId);
        logger.info(`건너뛰기로 인한 트랙 종료, 반복 모드 무시 (길드: ${guildId})`);
      } else {
        // 반복 모드 처리 (자연스러운 트랙 종료일 때만)
        const repeatMode = this.repeatModes.get(guildId) || 'off';
        logger.debug(`[반복 디버그] repeatMode: ${repeatMode}, finishedTrack: ${finishedTrack ? finishedTrack.title : 'null'}, queue.length: ${queue ? queue.length : 'null'}`);
        
        if (repeatMode === 'track' && finishedTrack) {
          // 트랙 반복: 현재 트랙을 대기열 맨 앞에 다시 추가
          queue.unshift(finishedTrack);
          logger.info(`트랙 반복: ${finishedTrack.title} (길드: ${guildId})`);
          logger.debug(`[반복 디버그] 트랙 반복 후 queue.length: ${queue.length}`);
        } else if (repeatMode === 'queue' && finishedTrack) {
          // 큐 반복: 현재 트랙을 대기열 맨 뒤에 추가
          queue.push(finishedTrack);
          logger.info(`큐 반복: ${finishedTrack.title} (길드: ${guildId})`);
          logger.debug(`[반복 디버그] 큐 반복 후 queue.length: ${queue.length}`);
        } else {
          logger.debug(`[반복 디버그] 반복 조건 미충족: repeatMode=${repeatMode}, finishedTrack=${!!finishedTrack}`);
        }
      }
      
      // 다음 트랙 재생
      if (queue && queue.length > 0) {
        const connection = this.connections.get(guildId);
        if (connection) {
          // 기존 자동 종료 타이머가 있으면 취소
          this.cancelAutoDisconnect(guildId);
          await this.playNextTrack(guildId);
        }
      } else {
        // 대기열이 비었으면 자동 종료 설정
        logger.info(`대기열이 비어있음, ${this.config.autoDisconnectDelay / 1000}초 후 자동 종료 (길드: ${guildId})`);
        
        const timerId = setTimeout(() => {
          logger.info(`자동 종료 실행 (길드: ${guildId})`);
          this.disconnect(guildId);
        }, this.config.autoDisconnectDelay);
        
        // 타이머 ID 저장 (필요시 취소할 수 있도록)
        this.disconnectTimers.set(guildId, timerId);
      }
      
    } catch (error) {
      logger.error('트랙 종료 처리 중 오류:', error);
    }
  }

  /**
   * 다음 트랙 재생
   * @param {string} guildId - 길드 ID
   */
  async playNextTrack(guildId) {
    try {
      const queue = this.queues.get(guildId);
      if (!queue || queue.length === 0) return;
      
      const nextTrack = queue[0];
      const player = this.players.get(guildId);
      const connection = this.connections.get(guildId);
      
      if (!player || !connection) return;
      
      // 오디오 스트림 생성
      const audioStream = await this.createAudioStream(nextTrack.url);
      if (!audioStream) {
        logger.error(`다음 트랙 스트림 생성 실패: ${nextTrack.title}`);
        // 실패한 트랙 제거하고 다음 트랙 시도
        queue.shift();
        if (queue.length > 0) {
          await this.playNextTrack(guildId);
        }
        return;
      }
      
      // 테스트 검증된 방식으로 리소스 생성 (demuxProbe 제거)
      const resource = createAudioResource(audioStream, {
        inputType: 'raw',        // 테스트에서 성공한 타입
        inlineVolume: false      // 테스트에서 성공한 설정
      });
      
      // 볼륨 설정 (inlineVolume: false이므로 생략)
      logger.debug(`다음 트랙 볼륨 설정 생략 (raw 타입 사용, 길드: ${guildId})`);
      
      // 현재 트랙 업데이트
      this.currentTracks.set(guildId, nextTrack);
      
      // 재생 시작
      player.play(resource);
      
      logger.info(`다음 트랙 재생: ${nextTrack.title} (길드: ${guildId})`);
      
    } catch (error) {
      logger.error('다음 트랙 재생 중 오류:', error);
    }
  }

  // ==================== 로깅 메소드 ====================

  /**
   * 음악 활동 로그 기록
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {string} action - 액션 타입
   * @param {Object} data - 로그 데이터
   */
  async logMusicActivity(guildId, userId, action, data) {
    try {
      await db.query(`
        INSERT INTO activities 
        (user_id, guild_id, activity_type, details, timestamp, created_at)
        VALUES (
          (SELECT id FROM users WHERE discord_id = $1 AND guild_id = $2),
          $2, $3, $4, $5, $6
        )
      `, [
        userId, guildId, `music_${action}`, 
        JSON.stringify(data), 
        new Date(), 
        new Date()
      ]);
      
    } catch (error) {
      logger.error('음악 활동 로그 저장 중 오류:', error);
    }
  }

  // ==================== 공개 API 메소드 ====================

  /**
   * 현재 재생 정보 조회
   * @param {string} guildId - 길드 ID
   * @returns {Object} 재생 정보
   */
  getNowPlaying(guildId) {
    const currentTrack = this.currentTracks.get(guildId);
    const queue = this.queues.get(guildId) || [];
    const isPlaying = this.isPlaying(guildId);
    
    return {
      current: currentTrack || null,
      queue: queue.slice(1), // 현재 트랙 제외
      queueLength: Math.max(0, queue.length - 1),
      isPlaying: isPlaying,
      volume: this.volumes.get(guildId) || 0.5,
      repeatMode: this.repeatModes.get(guildId) || 'none'
    };
  }

  /**
   * 대기열 조회
   * @param {string} guildId - 길드 ID
   * @param {number} page - 페이지 번호
   * @param {number} perPage - 페이지당 항목 수
   * @returns {Object} 대기열 정보
   */
  getQueue(guildId, page = 1, perPage = 10) {
    const queue = this.queues.get(guildId) || [];
    const totalItems = Math.max(0, queue.length - 1); // 현재 재생 중인 트랙 제외
    const totalPages = Math.ceil(totalItems / perPage);
    
    const startIndex = 1 + (page - 1) * perPage; // 현재 트랙(인덱스 0) 제외
    const endIndex = Math.min(startIndex + perPage, queue.length);
    
    const pageItems = queue.slice(startIndex, endIndex);
    
    return {
      current: this.currentTracks.get(guildId) || null,
      queue: pageItems,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }

  // ==================== 고급 음악 제어 메소드 ====================

  /**
   * 볼륨 설정
   * @param {string} guildId - 길드 ID
   * @param {number} volume - 볼륨 (1-100)
   * @param {string} userId - 사용자 ID
   * @returns {Object} 설정 결과
   */
  async setVolume(guildId, volume, userId) {
    try {
      // 볼륨 범위 검증
      if (volume < 1 || volume > 100) {
        return { 
          status: 'error', 
          message: '볼륨은 1-100 사이의 값이어야 합니다.',
          code: 'INVALID_VOLUME'
        };
      }
      
      // 사용자 권한 확인
      const hasPermission = await this.checkUserPermission(guildId, userId, 'control');
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: hasPermission.reason,
          code: 'PERMISSION_DENIED'
        };
      }
      
      // 현재 재생 중인지 확인
      const player = this.players.get(guildId);
      if (!player) {
        return { 
          status: 'error', 
          message: '현재 재생 중인 음악이 없습니다.',
          code: 'NO_PLAYER'
        };
      }
      
      // 볼륨 설정 (0-1 범위로 변환)
      const normalizedVolume = volume / 100;
      this.volumes.set(guildId, normalizedVolume);
      
      // 현재 리소스에 볼륨 적용
      const currentResource = player.state.resource;
      if (currentResource && currentResource.volume) {
        currentResource.volume.setVolume(normalizedVolume);
      }
      
      // 로그 기록 (볼륨 변경은 스키마에 없는 타입이므로 디버그 로그만 사용)
      logger.debug(`볼륨 변경: ${volume} (길드: ${guildId}, 사용자: ${userId})`);
      
      logger.info(`볼륨 설정: ${volume}% (길드: ${guildId}, 사용자: ${userId})`);
      
      return { 
        status: 'success', 
        volume: volume,
        message: `볼륨이 ${volume}%로 설정되었습니다.`
      };
      
    } catch (error) {
      logger.error('볼륨 설정 중 오류:', error);
      return { 
        status: 'error', 
        message: '볼륨 설정 중 오류가 발생했습니다.',
        code: 'VOLUME_ERROR'
      };
    }
  }

  /**
   * 반복 모드 설정
   * @param {string} guildId - 길드 ID
   * @param {string} mode - 반복 모드 ('off', 'track', 'queue')
   * @returns {Object} 설정 결과
   */
  async setRepeat(guildId, mode, userId) {
    try {
      // 모드 검증
      const validModes = ['off', 'track', 'queue'];
      if (!validModes.includes(mode)) {
        return { 
          status: 'error', 
          message: '반복 모드는 off, track, queue 중 하나여야 합니다.',
          code: 'INVALID_MODE'
        };
      }
      
      // 사용자 권한 확인
      const hasPermission = await this.checkUserPermission(guildId, userId, 'control');
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: hasPermission.reason,
          code: 'PERMISSION_DENIED'
        };
      }
      
      // 대기열 확인
      const queue = this.queues.get(guildId);
      if (!queue || queue.length === 0) {
        return { 
          status: 'error', 
          message: '대기열이 비어있습니다.',
          code: 'EMPTY_QUEUE'
        };
      }
      
      // 반복 모드 설정
      this.repeatModes.set(guildId, mode);
      
      // 모드별 메시지
      const modeMessages = {
        'off': '반복 모드가 해제되었습니다.',
        'track': '현재 트랙 반복이 설정되었습니다.',
        'queue': '대기열 전체 반복이 설정되었습니다.'
      };
      
      // 로그 기록 (repeat_change는 스키마에 없는 타입이므로 디버그 로그만 사용)
      logger.debug(`반복 모드 변경: ${mode} (길드: ${guildId}, 사용자: ${userId})`);
      
      logger.info(`반복 모드 설정: ${mode} (길드: ${guildId}, 사용자: ${userId})`);
      
      return { 
        status: 'success', 
        mode: mode,
        message: modeMessages[mode]
      };
      
    } catch (error) {
      logger.error('반복 모드 설정 중 오류:', error);
      return { 
        status: 'error', 
        message: '반복 모드 설정 중 오류가 발생했습니다.',
        code: 'REPEAT_ERROR'
      };
    }
  }

  /**
   * 대기열 셔플
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {Object} 셔플 결과
   */
  async shuffle(guildId, userId) {
    try {
      // 사용자 권한 확인
      const hasPermission = await this.checkUserPermission(guildId, userId, 'control');
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: hasPermission.reason,
          code: 'PERMISSION_DENIED'
        };
      }
      
      // 대기열 확인
      const queue = this.queues.get(guildId);
      if (!queue || queue.length <= 1) {
        return { 
          status: 'error', 
          message: '셔플할 트랙이 부족합니다. (최소 2개 필요)',
          code: 'INSUFFICIENT_TRACKS'
        };
      }
      
      // 현재 재생 중인 트랙 제외하고 셔플 (인덱스 1부터)
      const currentTrack = queue[0]; // 현재 재생 중인 트랙 보존
      const remainingTracks = queue.slice(1); // 나머지 트랙들
      
      // Fisher-Yates 셔플 알고리즘
      for (let i = remainingTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingTracks[i], remainingTracks[j]] = [remainingTracks[j], remainingTracks[i]];
      }
      
      // 셔플된 대기열 업데이트
      const shuffledQueue = [currentTrack, ...remainingTracks];
      this.queues.set(guildId, shuffledQueue);
      
      // 로그 기록
      // 셔플 로그 (shuffle은 스키마에 없는 타입이므로 디버그 로그만 사용)
      logger.debug(`대기열 셔플 (길드: ${guildId}, 사용자: ${userId})`);
      
      logger.info(`대기열 셔플: ${remainingTracks.length}개 트랙 (길드: ${guildId}, 사용자: ${userId})`);
      
      return { 
        status: 'success', 
        queueLength: shuffledQueue.length,
        shuffledTracks: remainingTracks.length,
        message: `${remainingTracks.length}개의 트랙이 셔플되었습니다.`
      };
      
    } catch (error) {
      logger.error('대기열 셔플 중 오류:', error);
      return { 
        status: 'error', 
        message: '대기열 셔플 중 오류가 발생했습니다.',
        code: 'SHUFFLE_ERROR'
      };
    }
  }

  /**
   * 대기열에서 특정 트랙 제거
   * @param {string} guildId - 길드 ID
   * @param {number} position - 제거할 트랙 위치 (1부터 시작)
   * @param {string} userId - 사용자 ID
   * @returns {Object} 제거 결과
   */
  async removeTrack(guildId, position, userId) {
    try {
      // 사용자 권한 확인
      const hasPermission = await this.checkUserPermission(guildId, userId, 'control');
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: hasPermission.reason,
          code: 'PERMISSION_DENIED'
        };
      }
      
      // 대기열 확인
      const queue = this.queues.get(guildId);
      if (!queue || queue.length === 0) {
        return { 
          status: 'error', 
          message: '대기열이 비어있습니다.',
          code: 'EMPTY_QUEUE'
        };
      }
      
      // 위치 검증 (1부터 시작, 현재 재생 중인 트랙은 제거 불가)
      if (position < 2 || position > queue.length) {
        return { 
          status: 'error', 
          message: `유효하지 않은 위치입니다. (2-${queue.length} 범위)`,
          code: 'INVALID_POSITION'
        };
      }
      
      // 현재 재생 중인 트랙 제거 방지
      if (position === 1) {
        return { 
          status: 'error', 
          message: '현재 재생 중인 트랙은 제거할 수 없습니다. /skip을 사용하세요.',
          code: 'CANNOT_REMOVE_CURRENT'
        };
      }
      
      // 트랙 제거 (배열 인덱스는 0부터 시작)
      const arrayIndex = position - 1;
      const removedTrack = queue.splice(arrayIndex, 1)[0];
      
      // 로그 기록 (remove_track은 스키마에 없는 타입이므로 디버그 로그만 사용)
      logger.debug(`트랙 제거: ${removedTrack.title} (위치: ${position}, 길드: ${guildId}, 사용자: ${userId})`);
      
      logger.info(`트랙 제거: ${removedTrack.title} (위치: ${position}, 길드: ${guildId}, 사용자: ${userId})`);
      
      return { 
        status: 'success', 
        removedTrack: {
          title: removedTrack.title,
          requestedBy: removedTrack.requestedBy.tag,
          position: position
        },
        remainingQueue: queue.length - 1,
        message: `"${removedTrack.title}"이(가) 대기열에서 제거되었습니다.`
      };
      
    } catch (error) {
      logger.error('트랙 제거 중 오류:', error);
      return { 
        status: 'error', 
        message: '트랙 제거 중 오류가 발생했습니다.',
        code: 'REMOVE_ERROR'
      };
    }
  }

  /**
   * 대기열 정리 (빈 대기열 제거)
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {Object} 정리 결과
   */
  async clearQueue(guildId, userId) {
    try {
      // 사용자 권한 확인 (관리자 권한 필요)
      const hasPermission = await this.checkUserPermission(guildId, userId, 'admin');
      if (!hasPermission.allowed) {
        return { 
          status: 'error', 
          message: '대기열 정리는 관리자만 가능합니다.',
          code: 'PERMISSION_DENIED'
        };
      }
      
      // 대기열 확인
      const queue = this.queues.get(guildId);
      if (!queue || queue.length <= 1) {
        return { 
          status: 'error', 
          message: '정리할 대기열이 없습니다.',
          code: 'EMPTY_QUEUE'
        };
      }
      
      // 현재 재생 중인 트랙만 남기고 모두 제거
      const currentTrack = queue[0];
      const clearedCount = queue.length - 1;
      
      this.queues.set(guildId, [currentTrack]);
      
      // 로그 기록
      // 대기열 초기화 로그 (clear_queue는 스키마에 없는 타입이므로 디버그 로그만 사용)
      logger.debug(`대기열 초기화: ${clearedCount}개 트랙 (길드: ${guildId}, 사용자: ${userId})`);
      
      logger.info(`대기열 정리: ${clearedCount}개 트랙 제거 (길드: ${guildId}, 사용자: ${userId})`);
      
      return { 
        status: 'success', 
        clearedCount: clearedCount,
        message: `대기열에서 ${clearedCount}개의 트랙이 제거되었습니다.`
      };
      
    } catch (error) {
      logger.error('대기열 정리 중 오류:', error);
      return { 
        status: 'error', 
        message: '대기열 정리 중 오류가 발생했습니다.',
        code: 'CLEAR_ERROR'
      };
    }
  }

  /**
   * 현재 볼륨 조회
   * @param {string} guildId - 길드 ID
   * @returns {number} 현재 볼륨 (1-100)
   */
  getVolume(guildId) {
    const normalizedVolume = this.volumes.get(guildId) || 0.5;
    return Math.round(normalizedVolume * 100);
  }

  /**
   * 현재 반복 모드 조회
   * @param {string} guildId - 길드 ID
   * @returns {string} 현재 반복 모드
   */
  getRepeatMode(guildId) {
    return this.repeatModes.get(guildId) || 'off';
  }

  /**
   * 시스템 정리 (봇 종료 시)
   */
  async cleanup() {
    try {
      logger.info('음악 플레이어 시스템 정리 시작...');
      
      for (const [guildId] of this.connections) {
        await this.disconnect(guildId);
      }
      
      this.queues.clear();
      this.currentTracks.clear();
      this.volumes.clear();
      this.repeatModes.clear();
      this.disconnectTimers.clear(); // 타이머도 함께 정리
      
      logger.info('음악 플레이어 시스템 정리 완료');
      
    } catch (error) {
      logger.error('음악 플레이어 정리 중 오류:', error);
    }
  }

  /**
   * 음악 제어 권한 확인
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {string} action - 액션 ('skip', 'stop', 'control', 'add')
   * @returns {Promise<Object>} 권한 확인 결과
   */
  async checkPermission(guildId, userId, action = 'control') {
    try {
      const result = await permissions.canControlMusic(guildId, userId, action);
      return {
        hasControl: result.allowed,
        reason: result.reason,
        message: result.message,
        userRank: result.userRank,
        ownerRank: result.ownerRank
      };
    } catch (error) {
      logger.error('권한 확인 중 오류:', error);
      return {
        hasControl: false,
        reason: 'error',
        message: '권한 확인 중 오류가 발생했습니다.'
      };
    }
  }

  /**
   * 사용자 음악 권한 정보 조회
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {Promise<Object>} 권한 정보
   */
  async getPermissionInfo(guildId, userId) {
    try {
      const permissionInfo = await permissions.getUserMusicPermissions(guildId, userId);
      
      // 사용자 친화적인 형태로 변환
      let canControlMessage = '아무도 제어할 수 없음';
      if (permissionInfo.isAdmin) {
        canControlMessage = '👑 관리자 - 모든 음악 제어 가능';
      } else if (permissionInfo.rank === 1) {
        canControlMessage = '👑 1위 - 2위~꼴찌 음악 제어 가능';
      } else if (permissionInfo.rank <= 10) {
        canControlMessage = `🏆 ${permissionInfo.rank}위 - ${permissionInfo.rank + 1}위~꼴찌 음악 제어 가능`;
      } else {
        canControlMessage = `📊 ${permissionInfo.rank}위 - 자신의 음악만 제어 가능`;
      }

      return {
        rank: permissionInfo.rank,
        canControl: canControlMessage,
        permissions: permissionInfo.permissions,
        currentTrack: permissionInfo.currentTrack
      };
    } catch (error) {
      logger.error('권한 정보 조회 중 오류:', error);
      return {
        rank: '알 수 없음',
        canControl: '알 수 없음',
        permissions: {},
        currentTrack: null
      };
    }
  }

  /**
   * 반복 모드 설정
   * @param {string} guildId - 길드 ID
   * @param {string} mode - 반복 모드 ('off', 'track', 'queue')
   * @returns {Promise<Object>} 설정 결과
   */
  async setRepeatMode(guildId, mode) {
    try {
      const validModes = ['off', 'track', 'queue'];
      if (!validModes.includes(mode)) {
        throw new Error('잘못된 반복 모드입니다.');
      }

      const player = this.players.get(guildId);
      if (!player) {
        throw new Error('재생 중인 음악이 없습니다.');
      }

      // 두 곳 모두에 반복 모드 저장
      player.repeatMode = mode;
      this.repeatModes.set(guildId, mode);
      
      logger.info(`반복 모드 설정: ${mode} (길드: ${guildId})`);
      
      return {
        mode,
        message: `반복 모드가 ${mode}로 설정되었습니다.`
      };
    } catch (error) {
      logger.error('반복 모드 설정 중 오류:', error);
      throw error;
    }
  }

  /**
   * 자동 종료 타이머 취소
   * @param {string} guildId - 길드 ID
   */
  cancelAutoDisconnect(guildId) {
    const timerId = this.disconnectTimers.get(guildId);
    if (timerId) {
      clearTimeout(timerId);
      this.disconnectTimers.delete(guildId);
      logger.debug(`자동 종료 타이머 취소 (길드: ${guildId})`);
    }
  }
}

// 싱글톤 인스턴스 생성 및 내보내기
module.exports = new MusicPlayer(); 