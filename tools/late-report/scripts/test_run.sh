#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Тестирование late-report сервиса ==="
echo ""

# Проверка конфигурации
if [ ! -f "/etc/late-report/late-report.env" ]; then
    echo "❌ Ошибка: Файл /etc/late-report/late-report.env не найден!"
    echo "Создайте его командой:"
    echo "  sudo mkdir -p /etc/late-report"
    echo "  sudo cp $PROJECT_DIR/.env.example /etc/late-report/late-report.env"
    echo "  sudo chmod 600 /etc/late-report/late-report.env"
    echo "  sudo nano /etc/late-report/late-report.env"
    exit 1
fi

echo "✅ Файл конфигурации найден"

# Проверка/создание venv
cd "$PROJECT_DIR"
if [ ! -d "venv" ]; then
    echo "Создание виртуального окружения..."
    if ! python3 -m venv venv 2>/dev/null; then
        echo "❌ Ошибка: Не удалось создать venv. Установите python3-venv:"
        echo "  sudo apt-get install -y python3-venv"
        exit 1
    fi
fi

# Активация venv и установка зависимостей
echo "Активация виртуального окружения..."
source venv/bin/activate

echo "Проверка зависимостей..."
if ! python3 -c "import pandas, imapclient, PIL, requests, dotenv" 2>/dev/null; then
    echo "Установка зависимостей..."
    pip install -q -r requirements.txt
fi

echo ""
echo "✅ Все зависимости установлены"
echo ""
echo "Запуск скрипта..."
echo "---"

export LATE_REPORT_ENV=/etc/late-report/late-report.env
python3 src/late_report.py

echo ""
echo "---"
echo "✅ Скрипт завершен"
