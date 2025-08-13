/**
 * YouTube API + yt-dlp 통합 테스트
 * 라즈베리파이 환경에서 음악 재생 시스템 테스트
 */

require('dotenv').config();
const youtubeAPI = require('./src/services/music/youtube-api');
const { spawn } = require('child_process');

/**
 * yt-dlp로 오디오 스트림 URL 가져오기 테스트
 */
async function testYtDlpStream(url) {
    console.log('\n🔍 yt-dlp 스트림 URL 테스트...');
    
    return new Promise((resolve, reject) => {
        const ytdlp = spawn('/usr/local/bin/yt-dlp', [
            '--get-url',
            '--format', 'bestaudio[ext=webm]/bestaudio',
            '--no-playlist',
            url
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        let error = '';
        
        ytdlp.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        ytdlp.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        ytdlp.on('close', (code) => {
            if (code === 0 && output.trim()) {
                console.log('✅ yt-dlp 스트림 URL 획득 성공');
                console.log('🔗 스트림 URL:', output.trim().substring(0, 100) + '...');
                resolve(output.trim());
            } else {
                console.log('❌ yt-dlp 스트림 URL 획득 실패');
                console.log('Error:', error);
                reject(new Error(error || 'yt-dlp failed'));
            }
        });
        
        ytdlp.on('error', (err) => {
            console.log('❌ yt-dlp 프로세스 에러:', err.message);
            reject(err);
        });
    });
}

/**
 * yt-dlp로 실제 오디오 스트림 생성 테스트
 */
async function testYtDlpAudioStream(url) {
    console.log('\n🎵 yt-dlp 오디오 스트림 생성 테스트...');
    
    return new Promise((resolve, reject) => {
        const ytdlp = spawn('/usr/local/bin/yt-dlp', [
            url,
            '--format', 'bestaudio[ext=webm]/bestaudio',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '-o', '-'
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let dataReceived = false;
        let totalBytes = 0;
        
        ytdlp.stdout.on('data', (chunk) => {
            dataReceived = true;
            totalBytes += chunk.length;
            
            // 처음 데이터 받으면 성공으로 판단하고 스트림 종료
            if (!dataReceived) {
                console.log('✅ 오디오 스트림 데이터 수신 시작');
            }
        });
        
        ytdlp.stderr.on('data', (data) => {
            const error = data.toString();
            if (!error.includes('Deleting original file')) {
                console.log('⚠️ yt-dlp stderr:', error);
            }
        });
        
        // 5초 후 테스트 완료 (스트림이 제대로 작동하는지만 확인)
        setTimeout(() => {
            ytdlp.kill('SIGTERM');
            
            if (dataReceived && totalBytes > 0) {
                console.log(`✅ 오디오 스트림 생성 성공 (${totalBytes} bytes 수신)`);
                resolve(true);
            } else {
                console.log('❌ 오디오 스트림 생성 실패 - 데이터 없음');
                reject(new Error('No audio data received'));
            }
        }, 5000);
        
        ytdlp.on('error', (err) => {
            console.log('❌ yt-dlp 프로세스 에러:', err.message);
            reject(err);
        });
    });
}

/**
 * 전체 시스템 통합 테스트
 */
async function runIntegratedTest() {
    console.log('🚀 YouTube API + yt-dlp 통합 테스트 시작\n');
    
    // 테스트용 YouTube URL
    const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Roll
    
    const results = {
        youtubeAPI: false,
        ytdlpStreamUrl: false,
        ytdlpAudioStream: false
    };
    
    try {
        // 1. YouTube API 테스트
        console.log('📋 1단계: YouTube API 테스트');
        const videoInfo = await youtubeAPI.getVideoFromQuery(testUrl);
        console.log('✅ YouTube API 성공');
        console.log(`📹 제목: ${videoInfo.title}`);
        console.log(`⏱️ 길이: ${youtubeAPI.formatDuration(videoInfo.durationSeconds)}`);
        console.log(`🎬 채널: ${videoInfo.channelTitle}`);
        results.youtubeAPI = true;
        
        // 2. yt-dlp 스트림 URL 테스트
        console.log('\n📋 2단계: yt-dlp 스트림 URL 테스트');
        await testYtDlpStream(testUrl);
        results.ytdlpStreamUrl = true;
        
        // 3. yt-dlp 오디오 스트림 테스트
        console.log('\n📋 3단계: yt-dlp 오디오 스트림 테스트');
        await testYtDlpAudioStream(testUrl);
        results.ytdlpAudioStream = true;
        
    } catch (error) {
        console.error('❌ 테스트 중 오류 발생:', error.message);
    }
    
    // 결과 요약
    console.log('\n📊 테스트 결과 요약:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`• YouTube API          : ${results.youtubeAPI ? '✅ 성공' : '❌ 실패'}`);
    console.log(`• yt-dlp 스트림 URL    : ${results.ytdlpStreamUrl ? '✅ 성공' : '❌ 실패'}`);
    console.log(`• yt-dlp 오디오 스트림 : ${results.ytdlpAudioStream ? '✅ 성공' : '❌ 실패'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
        console.log('🎉 모든 테스트 통과! 시스템이 준비되었습니다.');
        console.log('💡 권장사항:');
        console.log('   - YouTube API 키가 설정되어 있는지 확인하세요');
        console.log('   - 네트워크 연결이 안정적인지 확인하세요');
        console.log('   - Discord 봇 권한이 올바르게 설정되어 있는지 확인하세요');
    } else {
        console.log('⚠️ 일부 테스트 실패. 시스템 설정을 확인하세요.');
        
        if (!results.youtubeAPI) {
            console.log('   - YOUTUBE_API_KEY 환경변수를 확인하세요');
        }
        if (!results.ytdlpStreamUrl || !results.ytdlpAudioStream) {
            console.log('   - yt-dlp 설치 및 권한을 확인하세요');
            console.log('   - 네트워크 연결을 확인하세요');
        }
    }
    
    return allPassed;
}

// 테스트 실행
if (require.main === module) {
    runIntegratedTest().then((success) => {
        process.exit(success ? 0 : 1);
    }).catch((error) => {
        console.error('💥 치명적 오류:', error);
        process.exit(1);
    });
}

module.exports = {
    testYtDlpStream,
    testYtDlpAudioStream,
    runIntegratedTest
}; 