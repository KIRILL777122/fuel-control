#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_USER="late-report"
ENV_FILE="/etc/late-report/late-report.env"
STATE_DIR="/var/lib/late-report"
LOG_DIR="/var/log/late-report"

echo "Installing late-report service..."

# Создание пользователя
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "Creating user $SERVICE_USER..."
    useradd -r -s /bin/false -d "$STATE_DIR" "$SERVICE_USER"
fi

# Создание директорий
echo "Creating directories..."
mkdir -p /etc/late-report
mkdir -p "$STATE_DIR"
mkdir -p "$LOG_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$STATE_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"

# Копирование env файла если не существует
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating $ENV_FILE from example..."
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    chown root:"$SERVICE_USER" "$ENV_FILE"
    echo "⚠️  Please edit $ENV_FILE and set your credentials"
else
    echo "$ENV_FILE already exists, skipping"
fi

# Копирование systemd unit файлов
echo "Installing systemd units..."
cp "$PROJECT_DIR/systemd/late-report.service" /etc/systemd/system/
cp "$PROJECT_DIR/systemd/late-report.timer" /etc/systemd/system/

# Установка зависимостей Python
echo "Installing Python dependencies..."
cd "$PROJECT_DIR"
if [ -d "venv" ]; then
    source venv/bin/activate
else
    python3 -m venv venv
    source venv/bin/activate
fi
pip install -r requirements.txt

# Перезагрузка systemd
systemctl daemon-reload

echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit $ENV_FILE and set your credentials"
echo "2. Enable and start the timer:"
echo "   sudo systemctl enable late-report.timer"
echo "   sudo systemctl start late-report.timer"
echo "3. Check status:"
echo "   sudo systemctl status late-report.timer"
echo "   sudo journalctl -u late-report.service -f"
