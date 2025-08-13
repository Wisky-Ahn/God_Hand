/**
 * 간단한 오디오 재생 테스트
 */
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { generateDependencyReport } = require('@discordjs/voice');

console.log('🔍 Discord.js Voice 의존성 상태:');
console.log(generateDependencyReport());

console.log('\n🎵 간단한 음성 테스트 (환경변수 기반)');

// 환경변수에서 토큰 로드
require('dotenv').config();
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
    console.log('❌ DISCORD_BOT_TOKEN이 설정되지 않았습니다.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

client.once('ready', () => {
    console.log(`✅ 테스트 봇 로그인: ${client.user.tag}`);
    
    // 음성 채널 ID (하드코딩)
    const voiceChannelId = '1252933888175771763';
    const guildId = '1252933887680839701';
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.log('❌ 길드를 찾을 수 없습니다.');
        return;
    }
    
    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    if (!voiceChannel) {
        console.log('❌ 음성 채널을 찾을 수 없습니다.');
        return;
    }
    
    console.log(`🎯 음성 채널 연결 시도: ${voiceChannel.name}`);
    
    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
        });
        
        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('✅ 음성 채널 연결 완료!');
            
            // 간단한 테스트 리소스 생성 (무음)
            const player = createAudioPlayer();
            
            // YouTube URL로 리소스 생성
            try {
                const ytdl = require('ytdl-core');
                const stream = ytdl('https://www.youtube.com/watch?v=Cf7a2j0-ixE', {
                    quality: 'lowestaudio',
                    filter: 'audioonly'
                });
                
                const resource = createAudioResource(stream);
                
                player.play(resource);
                connection.subscribe(player);
                
                console.log('🎵 재생 시작!');
                
                player.on(AudioPlayerStatus.Playing, () => {
                    console.log('✅ 재생 중...');
                });
                
                player.on(AudioPlayerStatus.Idle, () => {
                    console.log('⏹️ 재생 완료');
                    connection.destroy();
                    client.destroy();
                });
                
                player.on('error', (error) => {
                    console.log('❌ 재생 오류:', error);
                    connection.destroy();
                    client.destroy();
                });
                
            } catch (audioError) {
                console.log('❌ 오디오 리소스 생성 실패:', audioError);
                connection.destroy();
                client.destroy();
            }
        });
        
        connection.on('error', (error) => {
            console.log('❌ 연결 오류:', error);
        });
        
    } catch (connectionError) {
        console.log('❌ 음성 채널 연결 실패:', connectionError);
        client.destroy();
    }
});

client.on('error', (error) => {
    console.log('❌ 클라이언트 오류:', error);
});

client.login(token); 