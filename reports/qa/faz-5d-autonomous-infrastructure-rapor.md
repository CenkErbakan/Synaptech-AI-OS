# Faz 5D — 7/24 Autonomous Infrastructure Raporu

**Durum:** Tamamlandı (izole / yerel). Production VPS’e dokunulmadı. Faz 5E’ye geçilmedi.

**Tarih:** 2026-11-18

## Özet

SynapTech AI OS için Cursor IDE ve Dashboard’dan bağımsız çalışabilecek scheduler/worker iskeleti hazırlandı. MSSQL üzerinde `WorkerLease` / `WorkerInstance` ile dağıtık kilit, kalıcı `ScheduledJob`, kill switch merkezi kontrolü, health/scheduler API doğrulaması ve çakışmasız Docker Compose (`14334` / `3111` / `3112`) eklendi. Gerçek Cloud Agent, ücretli AI, SSH ve VPS kurulumu yapılmadı.

## Teslimatlar

| Bileşen | Yol |
|---------|-----|
| Lease motoru | `apps/api/src/engines/worker-lease.ts` |
| Scheduler lease kapısı | `apps/api/src/engines/autonomy-scheduler.ts` |
| Worker süreci | `apps/api/src/worker.ts` (`pnpm worker`) |
| Health / scheduler / workers API | `apps/api/src/modules/system/routes.ts` |
| Migration | `apps/api/prisma/migrations/20261118050000_faz5d_worker_lease/` |
| İzole Compose | `docker-compose.faz5d.yml` |
| Ops / güvenlik | `docs/ops/faz5d-*.md` |
| Kanıt | `reports/qa/faz-5d-acceptance-evidence.json` |

## Mimari kararlar

1. **Mevcut stack korundu:** Next.js dashboard, Fastify API, MSSQL, Prisma.
2. **İzolasyon:** Compose project `synaptech-ai-os-faz5d`; portlar `14334/3111/3112` — mevcut `14333/3101` ile çakışmaz.
3. **Çift koruma:** `WorkerLease(scheduler:tick)` + `ScheduledJobRun.idempotencyKey` unique.
4. **Crash recovery:** TTL dolmuş lease başka worker tarafından alınır; job durumu DB’de kalır.
5. **Kill switch:** DB `SystemSetting` otoritesi; tick başında yeni iş yok.
6. **EMBED_SCHEDULER=0:** API HTTP; ayrı worker süreci tick üretir (IDE bağımsız tasarım).
7. **Cloud live kapalı:** `CLOUD_AGENT_LIVE_ENABLED=false`, `CURSOR_CLOUD_MODE=mock`.

## Test sonuçları (kanıt)

```text
pnpm --filter @synaptech/api test
→ 8 dosya / 48 test geçti
```

Doğrulanan kabul maddeleri:

- Worker lease: ikinci holder aynı lock’u alamaz
- Expired lease sonrası güvenli devam (crash simülasyonu)
- Kill switch scheduler tick’i `kill_switch` ile atlar
- `/api/system/scheduler` → `cloudLive: false`
- `ScheduledJob` upsert ile kalıcı
- 5A–5C regresyon suite’leri aynı koşuda geçti
- Compose dosyası: `docker compose -f docker-compose.faz5d.yml config` OK

Not: 5B zincir simülasyonunda parent/`ceo_plan` çakışması flaky hatası giderildi (`parentTaskId: { not: null }`).

## Güvenlik

Bkz. `docs/ops/faz5d-security.md`. Özet: production NPM/Docker/port/DB’ye müdahale yok; secret env; config RO mount; ağ `127.0.0.1`.

## Bilinçli yapılmayanlar

- Production VPS SSH / deploy
- Yeni ücretli VPS satın alma
- Cursor Cloud Agent / On-Demand / ücretli AI
- GitHub allow-list genişletme
- Faz 5E

## Gerçek VPS kurulumu için Owner onayları

Aşağıdakiler **onaylanmadan ajan yürütmez**. Onaylansa bile Faz 1–2’de kullanıcı manuel uygular.

1. **`production_deploy` (veya staging_deploy)** — İzole VPS’te `docker-compose.faz5d.yml` kurulumu  
   - Risk: Yüksek  
   - Gerekçe: Uzak sunucu / sürekli çalışma  
   - Bağlı sürüm: `docker-compose.faz5d.yml` SHA-256 (aşağıda)

2. **`db_migration`** — İzole VPS MSSQL’de `20261118050000_faz5d_worker_lease`  
   - Risk: Orta  
   - Gerekçe: Şema değişikliği (yalnızca izole DB)

3. **Harcama onayı** — Yeni VPS veya ek disk/bandwidth ücreti (gerekirse)  
   - Risk: Orta–Yüksek  
   - Bu fazda satın alma yapılmadı

4. **Ağ / domain** — Yeni subdomain veya NPM proxy kaydı istenirse ayrıca Owner onayı  
   - Mevcut NPM/domain’e dokunulmaz varsayılan

### Bağlı içerik SHA-256 (yerel)

| Dosya | SHA-256 |
|-------|---------|
| `docker-compose.faz5d.yml` | `9350D966145B4E818F62E0AA6677190969B68C0A76C088B5757F40CF2C53BC59` |
| `apps/api/src/engines/worker-lease.ts` | `BC5BA97CEB8485944880BDB1B591DA9DD0489D0DA8440FA3080E02DF334ED40A` |
| `apps/api/src/worker.ts` | `7E5E3D29F89161CC3CC1F575E3BC67F81EAA0847556729176757AA770AE58B7C` |
| `.../20261118050000_faz5d_worker_lease/migration.sql` | `A4006FD369B7373B3A3EE5EC36AF4392523BF525E1B4AEE015C8A3E363EBC782` |

Taslak onay dosyaları: `tasks/approvals/T-P5D-001-production_deploy.md`, `tasks/approvals/T-P5D-002-db_migration.md` (`status: pending`).

## Sonuç

Faz 5D kabul hedefleri izole ortam için karşılandı. Sistem hâlâ Owner denetimli; production 7/24 kurulumu onay + manuel/gelecek yürütücüye bağlıdır. **Dur — Faz 5E yok.**
