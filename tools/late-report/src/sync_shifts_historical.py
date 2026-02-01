#!/usr/bin/env python3
import os
import sys
from datetime import datetime, timedelta
import logging

# Add current directory to path so we can import shift_sync
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import shift_sync

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    config = shift_sync.load_config()
    # Force lookback to 100 days (Nov 1 is ~80 days ago)
    config['lookback_days'] = 100
    
    # We want to re-process even if we have some state, but let's just 
    # use a temporary state file to not mess up the main one, 
    # OR just don't use it at all for historical sync.
    config['processed_file'] = '/tmp/shift_historical_processed.json'
    if os.path.exists(config['processed_file']):
        os.remove(config['processed_file'])

    logger.info(f"Starting historical shift sync from {config['lookback_days']} days ago")
    
    # We can't easily call shift_sync.main() with custom config without modifying it
    # but we can monkeypatch or just copy the logic.
    # Let's just run the main logic from shift_sync but with our config.
    
    try:
        from imapclient import IMAPClient
        import email
        import time

        processed_keys = {} # Start fresh
        
        with IMAPClient(config['imap_host'], port=993, ssl=True) as client:
            client.login(config['imap_user'], config['imap_pass'])
            client.select_folder(config['mailbox'])
            
            since_date = (datetime.now() - timedelta(days=config['lookback_days'])).date()
            messages = client.search(['SINCE', since_date.strftime('%d-%b-%Y')])
            
            logger.info(f"Found {len(messages)} messages since {since_date}")
            
            all_records = []
            
            for uid in sorted(messages): # Process chronologically
                msg_data = client.fetch([uid], ['RFC822'])[uid]
                msg = email.message_from_bytes(msg_data[b'RFC822'])
                
                for part in msg.walk():
                    if part.get_content_maintype() == 'multipart': continue
                    filename = part.get_filename()
                    if not filename: continue
                    
                    from email.header import decode_header
                    decoded = decode_header(filename)
                    filename = "".join([
                        str(p[0], p[1] or 'utf-8') if isinstance(p[0], bytes) else str(p[0])
                        for p in decoded
                    ])
                    
                    if not (filename.endswith('.xlsx') or filename.endswith('.xls')): continue
                    
                    logger.info(f"Processing {filename} from UID {uid}")
                    file_data = part.get_payload(decode=True)
                    records = shift_sync.parse_excel(file_data, filename)
                    if records:
                        logger.info(f"Extracted {len(records)} records from {filename}")
                        # Sync each file immediately to avoid huge payloads
                        shift_sync.save_shifts_to_api(config, records)
                
            logger.info("Historical shift sync completed")
                
    except Exception as e:
        logger.error(f"Historical sync error: {e}")

if __name__ == '__main__':
    main()
