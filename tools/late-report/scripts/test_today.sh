#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Тестирование late-report: обработка последних 2 писем за сегодня ==="
echo ""

# Проверка конфигурации
if [ ! -f "/etc/late-report/late-report.env" ]; then
    echo "❌ Ошибка: Файл /etc/late-report/late-report.env не найден!"
    exit 1
fi

cd "$PROJECT_DIR"

# Создание/активация venv
if [ ! -d "venv" ]; then
    echo "Создание виртуального окружения..."
    python3 -m venv venv
fi

source venv/bin/activate

# Установка зависимостей
if ! python3 -c "import pandas, imapclient, PIL, requests, dotenv" 2>/dev/null; then
    echo "Установка зависимостей..."
    pip install -q -r requirements.txt
fi

# Создание временной версии скрипта для обработки последних писем
cat > /tmp/late_report_test.py << 'PYTHON_SCRIPT'
#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, '/opt/fuel-control/tools/late-report')

# Импорт оригинального модуля
from src import late_report as lr
from imapclient import IMAPClient
from datetime import datetime, timedelta
import email
import re

config = lr.load_config()
state = lr.load_state(config['state_path'])

print("Подключение к почте...")
with IMAPClient(config['imap_host'], port=993, ssl=True) as client:
    client.login(config['imap_user'], config['imap_pass'])
    client.select_folder('INBOX')
    
    # Поиск писем за сегодня
    today = datetime.now().date()
    search_date = today.strftime('%d-%b-%Y')
    messages = client.search(['SINCE', search_date])
    
    print(f"Найдено {len(messages)} писем за сегодня")
    
    # Берем последние 2 письма
    recent_messages = sorted(messages)[-2:] if len(messages) >= 2 else messages
    print(f"Обрабатываем последние {len(recent_messages)} письма(о)")
    
    attachment_pattern = re.compile(config['attachment_regex'], re.IGNORECASE)
    attachments = []
    
    for uid in recent_messages:
        try:
            msg_data = client.fetch([uid], ['RFC822'])[uid]
            msg = email.message_from_bytes(msg_data[b'RFC822'])
            
            for part in msg.walk():
                if part.get_content_disposition() == 'attachment':
                    filename = part.get_filename()
                    if filename and (filename.endswith('.xlsx') or filename.endswith('.xls')):
                        if attachment_pattern.search(filename):
                            file_data = part.get_payload(decode=True)
                            attachments.append((uid, filename, file_data))
                            print(f"  ✓ Найдено вложение: {filename} в письме {uid}")
        except Exception as e:
            print(f"  ✗ Ошибка обработки письма {uid}: {e}")

if not attachments:
    print("Нет подходящих вложений в последних письмах")
    sys.exit(0)

print(f"\nОбработка {len(attachments)} вложения(ий)...")

all_late_records = []
processed_uids = []
processed_hashes = []

for uid, filename, file_data in attachments:
    file_hash = lr.get_file_hash(file_data)
    
    if uid in state.get('processed_uids', []):
        print(f"  Письмо {uid} уже обработано (пропускаем)")
        continue
    
    if file_hash in state.get('processed_file_hashes', []):
        print(f"  Файл {filename} уже обработан (пропускаем)")
        continue
    
    try:
        df = lr.parse_excel(file_data)
        records = lr.extract_late_records(df)
        
        if records:
            all_late_records.extend(records)
            processed_uids.append(uid)
            processed_hashes.append(file_hash)
            print(f"  ✓ Найдено {len(records)} опозданий в {filename}")
    except Exception as e:
        print(f"  ✗ Ошибка обработки {filename}: {e}")

if not all_late_records:
    print("\nНет опозданий для отправки")
    sys.exit(0)

# Удаление дубликатов
seen = set()
unique_records = []
for record in all_late_records:
    key = (record['driver_name'], record['delay_minutes'], record['route_name'], 
           record.get('planned_time'), record.get('assigned_time'))
    if key not in seen:
        seen.add(key)
        unique_records.append(record)

print(f"\nУникальных опозданий: {len(unique_records)}")

# Генерация PNG
temp_png = '/tmp/late_report.png'
if lr.generate_png_table(unique_records, temp_png):
    caption = lr.format_caption(unique_records)
    
    print("\nОтправка в Telegram...")
    if lr.send_telegram_photo(config, temp_png, caption):
        full_caption = lr.format_caption(unique_records)
        if len(full_caption) > 1024:
            remaining = '\n'.join([f"{lr.get_delay_emoji(r['delay_minutes'])} {r['driver_name']} — +{r['delay_minutes']} мин" 
                                  for r in unique_records[len(caption.split('\n')):]])
            lr.send_telegram_text(config, remaining)
        
        # Обновление состояния
        state['processed_uids'].extend(processed_uids)
        state['processed_file_hashes'].extend(processed_hashes)
        state['processed_uids'] = state['processed_uids'][-1000:]
        state['processed_file_hashes'] = state['processed_file_hashes'][-1000:]
        lr.save_state(config['state_path'], state)
        
        # Пометить письма как прочитанные
        for uid in processed_uids:
            lr.mark_email_seen(config, uid)
        
        print(f"\n✅ Успешно обработано {len(processed_uids)} писем, отправлено {len(unique_records)} опозданий в Telegram")
    else:
        print("\n❌ Ошибка отправки в Telegram")

if os.path.exists(temp_png):
    os.remove(temp_png)
PYTHON_SCRIPT

export LATE_REPORT_ENV=/etc/late-report/late-report.env
python3 /tmp/late_report_test.py
