# Faz 5A — Autonomous Core Sonucu

**Durum:** Tamamlandı (yalnızca Faz 5A). Faz 5B+ başlatılmadı.  
**Planner:** `deterministic` — gerçek LLM değildir.  
**Cloud create / On-Demand / ücretli API / Automations:** yok.

Kanıt JSON: `reports/qa/faz-5a-acceptance-evidence.json`

---

## 1. Değiştirilen / eklenen dosyalar

### Prisma / API çekirdek
- `apps/api/prisma/schema.prisma` — `parentTaskId`, `executionPolicy`, `origin`; `AgentRun.reconcile*`; `CompanyGoal`, `Opportunity`, `AutonomyPolicy`, `ScheduledJob`, `ScheduledJobRun`, `AgentMessage`
- `apps/api/prisma/migrations/20261118020000_faz5a_autonomy_core/migration.sql`

### Motorlar
- `apps/api/src/engines/cloud-dispatch.ts` — live/mock kapasite ayrımı
- `apps/api/src/engines/run-reconciliation.ts` — stale mock TTL (15 dk) + live reconcile
- `apps/api/src/engines/opportunity-engine.ts` — deterministik fırsat taraması
- `apps/api/src/engines/ceo-orchestrator.ts` — deterministik CEO döngüsü
- `apps/api/src/engines/autonomy-dispatch.ts` — AUTO yerel ready; Cloud create yok
- `apps/api/src/engines/autonomy-scheduler.ts` — idempotent tick + boot timer

### API / boot
- `apps/api/src/modules/autonomy/routes.ts`
- `apps/api/src/app.ts` — autonomy routes kaydı
- `apps/api/src/index.ts` — `startAutonomyScheduler(60_000)`
- `apps/api/src/modules/cloud/routes.ts` — `activeLiveRuns` / `activeMockRuns` (önceki adım)
- `apps/api/scripts/faz5a-acceptance-probe.ts`

### Dashboard
- `apps/dashboard/src/app/otonomi/page.tsx`
- `apps/dashboard/src/components/views/autonomy-panel.tsx`
- `apps/dashboard/src/components/layout/nav-items.ts` — Otonom Faaliyet menüsü
- `apps/dashboard/src/components/common/status-badges.tsx` — `expired` stil (typecheck)

### Testler
- `apps/api/tests/autonomy.unit.test.ts`
- `apps/api/tests/api.integration.test.ts` — Faz 5A kabul senaryosu
- `apps/api/tests/cursor-adapter.unit.test.ts` — opsiyonel `repos?` typefix

---

## 2. Prisma migration sonuçları

Komut: `pnpm --filter @synaptech/api prisma:deploy`

```
Applying migration `20261118020000_faz5a_autonomy_core`
All migrations have been successfully applied.
```

`prisma generate` başarılı (Prisma Client 7.10.1).

---

## 3. Çalışan servisler

| Servis | Adres | Not |
|--------|-------|-----|
| MSSQL | `127.0.0.1:14333` | healthy |
| API | `http://127.0.0.1:3101` | Autonomy scheduler boot’ta açıldı |
| Dashboard | `http://127.0.0.1:3100` | `/otonomi` → HTTP 200 |

API boot log kanıtı:
`Autonomy scheduler başlatıldı (*/2 ceo_cycle, */5 reconciliation).`

Job’lar: `daily-ceo-review` (`*/2`), `run-reconciliation` (`*/5`), timezone `Europe/Istanbul`.

---

## 4. Test sonuçları

| Paket | Sonuç |
|-------|--------|
| `@synaptech/api` typecheck | geçti |
| `@synaptech/api` vitest | **30/30 geçti** (unit + integration dosyaları) |
| `@synaptech/dashboard` vitest | **5/5 geçti** |
| `@synaptech/dashboard` typecheck | geçti |
| Guard hook testleri | **8/8 geçti** |

Not: `pnpm --filter @synaptech/api test:integration` ayrı config dosyası eksik; entegrasyon testleri ana `vitest run` içinde çalışıyor.

---

## 5. Scheduler’ın gerçekten tetiklendiğine dair kanıtlar

1. Boot log: scheduler başlatıldı (yukarıda).
2. MSSQL `ScheduledJob.lastStatus=succeeded` + `lastFinishedAt` dolu (`daily-ceo-review`, `run-reconciliation`).
3. `AuditLog.action = scheduler.tick` birden fazla kayıt.
4. Kabul probe: `POST /api/autonomy/scheduler/tick` → 200; due değilse `skipped` (idempotent kova — beklenen davranış).
5. Entegrasyon testi: “Faz 5A: scheduler tick → fırsat → CEO görev → AgentMessage”.

