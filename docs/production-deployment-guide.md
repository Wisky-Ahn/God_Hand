# GodHand Discord Bot 프로덕션 배포 가이드

> 라즈베리파이 환경에서 GodHand Discord Bot을 안전하고 효율적으로 배포하기 위한 완전한 가이드

## 📋 배포 전 체크리스트

### 1. 시스템 요구사항
- **하드웨어**: 라즈베리파이 4 이상 (최소 2GB RAM 권장)
- **운영체제**: Raspberry Pi OS (64-bit 권장)
- **Node.js**: 18.0 이상
- **PostgreSQL**: 12 이상
- **저장공간**: 최소 4GB 여유 공간

### 2. 필수 소프트웨어 설치
```bash
# Node.js 및 npm 설치 확인
node --version  # v18.0.0 이상
npm --version

# PM2 전역 설치
sudo npm install -g pm2

# PostgreSQL 클라이언트 도구 설치
sudo apt-get update
sudo apt-get install postgresql-client

# Git 설치 (배포 스크립트용)
sudo apt-get install git
```

## 🔧 배포 준비

### 1. 환경 설정

#### .env 파일 생성
```bash
cp .env.example .env
nano .env
```

**필수 환경 변수:**
```env
# Discord Bot 설정
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id

# 데이터베이스 설정
DB_HOST=localhost
DB_PORT=5432
DB_NAME=godhand_bot
DB_USER=your_db_user
DB_PASSWORD=your_db_password

# 선택사항 (권장)
DISCORD_WEBHOOK_URL=your_webhook_url_for_alerts
LOG_LEVEL=info
NODE_ENV=production
```

#### 파일 권한 설정
```bash
# 보안을 위한 .env 파일 권한 제한
chmod 600 .env

# 스크립트 실행 권한 부여
chmod +x scripts/*.js
chmod +x scripts/*.sh
```

### 2. 데이터베이스 설정

#### PostgreSQL 데이터베이스 생성
```bash
# PostgreSQL에 접속
sudo -u postgres psql

# 데이터베이스 및 사용자 생성
CREATE DATABASE godhand_bot;
CREATE USER your_db_user WITH PASSWORD 'your_db_password';
GRANT ALL PRIVILEGES ON DATABASE godhand_bot TO your_db_user;
\q
```

#### 스키마 및 인덱스 생성
```bash
# 데이터베이스 마이그레이션 실행
npm run db:migrate

# 성능 최적화 인덱스 생성
psql -U your_db_user -d godhand_bot -f database/indexes.sql
```

## 🚀 배포 실행

### 1. 프로덕션 준비 상태 검증
```bash
# 프로덕션 배포 준비 상태 종합 검사
npm run check:production
```

이 명령어는 다음 항목들을 검증합니다:
- 환경 변수 설정
- 데이터베이스 연결 및 스키마
- 보안 설정
- 성능 최적화 설정
- 백업 시스템
- 모니터링 설정
- 배포 도구

### 2. 통합 테스트 실행
```bash
# 전체 시스템 통합 테스트
npm run test:integration
```

### 3. 성능 벤치마크 (선택사항)
```bash
# 라즈베리파이 성능 측정
npm run test:performance
```

### 4. 배포 실행

#### 기본 배포
```bash
# 표준 배포 (백업 포함)
npm run deploy:enhanced
```

#### 대화형 배포
```bash
# CLI 인터페이스를 통한 배포
npm run deploy:cli
```

#### 드라이런 배포 (테스트)
```bash
# 실제 배포 없이 과정만 확인
npm run deploy:dry-run
```

## 📊 모니터링 및 관리

### 1. PM2 프로세스 관리
```bash
# 봇 상태 확인
npm run pm2:status

# 실시간 모니터링
npm run pm2:monitor

# 로그 확인
npm run pm2:logs

# 재시작
npm run pm2:restart

# 중지
npm run pm2:stop
```

### 2. 시스템 모니터링
Discord 봇 내에서 다음 명령어들을 사용하여 모니터링:
```
/monitoring start    # 모니터링 시작
/monitoring status   # 현재 상태 확인
/monitoring metrics  # 시스템 메트릭 조회
/monitoring test     # 테스트 알림 전송
```

### 3. 백업 관리
```bash
# 수동 백업 생성
npm run backup:manual

# 일일 백업 생성
npm run backup:daily

# 백업 목록 확인
npm run backup:list

# 백업 복원
npm run restore

# 백업 스케줄러 시작
npm run backup:schedule
```

