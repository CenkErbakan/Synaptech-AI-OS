---
title: "Onay talebi — ilk sürekli kontrollü otonomi (timer)"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: blocked_missing_24h_window
outcome: "Açılış yapılmadı — restart-dayanıklı 24s kapanma T-P5E-008 onay anında yoktu; mekanizma eklendi, yeni onay T-P5E-009."
blockedAt: "2026-11-18T14:54:00.000Z"
bundleSha256: "9B4F3CF72C0990DE695625BD89DB83DC87F7FE56818EB19874BE305D85AF1083"
report: reports/qa/faz-5e-tp5e008-blocked-24h-window-rapor.md
nextApproval: T-P5E-009
dependsOn: T-P5E-007 BLOCKED geçmişi korunur
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | controlled_autonomy_enable |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os |
| Görev kimliği | T-P5E-008 |
| Risk | Yüksek |

## Açıklama

T-P5E-007 tek döngü **günlük kota** nedeniyle BLOCKED kaldı (doğru). Kota muhasebesi düzeltildi; bu onay **henüz uygulanmadı**.

Bu onay, Owner verdikten sonra **sınırlı timer’lı** sürekli döngü içindir (süresiz/sınırsız değil):

1. Yeni UTC günde gerçek CEO kotasında headroom ≥ 1 ve ajan headroom ≥ 2
2. `SCHEDULER_AI_CEO_MODE=local`, `LOCAL_AGENT_EXECUTION_MODE=local`, `CONTROLLED_AUTONOMY_MODE=local`
3. API `EMBED_SCHEDULER=1` veya ayrı worker; `timerActive=true` kanıtı
4. Cloud live / On-Demand / ücretli API kapalı
5. `AGENT_REPO_TOOLS_MODE=read_only` yalnızca verified; sandbox `isolated` + Docker
6. Push/PR/merge/deploy/blog/ads/müşteri iletişimi yok

Onaylansa bile ajan env açmaz; Owner manuel yazar ve süreçleri yeniden başlatır.

## Geri alma

Tüm `*_MODE=off`; kill switch isteğe bağlı.

## Not

Limitler bu onayda da varsayılan env’e yazılmadı (pencere yokken overlay yok). Kota doluysa `nextEligibleAt` beklenir.

Kanıt: `reports/qa/faz-5e-tp5e008-blocked-24h-window-rapor.md`. Sonraki onay: `tasks/approvals/T-P5E-009-continuous-autonomy-24h.md`.
