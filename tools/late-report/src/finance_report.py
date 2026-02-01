#!/usr/bin/env python3
"""
Finance Report Service
Fetches Excel attachments from emails with subject "Бухгалтерия Каравай"
and saves parsed tables for "Афина" and "Ника" into JSON files.
"""

import os
import json
import email
import email.header
import io
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Dict, Optional, Tuple

from imapclient import IMAPClient
from dotenv import load_dotenv
import pandas as pd


def load_config() -> Dict:
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
        'imap_lookback_days': int(os.getenv('IMAP_LOOKBACK_DAYS', '3')),
        'report_tz': os.getenv('REPORT_TZ', 'Europe/Moscow'),
        'subject_filter': os.getenv('FINANCE_SUBJECT', 'Бухгалтерия Каравай'),
        'output_dir': os.getenv('FINANCE_OUTPUT_DIR', '/opt/fuel-control/tools/late-report/state/finance'),
    }


def decode_mime_header(value: Optional[str]) -> str:
    if not value:
        return ''
    try:
        decoded_parts = email.header.decode_header(value)
        result = ''
        for part, enc in decoded_parts:
            if isinstance(part, bytes):
                result += part.decode(enc or 'utf-8', errors='replace')
            else:
                result += part
        return result
    except Exception:
        return str(value)


def parse_excel_to_json(file_data: bytes, source: str, filename: str) -> Dict:
    df = pd.read_excel(io.BytesIO(file_data))
    df = df.where(pd.notna(df), "")
    columns = [str(c) for c in df.columns.tolist()]
    rows = df.astype(str).values.tolist()
    return {
        "source": source,
        "filename": filename,
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "columns": columns,
        "rows": rows,
        "files": [{"filename": filename, "updatedAt": datetime.utcnow().isoformat() + "Z"}],
    }


def find_finance_attachments(config: Dict) -> Dict[str, list[Tuple[bytes, str]]]:
    if not config['imap_user'] or not config['imap_pass']:
        raise RuntimeError("IMAP credentials not set")

    try:
        tz = ZoneInfo(config['report_tz'])
    except Exception:
        tz = ZoneInfo('UTC')

    today_msk = datetime.now(tz).date()
    since_date = today_msk - timedelta(days=config['imap_lookback_days'])
    since_str = since_date.strftime('%d-%b-%Y')

    results: Dict[str, list[Tuple[bytes, str]]] = {"afina": [], "nika": []}
    seen_names: Dict[str, set[str]] = {"afina": set(), "nika": set()}
    with IMAPClient(config['imap_host'], port=993, ssl=True) as client:
        client.login(config['imap_user'], config['imap_pass'])
        client.select_folder(config['mailbox'])
        uids = client.search(['SINCE', since_str])
        uids = sorted(uids)
        if not uids:
            return results

        fetch_data = client.fetch(uids, ['RFC822', 'INTERNALDATE'])
        subject_filter = config['subject_filter'].lower()

        for uid in uids:
            msg_data = fetch_data.get(uid)
            if not msg_data:
                continue
            raw = msg_data.get(b'RFC822')
            if not raw:
                continue
            msg_date = msg_data.get(b'INTERNALDATE')
            msg = email.message_from_bytes(raw)
            subject = decode_mime_header(msg.get('Subject', '')).lower()
            if subject_filter not in subject:
                continue

            for part in msg.walk():
                filename_raw = part.get_filename()
                if not filename_raw:
                    continue
                filename = decode_mime_header(filename_raw)
                if not filename.lower().endswith(('.xlsx', '.xls')):
                    continue
                file_data = part.get_payload(decode=True)
                if not file_data:
                    continue

                lower_name = filename.lower()
                if 'афина' in lower_name:
                    if filename not in seen_names['afina']:
                        results['afina'].append((file_data, filename))
                        seen_names['afina'].add(filename)
                elif 'ника' in lower_name:
                    if filename not in seen_names['nika']:
                        results['nika'].append((file_data, filename))
                        seen_names['nika'].add(filename)

    return {k: v for k, v in results.items() if v}


def main() -> None:
    config = load_config()
    os.makedirs(config['output_dir'], exist_ok=True)

    attachments = find_finance_attachments(config)
    for source in ('afina', 'nika'):
        if source not in attachments:
            continue
        out_path = os.path.join(config['output_dir'], f"finance_{source}.json")
        backup_path = os.path.join(config['output_dir'], f"finance_{source}.bak.json")
        existing = {}
        if os.path.exists(out_path):
            try:
                with open(out_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                existing = {}
        if not existing and os.path.exists(backup_path):
            try:
                with open(backup_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                existing = {}

        existing_files = existing.get("files") if isinstance(existing.get("files"), list) else []
        existing_names = {str(item.get("filename")) for item in existing_files if isinstance(item, dict)}
        existing_rows = existing.get("rows") if isinstance(existing.get("rows"), list) else []
        existing_columns = existing.get("columns") if isinstance(existing.get("columns"), list) else None

        merged_rows = list(existing_rows)
        merged_files = list(existing_files)
        for file_data, filename in attachments[source]:
            if filename in existing_names:
                continue
            payload = parse_excel_to_json(file_data, source, filename)
            merged_rows += payload["rows"]
            merged_files += payload["files"]
            existing_names.add(filename)
            if not existing_columns:
                existing_columns = payload["columns"]

        if merged_rows:
            merged = {
                "source": source,
                "filename": merged_files[-1]["filename"] if merged_files else existing.get("filename", ""),
                "updatedAt": datetime.utcnow().isoformat() + "Z",
                "columns": existing_columns or [],
                "rows": merged_rows,
                "files": merged_files,
            }
            if os.path.exists(out_path):
                try:
                    with open(out_path, 'r', encoding='utf-8') as f:
                        current = f.read()
                    with open(backup_path, 'w', encoding='utf-8') as f:
                        f.write(current)
                except Exception:
                    pass
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(merged, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
