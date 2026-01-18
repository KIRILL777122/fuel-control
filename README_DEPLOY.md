# fuel-control — Deploy / Ops guide

## Prod (Linux server)

1) Подготовить `.env.production` (см. `.env.production.example`).
2) Собрать и поднять:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
   Быстрая пересборка backend без повторного скачивания (использует кэш npm ci):
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production build backend
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate --no-deps backend
   ```
3) Проверка:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production ps
   curl http://localhost:3000/health
   ```
4) Логи backend:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backend
   ```
5) Если `EADDRINUSE` на 3000/3001:
   ```bash
   docker compose -f docker-compose.prod.yml down
   # убедись, что нет других процессов, затем подними снова
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
6) Как скопировать проект на сервер:
   - git: `git clone <repo> && cd fuel-control`
   - или zip: `scp fuel-control.zip user@server:/opt/ && ssh user@server "cd /opt && unzip fuel-control.zip"`
   - убедись, что `.env.production` создан на сервере.
7) Открыть порты в firewall (пример ufw):
   ```bash
   sudo ufw allow 3000/tcp
   sudo ufw allow 3001/tcp
   sudo ufw allow 5432/tcp   # только если нужен внешний доступ к БД, иначе не открывать
   ```

## Dev (Windows, PowerShell)

```powershell
cd C:\Projects\fuel-control
docker compose -f .\docker-compose.yml up -d db
npm install
cd src\backend
npx prisma migrate dev --name init
npx prisma generate
cd ..\..
npm --workspace src/backend run seed
npm run dev   # backend:3000, web:3001
```

Пример curl для создания чека (dev):
```powershell
curl -X POST http://localhost:3000/api/receipts ^
  -H "Content-Type: application/json" ^
  -d "{""driver"":{""telegramUserId"":""1000000002"",""fullName"":""Автотест""}, ""vehicle"":{""plateNumber"":""Т123ТТ77"",""name"":""Газель""}, ""receipt"":{""stationName"":""Тест АЗС"",""totalAmount"":2500.5,""liters"":50,""pricePerLiter"":50.01,""mileage"":123456}, ""items"":[{""name"":""ДТ"",""quantity"":50,""unitPrice"":50.01,""amount"":2500.5}]}"
```

Пример curl для Telegram webhook (проверка, что endpoint жив):
```bash
curl -X POST http://localhost:3000/telegram/webhook \
  -H "Content-Type: application/json" \
  -d '{"message":{"chat":{"id":1},"text":"/start","date":0}}'
```

Prisma EPERM fix (если rename query_engine):
```powershell
taskkill /F /IM node.exe
rmdir /s /q node_modules\.prisma
npm install
cd src\backend
npx prisma generate
cd ..\..
```

Если EADDRINUSE (порты заняты в dev):
```powershell
# остановить свои compose/процессы
docker compose -f .\docker-compose.yml down
# проверить кто слушает порт
netstat -ano | findstr :3000
taskkill /PID <PID> /F
# поднять снова
docker compose -f .\docker-compose.yml up -d db
```

## Переменные окружения (prod)
- `DATABASE_URL` внутри compose: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`
- `API_BASE_URL` для web: `http://backend:3000`
- `WEB_ORIGIN` — домен веб-UI (например, `https://fuel.example.com`), нужен для CORS/cookie.
- `COOKIE_DOMAIN` — доменное имя без протокола (например, `fuel.example.com`) для httpOnly-кук.
- `JWT_SECRET`, `WEB_SESSION_SECRET` — минимум 32 символа.

## Чеклист из 6 команд
1. Поднять БД (dev):  
   `cd C:\Projects\fuel-control && docker compose -f .\docker-compose.yml up -d db`
2. Сид (dev):  
   `npm --workspace src/backend run seed`
3. Запуск dev:  
   `npm run dev`
4. Проверка curl (dev):  
   `curl http://localhost:3000/api/drivers`
5. Prod up:  
   `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
6. Prod verify:  
   `docker compose -f docker-compose.prod.yml --env-file .env.production ps && curl http://localhost:3000/health`
