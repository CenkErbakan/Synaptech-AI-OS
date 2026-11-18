# SynapTech AI OS — Faz 4A Final Rapor

**Tarih:** 2026-11-17  
**Kod durumu:** Cursor Cloud Agents API v1 adapter + mock yürütme + onay kapısı  
**Otonomi:** kapalı  
**Live Cloud Agent:** varsayılan **KAPALI** (`CLOUD_AGENT_LIVE_ENABLED=false`)  
**Faz 4B:** başlamadı — Owner açık onayı bekleniyor  
**Not:** `config/system-status.yaml` korumalı; Owner güncellemeden Dashboard faz şeridi eski fazı gösterebilir.

## Özet

Faz 4A altyapısı tamamlandı: `CursorCloudAdapter`, mock istemci, canlı istemci (create kilidi), görev bazlı `cloud_agent_run` Owner onayı, MSSQL AgentRun genişlemesi (filtered unique `idempotencyKey`), kill switch Cloud iptal taraması, dashboard Cloud panelleri. Gerçek ücretli Cloud Agent, GitHub push, production ve On-Demand açma **yapılmadı**.

## Migration kök neden analizi

İlk deneme şu hatayla düştü:

1. **Hata 1505** — `CREATE UNIQUE INDEX` nullable `idempotencyKey` üzerinde: SQL Server standart UNIQUE indeksinde birden fazla `NULL` tekilleştirilir; mevcut AgentRun satırları (hepsi NULL) çakışır.
2. **Hata 207** — Filtered unique düzeltmesinden sonra: SQL Server aynı batch içinde yeni eklenen kolonu `CREATE INDEX` derlemesinde görmez.

**Uygulanan çözüm (UNIQUE kaldırılmadı):**

- Filtered unique index: `WHERE [idempotencyKey] IS NOT NULL` → NULL serbest, aynı dolu anahtar engelli.
- Index’ler `EXEC(N'...')` ile dinamik SQL’de oluşturuldu (batch 207 kaçınımı).
- Prisma şemasında `@unique` korundu; DB gerçeği filtered unique.

**Doğrulama:** `AgentRun_idempotencyKey_key` → `is_unique=true`, `has_filter=true`, `filter_definition=([idempotencyKey] IS NOT NULL)`.

Migration dosyası SHA-256: `20B2E35BA2B93502F1866BC7F1063A1D6A5AADBCA14C26E11604EF03455CDF5E`

## Oluşturulan dosyalar

| Yol | Açıklama |
|-----|----------|
| `apps/api/src/cursor/adapter.ts` | CursorCloudAdapter |
| `apps/api/src/cursor/mock-client.ts` | Ücretsiz mock API |
| `apps/api/src/cursor/live-client.ts` | v1 HTTP (create live bayrağına bağlı) |
| `apps/api/src/cursor/credentials.ts` | Anahtar varlık / allow-list |
| `apps/api/src/cursor/sanitize.ts` | Prompt güvenliği + redaksiyon |
| `apps/api/src/cursor/types.ts` | Zod şemaları (resmi run durumları) |
| `apps/api/src/engines/cloud-dispatch.ts` | Onay kapısı + execute + sync + kill iptal |
| `apps/api/src/modules/cloud/routes.ts` | Cloud API rotaları |
| `apps/api/prisma/migrations/20261117200000_phase4a_cloud_runs/` | MSSQL migration |
| `packages/shared/src/domain/cursor-cloud.ts` | Durum eşlemesi |
| `apps/dashboard/src/components/views/cloud-status-panel.tsx` | Kullanım / Cloud UI |
| `apps/dashboard/src/components/views/cloud-activity-panel.tsx` | Canlı aktivite Cloud |
| `apps/dashboard/src/components/views/agents-cloud-overlay.tsx` | Ajan kartı Cloud göstergesi |
| `apps/api/tests/cursor-adapter.unit.test.ts` | Adapter birim testleri |
| `packages/shared/tests/cursor-cloud.test.ts` | Domain testleri |
| `apps/api/scripts/inspect-agentrun.mjs` | Şema/index denetim scripti |

## Değiştirilen dosyalar (başlıca)

- `packages/shared` — `DISPATCH_STATES`, `cloud_agent_run` onay türü, demo seed
- `apps/api` — task-engine, approval-engine, kill-switch, env, app, integration tests
- `apps/dashboard` — görevler, ajanlar, aktivite, kullanım sayfaları
- `.env.example` — Cursor Cloud env şablonu

## API uç noktaları (yeni)

| Yöntem | Yol | Yetki | Not |
|--------|-----|--------|-----|
| GET | `/api/cloud/status` | Bearer | Anahtar değeri yok; bağlantı/mod |
| POST | `/api/cloud/verify` | Owner | Live kapalıysa uzak doğrulama atlanır |
| GET | `/api/cloud/runs` | Bearer | MSSQL run kayıtları |
| POST | `/api/cloud/runs/execute` | Owner | Onaylı task+repo; varsayılan mock |
| POST | `/api/cloud/tasks/:taskId/sync` | Owner | Cursor durum → domain |
| POST | `/api/cloud/runs/:runId/cancel` | Owner | İptal + doğrulama |

Mevcut Faz 3 uçları korundu. OpenAPI: `http://127.0.0.1:3101/api/docs` (sürüm 0.4.0).

