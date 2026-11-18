---
title: "Onay talebi — Developer + Tester izole sandbox gerçek pilotu"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: blocked
blockedAt: "2026-11-18T02:17:30Z"
blockedReason: "sandbox_isolation_unproven — FS/process/network izolasyonu kanıtlanamadı; canlı test başlatılmadı"
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | real_ai_provider_pilot |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os (fixture veya Owner seçimli verified repo) |
| Görev kimliği | T-P5E-006 |
| Risk | Yüksek |

## Açıklama

Developer sandbox patch + Tester allow-list + güçlendirilmiş kabul doğrulayıcı fixture testleriyle hazır.

Bu onay **tek seferlik** gerçek Ollama Developer → Tester zinciri içindir:

1. `AGENT_REPO_TOOLS_MODE=read_only`, `AGENT_SANDBOX_MODE=isolated`, `LOCAL_AGENT_EXECUTION_MODE=local`
2. Yalnızca **verified** bağ + izole temp kopya (ana repo/master yazılmaz)
3. Maks 1 Developer + 1 Tester gerçek model çağrısı (aynı anda 1 Ollama)
4. `codeChangeApplied` yalnızca boş olmayan `sandbox_diff` ile
5. Tester `done` yalnızca `sandbox_command` + `exitCode=0` + digest ile; sonuç CTO’ya AgentMessage
6. Push / PR / merge / Cloud / production yok
7. Bitince tüm modlar `off`

Kapsam dışı: Marivo/SynapTech yazma (Owner ayrıca seçmedikçe), GitHub allow-list genişletme, T-P5E-004/005 geçmişini değiştirme, sürekli otomasyon.

## Değişiklik özeti (Owner onay sonrası manuel)

1. Hedef verified repo + sandbox env aç
2. Parent görev altında developer + tester görevleri
3. Execute sırayla (developer → tester)
4. Kanıt kontrolü → env off

## Bağlı sürüm

- Tür: content_sha256
- `apps/api/src/ai/repo/acceptance-verifier.ts` → `7BC4B9919A9987BD672A7ABBFAF828F1CCCC896A122D91F16E81BFECB053A0EE`
- `apps/api/src/ai/repo/sandbox-patch.ts` → `CEA5E340F63DE247F355B9CFDE78EE70CCC053B2ED9AAA7B7C413CD6B8EBC8E8`
- `apps/api/src/ai/repo/sandbox-runner.ts` → `9582CB07906B3781EBACB4191AA0EB2EA2DCA37F58B8603CD01FBEDCBD385EAD`
- `apps/api/src/ai/local-agent-execution.ts` → `387E81DFB5D80213E254743AB2025F5C2DFFB1729A51D8BB5E18D767939FFB7E`
- Rapor: `reports/qa/faz-5e-developer-tester-sandbox-rapor.md`

## Geri alma planı

- `AGENT_SANDBOX_MODE=off`, `AGENT_REPO_TOOLS_MODE=off`, `LOCAL_AGENT_EXECUTION_MODE=off`
- Temp sandbox dizinleri OS tarafından temizlenebilir; ana repo dokunulmaz

## Not

Onaylanmadan yeni gerçek Ollama / Subify sandbox yazma çalıştırılmaz. Bu onay başka projeye veya push yetkisine aktarılamaz.
