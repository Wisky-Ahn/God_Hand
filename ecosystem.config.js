/**
 * PM2 생태계 설정 파일
 * Raspberry Pi 환경에 최적화된 Discord 봇 프로세스 관리 설정
 */

module.exports = {
  apps: [{
    name: 'godhand-bot',
    script: 'src/bot/index.js',
    
    // 인스턴스 설정 - Raspberry Pi의 한정된 리소스를 고려하여 단일 인스턴스 운영
    instances: 1,
    exec_mode: 'fork',
    
    // 자동 재시작 설정
    autorestart: true,
    watch: false, // 파일 감시 비활성화 (개발용이 아님)
    max_restarts: 5, // 최대 재시작 횟수 제한
    min_uptime: '10s', // 최소 가동 시간
    
    // 메모리 관리 - Raspberry Pi의 메모리 제약 고려
    max_memory_restart: '512M',
    node_args: '--expose-gc --max-old-space-size=400',
    
    // 환경 변수
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Seoul'
    },
    
    // 로그 설정
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    combine_logs: true,
    merge_logs: true,
    
    // 에러 처리
    kill_timeout: 3000,
    listen_timeout: 3000,
    shutdown_with_message: true,
    
    // 시간 설정
    time: true,
    
    // 프로세스 재시작 조건
    cron_restart: '0 4 * * *', // 매일 새벽 4시 재시작 (메모리 정리)
    
    // 성능 모니터링
    pmx: true,
    source_map_support: false,
    
    // 프로세스 우선순위 (Raspberry Pi에서 낮은 우선순위 설정)
    increment_var: 'PORT',
    
    // 추가 PM2 모듈 설정
    post_update: ['npm install', 'echo "GodHand Bot updated successfully"'],
    
    // 환경별 설정 재정의
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      TZ: 'Asia/Seoul'
    },
    
    env_development: {
      NODE_ENV: 'development',
      PORT: 3001,
      WATCH: true
    }
  }],
  
  // PM2 모니터링 설정
  deploy: {
    production: {
      user: 'pi',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:user/godhand.git',
      path: '/home/pi/godhand',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production'
    }
  }
}; 