---
title: "Onay talebi — T-P5E-006 yeniden deneme (Docker izolasyon sonrası)"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: pending
supersedesNote: "Eski T-P5E-006 BLOCKED kaydı değiştirilmedi; bu yeni tek seferlik retry onayıdır."
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | real_ai_provider_pilot |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os (yalnızca fixture sandbox; Subify/Marivo/SynapTech yazılmaz) |
| Görev kimliği | T-P5E-006-retry |
| Risk | Yüksek |

## Açıklama

Önceki T-P5E-006 `sandbox_isolation_unproven` nedeniyle **BLOCKED** bırakıldı (kayıt değiştirilmedi).

Docker Desktop üzerinde gerçek FS/process/network izolasyonu sandbox-runner’a entegre edildi ve integration testlerle kanıtlandı. Bu onay, **yalnızca Owner verdikten sonra** tek seferlik gerçek Ollama Developer → Tester fixture zinciri içindir.

Kapsam:
1. `AGENT_REPO_TOOLS_MODE=read_only`, `AGENT_SANDBOX_MODE=isolated`, `LOCAL_AGENT_EXECUTION_MODE=local`
2. Tester komutu yalnızca Docker + sabit `node --test test/demo.test.js` (package.json scripts yok)
3. `network=none`, read-only rootfs, non-root, cap-drop ALL, no-new-privileges, bellek/CPU/PID limit
4. Host fallback yok; Docker yoksa blocked
5. Patch yalnızca temp fixture; ana repo/production dokunulmaz
6. Maks 1 Developer + 1 Tester Ollama çağrısı; bitince tüm modlar `off`
7. Cloud / push / PR / merge / production / sürekli otomasyon kapalı

## Değişiklik özeti (Owner onay sonrası manuel)

1. Env aç → fixture görevleri → execute developer → tester
2. Kanıt: sandbox_diff digests + docker sandbox_command exit=0 + test sayısı
3. Env kapat

## Bağlı sürüm

- Tür: content_sha256
- `apps/api/src/ai/repo/sandbox-docker.ts` → `1A9A5BB95F09552E16649133FCDF9BAEE9A16C8D69DD506A73D91C916C671F96`
- `apps/api/src/ai/repo/sandbox-runner.ts` → `CA4227FC056BA7B1D255039C5CD1F84A35434B14801414FD152BDA363808DA98`
- `apps/api/src/ai/repo/sandbox-patch.ts` → `7B9025BAF93F1565CDFCE3F7B65FE68DC32BD9B49671B521FF1F7DAAAA9982B6`
- `apps/api/src/ai/local-agent-execution.ts` → `B994200B26F145F10437FE0EE3EDB2D521DB7AB5C63E88121B5B499AE7947C5A`
- `apps/api/src/ai/repo/repository-tool-adapter.ts` → `5FB5763BB513AD8609515CCF0501A5B01AD6630EEBCAB124186F15198BBDE90B`
- `apps/api/src/ai/repo/acceptance-verifier.ts` → `7BC4B9919A9987BD672A7ABBFAF828F1CCCC896A122D91F16E81BFECB053A0EE` (değişmedi)
- Image pin: `node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee`
- Rapor: `reports/qa/faz-5e-tp5e006-docker-isolation-rapor.md`

Onay yalnızca bu SHA’lar için geçerlidir. İçerik değişirse yeni onay gerekir.

## Geri alma planı

- `AGENT_SANDBOX_MODE=off`, `AGENT_REPO_TOOLS_MODE=off`, `LOCAL_AGENT_EXECUTION_MODE=off`
- `docker rm -f synaptech-sbx-*` (kalıntı)
- Temp sandbox dizinleri silinebilir; ana repo dokunulmaz

## Not

Canlı Ollama bu onay olmadan başlatılmaz. Eski `T-P5E-006-developer-tester-sandbox-pilot.md` BLOCKED durumu korunur.
