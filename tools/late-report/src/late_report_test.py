#!/usr/bin/env python3
"""Тестовая версия для обработки последних TEST_LIMIT писем за сегодня"""
import sys
import os

# Добавляем текущую директорию в путь
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from late_report import (
    load_config, load_state, save_state, parse_excel, extract_late_records,
    generate_png_table, format_caption, send_telegram_photo, send_telegram_text,
    get_delay_emoji, get_file_hash, mark_email_seen,
    decode_filename, is_excel_file, has_valid_delay_column,
    detect_report_type, parse_docs_excel, generate_png_table_docs, process_docs_report,
    load_processed_keys, save_processed_keys
)
from imapclient import IMAPClient
from datetime import datetime, timedelta
import email
import email.header
import re
import logging
import time
import hashlib

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


def get_email_attachments_today(config):
    """Получение последних TEST_LIMIT писем за сегодня с Excel вложениями"""
    if not config['imap_user'] or not config['imap_pass']:
        logger.error("IMAP credentials not set")
        return []
    
    test_limit = config.get('test_limit', 10)
    attachments = []
    attachment_pattern = None
    if config.get('attachment_regex'):
        try:
            attachment_pattern = re.compile(config['attachment_regex'], re.IGNORECASE)
        except Exception as e:
            logger.warning(f"Invalid attachment_regex pattern: {e}, ignoring regex filter")
    
    try:
        with IMAPClient(config['imap_host'], port=993, ssl=True) as client:
            client.login(config['imap_user'], config['imap_pass'])
            mailbox = config.get('mailbox', 'INBOX')
            client.select_folder(mailbox)
            
            # Поиск писем с учетом lookback дней и московского времени
            from zoneinfo import ZoneInfo
            lookback_days = config.get('imap_lookback_days', 3)
            max_uids = config.get('imap_max_uids', 500)
            report_tz = config.get('report_tz', 'Europe/Moscow')
            
            try:
                tz = ZoneInfo(report_tz)
            except Exception as e:
                logger.warning(f"Invalid timezone {report_tz}, using UTC: {e}")
                tz = ZoneInfo('UTC')
            
            # Получаем текущую дату в московском времени
            today_msk = datetime.now(tz).date()
            # Вычисляем дату для поиска (сегодня - lookback дней)
            since_date = today_msk - timedelta(days=lookback_days)
            since_str = since_date.strftime('%d-%b-%Y')
            
            logger.info(f"Computed SINCE: {since_str} (lookback {lookback_days}d, tz={report_tz}, today_msk={today_msk})")
            
            # Поиск всех писем с указанной даты
            messages = client.search(['SINCE', since_str])
            logger.info(f"Found {len(messages)} messages since {since_str}")
            
            # Ограничиваем количество UID (берем последние max_uids)
            if len(messages) > max_uids:
                messages = sorted(messages)[-max_uids:]
                logger.info(f"Limited to last {max_uids} UIDs (total found: {len(messages)})")
            else:
                messages = sorted(messages)
                logger.info(f"Processing all {len(messages)} UIDs")
            
            for uid in messages:
                try:
                    msg_data = client.fetch([uid], ['RFC822'])[uid]
                    msg = email.message_from_bytes(msg_data[b'RFC822'])
                    
                    logger.info(f"--- Processing message UID {uid} ---")
                    
                    for part in msg.walk():
                        content_disposition = part.get_content_disposition()
                        filename_raw = part.get_filename()
                        content_type = part.get_content_type()
                        
                        # Декодируем имя файла
                        filename = decode_filename(filename_raw)
                        
                        # Логируем информацию о частях сообщения
                        if filename_raw or content_type:
                            logger.debug(f"  Part: content-type={content_type}, disposition={content_disposition}, filename_raw={filename_raw[:50] if filename_raw else None}, filename_decoded={filename[:50] if filename else None}")
                        
                        # Принимаем любую часть с filename (attachment или inline)
                        if filename:
                            # Проверяем, является ли файл Excel
                            if is_excel_file(filename, content_type):
                                logger.info(f"  ✓ Found Excel file: {filename} (UID {uid}, content-type: {content_type})")
                                
                                # Проверяем regex-фильтр (если задан)
                                should_include = True
                                if attachment_pattern and filename:
                                    # Проверяем, не слишком ли много кракозябр
                                    if '' not in filename:  # Если нормально декодирован
                                        if not attachment_pattern.search(filename):
                                            should_include = False
                                            logger.debug(f"    Filtered out by regex: {filename}")
                                    else:
                                        logger.info(f"    Filename has encoding issues, skipping regex filter")
                                
                                if should_include:
                                    try:
                                        file_data = part.get_payload(decode=True)
                                        if file_data:
                                            attachments.append((uid, len(attachments), filename or f"mail_{uid}.xlsx", file_data))
                                            logger.info(f"    ✓ Added attachment: {filename} (size: {len(file_data)} bytes)")
                                    except Exception as e:
                                        logger.error(f"    ✗ Failed to decode attachment {filename}: {e}")
                except Exception as e:
                    logger.error(f"Error processing message {uid}: {e}")
                    import traceback
                    traceback.print_exc()
    
    except Exception as e:
        logger.error(f"Error connecting to IMAP: {e}")
        import traceback
        traceback.print_exc()
    
    logger.info(f"Total Excel attachments found: {len(attachments)}")
    return attachments


