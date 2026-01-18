#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Smoke test for late-report service"
echo "===================================="

# Проверка наличия тестового XLSX файла
if [ ! -f "$PROJECT_DIR/samples/test.xlsx" ]; then
    echo "⚠️  Test file not found: $PROJECT_DIR/samples/test.xlsx"
    echo "Creating sample structure..."
    mkdir -p "$PROJECT_DIR/samples"
    echo "Please add test.xlsx file to samples/ directory"
    exit 1
fi

# Активация виртуального окружения если существует
if [ -d "$PROJECT_DIR/venv" ]; then
    source "$PROJECT_DIR/venv/bin/activate"
fi

# Запуск теста
cd "$PROJECT_DIR"

# Проверка наличия .env файла
if [ ! -f ".env" ] && [ ! -f "/etc/late-report/late-report.env" ]; then
    echo "⚠️  .env file not found. Creating from example..."
    cp .env.example .env
    echo "Please edit .env and set your credentials"
    exit 1
fi

# Тест с тестовым файлом
echo "Running test with sample file..."
export DRY_RUN=true
export LATE_REPORT_ENV="$PROJECT_DIR/.env" 2>/dev/null || export LATE_REPORT_ENV="/etc/late-report/late-report.env"

python3 "$PROJECT_DIR/src/late_report.py"

echo ""
echo "✅ Smoke test completed (DRY_RUN mode)"
echo "Check the output above for any errors"
