/**
 * YouTube Data API를 사용한 음악 정보 추출 시스템
 * 라이브러리 의존성 없이 안정적인 API 직접 호출
 */
require('dotenv').config();
const https = require('https');
const fs = require('fs');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const testUrl = 'https://www.youtube.com/watch?v=Cf7a2j0-ixE&list=RDCf7a2j0-ixE&start_radio=1';

console.log('🎵 YouTube Data API 테스트 시작...');
console.log('📋 API 키:', YOUTUBE_API_KEY ? '설정됨 ✅' : '없음 ❌');
console.log('📋 테스트 URL:', testUrl);

/**
 * YouTube URL에서 비디오 ID 추출
 */
function extractVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * YouTube Data API v3를 사용한 비디오 정보 조회
 */
function getVideoInfo(videoId) {
    return new Promise((resolve, reject) => {
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`;
        
        console.log('🔍 API 요청 중...');
        console.log('📡 URL:', apiUrl.replace(YOUTUBE_API_KEY, 'API_KEY_HIDDEN'));
        
        https.get(apiUrl, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    
                    if (response.error) {
                        reject(new Error(`YouTube API 오류: ${response.error.message}`));
                        return;
                    }
                    
                    if (!response.items || response.items.length === 0) {
                        reject(new Error('비디오를 찾을 수 없습니다'));
                        return;
                    }
                    
                    const video = response.items[0];
                    resolve({
                        id: video.id,
                        title: video.snippet.title,
                        channelTitle: video.snippet.channelTitle,
                        description: video.snippet.description,
                        duration: video.contentDetails.duration,
                        publishedAt: video.snippet.publishedAt,
                        thumbnails: video.snippet.thumbnails
                    });
                } catch (parseError) {
                    reject(new Error(`JSON 파싱 오류: ${parseError.message}`));
                }
            });
        }).on('error', (error) => {
            reject(new Error(`네트워크 오류: ${error.message}`));
        });
    });
}

/**
 * ISO 8601 duration을 초 단위로 변환
 */
function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    
    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    
    return hours * 3600 + minutes * 60 + seconds;
}

/**
 * 메인 테스트 함수
 */
async function testYouTubeAPI() {
    try {
        // 1. 비디오 ID 추출
        console.log('\n📋 1단계: 비디오 ID 추출');
        const videoId = extractVideoId(testUrl);
        
        if (!videoId) {
            throw new Error('유효하지 않은 YouTube URL입니다');
        }
        
        console.log('✅ 비디오 ID:', videoId);
        
        // 2. YouTube API로 비디오 정보 조회
        console.log('\n📋 2단계: YouTube API 정보 조회');
        const videoInfo = await getVideoInfo(videoId);
        
        // 3. 결과 출력
        console.log('\n🎉 성공! 비디오 정보:');
        console.log('📋 제목:', videoInfo.title);
        console.log('👤 채널:', videoInfo.channelTitle);
        console.log('⏱️ 길이:', parseDuration(videoInfo.duration) + '초');
        console.log('📅 업로드일:', new Date(videoInfo.publishedAt).toLocaleDateString('ko-KR'));
        console.log('🖼️ 썸네일:', videoInfo.thumbnails.medium?.url || '없음');
        
        // 4. 결과를 파일로 저장 (디버깅용)
        const result = {
            success: true,
            videoId,
            videoInfo,
            durationSeconds: parseDuration(videoInfo.duration),
            testUrl,
            timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync('youtube_api_test_result.json', JSON.stringify(result, null, 2));
        console.log('\n💾 결과가 youtube_api_test_result.json에 저장되었습니다');
        
        return result;
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        
        const errorResult = {
            success: false,
            error: error.message,
            testUrl,
            timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync('youtube_api_test_result.json', JSON.stringify(errorResult, null, 2));
        return errorResult;
    }
}

// 테스트 실행
if (require.main === module) {
    testYouTubeAPI().then(result => {
        console.log('\n📊 테스트 완료!');
        process.exit(result.success ? 0 : 1);
    });
}

module.exports = {
    extractVideoId,
    getVideoInfo,
    parseDuration,
    testYouTubeAPI
}; 