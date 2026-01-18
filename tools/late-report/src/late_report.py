#!/usr/bin/env python3
"""
Late Report Service
Сервис для обработки опозданий из почты и отправки в Telegram
"""

import os
import re
import json
import imaplib
import email
import email.header
import io
import hashlib
import textwrap
import time
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import List, Dict, Optional, Tuple
import logging

import pandas as pd
from PIL import Image, ImageDraw, ImageFont
from imapclient import IMAPClient
from dotenv import load_dotenv
import requests

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/var/log/late-report/late-report.log') if os.path.exists('/var/log/late-report') else logging.NullHandler()
    ]
)
logger = logging.getLogger(__name__)


def load_config():
    """Загрузка конфигурации из env файла"""
    env_path = os.getenv('LATE_REPORT_ENV', '/etc/late-report/late-report.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)
    else:
        load_dotenv('.env')
    
    attachment_regex = os.getenv('ATTACHMENT_NAME_REGEX', r'Соблюдение\s+сроков')
    # Если regex пустой - отключаем фильтр
    if not attachment_regex or attachment_regex.strip() == '':
        attachment_regex = None
    
    return {
        'imap_host': os.getenv('YA_IMAP_HOST', 'imap.yandex.com'),
        'imap_user': os.getenv('YA_IMAP_USER'),
        'imap_pass': os.getenv('YA_IMAP_PASS'),
        'mailbox': os.getenv('YA_MAILBOX', 'INBOX'),
        'attachment_regex': attachment_regex,
        'tg_token': os.getenv('TG_TOKEN'),
        'tg_chat_id': os.getenv('TG_CHAT_ID'),
        'tg_topic_id_late': os.getenv('TG_TOPIC_ID_LATE', os.getenv('TG_TOPIC_ID', '26')),
        'tg_topic_id_docs': os.getenv('TG_TOPIC_ID_DOCS', '2'),
        'admin_chat_id': os.getenv('ADMIN_CHAT_ID'),
        'dry_run': os.getenv('DRY_RUN', '0').lower() in ('1', 'true', 'yes'),
        'send_if_empty': os.getenv('SEND_IF_EMPTY', 'false').lower() == 'true',
        'run_late_report': False if os.getenv('DOCS_ONLY', '0').lower() in ('1', 'true', 'yes') else os.getenv('RUN_LATE_REPORT', '1').lower() in ('1', 'true', 'yes'),
        'run_docs_report': True if os.getenv('DOCS_ONLY', '0').lower() in ('1', 'true', 'yes') else os.getenv('RUN_DOCS_REPORT', '1').lower() in ('1', 'true', 'yes'),
        'state_path': os.getenv('STATE_PATH', '/var/lib/late-report/state.json'),
        'state_file': os.getenv('STATE_FILE', '/opt/fuel-control/tools/late-report/state/processed.json'),
        'imap_lookback_days': int(os.getenv('IMAP_LOOKBACK_DAYS', '3')),
        'imap_max_uids': int(os.getenv('IMAP_MAX_UIDS', '500')),
        'report_tz': os.getenv('REPORT_TZ', 'Europe/Moscow'),
        'force_resend': os.getenv('FORCE_RESEND', '0').lower() in ('1', 'true', 'yes'),
        'dry_run': os.getenv('DRY_RUN', '0').lower() in ('1', 'true', 'yes'),
        'docs_only': os.getenv('DOCS_ONLY', '0').lower() in ('1', 'true', 'yes'),
        'docs_date_token': os.getenv('DOCS_DATE_TOKEN'),  # Override для тестов
        'test_limit': int(os.getenv('TEST_LIMIT', '10')),
    }


def load_state(state_path: str) -> Dict:
    """Загрузка состояния обработанных писем"""
    if os.path.exists(state_path):
        try:
            with open(state_path, 'r', encoding='utf-8') as f:
                state = json.load(f)
                # Обеспечиваем обратную совместимость
                if 'processed_uids' not in state:
                    state['processed_uids'] = []
                if 'processed_file_hashes' not in state:
                    state['processed_file_hashes'] = []
                return state
        except Exception as e:
            logger.warning(f"Failed to load state: {e}")
    return {'processed_uids': [], 'processed_file_hashes': []}


def save_state(state_path: str, state: Dict):
    """Сохранение состояния"""
    try:
        state_dir = os.path.dirname(state_path)
        if state_dir:
            os.makedirs(state_dir, exist_ok=True)
        with open(state_path, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except PermissionError as e:
        logger.warning(f"Permission denied saving state to {state_path}: {e}. State will not be persisted.")
    except Exception as e:
        logger.error(f"Failed to save state: {e}")


def load_processed_keys(state_file: str) -> Dict[str, float]:
    """Загрузка обработанных ключей из state файла"""
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    # Формат: {"key1": timestamp1, "key2": timestamp2, ...}
                    return data
                elif isinstance(data, list):
                    # Старый формат: ["key1", "key2", ...] - конвертируем в dict
                    return {key: 0.0 for key in data}
        except Exception as e:
            logger.warning(f"Failed to load processed keys from {state_file}: {e}")
    return {}


def save_processed_keys(state_file: str, processed_keys: Dict[str, float], max_age_days: int = 30, max_keys: int = 5000):
    """Сохранение обработанных ключей с ограничением размера"""
    try:
        # Создаём папку если не существует
        state_dir = os.path.dirname(state_file)
        if state_dir:
            os.makedirs(state_dir, exist_ok=True)
        
        # Удаляем старые ключи (> max_age_days)
        current_time = time.time()
        max_age_seconds = max_age_days * 24 * 60 * 60
        filtered_keys = {
            key: timestamp
            for key, timestamp in processed_keys.items()
            if current_time - timestamp < max_age_seconds
        }
        
        # Ограничиваем количество ключей (оставляем последние max_keys)
        if len(filtered_keys) > max_keys:
            # Сортируем по timestamp и берём последние max_keys
            sorted_items = sorted(filtered_keys.items(), key=lambda x: x[1], reverse=True)
            filtered_keys = dict(sorted_items[:max_keys])
        
        # Сохраняем
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(filtered_keys, f, indent=2, ensure_ascii=False)
        
        logger.debug(f"Saved {len(filtered_keys)} processed keys to {state_file}")
    except PermissionError as e:
        logger.warning(f"Permission denied saving processed keys to {state_file}: {e}. Keys will not be persisted.")
    except Exception as e:
        logger.error(f"Failed to save processed keys: {e}")


def decode_filename(filename: Optional[str]) -> Optional[str]:
    """Декодирование имени файла из MIME заголовка"""
    if not filename:
        return None
    
    try:
        # Попытка декодирования MIME заголовка (может быть =?utf-8?B?...?=)
        decoded_parts = email.header.decode_header(filename)
        decoded_name = ''
        for part, encoding in decoded_parts:
            if isinstance(part, bytes):
                decoded_name += part.decode(encoding or 'utf-8', errors='replace')
            else:
                decoded_name += part
        return decoded_name
    except Exception as e:
        logger.warning(f"Failed to decode filename '{filename}': {e}, using as-is")
        return filename


def is_excel_file(filename: Optional[str], content_type: Optional[str] = None) -> bool:
    """Проверка, является ли файл Excel (по имени и/или content-type)"""
    if not filename:
        return False
    
    filename_lower = filename.lower()
    is_excel_by_name = filename_lower.endswith('.xlsx') or filename_lower.endswith('.xls')
    
    if is_excel_by_name:
        return True
    
    # Проверка по content-type (даже если имя файла не .xlsx/.xls)
    if content_type:
        content_type_lower = content_type.lower()
        excel_types = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/octet-stream',
        ]
        if any(ct in content_type_lower for ct in excel_types):
            return True
    
    return False


def has_valid_delay_column(df: pd.DataFrame) -> bool:
    """Проверка наличия обязательной колонки 'Опоздание, мин.'"""
    cols = find_columns(df)
    return 'delay' in cols


def detect_report_type(df: pd.DataFrame) -> str:
    """Определение типа отчёта по содержимому таблицы"""
    cols_lower = {str(c).lower(): c for c in df.columns}
    
    # Проверка на late-report: есть колонка "Опоздание"
    for col_lower in cols_lower:
        if 'опоздан' in col_lower:
            return 'late'
    
    # Проверка на docs-report: есть колонка "Причина некорректности ТТН" или "Срок ожидания документов по маршруту"
    for col_lower in cols_lower:
        if 'причина некорректности' in col_lower or 'срок ожидания документов' in col_lower:
            return 'docs'
    
    # По умолчанию - unknown
    return 'unknown'


def find_docs_header_row(file_data: bytes) -> int:
    """Определение строки заголовка для отчёта 'Отстающие документы'
    
    Ищет строку, где есть "ФИО водителя" и ("Гос. № а/м" или "Дата ТТН"/"Номер ТТН")
    """
    try:
        # Читаем первые 30 строк без заголовка для поиска
        df_preview = pd.read_excel(io.BytesIO(file_data), engine="openpyxl", header=None, nrows=30)
        
        # Ищем строку, где есть "ФИО водителя" и дополнительные маркеры
        for r in range(len(df_preview)):
            row_values = df_preview.iloc[r].astype(str).str.lower()
            row_str = ' '.join(row_values.values)
            
            # Проверяем наличие "ФИО водителя"
            has_fio = 'фио' in row_str and ('водител' in row_str or 'фио' in row_str)
            
            # Проверяем дополнительные маркеры
            has_marker = (
                ('гос' in row_str and ('№' in row_str or 'номер' in row_str) and ('а/м' in row_str or 'авто' in row_str)) or
                ('дата' in row_str and 'ттн' in row_str) or
                ('номер' in row_str and 'ттн' in row_str)
            )
            
            if has_fio and has_marker:
                logger.debug(f"Found docs header row {r}: ФИО водителя + маркер")
                return r
        
        # Если не найдено - возвращаем 0 (fallback)
        logger.warning("Docs header row not found in first 30 rows (ФИО водителя + маркер), using header=0")
        return 0
    except Exception as e:
        logger.warning(f"Failed to find docs header row: {e}, using header=0")
        return 0


def normalize_text_value(value) -> str:
    """Нормализация текстового значения: trim, замена \xa0, схлопывание пробелов"""
    if pd.isna(value) or value is None:
        return ''
    text = str(value)
    # Trim
    text = text.strip()
    # Замена \xa0 на пробел
    text = text.replace('\xa0', ' ')
    # Схлопывание двойных пробелов
    text = ' '.join(text.split())
    return text


def normalize_column_name(col_name: str) -> str:
    """Нормализация имени колонки: strip, lower, замена неразрывных пробелов, убрать лишние точки"""
    if pd.isna(col_name) or col_name is None:
        return ''
    text = str(col_name)
    # Trim
    text = text.strip()
    # Lower
    text = text.lower()
    # Замена \xa0 на пробел
    text = text.replace('\xa0', ' ')
    # Убрать лишние точки в конце
    text = text.rstrip('.')
    # Схлопывание двойных пробелов
    text = ' '.join(text.split())
    return text


def find_fio_column(df: pd.DataFrame) -> Optional[str]:
    """Поиск колонки ФИО водителя по синонимам
    
    Ищет колонку, которая содержит "фио" и ("водител" или просто "фио")
    """
    for col in df.columns:
        col_normalized = normalize_column_name(str(col))
        # Проверяем: содержит "фио" и ("водител" или просто "фио")
        if 'фио' in col_normalized:
            if 'водител' in col_normalized or col_normalized.strip() == 'фио':
                return col
    return None


def parse_docs_excel(file_data: bytes) -> pd.DataFrame:
    """Парсинг Excel файла отчёта 'Отстающие документы'"""
    try:
        # Определяем строку заголовка
        header_row = find_docs_header_row(file_data)
        logger.debug(f"Reading docs Excel with header={header_row}")
        
        # Читаем Excel с определенной строкой заголовка
        df = pd.read_excel(io.BytesIO(file_data), engine="openpyxl", header=header_row)
        
        # Удаляем полностью пустые строки
        df = df.dropna(how='all')
        
        # Нормализация имен колонок
        df.columns = [normalize_column_name(str(col)) for col in df.columns]
        # Переименовываем колонки для удобства (сохраняем оригинальные имена в mapping)
        col_mapping = {normalize_column_name(str(col)): col for col in df.columns}
        
        # Нормализация текстовых колонок
        for col in df.columns:
            if df[col].dtype == 'object':  # Строковые колонки
                df[col] = df[col].apply(normalize_text_value)
        
        # Обработка столбца "Срок ожидания документов по маршруту"
        # Убираем "0 часов, 0 минут, 0 секунд" и оставляем только дату
        def clean_waiting_period(value):
            """Убирает '0 часов, 0 минут, 0 секунд' и оставляет только дату"""
            if pd.isna(value) or value is None:
                return ''
            text = str(value)
            
            # Более агрессивная очистка: убираем все варианты "0 часов/минут/секунд"
            # Паттерны для удаления в любом порядке и комбинации:
            # "0 часов", "0 минут", "0 секунд", "0 ч", "0 мин", "0 сек"
            # Также возможны варианты: "0, 0, 0" или "00:00:00"
            
            # Убираем паттерны с запятыми и пробелами
            text = re.sub(r',?\s*0\s*(?:часов?|ч\.?)', '', text, flags=re.IGNORECASE)
            text = re.sub(r',?\s*0\s*(?:минут?|мин\.?)', '', text, flags=re.IGNORECASE)
            text = re.sub(r',?\s*0\s*(?:секунд?|сек\.?)', '', text, flags=re.IGNORECASE)
            
            # Убираем паттерны без запятых (в начале/конце)
            text = re.sub(r'0\s*(?:часов?|ч\.?)\s*,?', '', text, flags=re.IGNORECASE)
            text = re.sub(r'0\s*(?:минут?|мин\.?)\s*,?', '', text, flags=re.IGNORECASE)
            text = re.sub(r'0\s*(?:секунд?|сек\.?)', '', text, flags=re.IGNORECASE)
            
            # Убираем паттерны вида "00:00:00" или "0:0:0"
            text = re.sub(r'\s*0+:0+:0+\s*', '', text)
            
            # Убираем последовательности "0, 0, 0" или "0 0 0"
            text = re.sub(r'\s*0\s*,\s*0\s*,\s*0\s*', '', text)
            text = re.sub(r'\s*0\s+0\s+0\s*', '', text)
            
            # Убираем лишние запятые и пробелы
            text = re.sub(r',\s*,+', ',', text)  # Двойные запятые
            text = re.sub(r'^,\s*', '', text)  # Запятая в начале
            text = re.sub(r'\s*,\s*$', '', text)  # Запятая в конце
            text = re.sub(r'\s+', ' ', text)  # Множественные пробелы
            
            return text.strip()
        
        for col in df.columns:
            col_norm = normalize_column_name(str(col))
            if 'срок ожидания документов' in col_norm:
                df[col] = df[col].apply(clean_waiting_period)
        
        # Приведение дат к строковому виду (YYYY-MM-DD)
        # Ищем колонки с датами по нормализованным именам
        for col in df.columns:
            col_norm = normalize_column_name(str(col))
            if 'дата' in col_norm and ('ттн' in col_norm or 'маршрут' in col_norm):
                df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d').fillna('')
        
        # Приведение номеров к int (если целое число)
        for col in df.columns:
            col_norm = normalize_column_name(str(col))
            if ('номер' in col_norm and 'ттн' in col_norm) or ('№' in col_norm and 'маршрут' in col_norm):
                # Пробуем привести к int, если не получается - оставляем как есть
                df[col] = pd.to_numeric(df[col], errors='coerce')
                df[col] = df[col].apply(lambda x: int(x) if pd.notna(x) and x == int(x) else x)
                # Убираем ".0" из конца чисел (например, "123.0" -> "123")
                df[col] = df[col].astype(str).replace('nan', '').replace('<NA>', '').str.replace(r'\.0+$', '', regex=True)
        
        logger.debug(f"Docs Excel parsed successfully, rows: {len(df)}, columns: {list(df.columns)}")
        return df
    except Exception as e:
        logger.error(f"Failed to parse docs Excel: {e}")
        import traceback
        traceback.print_exc()
        raise


def detect_report_type(df: pd.DataFrame) -> str:
    """Определение типа отчёта по содержимому таблицы"""
    cols_lower = {str(c).lower(): c for c in df.columns}
    
    # Проверка на late-report: есть колонка "Опоздание"
    for col_lower in cols_lower:
        if 'опоздан' in col_lower:
            return 'late'
    
    # Проверка на docs-report: есть колонка "Причина некорректности ТТН" или "Срок ожидания документов по маршруту"
    for col_lower in cols_lower:
        if 'причина некорректности' in col_lower and 'ттн' in col_lower:
            return 'docs'
        if 'срок ожидания документов' in col_lower:
            return 'docs'
    
    return 'unknown'


# Alias для обратной совместимости
determine_report_type = detect_report_type




def get_email_attachments(config: Dict) -> List[Tuple[int, int, str, bytes]]:
    """Получение XLSX вложений из писем за последние lookback дней
    
    Returns:
        List[Tuple[uid, attachment_index, filename, file_data]]
    """
    if not config['imap_user'] or not config['imap_pass']:
        logger.error("IMAP credentials not set")
        return []
    
    attachments = []
    attachment_pattern = None
    # Применяем regex-фильтр только если он задан и не пустой
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
            
            # Поиск писем за последние lookback дней
            # Используем московское время для определения "сегодня"
            # Это важно, т.к. DOCS письма приходят около 01:00 МСК, но INTERNALDATE = вчера по UTC
            lookback_days = config.get('imap_lookback_days', 3)
            report_tz = config.get('report_tz', 'Europe/Moscow')
            max_uids = config.get('imap_max_uids', 500)
            
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
            
            attachment_index = 0
            for uid in messages:
                try:
                    # Получаем INTERNALDATE для логирования
                    fetch_data = client.fetch([uid], ['RFC822', 'INTERNALDATE'])
                    msg_data = fetch_data[uid]
                    internaldate = msg_data.get(b'INTERNALDATE', b'unknown')
                    if isinstance(internaldate, bytes):
                        internaldate_str = internaldate.decode('utf-8', errors='replace')
                    else:
                        internaldate_str = str(internaldate)
                    
                    msg = email.message_from_bytes(msg_data[b'RFC822'])
                    
                    for part in msg.walk():
                        # Проверяем наличие filename в Content-Disposition (attachment или inline)
                        content_disposition = part.get_content_disposition()
                        filename_raw = part.get_filename()
                        content_type = part.get_content_type()
                        
                        # Декодируем имя файла (может быть в MIME формате)
                        filename = decode_filename(filename_raw)
                        
                        # Принимаем любую часть с filename, даже если content-disposition не "attachment"
                        # (inline тоже может содержать вложение)
                        if filename:
                            # Проверяем, является ли файл Excel
                            if is_excel_file(filename, content_type):
                                # Проверяем regex-фильтр (если задан и filename нормально декодирован)
                                should_include = True
                                if attachment_pattern:
                                    # Проверяем, нет ли слишком много кракозябр (символов замены или нечитаемых)
                                    # Если имя файла содержит много замены ошибки или нечитаемых символов - пропускаем regex
                                    has_encoding_issues = filename and ('' in filename or filename_raw != filename)
                                    if not has_encoding_issues:
                                        if not attachment_pattern.search(filename):
                                            should_include = False
                                            logger.debug(f"Attachment {filename} (UID {uid}) filtered out by regex")
                                    else:
                                        # Если кракозябры - пропускаем regex-проверку, но включаем файл
                                        logger.info(f"Attachment filename contains encoding issues, skipping regex filter: {filename[:50]}")
                                
                                if should_include:
                                    try:
                                        file_data = part.get_payload(decode=True)
                                        if file_data:
                                            attachments.append((uid, attachment_index, filename or f"mail_{uid}.xlsx", file_data))
                                            logger.debug(f"Found Excel attachment: UID {uid}, INTERNALDATE {internaldate_str}, filename={filename[:50] if filename else 'N/A'}, index {attachment_index}, content-type: {content_type}")
                                            attachment_index += 1
                                    except Exception as e:
                                        logger.error(f"Failed to decode attachment {filename} (UID {uid}): {e}")
                except Exception as e:
                    logger.error(f"Error processing message {uid}: {e}")
    
    except Exception as e:
        logger.error(f"IMAP error: {e}")
        import traceback
        traceback.print_exc()
    
    return attachments


def normalize_column_name(name: str) -> str:
    """Нормализация имени колонки для поиска"""
    if not name or pd.isna(name):
        return ''
    name_str = str(name)
    # Lowercase
    name_str = name_str.lower()
    # Strip whitespace
    name_str = name_str.strip()
    # Replace NBSP (\xa0) with space
    name_str = name_str.replace('\xa0', ' ')
    # Replace multiple spaces with single space
    name_str = ' '.join(name_str.split())
    return name_str


# Alias для обратной совместимости
find_header_rows_docs = find_docs_header_row


def find_header_rows(file_data: bytes) -> int:
    """Определение строк заголовков в Excel файле"""
    try:
        # Читаем первые 10 строк без заголовка для поиска
        df_preview = pd.read_excel(io.BytesIO(file_data), engine="openpyxl", header=None, nrows=10)
        
        # Ищем первую строку r, где есть ячейка с подстрокой "опоздан"
        for r in range(len(df_preview)):
            row_values = df_preview.iloc[r].astype(str).str.lower()
            if any('опоздан' in str(val) for val in row_values):
                logger.debug(f"Found 'опоздан' in row {r}")
                
                # Проверяем следующую строку r+1 (если существует)
                if r + 1 < len(df_preview):
                    next_row_values = df_preview.iloc[r + 1].astype(str)
                    # Считаем непустые значения (не NaN, не '', не 'nan')
                    non_empty_count = sum(1 for val in next_row_values if str(val).strip() and str(val).lower() != 'nan')
                    
                    if non_empty_count >= 3:
                        logger.debug(f"Row {r+1} has {non_empty_count} non-empty values, using header=[{r}, {r+1}]")
                        return r
                    else:
                        logger.debug(f"Row {r+1} has only {non_empty_count} non-empty values, using header={r}")
                        return r
                else:
                    logger.debug(f"No row {r+1}, using header={r}")
                    return r
        
        # Если не найдено - возвращаем 0 (fallback)
        logger.warning("'опоздан' not found in first 10 rows, using header=0")
        return 0
    except Exception as e:
        logger.warning(f"Failed to find header rows: {e}, using header=0")
        return 0


def parse_excel(file_data: bytes) -> pd.DataFrame:
    """Парсинг Excel файла с автоматическим определением строк заголовков"""
    try:
        # Определяем строки заголовков автоматически
        header_row = find_header_rows(file_data)
        
        # Проверяем, нужна ли вторая строка заголовка
        df_preview = pd.read_excel(io.BytesIO(file_data), engine="openpyxl", header=None, nrows=header_row + 2)
        if header_row + 1 < len(df_preview):
            next_row_values = df_preview.iloc[header_row + 1].astype(str)
            non_empty_count = sum(1 for val in next_row_values if str(val).strip() and str(val).lower() != 'nan')
            
            if non_empty_count >= 3:
                header = [header_row, header_row + 1]
            else:
                header = header_row
        else:
            header = header_row
        
        logger.debug(f"Reading Excel with header={header}")
        
        # Читаем Excel с определенными строками заголовков
        df = pd.read_excel(io.BytesIO(file_data), engine="openpyxl", header=header)
        
        # Сплющивание многоуровневой шапки
        if isinstance(df.columns, pd.MultiIndex):
            # Forward fill по верхнему уровню для merged ячеек (NaN/Unnamed)
            columns_df = pd.DataFrame(list(df.columns))
            columns_df[0] = columns_df[0].replace('', pd.NA).ffill()
            
            # Обновляем MultiIndex с заполненными значениями
            new_columns = list(zip(columns_df[0], columns_df[1]))
            df.columns = pd.MultiIndex.from_tuples(new_columns)
            
            # Flatten колонок
            flattened_columns = []
            for col_tuple in df.columns:
                lvl0 = str(col_tuple[0]) if pd.notna(col_tuple[0]) else ''
                lvl1 = str(col_tuple[1]) if pd.notna(col_tuple[1]) else ''
                
                lvl0 = lvl0.strip()
                lvl1 = lvl1.strip()
                
                # Правила flatten:
                # - если lvl1 пустой/NaN/Unnamed -> col = lvl0
                # - elif lvl0 пустой -> col = lvl1
                # - else col = f"{lvl0} - {lvl1}"
                if not lvl1 or lvl1 == '' or lvl1.lower().startswith('unnamed'):
                    flattened_columns.append(lvl0)
                elif not lvl0 or lvl0 == '':
                    flattened_columns.append(lvl1)
                else:
                    flattened_columns.append(f"{lvl0} - {lvl1}")
            
            df.columns = flattened_columns
        
        # Очистка имен колонок (strip whitespace)
        df.columns = [str(c).strip() for c in df.columns]
        
        # Сохраняем file_data и header в атрибутах DataFrame для логирования
        df.attrs['_file_data'] = file_data
        df.attrs['_header_rows'] = header if isinstance(header, list) else [header]
        
        logger.debug(f"Excel parsed successfully with header={header}, columns: {list(df.columns)[:10]}...")
        return df
    except Exception as e:
        logger.error(f"Failed to parse Excel: {e}")
        import traceback
        traceback.print_exc()
        raise


def find_columns(df: pd.DataFrame) -> Dict[str, str]:
    """Поиск нужных колонок по нормализованным подстрокам"""
    cols_map = {}
    
    # Нормализуем все имена колонок
    normalized_cols = {normalize_column_name(str(c)): str(c) for c in df.columns}
    
    # Поиск delay колонки (обязательная): содержит "опоздан"
    for col_norm, col_orig in normalized_cols.items():
        if 'опоздан' in col_norm:
            cols_map['delay'] = col_orig
            logger.debug(f"Found delay column: '{col_orig}' (normalized: '{col_norm}')")
            break
    
    # Поиск FIO колонки: содержит "фио"
    for col_norm, col_orig in normalized_cols.items():
        if 'фио' in col_norm:
            cols_map['driver_name'] = col_orig
            break
    
    # Поиск госномера: содержит "гос"
    for col_norm, col_orig in normalized_cols.items():
        if 'гос' in col_norm:
            cols_map['plate'] = col_orig
            break
    
    # Поиск названия маршрута (должно содержать "типовой" И "наимен")
    for col_norm, col_orig in normalized_cols.items():
        if 'типовой' in col_norm and 'наимен' in col_norm:
            cols_map['route_name'] = col_orig
            break
    
    # Поиск планового времени (должно содержать "планов" И "подач")
    for col_norm, col_orig in normalized_cols.items():
        if 'планов' in col_norm and 'подач' in col_norm:
            cols_map['planned_time'] = col_orig
            break
    
    # Поиск фактического времени назначения: содержит "время назначения"
    for col_norm, col_orig in normalized_cols.items():
        if 'время назначения' in col_norm:
            cols_map['assigned_time'] = col_orig
            break
    
    # Если delay колонка не найдена - логируем все колонки и первые строки raw
    if 'delay' not in cols_map:
        header_rows = df.attrs.get('_header_rows', 'unknown')
        logger.warning(f"Delay column not found. Header rows: {header_rows}, Columns after flatten: {list(df.columns)}")
        logger.warning(f"Normalized columns: {list(normalized_cols.keys())}")
        
        # Логируем первые 5 строк raw для отладки
        try:
            file_data = df.attrs.get('_file_data', None)
            if file_data is None:
                # Если file_data недоступен, пробуем прочитать из глобального контекста
                logger.warning("Cannot access raw file data for logging")
            else:
                df_preview = pd.read_excel(io.BytesIO(file_data), engine="openpyxl", header=None, nrows=5)
                logger.warning(f"First 5 raw rows:\n{df_preview.head().to_string()}")
        except Exception as e:
            logger.warning(f"Failed to log raw rows: {e}")
    
    return cols_map


def extract_late_records(df: pd.DataFrame) -> List[Dict]:
    """Извлечение записей с опозданиями"""
    cols = find_columns(df)
    
    if 'delay' not in cols:
        logger.error("Delay column not found")
        return []
    
    # Приведение типа для delay колонки
    delay_series = pd.to_numeric(df[cols['delay']], errors="coerce").fillna(0).astype(int)
    
    # Фильтрация опоздавших (delay > 0)
    df_filtered = df[delay_series > 0].copy()
    
    if len(df_filtered) == 0:
        logger.info("No late records found (all delays <= 0)")
        return []
    
    records = []
    for _, row in df_filtered.iterrows():
        delay = int(pd.to_numeric(row[cols['delay']], errors="coerce") or 0)
        if delay <= 0:
            continue
        
        record = {
            'delay_minutes': delay,
            'driver_name': str(row.get(cols.get('driver_name', ''), '—')).strip() if cols.get('driver_name') else '—',
            'plate_number': str(row.get(cols.get('plate', ''), '—')).strip() if cols.get('plate') else '—',
            'route_name': str(row.get(cols.get('route_name', ''), '—')).strip() if cols.get('route_name') else '—',
            'planned_time': str(row.get(cols.get('planned_time', ''), '—')).strip() if cols.get('planned_time') else '—',
            'assigned_time': str(row.get(cols.get('assigned_time', ''), '—')).strip() if cols.get('assigned_time') else '—',
        }
        records.append(record)
    
    # Сортировка по опозданию по убыванию
    records.sort(key=lambda x: x['delay_minutes'], reverse=True)
    
    logger.info(f"Extracted {len(records)} late records from Excel")
    return records


def get_delay_emoji(delay: int) -> str:
    """Получение эмодзи для опоздания"""
    if delay >= 21:
        return '🔴'
    elif delay >= 11:
        return '🟡'
    else:
        return '🟢'


def generate_png_table_docs(df: pd.DataFrame, output_path: str):
    """Генерация PNG таблицы для docs-report (отстающие документы)"""
    if len(df) == 0:
        return False
    
    # Убираем ненужные колонки
    columns_to_remove = []
    for col in df.columns:
        col_lower = normalize_column_name(str(col))
        # Убираем: "Площадка", "Номер маршрута", "Гос. № а/м", "Дата маршрута"
        if any(word in col_lower for word in ['площадк', 'номер маршрут', 'гос', '№ а/м', 'госномер']):
            if 'номер' in col_lower or '№' in col_lower:
                columns_to_remove.append(col)
            elif 'площадк' in col_lower or ('гос' in col_lower and '№' in col_lower):
                columns_to_remove.append(col)
        # Убираем "Дата маршрута" (но не "Дата ТТН")
        elif 'дата' in col_lower and 'маршрут' in col_lower and 'ттн' not in col_lower:
            columns_to_remove.append(col)
        # Убираем "Номер маршрута" / "№ маршрута" (но не "Наименование маршрута")
        elif ('номер' in col_lower or '№' in col_lower) and 'маршрут' in col_lower and 'наименован' not in col_lower:
            columns_to_remove.append(col)
    
    if columns_to_remove:
        df = df.drop(columns=columns_to_remove, errors='ignore')
        logger.info(f"Removed columns from docs-report: {columns_to_remove}")
    
    if len(df.columns) == 0:
        logger.warning("No columns left after filtering")
        return False
    
    # Параметры таблицы (как в late-report для единообразия)
    cell_padding = 10  # Как в generate_png_table
    row_height = 50  # Как в generate_png_table
    header_height = 50  # Как в generate_png_table
    font_size = 11  # Увеличен на 1 для лучшей читаемости
    
    # Определяем ширины колонок динамически
    # Узкие колонки (даты, номера): 120-150
    # Средние колонки (ФИО, компания): 200-250
    # Широкие колонки (пункт назначения, причина): 300-400
    num_cols = len(df.columns)
    col_widths = []
    
    for col in df.columns:
        col_lower = normalize_column_name(str(col))
        # Очень узкие колонки (коды, даты)
        if any(word in col_lower for word in ['код получател', 'код']):
            col_widths.append(90)  # Узкая колонка для кода
        # Узкие колонки (даты, номера)
        elif any(word in col_lower for word in ['дата', 'ттн']):
            col_widths.append(110)
        # Средние колонки (ФИО водителя - немного поуже)
        elif any(word in col_lower for word in ['фио', 'водител']):
            col_widths.append(160)  # Было 170, стало 160 (еще поуже)
        # Узкие колонки (срок ожидания документов - узкая)
        elif any(word in col_lower for word in ['срок ожидания документов']):
            col_widths.append(140)  # Узкая колонка для "Срок ожидания документов"
        # Средние-широкие колонки (компания получателя)
        elif any(word in col_lower for word in ['компани', 'получател']):
            col_widths.append(200)
        # Широкие колонки (пункт назначения, причина - больше места)
        elif any(word in col_lower for word in ['пункт назначен']):
            col_widths.append(300)  # Было 280, стало 300 (больше места)
        # Очень широкие колонки (причина некорректности ТТН - больше места)
        elif any(word in col_lower for word in ['причина']):
            col_widths.append(320)  # Было 300, стало 320 (еще больше места)
        # Очень широкие (адреса, наименования)
        elif any(word in col_lower for word in ['адрес', 'наименован']):
            col_widths.append(340)  # Было 320, стало 340 (больше места)
        # По умолчанию - средняя ширина
        else:
            col_widths.append(180)
    
    # Нормализуем ширины, чтобы сумма была ~1200 (как в late-report)
    total_width = sum(col_widths)
    target_width = 1200
    if total_width > target_width:
        scale = target_width / total_width
        col_widths = [int(w * scale) for w in col_widths]
    elif total_width < 800:
        # Если слишком узко, увеличиваем
        scale = 800 / total_width
        col_widths = [int(w * scale) for w in col_widths]
    
    table_width = sum(col_widths) + (num_cols + 1) * 2  # + отступы
    
    num_rows = len(df) + 1  # +1 для заголовка
    table_height = header_height + num_rows * row_height
    
    # Создание изображения
    img = Image.new('RGB', (table_width, table_height), color='white')
    draw = ImageDraw.Draw(img)
    
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
        font_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()
        font_bold = font
    
    # Заголовки
    headers = list(df.columns)
    
    x = 2
    y = 2
    
    # Рисование заголовка
    for i, header in enumerate(headers):
        col_w = col_widths[i]
        cell_rect = [x, y, x + col_w, y + header_height]
        draw.rectangle(cell_rect, outline='black', width=2)
        draw.rectangle([cell_rect[0]+1, cell_rect[1]+1, cell_rect[2]-1, cell_rect[3]-1], fill='#f0f0f0')
        
        # Текст заголовка с переносами (wrap для длинных заголовков)
        header_text = str(header)
        col_lower = normalize_column_name(str(header))
        
        # Для "Код получателя" - принудительный перенос в две строки
        if 'код получател' in col_lower:
            # Разбиваем "Код получателя" на две строки
            words = header_text.split()
            if len(words) >= 2:
                # Разделяем на "Код" и "получателя"
                wrapped_lines = [words[0], ' '.join(words[1:])]
            else:
                # Если одно слово, просто переносим пополам
                mid = len(header_text) // 2
                wrapped_lines = [header_text[:mid], header_text[mid:]]
        # Для "Срок ожидания документов по маршруту" - принудительный перенос в три строки
        elif 'срок ожидания документов' in col_lower:
            # Разбиваем "Срок ожидания документов по маршруту" на три строки
            words = header_text.split()
            if len(words) >= 3:
                # Разделяем на "Срок ожидания", "документов по", "маршруту"
                if len(words) == 6:  # "Срок ожидания документов по маршруту"
                    wrapped_lines = ['Срок ожидания', 'документов по', 'маршруту']
                elif len(words) == 5:  # "Срок ожидания документов по маршруту" (вариант)
                    wrapped_lines = ['Срок ожидания', 'документов по', 'маршруту']
                else:
                    # Общий случай: делим на 3 части
                    part_size = len(words) // 3
                    wrapped_lines = [
                        ' '.join(words[:part_size]),
                        ' '.join(words[part_size:2*part_size]),
                        ' '.join(words[2*part_size:])
                    ]
            else:
                # Если мало слов, разбиваем по символам
                part_size = len(header_text) // 3
                wrapped_lines = [header_text[:part_size], header_text[part_size:2*part_size], header_text[2*part_size:]]
        else:
            # Компактный перенос для остальных заголовков
            wrap_width = max(12, col_w // 7)  # Адаптивная ширина переноса
            wrapped_lines = textwrap.wrap(header_text, width=wrap_width)
        
        text_y = cell_rect[1] + cell_padding
        line_spacing = 11  # Компактный интервал между строками
        for line in wrapped_lines[:3]:  # Максимум 3 строки для заголовка
            draw.text((cell_rect[0] + cell_padding, text_y), line, fill='black', font=font_bold)
            text_y += line_spacing
        
        x += col_w + 2
    
    # Находим колонку "Срок ожидания документов" для подсветки строк
    waiting_period_col = None
    for col in df.columns:
        col_norm = normalize_column_name(str(col))
        if 'срок ожидания документов' in col_norm:
            waiting_period_col = col
    
    # Получаем сегодняшнюю дату по московскому времени
    today_msk = datetime.now(ZoneInfo('Europe/Moscow')).date()
    
    # Функция для вычисления разницы в днях между "Срок ожидания документов" и сегодняшней датой
    def calculate_days_diff(row):
        """Вычисляет разницу в днях между 'Срок ожидания документов' и сегодняшней датой (МСК)"""
        if not waiting_period_col:
            return None
        
        waiting_date_str = str(row.get(waiting_period_col, '')) if pd.notna(row.get(waiting_period_col)) else ''
        
        if not waiting_date_str:
            return None
        
        try:
            # Пробуем распарсить дату в разных форматах
            # Сначала пробуем без dayfirst (для YYYY-MM-DD), потом с dayfirst (для DD.MM.YYYY)
            waiting_date = pd.to_datetime(waiting_date_str, errors='coerce', dayfirst=False)
            if pd.isna(waiting_date):
                waiting_date = pd.to_datetime(waiting_date_str, errors='coerce', dayfirst=True)
            
            if pd.isna(waiting_date):
                return None
            
            # Преобразуем в date для сравнения
            waiting_date_only = waiting_date.date()
            
            # Разница в днях (waiting_date - today_msk)
            # Если waiting_date в будущем, разница положительная
            # Если waiting_date в прошлом, разница отрицательная
            diff = (waiting_date_only - today_msk).days
            return diff
        except:
            return None
    
    # Данные
    y = header_height + 2
    for idx, row in df.iterrows():
        x = 2
        
        # Вычисляем разницу в днях для текущей строки
        days_diff = calculate_days_diff(row)
        
        # Определяем цвет фона строки (более насыщенные цвета)
        # Подсветка: < 2 дней → красная, 2-4 дня → оранжевая, >= 4 дней → белая
        if days_diff is not None:
            if days_diff >= 0 and days_diff < 2:
                row_bg_color = '#ff8888'  # Чуть краснее (< 2 дней)
            elif days_diff >= 2 and days_diff < 4:
                row_bg_color = '#ffd4aa'  # Чуть побледнее (2-4 дня)
            else:
                row_bg_color = '#ffffff'  # Белый (>= 4 дней или отрицательная разница)
        else:
            row_bg_color = '#ffffff'  # Белый (нет дат или не распознаны)
        
        for i, col_name in enumerate(headers):
            col_w = col_widths[i]
            cell_rect = [x, y, x + col_w, y + row_height]
            draw.rectangle(cell_rect, outline='black', width=1)
            
            # Заливаем фон ячейки цветом строки
            draw.rectangle([cell_rect[0]+1, cell_rect[1]+1, cell_rect[2]-1, cell_rect[3]-1], fill=row_bg_color)
            
            # Получаем значение ячейки
            cell_value = str(row[col_name]) if pd.notna(row[col_name]) else ''
            
            # Определяем ширину переноса в зависимости от ширины колонки (компактный режим)
            col_lower = normalize_column_name(str(col_name))
            if any(word in col_lower for word in ['пункт назначен', 'адрес', 'причина', 'наименован', 'компани']):
                wrap_width = max(16, col_w // 9)  # Широкие колонки - компактный перенос
            elif any(word in col_lower for word in ['фио', 'водител']):
                wrap_width = max(14, col_w // 8)  # Средние колонки
            else:
                wrap_width = max(12, col_w // 7)  # Узкие колонки
            
            # Используем textwrap с break_long_words=False, чтобы слова не разбивались посередине
            wrapped_lines = textwrap.wrap(cell_value, width=wrap_width, break_long_words=False, break_on_hyphens=False)
            
            if not wrapped_lines:
                wrapped_lines = ['']
            
            # Вертикальное центрирование с компактным интервалом
            line_height = 11  # Компактный интервал между строками
            total_text_height = len(wrapped_lines) * line_height + (len(wrapped_lines) - 1) * 1
            text_y_start = cell_rect[1] + (row_height - total_text_height) // 2
            
            # Ограничиваем длину строки в зависимости от ширины колонки
            max_chars = min(45, col_w // 6)
            for line in wrapped_lines[:4]:  # Максимум 4 строки для компактности
                line_text = line[:max_chars] if len(line) > max_chars else line
                draw.text((cell_rect[0] + cell_padding, text_y_start), line_text, fill='black', font=font)
                text_y_start += line_height
            
            x += col_w + 2
        
        y += row_height
    
    img.save(output_path)
    logger.info(f"Generated docs-report PNG table: {output_path}")
    return True


def generate_png_table(records: List[Dict], output_path: str):
    """Генерация PNG таблицы с опоздавшими"""
    if not records:
        return False
    
    # Параметры таблицы
    cell_padding = 10
    row_height = 50  # Увеличено с 40 для лучшего размещения многострочного текста
    # Ширины колонок: увеличена 3-я колонка "Время назначения..." с 150 до 180
    col_widths = [250, 150, 180, 100, 200, 120]  # Ширины колонок
    header_height = 50
    
    num_rows = len(records) + 1  # +1 для заголовка
    table_width = sum(col_widths) + (len(col_widths) + 1) * 2  # +границы
    table_height = header_height + num_rows * row_height
    
    # Создание изображения
    img = Image.new('RGB', (table_width, table_height), color='white')
    draw = ImageDraw.Draw(img)
    
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
        font_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 12)
    except:
        font = ImageFont.load_default()
        font_bold = font
    
    # Заголовки
    headers = ['Наименование маршрута', 'Плановое время подачи', 'Время назначения а/м на маршрут (факт)', 
               'Опоздание, мин.', 'ФИО водителя', 'Гос. №']
    
    x = 2
    y = 2
    
    # Рисование заголовка
    for i, header in enumerate(headers):
        cell_rect = [x, y, x + col_widths[i], y + header_height]
        draw.rectangle(cell_rect, outline='black', width=2)
        draw.rectangle([cell_rect[0]+1, cell_rect[1]+1, cell_rect[2]-1, cell_rect[3]-1], fill='#f0f0f0')
        
        # Текст заголовка с переносами
        words = header.split()
        text_lines = []
        current_line = []
        for word in words:
            test_line = ' '.join(current_line + [word])
            bbox = draw.textbbox((0, 0), test_line, font=font_bold)
            if bbox[2] - bbox[0] <= col_widths[i] - 2 * cell_padding:
                current_line.append(word)
            else:
                if current_line:
                    text_lines.append(' '.join(current_line))
                current_line = [word]
        if current_line:
            text_lines.append(' '.join(current_line))
        
        text_y = cell_rect[1] + cell_padding
        for line in text_lines[:3]:  # Максимум 3 строки
            draw.text((cell_rect[0] + cell_padding, text_y), line, fill='black', font=font_bold)
            text_y += 15
        
        x += col_widths[i] + 2
    
    # Данные
    y = header_height + 2
    for record in records:
        x = 2
        row_data = [
            record['route_name'],
            record['planned_time'],
            record['assigned_time'],
            str(record['delay_minutes']),
            record['driver_name'],
            record['plate_number'],
        ]
        
        for i, cell_text in enumerate(row_data):
            cell_rect = [x, y, x + col_widths[i], y + row_height]
            draw.rectangle(cell_rect, outline='black', width=1)
            
            # Обрезка текста если слишком длинный
            text = str(cell_text)[:40] + ('...' if len(str(cell_text)) > 40 else '')
            
            # Вычисляем высоту текста для вертикального центрирования
            text_bbox = draw.textbbox((0, 0), text, font=font)
            text_height = text_bbox[3] - text_bbox[1]
            text_width = text_bbox[2] - text_bbox[0]
            
            # Если текст содержит перенос строки - обрабатываем многострочно
            if '\n' in text:
                lines = text.split('\n')
                line_height = text_height
                total_text_height = len(lines) * line_height + (len(lines) - 1) * 5  # + межстрочный интервал
                text_y_start = cell_rect[1] + (row_height - total_text_height) // 2
                for line in lines:
                    if i == 0:  # Первая колонка "Наименование маршрута" - выравнивание по левому краю
                        text_x = cell_rect[0] + cell_padding
                    elif i == 2:  # 3-я колонка "Время назначения..." - центрирование
                        line_bbox = draw.textbbox((0, 0), line, font=font)
                        line_width = line_bbox[2] - line_bbox[0]
                        text_x = cell_rect[0] + (col_widths[i] - line_width) // 2
                    else:  # Остальные колонки - выравнивание по центру для чисел
                        line_bbox = draw.textbbox((0, 0), line, font=font)
                        line_width = line_bbox[2] - line_bbox[0]
                        text_x = cell_rect[0] + (col_widths[i] - line_width) // 2
                    draw.text((text_x, text_y_start), line, fill='black', font=font)
                    text_y_start += line_height + 5
            else:
                # Однострочный текст - центрирование по вертикали и горизонтали
                cell_height = row_height
                text_y = cell_rect[1] + (cell_height - text_height) // 2
                
                if i == 0:  # Первая колонка "Наименование маршрута" - выравнивание по левому краю
                    text_x = cell_rect[0] + cell_padding
                else:  # Остальные колонки - центрирование по горизонтали
                    text_x = cell_rect[0] + (col_widths[i] - text_width) // 2
                
                draw.text((text_x, text_y), text, fill='black', font=font)
            
            x += col_widths[i] + 2
        
        y += row_height
    
    img.save(output_path)
    logger.info(f"Generated PNG table: {output_path}")
    return True


def send_telegram_photo(config: Dict, photo_path: str, caption: str, topic_id: Optional[int] = None):
    """Отправка фото в Telegram в указанную тему"""
    if not config['tg_token'] or not config['tg_chat_id']:
        logger.error("Telegram credentials not set")
        return False
    
    # Используем переданный topic_id или дефолтный из конфига
    if topic_id is None:
        topic_id = config.get('tg_topic_id_late') or config.get('tg_topic_id')
    
    if config.get('dry_run', False):
        logger.info(f"[DRY_RUN] Would send photo to Telegram: chat {config['tg_chat_id']}, topic {topic_id}, caption length: {len(caption)}")
        return True
    
    url = f"https://api.telegram.org/bot{config['tg_token']}/sendPhoto"
    
    data = {
        'chat_id': config['tg_chat_id'],
        'caption': caption[:1024],  # Ограничение длины
    }
    
    if topic_id:
        data['message_thread_id'] = int(topic_id)
    
    try:
        with open(photo_path, 'rb') as photo:
            files = {'photo': photo}
            response = requests.post(url, data=data, files=files, timeout=30)
            response.raise_for_status()
            logger.info(f"Photo sent successfully to topic {topic_id}")
            return True
    except Exception as e:
        logger.error(f"Failed to send photo: {e}")
        return False


def send_telegram_text(config: Dict, text: str):
    """Отправка текста в Telegram"""
    if not config['tg_token'] or not config['tg_chat_id']:
        return False
    
    if config.get('dry_run', False):
        logger.info(f"[DRY_RUN] Would send text to Telegram: {text[:100]}...")
        return True
    
    url = f"https://api.telegram.org/bot{config['tg_token']}/sendMessage"
    
    data = {
        'chat_id': config['tg_chat_id'],
        'text': text[:4096],
    }
    
    if config['tg_topic_id']:
        data['message_thread_id'] = int(config['tg_topic_id'])
    
    try:
        response = requests.post(url, json=data, timeout=30)
        response.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Failed to send text: {e}")
        return False


def send_telegram_message(config: Dict, text: str, topic_id: Optional[int] = None):
    """Отправка текстового сообщения в Telegram в указанную тему"""
    if not config['tg_token'] or not config['tg_chat_id']:
        logger.error("Telegram credentials not set")
        return False
    
    if config.get('dry_run', False):
        logger.info(f"[DRY_RUN] Would send message to Telegram: topic {topic_id}, text: {text[:100]}...")
        return True
    
    url = f"https://api.telegram.org/bot{config['tg_token']}/sendMessage"
    
    data = {
        'chat_id': config['tg_chat_id'],
        'text': text[:4096],
    }
    
    if topic_id:
        data['message_thread_id'] = int(topic_id)
    
    try:
        response = requests.post(url, json=data, timeout=30)
        response.raise_for_status()
        logger.info(f"Message sent successfully to topic {topic_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        return False


def format_caption(records: List[Dict]) -> str:
    """Формирование подписи с опоздавшими"""
    lines = []
    for record in records:
        emoji = get_delay_emoji(record['delay_minutes'])
        # Формат: "🟡 Кобилов Ш.А. — 16" (без "+" и "мин", пробел после эмодзи)
        line = f"{emoji} {record['driver_name']} — {record['delay_minutes']}"
        lines.append(line)
    
    caption = '\n'.join(lines)
    if len(caption) > 1024:
        # Обрезаем до 1020 символов, чтобы влезло "..." 
        caption = caption[:1020] + '...'
    
    return caption


def mark_email_seen(config: Dict, uid: int):
    """Пометить письмо как прочитанное"""
    try:
        with IMAPClient(config['imap_host'], port=993, ssl=True) as client:
            client.login(config['imap_user'], config['imap_pass'])
            client.select_folder('INBOX')
            client.set_flags([uid], [b'\\Seen'])
            logger.info(f"Marked message {uid} as seen")
    except Exception as e:
        logger.error(f"Failed to mark message as seen: {e}")


def get_file_hash(file_data: bytes) -> str:
    """Получение хеша файла для предотвращения дублей"""
    return hashlib.sha256(file_data).hexdigest()


def process_docs_report(config: Dict, attachments: List[Tuple[int, int, str, bytes]], processed_keys: Dict[str, float]) -> None:
    """Обработка docs-report (отстающие документы)"""
    if not config['run_docs_report']:
        logger.info("Docs-report disabled (RUN_DOCS_REPORT=0)")
        return
    
    logger.info("Processing docs-report (отстающие документы)")
    
    all_docs_dfs = []
    
    for uid, att_index, filename, file_data in attachments:
        # Генерируем ключ для вложения
        file_hash = hashlib.sha256(file_data).hexdigest()
        attachment_key = f"{uid}:{att_index}:{file_hash}"
        
        try:
            # Парсинг Excel для docs-report
            df = parse_docs_excel(file_data)
            
            # Определение типа отчёта
            report_type = detect_report_type(df)
            
            if report_type != 'docs':
                logger.debug(f"File {filename} (UID {uid}) is not docs-report, skipping")
                continue
            
            # Поиск колонки ФИО водителя
            fio_col = find_fio_column(df)
            
            if not fio_col:
                # Логируем информацию для диагностики
                # Получаем header_row для логирования
                header_row = find_docs_header_row(file_data)
                logger.error(f"FIO column not found in docs-report file {filename} (UID {uid})")
                logger.error(f"  Header row: {header_row}")
                logger.error(f"  Columns: {list(df.columns)}")
                logger.error(f"  First 2 rows:\n{df.head(2).to_string()}")
                logger.warning(f"Skipping file {filename} (UID {uid}) - FIO column not found")
                continue
            
            # Удаление полностью пустых строк по ФИО
            df = df[df[fio_col].astype(str).str.strip() != ''].copy()
            
            if len(df) > 0:
                all_docs_dfs.append(df)
                # Добавляем ключ в processed_keys после успешной обработки
                processed_keys[attachment_key] = time.time()
                logger.info(f"Found {len(df)} docs records in {filename} (UID {uid}, key: {attachment_key[:20]}...)")
            else:
                processed_keys[attachment_key] = time.time()
                logger.info(f"No docs records in {filename} (UID {uid}), but file processed")
        except Exception as e:
            logger.error(f"Error processing docs-report file {filename} (UID {uid}): {e}")
            import traceback
            traceback.print_exc()
    
    if not all_docs_dfs:
        logger.info("No docs-report records found")
        return
    
    # Объединение всех DataFrame
    df_all = pd.concat(all_docs_dfs, ignore_index=True)
    
    # Поиск колонок для дедупликации
    fio_col = find_fio_column(df_all)
    if not fio_col:
        logger.error("FIO column not found in docs-report after merging all files")
        logger.error(f"  Columns: {list(df_all.columns)}")
        logger.error(f"  First 2 rows:\n{df_all.head(2).to_string()}")
        return
    
    # Поиск колонок для дедупликации
    ttn_num_col = None
    for col in df_all.columns:
        col_norm = normalize_column_name(str(col))
        if 'номер' in col_norm and 'ттн' in col_norm:
            ttn_num_col = col
            break
    
    ttn_date_col = None
    for col in df_all.columns:
        col_norm = normalize_column_name(str(col))
        if 'дата' in col_norm and 'ттн' in col_norm:
            ttn_date_col = col
            break
    
    route_num_col = None
    for col in df_all.columns:
        col_norm = normalize_column_name(str(col))
        if ('№' in col_norm or 'номер' in col_norm) and 'маршрут' in col_norm:
            route_num_col = col
            break
    
    # Дедупликация по ключу (Номер ТТН, Дата ТТН, ФИО водителя, № маршрута)
    if ttn_num_col and ttn_date_col and fio_col:
        dedup_keys = set()
        df_unique_rows = []
        
        for _, row in df_all.iterrows():
            key = (
                str(row.get(ttn_num_col, '')),
                str(row.get(ttn_date_col, '')),
                str(row.get(fio_col, '')).strip(),
                str(row.get(route_num_col, '')) if route_num_col else ''
            )
            
            if key not in dedup_keys:
                dedup_keys.add(key)
                df_unique_rows.append(row)
        
        df_all = pd.DataFrame(df_unique_rows).reset_index(drop=True)
        logger.info(f"Total docs records before dedup: {sum(len(df) for df in all_docs_dfs)}, after dedup: {len(df_all)}")
    
    # Группировка по ФИО водителя
    fio_series = df_all[fio_col].fillna("").astype(str).str.strip()
    df_all = df_all[fio_series != ''].copy()
    
    # Добавляем surname для сортировки
    df_all['_surname'] = df_all[fio_col].astype(str).str.split().str[0]
    
    # Сортировка по фамилии и ФИО
    df_all = df_all.sort_values(['_surname', fio_col]).reset_index(drop=True)
    
    # Группировка и отправка по каждому водителю
    unique_fios = df_all[fio_col].unique()
    total_rows = len(df_all)
    logger.info(f"Preparing docs-report for {len(unique_fios)} drivers (total {total_rows} records)")
    
    # DRY_RUN режим: логируем сколько сообщений было бы отправлено
    dry_run = config.get('dry_run', False)
    if dry_run:
        logger.info(f"[DRY_RUN] Would send {len(unique_fios)} messages to Telegram (topic docs=2)")
        for fio in unique_fios:
            df_driver = df_all[df_all[fio_col] == fio].copy()
            logger.info(f"[DRY_RUN] Would send message for driver {fio}: {len(df_driver)} records")
        return
    
    # Отправляем дату перед отправкой таблиц
    topic_id = int(config.get('tg_topic_id_docs', 2))
    today_msk = datetime.now(ZoneInfo('Europe/Moscow')).date()
    date_str = today_msk.strftime('%d.%m.%Y')
    
    # Отправка текстового сообщения с датой
    if not dry_run:
        if send_telegram_message(config, date_str, topic_id=topic_id):
            logger.info(f"Sent date message: {date_str}")
        else:
            logger.error("Failed to send date message")
        
        # Небольшая задержка перед отправкой таблиц
        time.sleep(0.3)
    
    sent_count = 0
    for fio in unique_fios:
        df_driver = df_all[df_all[fio_col] == fio].copy()
        df_driver = df_driver.drop(columns=['_surname'], errors='ignore')
        
        # Генерация PNG
        temp_png = f'/tmp/docs_report_{hash(fio)}.png'
        if generate_png_table_docs(df_driver, temp_png):
            # Caption: "Отстающие документы для [Ф.И.О. водителя]"
            caption = f"Отстающие документы для {fio}"
            
            # Отправка в Telegram в тему 2
            topic_id = int(config.get('tg_topic_id_docs', 2))
            if send_telegram_photo(config, temp_png, caption, topic_id=topic_id):
                sent_count += 1
                logger.info(f"Sent docs-report for driver {fio}: {len(df_driver)} records")
            else:
                logger.error(f"Failed to send docs-report for driver {fio}")
            
            # Throttle между сообщениями (0.3-0.6 секунды)
            time.sleep(0.5)
            
            # Очистка
            if os.path.exists(temp_png):
                os.remove(temp_png)
    
    logger.info(f"Docs-report completed: {sent_count}/{len(unique_fios)} messages sent")
    
    # Сохраняем обработанные ключи
    save_processed_keys(config['state_file'], processed_keys)


def main():
    """Основная функция"""
    config = load_config()
    
    logger.info("Starting late-report service")
    
    # Загрузка обработанных ключей (если не включен FORCE_RESEND)
    force_resend = config.get('force_resend', False)
    if force_resend:
        logger.info("FORCE_RESEND: True -> state filtering disabled")
        processed_keys = {}
    else:
        processed_keys = load_processed_keys(config['state_file'])
        logger.info(f"Loaded {len(processed_keys)} processed keys from state")
    
    # DOCS_ONLY режим
    docs_only = config.get('docs_only', False)
    if docs_only:
        logger.info("DOCS_ONLY enabled -> skipping LATE pipeline")
        config['run_late_report'] = False
        config['run_docs_report'] = True
    
    # Получение вложений из почты
    attachments = get_email_attachments(config)
    
    if not attachments:
        logger.info("No new attachments found")
        return
    
    logger.info(f"Found {len(attachments)} Excel attachments")
    
    # Фильтрация уже обработанных вложений (если не включен FORCE_RESEND)
    new_attachments = []
    skipped_count = 0
    
    for uid, att_index, filename, file_data in attachments:
        # Генерируем ключ для вложения: uid:att_index:sha256
        file_hash = hashlib.sha256(file_data).hexdigest()
        attachment_key = f"{uid}:{att_index}:{file_hash}"
        
        # Проверка на дубликаты (если не включен FORCE_RESEND)
        if not force_resend:
            if attachment_key in processed_keys:
                logger.debug(f"Skipping already processed attachment: {filename} (UID {uid}, key: {attachment_key[:20]}...)")
                skipped_count += 1
                continue
        
        new_attachments.append((uid, att_index, filename, file_data))
    
    logger.info(f"Filtered: {skipped_count} already processed, {len(new_attachments)} new attachments to process")
    
    if not new_attachments:
        logger.info("No new attachments to process")
        return
    
    # Получаем today_msk для фильтрации DOCS по токену даты
    # Если задан DOCS_DATE_TOKEN - используем его (для тестов)
    if config.get('docs_date_token'):
        date_token = config['docs_date_token']
        logger.info(f"DOCS date_token filter (override): {date_token}")
    else:
        report_tz = config.get('report_tz', 'Europe/Moscow')
        try:
            tz = ZoneInfo(report_tz)
        except Exception:
            tz = ZoneInfo('UTC')
        today_msk = datetime.now(tz).date()
        date_token = today_msk.strftime("%Y_%d_%m")  # формат 2026_17_01
        logger.info(f"DOCS date_token filter: {date_token} (today_msk={today_msk})")
    
    # Разделение на late и docs отчёты
    late_attachments = []
    docs_attachments = []
    
    for uid, att_index, filename, file_data in new_attachments:
        try:
            # Быстрая проверка типа отчёта
            # Сначала пробуем парсить как late-report
            df_test = parse_excel(file_data)
            report_type = determine_report_type(df_test)
            
            # Для DOCS: дополнительная проверка по токену даты в имени файла
            if report_type == 'docs':
                # Проверяем, содержит ли filename токен даты (даже если кракозябры, цифры сохраняются)
                filename_str = str(filename) if filename else ''
                if date_token in filename_str:
                    docs_attachments.append((uid, att_index, filename, file_data))
                    logger.info(f"DOCS matched date_token={date_token}: UID {uid}, filename={filename[:50] if filename else 'N/A'}")
                else:
                    logger.debug(f"DOCS skipped (no date_token match): UID {uid}, filename={filename[:50] if filename else 'N/A'}, date_token={date_token}")
            elif report_type == 'late':
                late_attachments.append((uid, att_index, filename, file_data))
            else:
                logger.warning(f"Unknown report type for {filename} (UID {uid}), skipping")
        except Exception as e:
            logger.debug(f"Failed to determine report type for {filename} (UID {uid}): {e}, will try both parsers")
            # Если не определили - пробуем оба типа (но для docs всё равно нужен date_token)
            late_attachments.append((uid, att_index, filename, file_data))
            # Для docs проверяем date_token
            filename_str = str(filename) if filename else ''
            if date_token in filename_str:
                docs_attachments.append((uid, att_index, filename, file_data))
                logger.debug(f"DOCS matched date_token={date_token} (fallback): UID {uid}")
    
    logger.info(f"Classified: {len(late_attachments)} LATE, {len(docs_attachments)} DOCS attachments")
    
    # Обработка late-report
    all_late_records = []
    late_processed_uids = []
    late_processed_hashes = []
    
    if config['run_late_report'] and late_attachments:
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
                    # Помечаем как обработанное, чтобы не пытаться снова
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
                    # Даже если нет опоздавших, помечаем файл как обработанный
                    processed_keys[attachment_key] = time.time()
                    logger.info(f"No late records in {filename} (UID {uid}), but file processed")
            except Exception as e:
                logger.error(f"Error processing {filename} (UID {uid}): {e}")
                import traceback
                traceback.print_exc()
    
    if not all_late_records and not config['send_if_empty']:
        logger.info("No late records found in all attachments")
        return
    
    # Обработка late-report только если есть записи или включена отправка пустых отчётов
    if all_late_records or config['send_if_empty']:
        logger.info(f"Total late records before deduplication: {len(all_late_records)}")
        
        # Дедупликация: группировка по (fio, route_name, plan_time) и оставление записи с максимальным delay
        # Используем словарь для группировки
        dedup_dict = {}
        for record in all_late_records:
            # Ключ для дедупликации: (driver_name, route_name, planned_time)
            key = (
                record.get('driver_name', '').strip(),
                record.get('route_name', '').strip(),
                record.get('planned_time', '').strip()
            )
            
            # Если такой ключ уже есть, сравниваем delay и оставляем запись с большим delay
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
        temp_png = '/tmp/late_report.png'
        if generate_png_table(unique_records, temp_png):
            # Формирование подписи
            caption = format_caption(unique_records)
            
            # Отправка в Telegram с topic_id для late-report
            topic_id_late = int(config.get('tg_topic_id_late', 26))
            if send_telegram_photo(config, temp_png, caption, topic_id=topic_id_late):
                # Если подпись обрезалась, отправить остаток текстом
                full_caption = format_caption(unique_records)
                if len(full_caption) > 1024:
                    remaining = '\n'.join([f"{get_delay_emoji(r['delay_minutes'])} {r['driver_name']} — {r['delay_minutes']}" 
                                          for r in unique_records[len(caption.split('\n')):]])
                    send_telegram_text(config, remaining)
                
                # Сохраняем обработанные ключи
                save_processed_keys(config['state_file'], processed_keys)
                
                logger.info(f"Successfully processed late-report with {len(unique_records)} unique late records")
            else:
                logger.error("Failed to send late-report to Telegram")
        
        # Очистка временного файла
        if os.path.exists(temp_png):
            os.remove(temp_png)
    
    # Обработка docs-report
    if config['run_docs_report'] and docs_attachments:
        logger.info(f"Processing {len(docs_attachments)} docs-report attachments")
        process_docs_report(config, docs_attachments, processed_keys)


if __name__ == '__main__':
    main()
