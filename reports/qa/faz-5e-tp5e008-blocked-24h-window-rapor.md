---
title: "T-P5E-008 — İlk sürekli kontrollü otonomi BLOCKED"
date: "2026-11-18"
task: T-P5E-008
status: BLOCKED
reason: missing_restart_proof_24h_window_at_approval_time
liveOllamaThisSession: false
modesChanged: false
quotaReset: false
auditDeleted: false
continuousAutomation: false
nextApproval: T-P5E-009
---

# T-P5E-008 — BLOCKED

Owner 24 saatlik sınırlı yerel otomasyonu onayladı. Talimat: restart sonrası da geçerli otomatik kapanma yoksa **açılış yapılmaz**, mekanizma hazırlanır, yeni onay istenir.

T-P5E-008 onay anında bu mekanizma yoktu. Açılış **yapılmadı**. `openAutonomyWindow` çağrılmadı. Env kapıları `local` yazılmadı. Yeni Ollama üretimi başlatılmadı. Kota/audit silinmedi.

## 1) Onay ve sürüm

| Alan | Değer |
|------|--------|
| Onay dosyası | `tasks/approvals/T-P5E-008-continuous-autonomy.md` |
| Git commit | yok (depo `No commits yet on main`) |
| Bundle SHA-256 | `9B4F3CF72C0990DE695625BD89DB83DC87F7FE56818EB19874BE305D85AF1083` |
| Pencere kodu SHA-256 | `544D67EE432524595E056C6AAE4ED8A2F265D7E8C58E1666E21383121C7760B6` (`apps/api/src/engines/autonomy-window.ts`) |

T-P5E-008 bu bundle’a bağlı değildir; onay, kapanma kodundan önce verildi. Yeni onay: `tasks/approvals/T-P5E-009-continuous-autonomy-24h.md`.

## 2) Neden açılmadı

1. **24 saat otomatik kapanma** onay anında yoktu; restart sonrası süre RAM’e bağlı kalamaz. Fail-closed pencere (`SystemSetting.controlled_autonomy_window`) bu turda eklendi; **aktif pencere yazılmadı**.
2. **UTC gün 2026-11-18** hâlâ açık (gözlem ~14:54Z). T-P5E-007 kaydı: `ceoReal` kotası dolu, ajan kotası dolu. Limit yükseltmesi ve kota sıfırlama **yapılmadı**. `nextEligibleAt` = `2026-11-19T00:00:00.000Z`.
3. Çalışan süreç **yeni pencere kodunu yüklemiş değil**; canlı restart + `MODE=local` yapılmadı.

## 3) Ön kontroller (okuma)

| Kapı | Sonuç |
|------|--------|
| Kill switch | Kapalı (`config/kill-switch.json` `enabled: false`) |
| Ollama `qwen2.5:14b` | Kayıtlı (`127.0.0.1:11434` tags; üretme yok) |
| Docker Engine | `29.8.0` |
| MSSQL | `synaptech-ai-os-mssql` Up 23h (healthy); API health `database.ok=true` latency 7ms |
| API :3101 | Ayakta |
| Dashboard :3100 | Node dinliyor |
| Mevcut worker | `worker-Cenk-26988-5269abf2`, `timerActive=true`, lastTick `2026-11-18T14:53:50.784Z` |
| İkinci worker | Başlatılmadı |
| Cloud live / On-Demand | Bu turda açılmadı; `.env.example` `CLOUD_AGENT_LIVE_ENABLED=false`, `CURSOR_CLOUD_MODE=mock`, `CLOUD_ON_DEMAND_VERIFIED=false` |
| Kota sıfırlama | Yok |

`GET /api/autonomy/status` 401 (Owner token sohbete alınmadı).

## 4) Eklenen kapanma mekanizması (canlı değil)

- MSSQL `SystemSetting` anahtarı `controlled_autonomy_window`: `enabled`, `startedAt`, `expiresAt` (24s), limitler.
- Tick/boot: `enforceAutonomyWindow` — süre dolduysa `*_MODE=off` persist + audit `autonomy.window_closed`.
- Pencere yokken `SCHEDULER_AI_CEO_MODE=local` bile CEO/ajan **skip** (`no_autonomy_window`).
- `continuousAutomation` timer + üç kapı + kill/cloud off **ve** `windowActive`.
- Kota overlay yalnızca aktif pencerede: CEO 2, ajan 8, ajan başına 2, tick 2, eşzamanlı LLM 1.
- `openAutonomyWindow` limit anahtarlarını yazar; **`MODE=local` yazmaz**. Bu turda çağrılmadı.

Test: `apps/api` vitest `autonomy-window.unit.test.ts` 5/5 geçti (2026-11-18 17:54 yerel). Önceki tur: 6 dosya / 35 test geçti.

## 5) Otomasyon raporu (istenen kanıtlar)

| İstenen | Durum |
|---------|--------|
| Gerçek timer başlangıcı (T-P5E-008) | Yok — yeni timer başlatılmadı |
| Timer/worker/lease (mevcut süreç) | `worker-Cenk-26988-5269abf2` — T-P5E-008 local profili değil |
| İlk gerçek otomatik CEO | Yok |
| Dağıtılan görevler | Yok (bu onay) |
| Gerçek model çalıştıran ajanlar | Yok (bu oturum) |
| Kabul / engel | Açılış BLOCKED |
| Günlük LLM | T-P5E-007 kaydı korunur; sıfırlanmadı |
| 24s otomatik kapanma | Kod hazır, pencere **kapalı/yok** |

## 6) Sonraki adım (T-P5E-009)

Owner onaylar ve **yeni UTC günde** headroom varsa (sıfırlama yok):

1. Bu bundle’ı yükleyen API/worker restart (tek scheduler lease).
2. Owner `MODE=local` yazar; ajan `openAutonomyWindow({ taskId: "T-P5E-009" })` çağırır.
3. 24s sonra kapılar off; kill switch veya kritik hata da durdurur.

Yüksek riskli işler (repo yazma, push/PR/merge, deploy, müşteri, blog, ads, ücretli API, Cloud Agent, onaysız verified repo) **yasak** kalır.
