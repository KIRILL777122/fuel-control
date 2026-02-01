#!/usr/bin/env python3
import os, re, json, io, time as time_mod, logging, email, requests
from datetime import datetime, timedelta, time
from typing import List, Dict, Optional
import pandas as pd
from imapclient import IMAPClient
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


def load_config():
    env_path = os.getenv('LATE_REPORT_ENV', '/etc/late-report/late-report.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)
    else:
        load_dotenv('.env')
    return {
        'imap_host': os.getenv('YA_IMAP_HOST', 'imap.yandex.com'),
        'imap_user': os.getenv('YA_IMAP_USER'),
        'imap_pass': os.getenv('YA_IMAP_PASS'),
        'mailbox': os.getenv('YA_MAILBOX', 'INBOX'),
        'api_base_url': os.getenv('API_BASE_URL', 'http://localhost:3000'),
        'processed_file': os.getenv('SHIFT_PROCESSED_FILE', '/opt/fuel-control/tools/late-report/state/shift_processed.json'),
        'lookback_days': int(os.getenv('IMAP_LOOKBACK_DAYS', '30')),
    }


def load_processed_keys(file_path: str) -> Dict[str, float]:
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load processed keys: {e}")
    return {}


def save_processed_keys(file_path: str, keys: Dict[str, float]):
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(keys, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save processed keys: {e}")


def extract_date_from_header(df: pd.DataFrame) -> Optional[datetime]:
    for r in range(min(20, len(df))):
        for val in df.iloc[r]:
            if isinstance(val, str):
                m = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', val)
                if m:
                    try:
                        return datetime.strptime(m.group(0), '%d.%m.%Y')
                    except Exception:
                        pass
                m = re.search(r'(\d{4})-(\d{2})-(\d{2})', val)
                if m:
                    try:
                        return datetime.strptime(m.group(0), '%Y-%m-%d')
                    except Exception:
                        pass
            elif isinstance(val, (datetime, pd.Timestamp)):
                return pd.to_datetime(val)
    return None


def is_header_like_row(row: pd.Series) -> bool:
    vals = [v for v in row.tolist() if str(v).strip().lower() not in ['nan', 'none', '']]
    if not vals:
        return False
    text_like = sum(1 for v in vals if isinstance(v, str))
    return text_like / max(len(vals), 1) > 0.6


def clean_time(val) -> str:
    if pd.isna(val) or str(val).strip().lower() in ['nan', 'none', '']:
        return ''
    if isinstance(val, (datetime, pd.Timestamp)):
        return val.strftime('%H:%M')
    if isinstance(val, time):
        return val.strftime('%H:%M')
    m = re.search(r'(\d{2}:\d{2})', str(val))
    if m:
        return m.group(1)
    return str(val)


def combine_headers(df_full: pd.DataFrame, header_row: int) -> (List[str], int):
    base_row = df_full.iloc[header_row]
    next_row = df_full.iloc[header_row + 1] if header_row + 1 < len(df_full) else None
    use_two_rows = next_row is not None and is_header_like_row(next_row)

    columns = []
    for i, base in enumerate(base_row.tolist()):
        base_str = str(base).strip() if str(base).strip().lower() != 'nan' else ''
        if use_two_rows:
            sub = str(next_row.iloc[i]).strip() if str(next_row.iloc[i]).strip().lower() != 'nan' else ''
            if sub and sub.lower() != f'unnamed: {i}':
                col = f"{base_str} {sub}".strip()
            else:
                col = base_str
        else:
            col = base_str
        columns.append(col)
    data_start = header_row + (2 if use_two_rows else 1)
    return columns, data_start


def is_shift_file(columns: List[str]) -> bool:
    cols = [c.lower() for c in columns]
    return (
        any('маршрут' in c for c in cols)
        and any('смена' in c and 'дата' in c for c in cols)
        and any('типовой маршрут' in c for c in cols)
        and any('время назначения' in c for c in cols)
        and any('на выезд' in c for c in cols)
        and any('опоздание' in c for c in cols)
        and any('фио' in c for c in cols)
        and any('гос' in c for c in cols)
    )


def parse_excel(file_data: bytes, filename: str) -> List[Dict]:
    try:
        df_full = pd.read_excel(io.BytesIO(file_data), engine="openpyxl", header=None)
        sheet_date = extract_date_from_header(df_full)
        if not sheet_date:
            m = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', filename)
            if m:
                sheet_date = datetime.strptime(m.group(0), '%d.%m.%Y')
        if not sheet_date:
            logger.warning(f"Could not extract date from {filename}")
            return []

        header_row = None
        for r in range(min(50, len(df_full))):
            row_vals = [str(val).lower() for val in df_full.iloc[r].tolist()]
            if any('маршрут' in v for v in row_vals) and any('фио' in v for v in row_vals):
                header_row = r
                break
        if header_row is None:
            return []

        columns, data_start = combine_headers(df_full, header_row)
        if not is_shift_file(columns):
            return []

        df = df_full.iloc[data_start:].copy()
        df.columns = columns

        col_map = {}
        for c in df.columns:
            c_lower = c.lower()
            if 'фио' in c_lower:
                col_map['driver'] = c
            elif 'гос' in c_lower:
                col_map['plate'] = c

        # Prefer actual route number from "Маршрут №"
        for c in df.columns:
            c_lower = c.lower()
            if c_lower.startswith('маршрут') and ('№' in c_lower or 'номер' in c_lower):
                col_map['route_num'] = c
                break
        if 'route_num' not in col_map:
            for c in df.columns:
                c_lower = c.lower()
                if 'маршрут' in c_lower and ('№' in c_lower or 'номер' in c_lower) and 'типовой' not in c_lower:
                    col_map['route_num'] = c
                    break

        # Route name (Типовой маршрут -> Наименование column next to it)
        if 'Типовой маршрут Номер' in df.columns:
            try:
                idx = list(df.columns).index('Типовой маршрут Номер')
                if idx + 1 < len(df.columns):
                    next_col = list(df.columns)[idx + 1]
                    if 'наименование' in str(next_col).lower():
                        col_map['route_name'] = next_col
            except Exception:
                pass

        for c in df.columns:
            c_lower = c.lower()
            if 'смена' in c_lower and 'дата' in c_lower:
                col_map['shift_date'] = c
            elif 'типовой маршрут' in c_lower and ('наименование' in c_lower or c_lower.strip() == 'типовой маршрут'):
                col_map['route_name'] = col_map.get('route_name', c)
            elif c_lower.strip() == 'наименование' and 'route_name' not in col_map:
                col_map['route_name'] = c
            elif 'план' in c_lower and 'подач' in c_lower:
                col_map['planned'] = c
            elif 'время назначения' in c_lower and 'на маршрут' in c_lower:
                col_map['assigned'] = c
            elif 'на выезд' in c_lower:
                col_map['departure'] = c
            elif 'опоздание' in c_lower and 'мин' in c_lower:
                col_map['delay'] = c

        if 'driver' not in col_map or 'route_num' not in col_map or 'route_name' not in col_map:
            logger.info(f"Shift file columns not mapped: {col_map}")
            return []

        records = []
        for _, row in df.iterrows():
            driver = str(row.get(col_map.get('driver', ''), '')).strip()
            if driver.lower() in ['nan', 'none', '', 'водитель', 'фио']:
                continue

            route_num = str(row.get(col_map.get('route_num', ''), '')).strip()
            route_name = str(row.get(col_map.get('route_name', ''), '')).strip()
            if route_num.lower() in ['nan', 'none']:
                route_num = ''
            if route_name.lower() in ['nan', 'none']:
                route_name = ''
            if not route_name and not route_num:
                continue

            plate = str(row.get(col_map.get('plate', ''), '')).strip()
            if plate.lower() in ['nan', 'none']:
                plate = ''

            planned = clean_time(row.get(col_map.get('planned', ''), ''))
            assigned = clean_time(row.get(col_map.get('assigned', ''), ''))
            departure = clean_time(row.get(col_map.get('departure', ''), ''))

            delay_val = row.get(col_map.get('delay', ''), '')
            delay_minutes = None
            try:
                delay_minutes = int(pd.to_numeric(delay_val, errors='coerce')) if str(delay_val).strip() != '' else None
            except Exception:
                delay_minutes = None

            shift_date_val = row.get(col_map.get('shift_date', ''), '')
            shift_date = sheet_date
            if isinstance(shift_date_val, (datetime, pd.Timestamp)):
                shift_date = shift_date_val

            records.append({
                'driver_name': driver,
                'plate_number': plate,
                'route_name': route_name,
                'route_number': route_num,
                'shift_date': shift_date.strftime('%Y-%m-%d'),
                'planned_time': planned,
                'assigned_time': assigned,
                'departure_time': departure,
                'delay_minutes': delay_minutes,
            })

        unique = {}
        for r in records:
            key = f"{r['shift_date']}|{r['driver_name']}|{r['route_name']}|{r['route_number']}|{r['plate_number']}|{r['planned_time']}|{r['assigned_time']}|{r['departure_time']}|{r.get('delay_minutes')}"
            unique[key] = r
        return list(unique.values())

    except Exception as e:
        logger.error(f"Error parsing {filename}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return []


def save_shifts_to_api(config: Dict, records: List[Dict]):
    if not records:
        return
    try:
        url = f"{config['api_base_url']}/api/shifts"
        res = requests.post(url, json={'records': records}, timeout=30)
        if res.ok:
            logger.info(f"Successfully synced {len(records)} shifts to API")
        else:
            logger.error(f"Failed to sync shifts: {res.status_code} {res.text}")
    except Exception as e:
        logger.error(f"API sync error: {e}")


def main():
    config = load_config()
    pk = load_processed_keys(config['processed_file'])
    try:
        with IMAPClient(config['imap_host'], port=993, ssl=True) as client:
            client.login(config['imap_user'], config['imap_pass'])
            client.select_folder(config['mailbox'])
            since = (datetime.now() - timedelta(days=config['lookback_days'])).date()
            uids = client.search(['SINCE', since.strftime('%d-%b-%Y')])
            all_records = []
            new_keys = {}
            for uid in sorted(uids, reverse=True):
                data = client.fetch([uid], ['RFC822'])[uid]
                msg = email.message_from_bytes(data[b'RFC822'])
                for part in msg.walk():
                    if part.get_content_maintype() == 'multipart':
                        continue
                    fn = part.get_filename()
                    if not fn:
                        continue
                    if not (fn.endswith('.xlsx') or fn.endswith('.xls')):
                        continue
                    key = f"{uid}_{fn}"
                    if key in pk:
                        continue
                    file_data = part.get_payload(decode=True)
                    recs = parse_excel(file_data, fn)
                    if recs:
                        all_records.extend(recs)
                        new_keys[key] = time_mod.time()
            if all_records:
                save_shifts_to_api(config, all_records)
                pk.update(new_keys)
                save_processed_keys(config['processed_file'], pk)
    except Exception as e:
        logger.error(f"Main loop error: {e}")


if __name__ == '__main__':
    main()