## MSSQL değişiklikleri

`AgentRun` ek alanlar: `cursorAgentId`, `cursorRunId`, `githubRepository`, `branch`, `model`, `cursorStatus`, `errorMessage`, `resultSummary`, `prUrl`, `agentUrl`, `executionMode`, `approvalId`, `idempotencyKey`, token sayaçları, `cancelVerified`.

## Cursor API uyumluluğu (v1 public beta)

Desteklenen (dokümante): agent create/get, runs get/list/cancel, usage, SSE stream (istemci hazır; webhook yok).  
Uydurulmayan: webhook, hesap kalan kullanım API’si, On-Demand programatik kontrol.

**Run durumları:** `CREATING`, `RUNNING`, `WAITING_FOR_BACKGROUND_WORK`, `FINISHED`, `ERROR`, `CANCELLED`, `EXPIRED`.  
`FINISHED` → domain `in_review` (otomatik `done` yok). Bilinmeyen durum → `reconciliation_required`.

**Yerel `.cursor/agents/`:** Cloud VM’de otomatik yüklenmez varsayımı; pilotta `customSubagents` veya güvenli prompt rolü belgelenir. Tanım dosyaları silinmedi.

## Güvenlik kontrolleri

- API anahtarı yalnızca backend env; frontend / audit / prompt’a yazılmaz (test doğruladı).
- `cloud_agent_run` Owner onayı + boundVersion (içerik değişince geçersiz).
- Ajan kendi onayını veremez; execute Owner-only.
- Allow-list repository; SynapTech/Subify/Marivo production dokunulmaz.
- Kill switch: yeni create/dispatch engeli + aktif run iptal taraması.
- `KILL_SWITCH_SKIP_FILE_MIRROR` / test `NODE_ENV`: korumalı `config/kill-switch.json` testlerde değişmez (doğrulandı).
- Max 1 eşzamanlı Cloud run; pilotta otomatik retry yok; rate limit’te kontrollü durma.

## Test sonuçları (kanıt)

| Paket | Sonuç |
|-------|--------|
| `@synaptech/shared` | **49/49** |
| `@synaptech/api` (unit + integration) | **22/22** |
| `@synaptech/dashboard` | **5/5** |
| Typecheck shared + api | geçti |

Kapsanan senaryolar: mock adapter, auth hatası, yetkisiz repo, kill switch (dosya dokunulmadan), Owner onayı, sürüm değişimi, çift create / reconciliation, timeout, rate limit, live create kilidi, anahtar sızıntısı yok, DEMO izolasyon, CEO→onay→mock execute→sync.

## Dashboard

- **Görevler:** CEO formu → `awaiting_execution_approval`
- **Onaylar:** `cloud_agent_run`
- **Kullanım:** Cloud bağlantı + execute formu + run listesi; On-Demand “Doğrulanamıyor”
- **Aktivite / Ajanlar:** Cloud run overlay

Ekran görüntüleri bu turda yeniden çekilmedi; önceki Faz 3 görselleri `reports/qa/screenshots/` altında. Canlı UI doğrulaması Owner’ın `pnpm dev` + Gerçek mod ile yapılabilir.

## Desteklenmeyen / bilerek kapalı

- Gerçek Cloud Agent çalıştırma (Faz 4B)
- Hesap kalan kullanım (programatik yok)
- Webhook
- Automations / On-Demand
- Çoklu ajan zinciri (CEO→CTO→…) gerçek Cloud’da
- GitHub production repo bağlantısı

## Manuel yapılması gerekenler

1. İsteğe bağlı: `config/system-status.yaml` Owner güncellemesi (Faz 4A etiketi) — **korumalı; ajan yazmaz**.
2. Pilot öncesi: Cursor Dashboard’da On-Demand’in kapalı olduğunu manuel doğrula → `CLOUD_ON_DEMAND_VERIFIED=true`.
3. İzole test GitHub repository URL’sini `CLOUD_AGENT_ALLOWED_REPOS` içine yaz.
4. Faz 4B için ayrı Owner onayı (tek live run).

## İlk gerçek pilot (Faz 4B) ön koşulları

- [ ] Owner On-Demand kapalı doğrulaması
- [ ] İzole test repo + branch protection
- [ ] `CLOUD_AGENT_LIVE_ENABLED=true` yalnızca pilot anında
- [ ] Belirli task + approval + repository için execute
- [ ] Max 1 run; sonuç ve PR ayrı doğrulama
- [ ] Pilot bitince live bayrağını tekrar kapat

## Kabul kriterleri (Faz 4A)

| Kriter | Durum |
|--------|--------|
| Cursor API Adapter | Evet |
| Anahtar frontend’e sızmıyor | Evet |
| Live varsayılan kapalı | Evet |
| Owner onay sistemi | Evet |
| Task ↔ Cursor run ilişkisi | Evet |
| Kill switch yeni başlatmayı engeller | Evet |
| İptal mock test | Evet |
| Çift çalıştırma önleme | Evet |
| DEMO/Gerçek ayrımı | Evet |
| Testler geçti | Evet |
| GitHub push / production / ücretli API | Yapılmadı |

## Sonuç

**Faz 4A tamamlandı.** Faz 4B’ye otomatik geçilmedi.
