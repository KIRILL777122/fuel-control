import os, sys, logging
from dotenv import load_dotenv

sys.path.append(os.path.dirname(__file__))
import late_report

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    env_path = os.getenv('LATE_REPORT_ENV', '/etc/late-report/late-report.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)
    else:
        load_dotenv('.env')

    config = late_report.load_config()
    # FORCE SYNC, no Telegram
    config['tg_token'] = None
    config['tg_chat_id'] = None
    config['force_resend'] = True
    config['run_late_report'] = True
    config['run_docs_report'] = False

    # Use extended IMAP lookback for historical sync
    config['imap_lookback_days'] = 120

    if os.getenv('API_BASE_URL'):
        config['api_base_url'] = os.getenv('API_BASE_URL')

    logger.info("Starting DEEP historical sync for late delays...")
    late_report.main(config_override=config)
    logger.info("Deep historical sync finished.")


if __name__ == '__main__':
    main()
