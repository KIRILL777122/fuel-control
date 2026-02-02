#!/bin/bash
# Скрипт для настройки cron задач для late-report
# Не требует sudo

SCRIPT_DIR="/opt/fuel-control/tools/late-report"
PYTHON_SCRIPT="${SCRIPT_DIR}/src/late_report.py"
ENV_FILE="/etc/late-report/late-report.env"

# Проверка существования файлов
if [ ! -f "$PYTHON_SCRIPT" ]; then
    echo "Ошибка: файл $PYTHON_SCRIPT не найден"
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "Ошибка: файл $ENV_FILE не найден"
    exit 1
fi

# Создаем временный файл для crontab
TMP_CRON=$(mktemp)

# Получаем текущий crontab (если есть)
crontab -l > "$TMP_CRON" 2>/dev/null || echo "" > "$TMP_CRON"

# Удаляем старые записи late-report (если есть)
sed -i '/late_report.py/d' "$TMP_CRON"
sed -i '/late-report/d' "$TMP_CRON"

# Добавляем новые записи
# Late-report (опоздания) - каждый день в 11:00 МСК
echo "# Late-report: опоздания - каждый день в 11:00 МСК" >> "$TMP_CRON"
echo "0 11 * * * TZ=Europe/Moscow REPORT_TZ=Europe/Moscow cd $SCRIPT_DIR && /usr/bin/python3 $PYTHON_SCRIPT >> /tmp/late-report.log 2>&1" >> "$TMP_CRON"

# Docs-report (документы) - каждый день в 01:00 МСК
echo "# Late-report: документы - каждый день в 01:00 МСК" >> "$TMP_CRON"
echo "0 1 * * * TZ=Europe/Moscow REPORT_TZ=Europe/Moscow cd $SCRIPT_DIR && DOCS_ONLY=1 /usr/bin/python3 $PYTHON_SCRIPT >> /tmp/late-report-docs.log 2>&1" >> "$TMP_CRON"

# Устанавливаем новый crontab
crontab "$TMP_CRON"

# Удаляем временный файл
rm "$TMP_CRON"

echo "✅ Cron задачи установлены:"
echo "  - Late-report (опоздания): каждый день в 11:00 МСК"
echo "  - Docs-report (документы): каждый день в 01:00 МСК"
echo ""
echo "Проверить: crontab -l"
echo "Логи: /tmp/late-report.log и /tmp/late-report-docs.log"
