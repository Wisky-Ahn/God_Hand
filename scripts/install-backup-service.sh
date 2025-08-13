#!/bin/bash

# GodHand Discord Bot 백업 서비스 설치 스크립트
# Raspberry Pi의 systemd를 사용하여 자동 백업 서비스 설정

set -e

# 설정 변수
SERVICE_NAME="godhand-backup"
SERVICE_USER="pi"
PROJECT_ROOT="$(pwd)"
SCRIPT_PATH="$PROJECT_ROOT/scripts/backup-manager.js"

echo "🔧 GodHand 백업 서비스 설치 시작..."

# 1. 프로젝트 경로 확인
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ 백업 스크립트를 찾을 수 없습니다: $SCRIPT_PATH"
    exit 1
fi

# 2. systemd 서비스 파일 생성
echo "📝 systemd 서비스 파일 생성 중..."

cat > /tmp/${SERVICE_NAME}.service << EOF
[Unit]
Description=GodHand Discord Bot Database Backup Service
After=network.target postgresql.service
Wants=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${PROJECT_ROOT}
ExecStart=/usr/bin/node ${SCRIPT_PATH} schedule
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# 환경 변수 파일 로드
EnvironmentFile=-${PROJECT_ROOT}/.env

# 리소스 제한 (Raspberry Pi에 맞게 조정)
MemoryLimit=128M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF

# 3. 서비스 파일을 systemd 디렉토리로 복사
echo "📁 서비스 파일 설치 중..."
sudo mv /tmp/${SERVICE_NAME}.service /etc/systemd/system/

# 4. systemd 데몬 리로드
echo "🔄 systemd 데몬 리로드 중..."
sudo systemctl daemon-reload

# 5. 서비스 활성화
echo "✅ 서비스 활성화 중..."
sudo systemctl enable ${SERVICE_NAME}.service

# 6. 서비스 시작
echo "▶️  서비스 시작 중..."
sudo systemctl start ${SERVICE_NAME}.service

# 7. 서비스 상태 확인
echo "🔍 서비스 상태 확인 중..."
sudo systemctl status ${SERVICE_NAME}.service --no-pager

echo ""
echo "🎉 백업 서비스 설치 완료!"
echo ""
echo "📋 유용한 명령어:"
echo "  sudo systemctl status ${SERVICE_NAME}     # 서비스 상태 확인"
echo "  sudo systemctl restart ${SERVICE_NAME}    # 서비스 재시작"
echo "  sudo systemctl stop ${SERVICE_NAME}       # 서비스 중지"
echo "  sudo systemctl disable ${SERVICE_NAME}    # 서비스 비활성화"
echo "  sudo journalctl -u ${SERVICE_NAME} -f     # 실시간 로그 보기"
echo "  sudo journalctl -u ${SERVICE_NAME} --since today  # 오늘 로그 보기"
echo ""
echo "⏰ 백업 스케줄:"
echo "  📅 일일 백업: 매일 새벽 2시"
echo "  📅 주간 백업: 매주 일요일 새벽 3시"
echo "  📅 월간 백업: 매월 1일 새벽 4시"
echo ""
echo "📁 백업 파일 위치: ${PROJECT_ROOT}/backups/" 