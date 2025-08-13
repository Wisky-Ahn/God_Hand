/**
 * Discord 음성 연결 테스트
 * EPIPE 에러 원인 파악을 위한 기본 연결 테스트
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState
} = require('@discordjs/voice');
const { createReadStream } = require('fs');
const { spawn } = require('child_process');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

async function testVoiceConnection() {
  try {
    console.log('🔗 Discord 음성 연결 테스트 시작...');
    
    const guildId = '1252933887680839701';
    const channelId = '1252933888175771763';
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.log('❌ 길드를 찾을 수 없습니다.');
      return;
    }
    
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      console.log('❌ 음성 채널을 찾을 수 없습니다.');
      return;
    }
    
    console.log(`📢 음성 채널 연결 시도: ${channel.name}`);
    
    // 1. 음성 채널 연결
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    
    console.log('⏳ 연결 상태 대기 중...');
    
    // 2. 연결 완료 대기
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);
    console.log('✅ 음성 채널 연결 성공!');
    
    // 3. 플레이어 생성
    const player = createAudioPlayer();
    console.log('🎵 오디오 플레이어 생성 완료');
    
    // 4. 구독
    const subscription = connection.subscribe(player);
    if (!subscription) {
      console.log('❌ 플레이어 구독 실패');
      return;
    }
    console.log('✅ 플레이어 구독 성공');
    
    // 5. 테스트용 사인파 오디오 생성 (FFmpeg)
    console.log('🔧 테스트 오디오 스트림 생성...');
    
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'lavfi',
      '-i', 'sine=frequency=1000:duration=5',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // 6. 오디오 리소스 생성
    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: 'raw',
      inlineVolume: false
    });
    
    console.log('🎶 오디오 리소스 생성 완료');
    
    // 7. 재생 시작
    player.play(resource);
    console.log('▶️ 재생 시작!');
    
    // 8. 플레이어 이벤트 모니터링
    player.on(AudioPlayerStatus.Playing, () => {
      console.log('🎵 재생 중...');
    });
    
    player.on(AudioPlayerStatus.Idle, () => {
      console.log('⏸️ 재생 완료');
      process.exit(0);
    });
    
    player.on('error', (error) => {
      console.error('❌ 플레이어 에러:', error);
      process.exit(1);
    });
    
    // 9. 연결 이벤트 모니터링
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      console.log('📴 음성 연결 해제됨');
    });
    
    connection.on('error', (error) => {
      console.error('❌ 연결 에러:', error);
    });
    
    // 10. FFmpeg 에러 모니터링
    ffmpeg.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      if (!errorMsg.includes('No trailing') && !errorMsg.includes('frame=')) {
        console.log('FFmpeg:', errorMsg.trim());
      }
    });
    
    ffmpeg.on('close', (code) => {
      console.log(`FFmpeg 종료 (코드: ${code})`);
    });
    
    setTimeout(() => {
      console.log('⏰ 테스트 타임아웃');
      process.exit(0);
    }, 15000);
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    process.exit(1);
  }
}

client.once('ready', () => {
  console.log(`✅ 봇 로그인: ${client.user.tag}`);
  testVoiceConnection();
});

client.login(process.env.DISCORD_BOT_TOKEN); 