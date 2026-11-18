---
title: "T-P5E-007 — Kota muhasebesi ve otomatik tetikleme düzeltmesi"
date: "2026-11-18"
status: code_complete_live_off
liveOllamaThisSession: false
tP5e007BlockedPreserved: true
---

# Kota tutarsızlığı ve scheduler doğrulama

Canlı otomasyon **açılmadı**. T-P5E-007 BLOCKED kaydı korunur. Limitler değiştirilmedi, audit silinmedi.

## 1) Kota kök nedenleri

### CEO 12 vs 1
`countSchedulerAiCeoRunsToday()` `SCHEDULER_AI_CEO_MODE=off` iken **tüm** `ai.scheduler_ceo_cycle` satırlarını sayıyordu (mock dahil). Local modda yalnızca `realAiExecution` süzülüyordu. Status endpoint off iken 12, local bütçe 1 gösteriyordu.

Ek: `meta.mode==="local"` gerçek AI sanılıyordu; bu yanlış.

### Ajan 9 vs 7
`countRealLocalModelCallsToday()` üç eylemi birleştiriyordu: `ai.scheduler_ceo_cycle` + `ai.local_ceo_pilot` + `ai.local_agent_execution`. 1 gerçek scheduler CEO + 1 yerel CEO pilot + 7 ajan = **9**. Global ajan kotası CEO çağrılarını yiyordu.

## 2) Politika (canonical)

| Kavram | Kota |
|--------|------|
| Probe / lease / kill / idempotent skip | Sayılmaz |
| Mock ModelProvider | Yalnızca mock bütçe; gerçek kotayı tüketmez |
| Gerçek Ollama çağrısı (JSON/acceptance fail dahil) | Gerçek kota (`providerInvoked`) |
| `ai.local_ceo_pilot` | Scheduler/ajan kotasına **dahil değil** |
| Çift audit | `quotaCallId` ile tekilleştirilir |

UTC gün `00:00Z`–`24:00Z`. Dolu kotada `nextEligibleAt` = sonraki UTC gece yarısı.

## 3) Otomatik tetikleme

- `CONTROLLED_AUTONOMY_MODE=local` + `LOCAL_AGENT_EXECUTION_MODE=local` → `runControlledAutonomyTick` ajan pass açar (CEO `ceo_cycle` sonrası).
- `continuousAutomation` **sabit false değil**: timer bu süreçte aktif **ve** üç kapı aynı `mock|local` **ve** kill/cloud kapalı ise true.
- `timerActive=false` preflight’ta doğruydu: script **ayrı süreç**; API `startAutonomyScheduler` yalnızca `index.ts` / `worker.ts` içinde.
- API gömülü scheduler (`EMBED_SCHEDULER≠0`) ve ayrı worker aynı `scheduler:tick` lease’i paylaşır; bir tick’te tek sahip; `ScheduledJobRun.idempotencyKey` çift job’u keser.
- Manuel: `POST /api/autonomy/scheduler/tick` → `trigger=manual_api` (timer değildir).
- Zincir: timer/`ceo_cycle` → `runScheduledAiCeoCycle` → grounding → Task + AgentMessage → `dispatchAutonomousChildren` → `runControlledAutonomyTick` → ajan araçları → acceptance → CEO bağlamına `recentAgentResults`.

## 4) Test

`vitest` dosyaları: `llm-quota.unit.test.ts`, `controlled-autonomy.unit.test.ts`, `faz5e-scheduler-ai.integration.test.ts`, Docker/ajan regresyonları.

## 5) Önerilen güvenli günlük profil (bu turda uygulanmadı)

| Sayaç | Öneri | Mevcut (değiştirilmedi) |
|-------|--------|-------------------------|
| CEO gerçek | 2/gün | 1 |
| Global ajan gerçek | 8/gün | 4 |
| Per-agent | 2/gün | 6 |
| Eşzamanlı LLM | 1 | 1 |
| Tick ajan | 2 | 2 |

UTC gün değişince otomatik headroom; kota sıfırlama yok.

## 6) İlk sürekli otomasyon için Owner onayı

Dosya: `tasks/approvals/T-P5E-008-continuous-autonomy.md`  
Önkoşul: UTC günde gerçek CEO/ajan headroom; üç mod `local`; Docker+Ollama; Cloud kapalı; timer’lı API veya worker.
