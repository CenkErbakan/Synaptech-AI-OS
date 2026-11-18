---
title: "Faz 5E — Kontrollü otonomi hazırlık raporu"
date: "2026-11-18"
task: T-P5E-007
status: ready_for_owner_approval
continuousAutomation: false
liveOllamaThisSession: false
---

# Kontrollü otonomi — hazırlık tamam, canlı etkinleştirme yok

## Özet

Dokuz ajan için capability matrix, politika kapısı, CEO→ajan tick orkestratörü, growth/security taslak kabul şemaları, retry/escalation, günlük LLM limitleri ve dashboard kuyruk/blokaj alanları mevcut scheduler/worker üzerine eklendi. **CONTROLLED_AUTONOMY_MODE varsayılan `off`.** Bu oturumda yeni Ollama çağrısı ve sürekli otonomi **başlatılmadı**.

## Doğrulanan önceki pilotlar (bağlam)

| Pilot | Sonuç |
|-------|--------|
| T-P5E-003 | Gerçek Ollama AI CEO planlama |
| T-P5E-004 | Gerçek Developer (analiz) |
| T-P5E-005 | Gerçek CTO repo_read |
| T-P5E-006-retry | Developer sandbox_diff + Tester Docker test |

## Bu turda eklenenler

1. **Capability matrix** — `packages/shared/src/domain/agent-capabilities.ts` (9 ajan)
2. **Policy gate** — Owner gated eylemler, unverified repo engeli, Docker zorunluluğu
3. **Tick orkestratör** — `ceo_cycle` sonrası ajan pass; mode=off ise no-op
4. **Acceptance** — growth/seo/content/ads/security yapısal taslak; araçsız CTO/dev done olmaz
5. **modelProposal vs toolActions** — MSSQL `executionResult` içinde ayrı
6. **Retry → Owner escalation** — `CONTROLLED_AUTONOMY_MAX_RETRIES` sonrası `awaiting_approval`
7. **Limitler** — günlük global + ajan başına; eşzamanlı LLM lease = 1
8. **Dashboard** — kuyruk, blokaj, süre, yetenekler, `controlledAutonomyMode`
9. **GitHub/Cursor** — configDeclared ≠ observedRuntime (önceki ayrım korundu)

## Varsayılan kapılar (şu an)

```
CONTROLLED_AUTONOMY_MODE=off
SCHEDULER_AI_CEO_MODE=off   # .env’de ne varsa; kod varsayılanı off
LOCAL_AGENT_EXECUTION_MODE=off
continuousAutomation=false
```

## Test kanıtı (bu oturum)

Komut (apps/api):

`vitest run tests/controlled-autonomy.unit.test.ts tests/sandbox-docker-isolation.integration.test.ts tests/local-agent-execution.integration.test.ts tests/agent-runtime-summary.integration.test.ts tests/faz5e-scheduler-ai.integration.test.ts`

Sonuç: **5 dosya, 29 test geçti.** Canlı Ollama yok; Docker izolasyon testleri dahil.

## Owner onayı

Dosya: `tasks/approvals/T-P5E-007-controlled-autonomy.md`  
Bundle SHA-256: `AA4F0BF5DF0AAB568500E5F8547F3500591DD325A0567662C5491D3428505CC1`

Onay sonrası Owner manuel env açar; ajanlar env’i kendi başına açmaz.

## Bilinçli duruş

- Gerçek sürekli otonomi **etkinleştirilmedi**
- Yeni gerçek Ollama çağrısı **yok**
- Gerçek repo / production / Cloud / ücretli API **yok**
- PC kapalıyken Ollama kullanılamaz; Cloud’a sessiz geçiş **yok**
