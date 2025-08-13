/**
 * YouTube Data API를 사용한 안정적인 음악 정보 추출 서비스
 * 기존 라이브러리 의존성을 제거하고 API 직접 호출로 개선
 */
const https = require('https');
const logger = require('../../utils/logger');

class YouTubeAPIService {
    constructor() {
        this.apiKey = process.env.YOUTUBE_API_KEY;
        
        if (!this.apiKey) {
            logger.warn('YouTube API 키가 설정되지 않았습니다. YOUTUBE_API_KEY 환경변수를 확인하세요.');
        }
    }

    /**
     * YouTube URL에서 비디오 ID 추출
     */
    extractVideoId(url) {
        const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    /**
     * 검색어로 YouTube 검색 수행
     */
    async searchVideos(query, maxResults = 5) {
        if (!this.apiKey) {
            throw new Error('YouTube API 키가 설정되지 않았습니다');
        }

        const encodedQuery = encodeURIComponent(query);
        const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodedQuery}&key=${this.apiKey}`;

        logger.debug('YouTube 검색 시작:', query);

        return new Promise((resolve, reject) => {
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

                        const videos = response.items.map(item => ({
                            id: item.id.videoId,
                            title: item.snippet.title,
                            channelTitle: item.snippet.channelTitle,
                            publishedAt: item.snippet.publishedAt,
                            thumbnails: item.snippet.thumbnails,
                            url: `https://www.youtube.com/watch?v=${item.id.videoId}`
                        }));

                        logger.debug(`YouTube 검색 완료: ${videos.length}개 결과`);
                        resolve(videos);

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
     * 비디오 ID로 상세 정보 조회
     */
    async getVideoInfo(videoId) {
        if (!this.apiKey) {
            throw new Error('YouTube API 키가 설정되지 않았습니다');
        }

        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${this.apiKey}`;

        logger.debug('YouTube 비디오 정보 조회:', videoId);

        return new Promise((resolve, reject) => {
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
                        const result = {
                            id: video.id,
                            title: video.snippet.title,
                            channelTitle: video.snippet.channelTitle,
                            description: video.snippet.description,
                            duration: video.contentDetails.duration,
                            durationSeconds: this.parseDuration(video.contentDetails.duration),
                            publishedAt: video.snippet.publishedAt,
                            thumbnails: video.snippet.thumbnails,
                            url: `https://www.youtube.com/watch?v=${video.id}`
                        };

                        logger.debug('YouTube 비디오 정보 조회 완료:', result.title);
                        resolve(result);

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
     * URL 또는 검색어에서 비디오 정보 가져오기
     */
    async getVideoFromQuery(query) {
        try {
            // URL인지 확인
            const videoId = this.extractVideoId(query);
            
            if (videoId) {
                // URL인 경우 직접 정보 조회
                logger.debug('URL에서 비디오 ID 추출:', videoId);
                return await this.getVideoInfo(videoId);
            } else {
                // 검색어인 경우 검색 후 첫 번째 결과 반환
                logger.debug('검색어로 YouTube 검색 수행:', query);
                const searchResults = await this.searchVideos(query, 1);
                
                if (searchResults.length === 0) {
                    throw new Error('검색 결과가 없습니다');
                }
                
                const firstResult = searchResults[0];
                return await this.getVideoInfo(firstResult.id);
            }
        } catch (error) {
            logger.error('YouTube 비디오 정보 조회 실패:', error.message);
            throw error;
        }
    }

    /**
     * ISO 8601 duration을 초 단위로 변환
     */
    parseDuration(duration) {
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return 0;

        const hours = parseInt(match[1] || 0);
        const minutes = parseInt(match[2] || 0);
        const seconds = parseInt(match[3] || 0);

        return hours * 3600 + minutes * 60 + seconds;
    }

    /**
     * 초 단위 시간을 HH:MM:SS 형식으로 변환
     */
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    /**
     * API 상태 확인
     */
    async checkApiStatus() {
        try {
            const testVideo = await this.getVideoInfo('dQw4w9WgXcQ'); // Rick Roll 비디오로 테스트
            return {
                status: 'ok',
                apiKey: this.apiKey ? '설정됨' : '없음',
                testTitle: testVideo.title
            };
        } catch (error) {
            return {
                status: 'error',
                apiKey: this.apiKey ? '설정됨' : '없음',
                error: error.message
            };
        }
    }
}

module.exports = new YouTubeAPIService(); 