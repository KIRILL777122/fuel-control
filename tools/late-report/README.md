# Late Report Service

Сервис для автоматической обработки опозданий из почты и отправки отчетов в Telegram.

## Описание

Сервис:
1. Подключается к Яндекс.Почте по IMAP
2. Забирает новые письма с XLSX вложениями "Соблюдение сроков"
3. Парсит таблицу и находит опоздавших (delay > 0)
4. Генерирует PNG таблицу с опоздавшими
5. Отправляет в Telegram в указанную тему

**Расписание:** Запускается один раз в день в 12:00 по московскому времени.

**Защита от дублей:** 
- Проверка по UID письма (обработанные письма помечаются как Seen)
- Проверка по хешу файла (SHA256) - один и тот же файл не обрабатывается повторно даже если придет в новом письме

## Установка

### 1. Создание пользователя и директорий

```bash
sudo useradd -r -s /bin/false -d /var/lib/late-report late-report
sudo mkdir -p /etc/late-report /var/lib/late-report /var/log/late-report
sudo chown -R late-report:late-report /var/lib/late-report /var/log/late-report
```

### 2. Создание файла конфигурации

```bash
sudo cp .env.example /etc/late-report/late-report.env
sudo chmod 600 /etc/late-report/late-report.env
sudo chown root:late-report /etc/late-report/late-report.env
```

### 3. Редактирование конфигурации

Отредактируйте `/etc/late-report/late-report.env`:

```bash
sudo nano /etc/late-report/late-report.env
```

Установите:
- `YA_IMAP_USER` - ваш email на Яндекс.Почте
- `YA_IMAP_PASS` - пароль приложения (не основной пароль!)
- `TG_TOKEN` - токен Telegram бота
- `TG_CHAT_ID` - ID чата (уже установлен по умолчанию)
- `TG_TOPIC_ID` - ID темы (уже установлен по умолчанию)

**Как получить пароль приложения Яндекс:**
1. Перейдите в [Настройки аккаунта](https://id.yandex.ru/security)
2. Включите двухфакторную аутентификацию (если не включена)
3. Создайте пароль приложения для "Почты"
4. Используйте этот пароль в `YA_IMAP_PASS`

### 4. Установка зависимостей

```bash
cd /opt/fuel-control/tools/late-report
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Или используйте скрипт установки:**

```bash
cd /opt/fuel-control/tools/late-report
chmod +x scripts/install.sh
sudo ./scripts/install.sh
```

### 5. Установка systemd сервисов

```bash
sudo cp systemd/late-report.service /etc/systemd/system/
sudo cp systemd/late-report.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

### 6. Запуск сервиса

```bash
# Включение автозапуска таймера
sudo systemctl enable late-report.timer

# Запуск таймера
sudo systemctl start late-report.timer

# Проверка статуса
sudo systemctl status late-report.timer

# Проверка времени следующего запуска
sudo systemctl list-timers late-report.timer

# Просмотр логов
sudo journalctl -u late-report.service -f

# Ручной запуск для тестирования
sudo systemctl start late-report.service
```

**Расписание:** Таймер настроен на запуск один раз в день в 12:00 по московскому времени (09:00 UTC).

**Важно:** Если сервер находится в другом timezone, отредактируйте `/etc/systemd/system/late-report.timer`:
- Для MSK timezone: `OnCalendar=12:00`
- Для UTC: `OnCalendar=09:00` (09:00 UTC = 12:00 MSK)

## Переменные окружения

### Обязательные

- `YA_IMAP_USER` - email на Яндекс.Почте
- `YA_IMAP_PASS` - пароль приложения
- `TG_TOKEN` - токен Telegram бота
- `TG_CHAT_ID` - ID чата (по умолчанию: `-1003541359350`)
- `TG_TOPIC_ID` - ID темы (по умолчанию: `26`)

### Опциональные

- `YA_IMAP_HOST` - IMAP хост (по умолчанию: `imap.yandex.com`)
- `ATTACHMENT_NAME_REGEX` - регулярное выражение для поиска вложений (по умолчанию: `Соблюдение\\s+сроков`)
- `ADMIN_CHAT_ID` - ID чата для админских уведомлений
- `DRY_RUN` - тестовый режим без отправки (по умолчанию: `false`)
- `SEND_IF_EMPTY` - отправлять сообщение если нет опоздавших (по умолчанию: `false`)
- `STATE_PATH` - путь к файлу состояния (по умолчанию: `/var/lib/late-report/state.json`)

## Запуск вручную

```bash
cd /opt/fuel-control/tools/late-report
source venv/bin/activate
export LATE_REPORT_ENV=/etc/late-report/late-report.env
python3 src/late_report.py
```

## Тестирование

Для тестового запуска без отправки в Telegram:

```bash
# В .env файле установите
DRY_RUN=true

# Или через переменную окружения
DRY_RUN=true python3 src/late_report.py
```

## Структура проекта

```
tools/late-report/
├── src/
│   └── late_report.py      # Основной скрипт
├── systemd/
│   ├── late-report.service # Systemd сервис
│   └── late-report.timer   # Systemd таймер (каждые 5 минут)
├── scripts/
│   ├── install.sh          # Скрипт установки
│   └── smoke_test.sh       # Тестовый скрипт
├── requirements.txt        # Python зависимости
├── .env.example           # Пример конфигурации
├── .gitignore            # Игнорируемые файлы
└── README.md             # Документация
```

## Логи

Логи доступны через journald:

```bash
# Последние 100 строк
sudo journalctl -u late-report.service -n 100

# Следить в реальном времени
sudo journalctl -u late-report.service -f

# За последний час
sudo journalctl -u late-report.service --since "1 hour ago"
```

Также логи пишутся в `/var/log/late-report/late-report.log` (если директория существует и доступна для записи).

## Устранение проблем

### Сервис не запускается

```bash
# Проверьте права на файлы
sudo ls -la /etc/late-report/late-report.env
sudo ls -la /var/lib/late-report/

# Проверьте логи
sudo journalctl -u late-report.service -n 50
```

### Не приходят сообщения в Telegram

1. Проверьте `TG_TOKEN` и `TG_CHAT_ID` в конфигурации
2. Убедитесь, что бот добавлен в чат и имеет права на отправку сообщений
3. Проверьте, что `TG_TOPIC_ID` правильный для вашей темы

### Не обрабатываются письма

1. Проверьте `YA_IMAP_USER` и `YA_IMAP_PASS`
2. Убедитесь, что используется пароль приложения (не основной пароль)
3. Проверьте регулярное выражение `ATTACHMENT_NAME_REGEX`

### Дубликаты сообщений

Проверьте файл состояния: `/var/lib/late-report/state.json`. Если файл поврежден или недоступен для записи, могут появляться дубликаты.

## Разработка

Для локальной разработки:

```bash
cd /opt/fuel-control/tools/late-report
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Создайте .env файл в корне проекта (для разработки)
cp .env.example .env
# Отредактируйте .env

# Запустите скрипт
python3 src/late_report.py
```
