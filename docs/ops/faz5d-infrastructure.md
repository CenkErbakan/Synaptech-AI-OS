# Faz 5D — 7/24 Otonom Altyapı (İzole)

**Durum:** Yerel / izole staging iskeleti. Production VPS, Nginx Proxy Manager, mevcut SynapTech/Subify servisleri **dokunulmaz**.

## Bileşenler

| Servis | Compose | Host port | Rol |
|--------|---------|-----------|-----|
| mssql-faz5d | `docker-compose.faz5d.yml` | `127.0.0.1:14334` | İzole MSSQL |
| api-faz5d | aynı | `127.0.0.1:3111` | HTTP API (`EMBED_SCHEDULER=0`) |
| worker-faz5d | aynı | `127.0.0.1:3112` | Scheduler + health |
| worker-faz5d-b | profile `dual-worker` | `127.0.0.1:3113` | Çift worker kabul testi |

Mevcut geliştirme stack (`docker-compose.yml`): MSSQL `14333`, API `3101` — **çakışmaz**.

## Distributed lock

- Tablo: `WorkerLease` (`lockKey`, `holderId`, `expiresAt`, `heartbeatAt`)
- Anahtar: `scheduler:tick`
- TTL: 30s; tick sırasında `renewLease`
- İkinci katman: `ScheduledJobRun.idempotencyKey` unique

## Kill switch (merkezi)

1. **Otorite:** MSSQL `SystemSetting` (`kill_switch`)
2. **Ayna:** `config/kill-switch.json` (Owner; ajan yazmaz)
3. Açıkken `schedulerTick` yeni iş çalıştırmaz; Cloud create zaten kapalı

## Yerel çalıştırma (izole)

```bash
# .env içinde MSSQL_SA_PASSWORD, SYNAPTECH_OWNER_TOKEN, SYNAPTECH_SYSTEM_TOKEN olmalı
docker compose -f docker-compose.faz5d.yml up -d --build
# migrate (container veya host):
# DATABASE_URL=...14334... pnpm --filter @synaptech/api prisma:deploy
```

Doğrulama:

```bash
curl -s http://127.0.0.1:3111/api/system/health
curl -s -H "Authorization: Bearer $SYNAPTECH_OWNER_TOKEN" http://127.0.0.1:3111/api/system/scheduler
```

## Secret yönetimi (tasarım)

- Secret'lar compose env / gelecekte VPS secret store; repoya yazılmaz
- `config/` worker'a **readonly** mount
- Ağ: yalnızca `127.0.0.1` bind (yerel); staging VPS'te ayrı Docker network + firewall (Owner onayı)

## Migration / backup / rollback

Bkz. `docs/ops/faz5d-db-runbook.md`.

## Alarm / monitoring (iskelet)

- Health: `/api/system/health`, `/api/system/scheduler`, `/api/system/workers`
- Önerilen alarm (henüz dış servise bağlı değil): lease expired + worker stale > 90s; kill switch beklenmedik açık; DB health fail
- Log: process stdout (Docker logging driver); ileride merkezi log Owner onayı ile

## Gerçek VPS için Owner onayı gerekir

- Yeni **izole** VPS veya mevcut host'ta tamamen ayrı compose project
- Port/domain/NPM değişikliği yok varsayılan; yeni subdomain ancak Owner onayı
- SSH, ücretli VPS satın alma, Cloud Agent, On-Demand — bu fazda **yapılmadı**
