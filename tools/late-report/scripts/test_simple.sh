#!/bin/bash
set -e

cd /opt/fuel-control/tools/late-report

echo "=== Диагностика и тестирование late-report ==="
echo ""

# 1. Проверка конфигурации
echo "1. Проверка конфигурации..."
CONFIG_FILE="/etc/late-report/late-report.env"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "   ❌ Файл $CONFIG_FILE не найден!"
    echo "   Создайте его: sudo cp .env.example $CONFIG_FILE && sudo chmod 644 $CONFIG_FILE"
    exit 1
fi

if [ ! -r "$CONFIG_FILE" ]; then
    echo "   ⚠️  Файл недоступен для чтения"
    echo "   Попробуйте: sudo chmod 644 $CONFIG_FILE"
    echo "   Или запустите скрипт с sudo"
    exit 1
fi

echo "   ✅ Файл конфигурации найден и доступен"

# 2. Проверка/создание venv
echo ""
echo "2. Проверка виртуального окружения..."
if [ ! -d "venv" ]; then
    echo "   Создание venv..."
    if ! python3 -m venv venv 2>/dev/null; then
        echo "   ❌ Не удалось создать venv. Установите: sudo apt-get install -y python3-venv"
        exit 1
    fi
    echo "   ✅ venv создан"
else
    echo "   ✅ venv существует"
fi

# 3. Активация и проверка зависимостей
echo ""
echo "3. Проверка зависимостей..."
source venv/bin/activate

if ! python3 -c "import pandas, imapclient, PIL, requests, dotenv" 2>/dev/null; then
    echo "   Установка зависимостей..."
    pip install -q -r requirements.txt
    echo "   ✅ Зависимости установлены"
else
    echo "   ✅ Все зависимости установлены"
fi

# 4. Запуск основного скрипта
echo ""
echo "4. Запуск скрипта обработки писем..."
echo "---"

export LATE_REPORT_ENV="$CONFIG_FILE"
python3 src/late_report.py

echo ""
echo "---"
echo "✅ Завершено"