## 🔄 배포 후 작업

### 1. 시스템 시작 설정
```bash
# PM2 부팅 시 자동 시작 설정
pm2 startup
# 출력된 명령어를 sudo로 실행

# 현재 프로세스 저장
pm2 save
```

### 2. 백업 서비스 설치 (systemd)
```bash
# 백업 서비스 설치
sudo bash scripts/install-backup-service.sh

# 서비스 상태 확인
sudo systemctl status godhand-backup
```

### 3. 로그 로테이션 설정
```bash
# PM2 로그 로테이션 설치
pm2 install pm2-logrotate

# 로그 로테이션 설정
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 4. 방화벽 설정 (선택사항)
```bash
# UFW 방화벽 설정
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 5432  # PostgreSQL (로컬만 접근하는 경우 불필요)
```

## 🚨 문제 해결

### 1. 일반적인 문제들

#### 메모리 부족
```bash
# 메모리 사용량 확인
free -h

# 스왑 파일 생성 (권장: 1GB)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 영구 적용
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

#### 데이터베이스 연결 오류
```bash
# PostgreSQL 서비스 상태 확인
sudo systemctl status postgresql

# PostgreSQL 재시작
sudo systemctl restart postgresql

# 연결 테스트
psql -U your_db_user -d godhand_bot -c "SELECT 1;"
```

#### PM2 프로세스 문제
```bash
# PM2 데몬 재시작
pm2 kill
pm2 resurrect

# 또는 완전 재시작
npm run pm2:delete
npm run pm2:start
```

### 2. 성능 최적화

#### 라즈베리파이 GPU 메모리 조정
```bash
# GPU 메모리 최소화 (CLI 전용 사용 시)
sudo raspi-config
# Advanced Options > Memory Split > 16MB
```

#### CPU 온도 모니터링
```bash
# CPU 온도 확인
vcgencmd measure_temp

# 온도가 80°C 이상인 경우 쿨링 개선 필요
```

## 🔒 보안 권장사항

### 1. 시스템 보안
```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 불필요한 서비스 비활성화
sudo systemctl disable bluetooth
sudo systemctl disable wifi-country  # 이더넷 사용 시

# SSH 키 기반 인증 설정 (비밀번호 인증 비활성화)
sudo nano /etc/ssh/sshd_config
# PasswordAuthentication no
sudo systemctl restart ssh
```

### 2. 애플리케이션 보안
```bash
# .env 파일 권한 재확인
ls -la .env  # -rw------- (600)

# 로그 디렉터리 권한 설정
sudo chown -R $USER:$USER logs/
chmod 755 logs/
```

## 📝 정기 유지보수

### 일일 작업
- [ ] PM2 프로세스 상태 확인
- [ ] 시스템 리소스 확인 (메모리, CPU, 온도)
- [ ] 에러 로그 확인

### 주간 작업
- [ ] 백업 파일 상태 확인
- [ ] 성능 메트릭 검토
- [ ] 디스크 공간 정리

### 월간 작업
- [ ] 시스템 업데이트
- [ ] 의존성 업데이트 (보안 패치)
- [ ] 성능 벤치마크 실행

## 🆘 응급 상황 대응

### 봇 완전 중단 시
```bash
# 1. 현재 상태 진단
npm run pm2:status
npm run check:production

# 2. 로그 확인
npm run pm2:logs --lines 100

# 3. 데이터베이스 백업 생성
npm run backup:manual

# 4. 봇 재시작
npm run pm2:restart

# 5. 정상 작동 확인
npm run test:integration
```

### 롤백이 필요한 경우
```bash
# 이전 버전으로 롤백
npm run deploy:rollback

# 특정 커밋으로 롤백
git checkout <commit-hash>
npm run deploy:enhanced
```

## 📞 지원 및 문의

배포 과정에서 문제가 발생하거나 추가 지원이 필요한 경우:

1. **로그 수집**: `npm run pm2:logs`로 로그 확인
2. **시스템 상태**: `npm run check:production`으로 상태 점검
3. **성능 분석**: `npm run test:performance`로 성능 측정

---

**참고**: 이 가이드는 라즈베리파이 환경에 최적화되어 있습니다. 다른 환경에서 배포하는 경우 일부 설정을 조정해야 할 수 있습니다. 