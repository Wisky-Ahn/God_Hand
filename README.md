# 🎯 GodHand Discord Bot

**음성 활동 중심의 순위 시스템과 음악 재생 기능을 제공하는 종합 관리 봇**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-14.x-blue.svg)](https://discord.js.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue.svg)](https://postgresql.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 📋 프로젝트 개요

GodHand는 디스코드 서버의 활동을 추적하고 통계를 제공하며, **음성 중심의 순위 시스템**과 **음악 재생 기능**을 제공하는 혁신적인 Discord 봇입니다.

### 🎯 핵심 특징

- **🎤 음성 활동 우선**: 실제 대화 참여를 가장 높게 평가 (전체 점수의 70-80%)
- **⏰ 현실적인 시간 가중치**: 새벽 페널티, 저녁 보너스 등 실제 활동 패턴 반영
- **🏆 이중 랭킹 시스템**: 2주 시즌 + 평생 누적 통계
- **🎵 순위 기반 음악 시스템**: 실시간 순위에 따른 음악 제어 권한
- **🔄 자동화된 닉네임 관리**: 실시간 닉네임 동기화 및 관리 시스템
- **📊 정확한 통계 추적**: 개선된 라이프타임 통계 및 시즌 관리
- **🍓 라즈베리파이 최적화**: 저전력 환경에서의 안정적 운영

> 📋 **최신 업데이트 내역은 [CHANGELOG.md](docs/CHANGELOG.md)에서 확인하세요!**

## 🚀 빠른 시작

### 📋 사전 요구사항

- **Node.js** 18.0.0 이상
- **PostgreSQL** 14.0 이상
- **Discord Bot Token** (Discord Developer Portal에서 발급)
- **FFmpeg** (음악 재생용)

### ⚙️ 설치 방법

1. **저장소 클론**
   ```bash
   git clone <your-github-repository-url>
   cd godhand-discord-bot
   ```

2. **의존성 설치**
   ```bash
   npm install
   ```

3. **환경변수 설정**
   ```bash
   cp .env.example .env
   # .env 파일을 편집하여 토큰과 설정 정보 입력
   ```

4. **데이터베이스 설정**
   ```bash
   # PostgreSQL 데이터베이스 생성
   createdb godhand_bot
   
   # 마이그레이션 실행 
   npm run db:migrate
   ```

5. **명령어 등록**
   ```bash
   npm run deploy
   ```

6. **봇 실행**
   ```bash
   # 개발 모드
   npm run dev
   
   # 프로덕션 모드
   npm start
   ```

## 🎮 사용 가능한 명령어

### 👤 사용자 명령어

| 명령어 | 설명 |
|--------|------|
| `/핑` | 🏓 봇의 응답 속도와 지연시간 확인 |
| `/랭킹 [limit]` | 🏆 현재 시즌 TOP 10 순위 (5-20명까지 선택 가능) |
| `/명예의전당 [limit]` | 🏛️ 전체 기간 누적 TOP 10 랭킹 (5-20명까지 선택 가능) |
| `/내기록` | 📊 나의 상세한 활동 통계 확인 |

### 🎵 음악 명령어

| 명령어 | 설명 |
|--------|------|
| `/노래 재생 url:<주소/검색어>` | 🎵 YouTube 음악 재생/큐 추가 |
| `/노래 중지` | ⏹️ 음악 재생 중지 및 대기열 정리 (권한 확인) |
| `/노래 건너뛰기` | ⏭️ 다음 곡으로 건너뛰기 (권한 확인) |
| `/노래 대기열` | 📜 현재 재생 대기열 확인 |
| `/노래 섞기` | 🔀 대기열 섞기 (권한 확인) |
| `/노래 반복 모드:<설정>` | 🔁 반복 모드 설정 (없음/한곡/전체) |
| `/노래 제거 번호:<번호>` | 🗑️ 대기열에서 특정 곡 제거 (권한 확인) |
| `/노래 내권한` | 🔐 내 음악 제어 권한 확인 |

### 🔧 관리자 명령어

| 명령어 | 설명 |
|--------|------|
| `/서버통계 [기간]` | 📊 서버 통계 (1일/3일/7일/14일/30일/90일 선택) |
| `/사용자관리 <작업>` | 👥 사용자 관리 (순위조회/사용자조회/점수관리/계정관리/대량관리) |
| `/시즌관리 <작업>` | 🏆 시즌 관리 (새시즌/정보/완료/수동완료/랭킹계산) |
| `/시스템 <작업>` | ⚙️ 시스템 관리 (재시작/상태/로그/최적화) |
| `/모니터링 <작업>` | 📈 모니터링 관리 (상태/시작/중지/메트릭/설정) |
| `/닉네임동기화 [사용자]` | 🏷️ 닉네임 동기화 (특정 사용자 또는 전체 서버) |

## 📊 점수 시스템

### 🎤 음성 활동 (약 75% 비중)
- **혼자 음성 채널**: 0.1점/분
- **2명 이상 채널**: 2점/분 (기본)
- **카메라 켜기**: +3점/세션 (웹캠 활성화)
- **화면 공유**: +5점/세션 (데스크톱 화면 공유)
- **라이브 스트리밍**: +8점/세션 (서버 전체 방송)

### 💬 메시지 활동 (약 20% 비중)
- **기본 메시지**: 0.15점
- **고품질 메시지**: 최대 +0.35점 (총 0.5점)

### 🎯 기타 활동 (약 5% 비중)
- **리액션 주기**: 0.1점
- **리액션 받기**: 0.2점

### ⏰ 시간대별 가중치
- **00:00-06:00**: 0.2배 (새벽 페널티)
- **06:00-09:00**: 0.8배 (출근/등교시간)
- **09:00-18:00**: 1.0배 (일과시간)
- **18:00-23:00**: 1.4배 (저녁 활동 보너스)
- **23:00-24:00**: 0.6배 (늦은밤)

## 📖 사용법

### 🚀 봇 시작하기

1. **봇이 서버에 참가하면** 그 순간부터 모든 멤버의 활동 추적이 시작됩니다.
2. **음성 채널 참여, 메시지 작성, 리액션** 등의 활동에 따라 실시간으로 점수가 적립됩니다.
3. **2주마다 새로운 시즌**이 시작되며, 이전 시즌 점수는 초기화되고 새롭게 랭킹이 매겨집니다.
4. **현재 시즌 랭킹**은 `/랭킹` 명령어로, **전체 기간 누적 랭킹**은 `/명예의전당` 명령어로 확인할 수 있습니다.
5. **닉네임은 자동으로 동기화**되어 항상 최신 상태로 유지됩니다.

### 🔄 자동화된 닉네임 관리 시스템

GodHand는 Discord 서버의 닉네임 변경을 **실시간으로 감지**하고 **자동 동기화**합니다:

- **실시간 동기화**: 사용자가 닉네임을 변경하면 즉시 데이터베이스에 반영
- **자동 스케줄링**: 매일 새벽 3시 전체 서버 닉네임 동기화
- **캐시 시스템**: 성능 최적화를 위한 5분 TTL 캐시
- **관리자 제어**: `/닉네임동기화` 명령어로 수동 동기화

### 🎵 음악 시스템 사용법

#### 기본 음악 재생
```
/노래 재생 url:https://youtu.be/example    # YouTube URL로 재생
/노래 재생 url:아이유 블루밍                # 검색어로 재생
/노래 대기열                              # 현재 대기열 확인
/노래 반복 모드:한곡반복                    # 반복 모드 설정
/노래 섞기                               # 대기열 섞기 (권한 필요)
```

#### 🏆 위계적 권한 구조

GodHand의 가장 독특한 특징은 **랭킹 기반 음악 제어 권한** 시스템입니다:

| 순위 | 아이콘 | 제어 가능 대상 | 설명 |
|------|--------|----------------|------|
| **1위** | 👑 | 2위~꼴찌 | 모든 사용자의 음악 제어 가능 |
| **2위** | 🥈 | 3위~꼴찌 | 1위를 제외한 모든 사용자 제어 가능 |
| **3위** | 🥉 | 4위~꼴찌 | 1,2위를 제외한 사용자 제어 가능 |
| **4위** | 📈 | 5위~꼴찌 | 1,2,3위를 제외한 사용자 제어 가능 |
| **...** | ... | ... | ... |
| **꼴찌** | 😅 | 본인만 | 아무도 제어 못함 (본인 곡 추가만 가능) |

#### 📝 권한 시스템 예시

**상황**: 현재 7위 사용자가 음악을 재생 중

```
1위 사용자: /노래 중지      → ✅ 성공 (1위는 모든 사람 제어 가능)
4위 사용자: /노래 건너뛰기   → ✅ 성공 (4위는 7위 제어 가능)  
9위 사용자: /노래 중지      → ❌ 실패 (9위는 7위보다 낮음)
7위 사용자: /노래 재생 url:새곡 → ✅ 성공 (곡 추가는 누구나 가능)
```

#### 🎮 권한이 필요한 명령어

- **`/노래 중지`** - 현재 재생 중인 음악 정지 (권한 확인)
- **`/노래 건너뛰기`** - 다음 곡으로 건너뛰기 (권한 확인)  
- **`/노래 섞기`** - 대기열 무작위 섞기 (권한 확인)
- **`/노래 제거 번호:<번호>`** - 특정 곡 제거 (권한 확인)

#### 🆓 모든 사용자가 사용 가능한 명령어

- **`/노래 재생 url:<주소/검색어>`** - 음악 추가 (누구나 가능)
- **`/노래 대기열`** - 대기열 확인 (누구나 가능)
- **`/노래 반복 모드:<모드>`** - 반복 모드 설정 (누구나 가능)
- **`/노래 내권한`** - 자신의 음악 제어 권한 확인

### 📊 랭킹 및 통계 확인

```
/핑              # 봇 상태 및 응답속도 확인
/랭킹             # 현재 시즌 TOP 10 순위
/랭킹 limit:15    # 현재 시즌 TOP 15 순위 (5-20명 선택 가능)
/명예의전당        # 전체 기간 누적 TOP 10 랭킹  
/명예의전당 limit:20  # 전체 기간 누적 TOP 20 랭킹
/내기록           # 개인 상세 활동 통계
```

### 💡 팁

- **음성 채널에서 활발히 대화**하면 가장 많은 점수를 얻을 수 있습니다.
- **저녁 시간대(18:00-23:00)** 활동은 1.4배 보너스가 적용됩니다.
- **새벽 시간대(00:00-06:00)** 활동은 페널티가 있으니 주의하세요.
- **랭킹이 높을수록** 음악 제어 권한이 강해지므로 꾸준한 활동이 중요합니다!

## 🏗️ 프로젝트 구조

```
GodHand/
├── src/
│   ├── bot/                    # 봇 핵심
│   │   ├── index.js           # 메인 엔트리 포인트
│   │   ├── client.js          # Discord 클라이언트 설정
│   │   └── deploy-commands.js # 슬래시 명령어 등록
│   ├── commands/              # 슬래시 명령어
│   │   ├── user/             # 사용자 명령어
│   │   │   ├── ranking.js    # 랭킹 조회 (개선됨)
│   │   │   └── my-stats.js   # 개인 통계 (개선됨)
│   │   └── admin/            # 관리자 명령어
│   │       └── nickname-admin.js # 닉네임 관리 (신규)
│   ├── events/               # 이벤트 핸들러
│   │   └── guildMemberUpdate.js # 닉네임 실시간 동기화 (신규)
│   ├── services/             # 핵심 서비스
│   │   ├── activity/         # 활동 추적
│   │   ├── season/           # 시즌 관리 (개선됨)
│   │   ├── music/            # 음악 시스템
│   │   ├── nickname/         # 닉네임 관리 시스템 (신규)
│   │   │   └── scheduler.js  # 자동 동기화 스케줄러
│   │   └── database/         # 데이터베이스
│   ├── utils/                # 유틸리티
│   │   └── nickname.js       # 닉네임 유틸리티 (신규)
│   └── config/               # 설정 파일
├── database/                 # 데이터베이스 파일
├── test/                     # 테스트 코드 (통합)
│   ├── audio/               # 오디오/음성 테스트
│   ├── integration/         # 통합 테스트
│   ├── music/               # 음악 시스템 테스트
│   ├── performance/         # 성능 벤치마크
│   ├── results/             # 테스트 결과
│   └── unit/                # 단위 테스트 (향후)
└── docs/                     # 문서
```

## 🛠️ 기술 스택

- **Runtime**: Node.js 18+
- **Discord Library**: discord.js v14
- **Database**: PostgreSQL 14+
- **Voice Library**: @discordjs/voice
- **Audio Processing**: FFmpeg
- **Logging**: Winston
- **Scheduling**: node-cron
- **Testing**: Jest
- **Process Management**: PM2

## 🔧 개발 스크립트

### 기본 실행
```bash
# 개발 서버 실행 (nodemon)
npm run dev

# 프로덕션 서버 실행
npm start

# 명령어 배포
npm run deploy
```

### 테스트 및 검증
```bash
# 모든 테스트 실행
npm run test:all

# 개별 테스트 실행
npm run test:integration     # 통합 테스트
npm run test:performance     # 성능 벤치마크
npm run test:music          # 음악 시스템 테스트
npm run test:audio          # 오디오 시스템 테스트

# 세부 음악 테스트
npm run test:music:youtube      # YouTube API 테스트
npm run test:music:integrated   # 음악 통합 테스트

# 단위 테스트 (Jest)
npm test                    # Jest 단위 테스트
npm run test:watch          # Jest watch 모드

# 프로덕션 준비 상태 검증
npm run check:production
```

### 데이터베이스 관리
```bash
# 데이터베이스 마이그레이션
npm run db:migrate

# 시드 데이터 삽입
npm run db:seed
```

### PM2 프로세스 관리
```bash
# PM2로 시작
npm run pm2:start

# 상태 확인
npm run pm2:status

# 재시작
npm run pm2:restart

# 정지
npm run pm2:stop

# 로그 확인
npm run pm2:logs

# 실시간 모니터링
npm run pm2:monitor
```

### 배포 관리
```bash
# 향상된 배포
npm run deploy:enhanced

# 대화형 배포 CLI
npm run deploy:cli

# 드라이런 배포 (테스트)
npm run deploy:dry-run

# 이전 버전으로 롤백
npm run deploy:rollback
```

### 백업 관리
```bash
# 수동 백업 생성
npm run backup:manual

# 일일 자동 백업
npm run backup:daily

# 백업 목록 조회
npm run backup:list

# 백업 복원
npm run restore

# 백업 스케줄러 시작
npm run backup:schedule
```

## 🔒 환경변수 설정

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_discord_guild_id_here

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/godhand_bot

# Environment
NODE_ENV=development
LOG_LEVEL=info

# 라즈베리파이 최적화
OPTIMIZATION_MODE=raspberry_pi
MAX_MEMORY=400MB

# Optional (Recommended for Production)
DISCORD_WEBHOOK_URL=your_webhook_url_for_alerts
```

## 🚀 프로덕션 배포 (라즈베리파이)

### 📋 배포 전 준비
1. **시스템 요구사항 확인**
   - 라즈베리파이 4 이상 (2GB RAM 권장)
   - 라즈베리파이 OS (64-bit)
   - Node.js 18+, PostgreSQL 12+

2. **프로덕션 준비 상태 검증**
   ```bash
   npm run check:production
   ```

3. **통합 테스트 실행**
   ```bash
   npm run test:integration
   ```

### 🔧 배포 실행
```bash
# 표준 배포 (백업 포함)
npm run deploy:enhanced

# 대화형 배포 (권장)
npm run deploy:cli

# 테스트 배포 (실제 배포 안함)
npm run deploy:dry-run
```

### 📊 모니터링 및 관리
- **PM2 대시보드**: `npm run pm2:monitor`
- **시스템 상태**: `/monitoring status` (Discord 명령어)
- **성능 벤치마크**: `npm run test:performance`
- **자동 백업**: `npm run backup:schedule`

### 📖 자세한 배포 가이드
프로덕션 환경 배포에 대한 자세한 내용은 [배포 가이드](docs/production-deployment-guide.md)를 참고하세요.

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참고하세요.

## 👥 개발팀

- **GodHand Team** - *Initial work*

## 📞 지원

문제가 발생하거나 질문이 있으시면 GitHub Issues를 통해 연락해주세요.

---

**⭐ 이 프로젝트가 유용하다면 스타를 눌러주세요!**