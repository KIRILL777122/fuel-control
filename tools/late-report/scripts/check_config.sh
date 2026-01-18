#!/bin/bash

echo "=== Проверка конфигурации late-report ==="
echo ""

# Проверка файла конфигурации
CONFIG_FILE="/etc/late-report/late-report.env"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Файл $CONFIG_FILE не найден!"
    echo ""
    echo "Создайте его командой:"
    echo "  sudo mkdir -p /etc/late-report"
    echo "  sudo cp /opt/fuel-control/tools/late-report/.env.example $CONFIG_FILE"
    echo "  sudo chmod 600 $CONFIG_FILE"
    echo "  sudo nano $CONFIG_FILE"
    exit 1
fi

echo "✅ Файл конфигурации найден: $CONFIG_FILE"

# Проверка прав доступа
if [ ! -r "$CONFIG_FILE" ]; then
    echo "⚠️  Файл недоступен для чтения (нужны права)"
    echo "Попробуйте запустить скрипт с sudo или установите права:"
    echo "  sudo chmod 644 $CONFIG_FILE"
    echo ""
fi

# Чтение конфигурации (попытка)
echo ""
echo "Проверка переменных окружения:"
source <(grep -v '^#' "$CONFIG_FILE" 2>/dev/null | grep '=' | sed 's/^/export /') 2>/dev/null || true

if [ -z "$YA_IMAP_USER" ]; then
    echo "  ❌ YA_IMAP_USER: НЕ УСТАНОВЛЕН"
else
    echo "  ✅ YA_IMAP_USER: установлен"
fi

if [ -z "$YA_IMAP_PASS" ]; then
    echo "  ❌ YA_IMAP_PASS: НЕ УСТАНОВЛЕН"
else
    echo "  ✅ YA_IMAP_PASS: установлен (len=${#YA_IMAP_PASS})"
fi

if [ -z "$TG_TOKEN" ]; then
    echo "  ❌ TG_TOKEN: НЕ УСТАНОВЛЕН"
else
    echo "  ✅ TG_TOKEN: установлен (len=${#TG_TOKEN})"
fi

echo ""
echo "TG_CHAT_ID: ${TG_CHAT_ID:--1003541359350 (default)}"
echo "TG_TOPIC_ID: ${TG_TOPIC_ID:-26 (default)}"
