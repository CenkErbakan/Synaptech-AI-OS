---
title: "Onay talebi — CTO + Developer gerçek yerel LLM ajan pilotu"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: applied
appliedAt: "2026-11-18T01:36:55Z"
appliedBy: owner
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | real_ai_provider_pilot |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os |
| Görev kimliği | T-P5E-004 |
| Risk | Yüksek |

## Açıklama

Yerel ajan yürütme altyapısı + mock testler tamam (`LOCAL_AGENT_EXECUTION_MODE=off`).

Bu onay **yalnızca sınırlı bir gerçek Ollama ajan pilotu** içindir:

- Roller: **cto**, **developer** (aynı model `qwen2.5:14b`, sırayla)
- Kaynak: T-P5E-003 / `scheduler-ai-ceo:*` uygun `planned` görevler (arşivli değil)
- Çıktı MSSQL: `executionResult`, `model`, `executionKind=local_llm`, AgentMessage `result`
- `acceptanceMet` false ise görev **done olmaz**
- `codeChangeApplied=false` (repo/sandbox değişikliği yok)
- Pilot bitince `LOCAL_AGENT_EXECUTION_MODE=off`

Kapsam dışı: Cloud Agent, production deploy, GitHub merge, reklam, blog, müşteri iletişimi, sürekli otomasyon, diğer 6 rol.

## Değişiklik özeti (Owner onay sonrası manuel)

1. `.env`: `LOCAL_AGENT_EXECUTION_MODE=local`, `MODEL_PROVIDER=local`
2. API yeniden başlat
3. `POST /api/ai/agents/execute` body örneği:  
   `{ "limit": 2, "agentIds": ["cto", "developer"] }`
4. Kanıt kontrolü → hemen `LOCAL_AGENT_EXECUTION_MODE=off`

## Bağlı sürüm

- Tür: content_sha256
- `apps/api/src/ai/local-agent-execution.ts` → `9F9C027E91A4FA02312A423E215EF6A665B999900154FD0CD306AA2BF8BEDB7F`
- `apps/api/src/ai/agent-roles.ts` → `868FD1C3797C1805DD6B1D2705A3FD837BAC85D4A448DC9557FB81D77F4A8E23`
- `apps/api/src/ai/llm-call-guard.ts` → `A9CC498A8B4AEC26EA660BE26F7C01BBEBA4152AA9B143CA5D6CD9C1AE9900BF`
- Rapor: `reports/qa/faz-5e-local-agent-execution-rapor.md`

## Geri alma planı

- `LOCAL_AGENT_EXECUTION_MODE=off`
- API yeniden başlat
- İstenirse ilgili görevlerde `executionKind` / `executionResult` incele; silme yok

## Not

Onaylanmadan ajan `local` moda geçmez / yeni gerçek model çağrısı başlatmaz. Bu onay başka çalıştırmaya aktarılamaz.