---

## 6. MSSQL görev ve fırsat kayıtları (özet)

Probe anında (örnek):

- **CompanyGoal:** 4 (synaptech-ai-os, synaptech, subify, marivo)
- **Opportunity:** ≥5, `verified=true`, kanıt `evidenceRef` (ör. `project:…:openTasks=…`, `failedRuns=…`)
- **Task:** üst görev (`assigneeId=ceo`, `origin=opportunity:…`) + alt görev (`parentTaskId` set, ajan atanmış)
- **AgentMessage:** CEO → cto / tester / growth-lead handoff
- **AuditLog:** `opportunity.scan_completed`, `ceo.cycle_completed`, `dispatch.auto_ready`, `scheduler.tick`

Örnek üst/alt:
- Parent `0f78d2cd-…` → Sub `5310d5b7-…` (`cto`, `dispatchState=ready`)
- Parent `9936e046-…` → Sub `81a7c3a1-…` (`growth-lead`)

Dört proje fırsat taramasında değerlendirildi; en az bir (fiilen birden çok) kanıta dayalı fırsat kabul edilip göreve dönüştü.

---

## 7. Dashboard doğrulaması

- Menü: **Otonom Faaliyet** → `/otonomi`
- Sayfa HTTP **200**
- Panel API üzerinden: status, fırsatlar, otonom görevler, AgentMessage; `planner=deterministic`, `llmIntegrated=false`
- Owner “Tick çalıştır” butonu: `POST /api/control/autonomy/scheduler/tick`

---

## 8. Hâlâ eksik olan gerçek LLM entegrasyonu (Faz 5A sonrası rapor)

Faz 5A bilinçli olarak **mock/deterministik** kaldı. Gerçek AI CEO için sonraki adımlar (henüz yapılmadı):

### Model sağlayıcısı
- Yerel orkestratörde LLM yok; Cursor Cloud Agent prompt’u yalnızca onaylı live path’te (4B pilot) kullanıldı.
- Ücretli harici API (OpenAI/Anthropic vb.) **eklenmedi** ve güvenlik sınırında yasak.
- Gerçek CEO için seçenekler: (A) Cursor Cloud Agent + sıkı allow-list/bütçe, (B) Owner onaylı yerel model sağlayıcısı — ikisi de Faz 5B+ ve ayrı onay ister.

### Cursor Cloud API uygunluğu
- Live create mevcut adapter ile mümkün; Faz 5A `AutonomousDispatchEngine` **POLICY-AUTO Cloud’u bilinçli blokluyor** (`faz5a_no_live_cloud_dispatch` / live kapalı).
- Allow-list değiştirilmedi (Pilot dışı genişleme yok).
- `autoCreatePR=false`, `workOnCurrentBranch=false` korunuyor.

### Bütçe kısıtları
- On-Demand Spending açılmadı.
- `CLOUD_ON_DEMAND_VERIFIED` olmadan otomatik Cloud yok.
- Live kapasite ayrı sayılır; stale mock TTL live kotayı doldurmaz.
- Cursor Automations etkinleştirilmedi; Cloud Agents maliyet kapısı Faz 5A’da açılmadı.

### Güvenlik sınırlarına uyum (bu fazda)
- Gerçek Cloud Agent başlatılmadı (otonom path).
- Production deploy / VPS / protected merge / müşteri ileti / canlı yayın / hook gevşetme yok.

---

## Kabul kriterleri kontrol listesi

| Kriter | Sonuç |
|--------|--------|
| Manuel görev oluşturmadan akış | Geçti (scheduler/CEO) |
| Scheduler otomatik tetik | Geçti (boot + interval) |
| Dört proje değerlendirme | Geçti (opportunity scan) |
| ≥1 kanıta dayalı fırsat | Geçti |
| MSSQL üst + alt görev | Geçti |
| Ajana atama | Geçti |
| AgentMessage + AuditLog | Geçti |
| Dashboard gösterimi | Geçti (`/otonomi`) |
| Mock/deterministik; LLM diye sunmama | Geçti (`planner=deterministic`) |

**Faz 5A burada durur. Faz 5B başlatılmadı.**