def main():
    """Основная функция для тестирования"""
    test_limit = int(os.getenv('TEST_LIMIT', '10'))
    logger.info(f"Starting late-report TEST mode (last {test_limit} messages today)")
    
    config = load_config()
    
    # Проверка конфигурации
    if not config.get('imap_user') or not config.get('imap_pass'):
        logger.error("❌ IMAP credentials not set in config!")
        return
    
    if not config.get('tg_token'):
        logger.error("❌ TG_TOKEN not set in config!")
        return
    
    logger.info(f"IMAP: {config['imap_user']}@{config['imap_host']}")
    logger.info(f"Mailbox: {config.get('mailbox', 'INBOX')}")
    logger.info(f"Telegram chat: {config.get('tg_chat_id')}, topic late: {config.get('tg_topic_id_late')}, topic docs: {config.get('tg_topic_id_docs')}")
    logger.info(f"TEST_LIMIT: {config.get('test_limit', 10)}")
    logger.info(f"RUN_LATE_REPORT: {config.get('run_late_report', True)}, RUN_DOCS_REPORT: {config.get('run_docs_report', True)}")
    logger.info(f"IMAP_LOOKBACK_DAYS: {config.get('imap_lookback_days', 3)}")
    logger.info(f"STATE_FILE: {config.get('state_file')}")
    
    # Загрузка обработанных ключей
    processed_keys = load_processed_keys(config.get('state_file', '/opt/fuel-control/tools/late-report/state/processed.json'))
    logger.info(f"Loaded {len(processed_keys)} processed keys from state")
    
    # Получение вложений (последние TEST_LIMIT писем за сегодня)
    attachments = get_email_attachments_today(config)
    
    if not attachments:
        logger.info(f"No Excel attachments found in last {test_limit} messages today")
        return
    
    logger.info(f"Found {len(attachments)} attachment(s)")
    
    # Фильтрация уже обработанных вложений
    new_attachments = []
    skipped_count = 0
    
    for uid, att_index, filename, file_data in attachments:
        # Генерируем ключ для вложения: uid:att_index:sha256
        file_hash = hashlib.sha256(file_data).hexdigest()
        attachment_key = f"{uid}:{att_index}:{file_hash}"
        
        if attachment_key in processed_keys:
            logger.debug(f"Skipping already processed attachment: {filename} (UID {uid}, key: {attachment_key[:20]}...)")
            skipped_count += 1
            continue
        
        new_attachments.append((uid, att_index, filename, file_data))
    
    logger.info(f"Filtered: {skipped_count} already processed, {len(new_attachments)} new attachments to process")
    
    if not new_attachments:
        logger.info("No new attachments to process")
        return
    
    # Разделение на late и docs отчёты
    late_attachments = []
    docs_attachments = []
    
    for uid, att_index, filename, file_data in new_attachments:
        report_type = None
        # Пробуем определить тип отчёта, пробуя оба парсера
        try:
            df_test = parse_excel(file_data)
            report_type = detect_report_type(df_test)
        except Exception as e:
            logger.debug(f"Failed to parse as late-report for {filename} (UID {uid}): {e}")
        
        if report_type != 'late':
            try:
                df_test = parse_docs_excel(file_data)
                report_type = detect_report_type(df_test)
            except Exception as e:
                logger.debug(f"Failed to parse as docs-report for {filename} (UID {uid}): {e}")
        
        if report_type == 'late':
            late_attachments.append((uid, att_index, filename, file_data))
            logger.info(f"File {filename} (UID {uid}) identified as LATE-report")
        elif report_type == 'docs':
            docs_attachments.append((uid, att_index, filename, file_data))
            logger.info(f"File {filename} (UID {uid}) identified as DOCS-report")
        else:
            logger.warning(f"Unknown report type for {filename} (UID {uid}), skipping")
    
    # Обработка late-report
    all_late_records = []
    late_processed_uids = []
    late_processed_hashes = []
    
    if config.get('run_late_report', True) and late_attachments:
        logger.info(f"Processing {len(late_attachments)} late-report attachments")
        
        for uid, att_index, filename, file_data in late_attachments:
            # Генерируем ключ для вложения
            file_hash = hashlib.sha256(file_data).hexdigest()
            attachment_key = f"{uid}:{att_index}:{file_hash}"
            
            try:
                # Парсинг Excel
                df = parse_excel(file_data)
                
                # Проверка наличия обязательной колонки "Опоздание, мин."
                if not has_valid_delay_column(df):
                    logger.warning(f"File {filename} (UID {uid}) does not contain 'Опоздание, мин.' column, skipping")
                    processed_keys[attachment_key] = time.time()
                    continue
            
                # Извлечение опоздавших
                records = extract_late_records(df)
                
                # Нормализация значений: trim для строковых полей, upper для госномера
                normalized_records = []
                for record in records:
                    normalized_record = {
                        'driver_name': str(record.get('driver_name', '')).strip(),
                        'plate_number': str(record.get('plate_number', '')).strip().upper(),
                        'route_name': str(record.get('route_name', '')).strip(),
                        'planned_time': str(record.get('planned_time', '')).strip(),
                        'assigned_time': str(record.get('assigned_time', '')).strip(),
                        'delay_minutes': int(record.get('delay_minutes', 0)),
                    }
                    normalized_records.append(normalized_record)
                
                if normalized_records:
                    all_late_records.extend(normalized_records)
                    # Добавляем ключ в processed_keys после успешной обработки
                    processed_keys[attachment_key] = time.time()
                    logger.info(f"Found {len(normalized_records)} late records in {filename} (UID {uid}, key: {attachment_key[:20]}...)")
                else:
                    processed_keys[attachment_key] = time.time()
                    logger.info(f"No late records in {filename} (UID {uid}), but file processed")
            except Exception as e:
                logger.error(f"Error processing {filename}: {e}")
                import traceback
                traceback.print_exc()
        
        if all_late_records:
            logger.info(f"Total late records before deduplication: {len(all_late_records)}")
            
            # Дедупликация
            dedup_dict = {}
            for record in all_late_records:
                key = (
                    record.get('driver_name', '').strip(),
                    record.get('route_name', '').strip(),
                    record.get('planned_time', '').strip()
                )
                if key in dedup_dict:
                    if record.get('delay_minutes', 0) > dedup_dict[key].get('delay_minutes', 0):
                        dedup_dict[key] = record
                else:
                    dedup_dict[key] = record
            
            unique_records = list(dedup_dict.values())
            logger.info(f"Total late records after deduplication: {len(unique_records)}")
            
            # Сортировка по delay по убыванию
            unique_records.sort(key=lambda x: x.get('delay_minutes', 0), reverse=True)
            
            # Генерация PNG
            temp_png = '/tmp/late_report_test.png'
            if generate_png_table(unique_records, temp_png):
                caption = format_caption(unique_records)
                
                logger.info("Sending late-report to Telegram...")
                topic_id_late = int(config.get('tg_topic_id_late', 26))
                if send_telegram_photo(config, temp_png, caption, topic_id=topic_id_late):
                    full_caption = format_caption(unique_records)
                    if len(full_caption) > 1024:
                        remaining = '\n'.join([f"{get_delay_emoji(r['delay_minutes'])} {r['driver_name']} — {r['delay_minutes']}" 
                                              for r in unique_records[len(caption.split('\n')):]])
                        send_telegram_text(config, remaining)
                    
                    # Сохраняем обработанные ключи
                    save_processed_keys(config.get('state_file', '/opt/fuel-control/tools/late-report/state/processed.json'), processed_keys)
                    
                    logger.info(f"✅ Successfully sent {len(unique_records)} late records to Telegram topic {topic_id_late}")
                else:
                    logger.error("❌ Failed to send late-report to Telegram")
            else:
                logger.error("❌ Failed to generate late-report PNG table")
            
            # Очистка
            if os.path.exists(temp_png):
                os.remove(temp_png)
        else:
            logger.info("No late records found in late-report attachments")
    
    # Обработка docs-report
    if config.get('run_docs_report', True) and docs_attachments:
        logger.info(f"Processing {len(docs_attachments)} docs-report attachments")
        process_docs_report(config, docs_attachments, processed_keys)
        
        logger.info("✅ Docs-report processing completed")
    elif not config.get('run_docs_report', True):
        logger.info("Docs-report disabled (RUN_DOCS_REPORT=0)")
    elif not docs_attachments:
        logger.info("No docs-report attachments found")


if __name__ == '__main__':
    main()
