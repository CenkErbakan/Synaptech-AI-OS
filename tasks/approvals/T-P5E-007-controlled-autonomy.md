---
title: "Onay talebi — kontrollü otonomi (sürekli otomasyon kapısı)"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: owner_approved_live_blocked_quota
ownerApprovedAt: "2026-11-18T14:50:00+03:00"
liveOutcome: "blocked_daily_llm_cap — limit yükseltilmedi / kota sıfırlanmadı"
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | controlled_autonomy_enable |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os |
| Görev kimliği | T-P5E-007 |
| Risk | Yüksek |

## Açıklama

T-P5E-003…006-retry pilotları doğrulandı. Bu onay, **Owner verdikten sonra** kontrollü otonomi env kapılarının açılması içindir.

Hazırlık kodu tamamlandı; **bu onaydan önce** canlı Ollama / sürekli otonomi **etkinleştirilmedi**.

Onay sonrası Owner’ın manuel uygulayacağı ilk güvenli profil (öneri):

1. `CONTROLLED_AUTONOMY_MODE=mock` (veya kanıtlıysa `local`)
2. `SCHEDULER_AI_CEO_MODE=mock|local` (local yalnızca Ollama ayaktayken)
3. `LOCAL_AGENT_EXECUTION_MODE` aynı hizada (`mock`↔`mock`, `local`↔`local`)
4. `AGENT_REPO_TOOLS_MODE=read_only` yalnızca verified repo’lar için
5. `AGENT_SANDBOX_MODE=isolated` (kod/test için Docker zorunlu)
6. `MODEL_PROVIDER=local`, `LOCAL_LLM_MODEL=qwen2.5:14b`
7. Cloud live / On-Demand / ücretli API kapalı
8. `continuousAutomation` kodda hâlâ `false` — yalnızca salt-okunur araştırma, analiz, taslak, fixture/sandbox

**Ayrı Owner onayı gerektirenler (otomatik değil):** gerçek repo kod değişikliği, GitHub push/PR/merge, production deploy, reklam harcaması, blog yayını, müşteri iletişimi.

## Değişiklik özeti (Owner onay sonrası manuel)

1. Yukarıdaki env değerlerini `.env` içine yaz
2. API + scheduler/worker süreçlerini yeniden başlat
3. Dashboard `/ajanlar` ve `/api/autonomy/status` ile `controlledAutonomyMode` doğrula
4. İlk döngü: CEO plan → child dispatch → en fazla `LOCAL_AGENT_TICK_MAX` ajan (sırayla 1 LLM)
5. Kanıt: MSSQL Task / AgentMessage / AuditLog + dashboard kuyruk/blokaj
6. PC kapalı / Ollama yoksa fail-closed; Cloud’a sessiz geçiş yok

## Bağlı sürüm

- Tür: content_sha256 (bundle)
- Bundle SHA-256: `AA4F0BF5DF0AAB568500E5F8547F3500591DD325A0567662C5491D3428505CC1`
- Dosyalar:
  - `packages/shared/src/domain/agent-capabilities.ts` → `E0E331384DA3C3DFD3D23C4AA0B40BCDC4951264D1F6BB6578CDA7C94F92A48F`
  - `apps/api/src/engines/autonomy-policy-gate.ts` → `259961C41B29A5B028CE48F8E5B7CE4FA47F2FEB6D283A7A1B1A810FF2D79056`
  - `apps/api/src/engines/autonomy-tick-orchestrator.ts` → `F57071058615D41643774F57CA30C9F985B00DD6B1943C83604A8AC7C2ED0E2A`
  - `apps/api/src/ai/repo/acceptance-verifier.ts` → `D66D3E19E94FC63DB393EAC30B3A6159C5237601552A94786287A027A27EB167`
  - `apps/api/src/ai/local-agent-execution.ts` → `A5A65F481CBE2F57575D8149A8071BE50CCECE96F84357543830B08ECC1AAB84`
  - `apps/api/src/lib/env.ts` → `97B2D0D14FA61DDA53EE939A52AA9217EF8A39B7FDC4EFCB2DDE298F457B7C65`
  - `apps/api/src/engines/autonomy-scheduler.ts` → `70D95B34321CDF137E907850BA3C4B8944DAA0C8718A77DB36DA676E640D76A5`
  - `apps/api/src/engines/agent-runtime-summary.ts` → `8F6B0479F1267864841FC3B42377AD8510F2016215048C98DA3D6AE52D840160`
- Rapor: `reports/qa/faz-5e-kontrollu-otonomi-hazirlik-rapor.md`
- Test kanıtı: controlled-autonomy + Docker izolasyon + local-agent + runtime-summary + scheduler AI (29 test geçti; canlı Ollama yok)

Onay yalnızca bu sürüm için geçerlidir. İçerik değişirse yeni onay gerekir.

## Geri alma planı

- `CONTROLLED_AUTONOMY_MODE=off`
- `SCHEDULER_AI_CEO_MODE=off`
- `LOCAL_AGENT_EXECUTION_MODE=off`
- `AGENT_REPO_TOOLS_MODE=off`
- `AGENT_SANDBOX_MODE=off`
- Kill switch gerekirse `enabled: true`
- Lease/idempotency MSSQL’de kalır; çift yürütme engeli korunur

## Not

Onayı yalnızca Owner verir. Onaylansa bile ajan env’i kendi başına açmaz; Owner manuel uygular. Bu oturumda yeni Ollama çağrısı ve sürekli otonomi **başlatılmadı**.
