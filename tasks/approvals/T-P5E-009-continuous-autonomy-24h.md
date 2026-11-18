---
title: "Onay talebi — 24s restart-dayanıklı kontrollü otonomi"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: owner_approved_live_blocked_utc_day
ownerApprovedAt: "2026-11-18T17:58:00+03:00"
liveOutcome: "blocked_until_utc_2026-11-19 — openAutonomyWindow yok, MODE=local yok, Ollama üretme yok"
report: reports/qa/faz-5e-tp5e009-blocked-utc-gun-rapor.md
dependsOn: T-P5E-008 BLOCKED (24s pencere onay anında yoktu)
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | controlled_autonomy_enable |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os |
| Görev kimliği | T-P5E-009 |
| Risk | Yüksek |

## Açıklama

T-P5E-008 Owner onayı, restart sonrası da işleyen 24 saatlik otomatik kapanma olmadan verildi. Talimat gereği açılış **BLOCKED** kaldı; kota sıfırlanmadı; `MODE=local` yazılmadı.

Bu onay, **yalnızca aşağıdaki bağlı sürüme** ve **yeni UTC günde gerçek kota headroom’una** bağlı 24 saatlik yerel kontrollü otonomi içindir (süresiz / yüksek riskli eylemler hariç).

Önkoşullar (açılış anında kanıt):

1. UTC günde gerçek CEO headroom ≥ 1 ve ajan headroom ≥ 2 (T-P5E-009 limitleri: CEO 2, ajan 8, ajan başına 2). Kota silinmez.
2. `openAutonomyWindow({ taskId: "T-P5E-009" })` MSSQL penceresi yazar; `expiresAt = startedAt + 24h`.
3. Owner env: `CONTROLLED_AUTONOMY_MODE=local`, `SCHEDULER_AI_CEO_MODE=local`, `LOCAL_AGENT_EXECUTION_MODE=local`, `MODEL_PROVIDER=local`, `LOCAL_LLM_MODEL=qwen2.5:14b`, `AGENT_REPO_TOOLS_MODE=read_only`, `AGENT_SANDBOX_MODE=isolated`.
4. `CLOUD_AGENT_LIVE_ENABLED=false`, `CURSOR_CLOUD_MODE=mock`, On-Demand kapalı, kill switch kapalı.
5. Tek scheduler lease; `timerActive=true` çalışan süreçte; ikinci worker yok.
6. Süre dolunca `enforceAutonomyWindow` kapıları `off` yazar (restart sonrası da).
7. Yasak: ana repo yazma, GitHub push/PR/merge, production, müşteri ileti, blog yayın, reklam harcaması, ücretli AI API, Cloud Agent live, onaysız verified repo.

Onaylansa bile ajan env’i Owner yazmadan `MODE=local` yapmaz; pencereyi Owner onayı sonrası açar.

## Değişiklik özeti

- `apps/api/src/engines/autonomy-window.ts` — 24s pencere, fail-closed, expire→off
- Scheduler / tick / local CEO / quota snapshot / boot enforce
- Limit profili yalnızca aktif pencerede: CEO 2 / ajan 8 / ajan başına 2 / tick 2 / eşzamanlı LLM 1

## Bağlı sürüm

- Tür: content_sha256 (git commit yok)
- Ref / yol: 12 dosyalık T-P5E-008/009 otonomi penceresi paketi
- Sürüm (bundle SHA-256): `9B4F3CF72C0990DE695625BD89DB83DC87F7FE56818EB19874BE305D85AF1083`
- `autonomy-window.ts` SHA-256: `544D67EE432524595E056C6AAE4ED8A2F265D7E8C58E1666E21383121C7760B6`

Onay yalnızca bağlı sürüm için geçerlidir. **2026-11-18 18:06 sonrası** idle-skip `ai-ceo-scheduler.ts` dosyasını değiştirdi; eski bundle SHA `9B4F3CF7…` geçersiz. Pencere dosyası SHA aynı (`544D67EE…`). UTC 19 açılışı `tasks/approvals/owner-operasyon-yetki-plani.md` madde A’daki yeni scheduler SHA ile yapılır. Canlı açılış hâlâ yok.

## Geri alma planı

- Kill switch `enabled: true` (Owner)
- Tüm `CONTROLLED_AUTONOMY_MODE`, `SCHEDULER_AI_CEO_MODE`, `LOCAL_AGENT_EXECUTION_MODE`, `AGENT_REPO_TOOLS_MODE`, `AGENT_SANDBOX_MODE` = `off`
- `closeAutonomyWindow` veya süre dolumu (otomatik)

## Not

Onayı yalnızca kullanıcı verir. Faz 1–2’de onaylanan işi ajan production’a taşımaz.

T-P5E-007 BLOCKED kota geçmişi korunur. En erken kota headroom: `2026-11-19T00:00:00.000Z` (UTC gün değişimi); o anda da gerçek sayaçlar kontrol edilir.

Owner onayı 2026-11-18 17:58+03 alındı. Gözlenen UTC `2026-11-18T14:58:52Z` — koşul 2 nedeniyle canlı açılış yok. Kanıt: `reports/qa/faz-5e-tp5e009-blocked-utc-gun-rapor.md`.

## Veri kaynakları

- `reports/qa/faz-5e-tp5e008-blocked-24h-window-rapor.md`
- `reports/qa/faz-5e-tp5e007-quota-detail.json` (sıfırlanmadı)
- Vitest: `tests/autonomy-window.unit.test.ts` 5/5
