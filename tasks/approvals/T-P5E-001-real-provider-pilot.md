---
title: "Onay talebi — real_ai_provider_pilot (yerel AI CEO)"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: approved
approved_by: owner
approved_at: "2026-11-18"
applied_at: "2026-11-18T01:01:00Z"
result: "reports/qa/faz-5e-local-ceo-pilot-sonuc.md"
---

# Onay talebi — Owner onayladı (yerel Ollama pilot)

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | real_ai_provider_pilot |
| İsteyen ajan | orchestrator (Faz 5E yerel CEO hazırlığı) |
| Proje | synaptech-ai-os |
| Görev kimliği | T-P5E-001 |
| Risk | Orta |
| Owner kararı | **onaylandı** — qwen2.5:14b / tek seferlik değerlendirme |

## Açıklama

Yalnızca **yerel Ollama** üzerinde AI CEO planlama + sohbet pilotu. Bu onay **production_deploy değildir**.

Kapsam dışı (bu onayla yapılmaz):

- Cloud Agent / Cloud live
- On-Demand Spending
- Harici ücretli API
- Production/staging VPS, GitHub allow-list
- Müşteri iletişimi, blog/reklam yayını

## Değişiklik özeti (Owner manuel)

1. Ollama kurulumu (Windows)
2. Model indirme: önerilen `qwen2.5:14b` (RTX 5070 Ti 16 GB)
3. `.env`: `MODEL_PROVIDER=local`, `LOCAL_LLM_BASE_URL=http://127.0.0.1:11434`, `LOCAL_LLM_MODEL=qwen2.5:14b`, `LOCAL_AI_PILOT=true`
4. `CLOUD_AGENT_LIVE_ENABLED=false`, `CURSOR_CLOUD_MODE=mock` kalır
5. Owner: `POST /api/ai/local-ceo/pilot` ile tek seferlik değerlendirme

## Bağlı sürüm

- Tür: content_sha256
- Ref / yol:
  - `apps/api/src/ai/local-ceo-pilot.ts` → `98263444967485F7B77EE452875C65147674E7F827FFDEDFB0CD9D77C2F23B4D`
  - `docs/ops/faz5e-local-ceo-pilot-hazirlik.md` → `8387C093B8982F53B59A91396BE61FD283373832044A8CFB660B418375D97960`

Onay yalnızca bu sürüm / prosedür için geçerlidir. Model pull veya Ollama kurulumu bu onaydan **sonra** Owner tarafından yapılır.

## Geri alma planı

- `MODEL_PROVIDER=mock`, `LOCAL_AI_PILOT=false`
- Ollama servisini durdur (isteğe bağlı)
- Cloud live zaten kapalı kalır

## Not

Onayı yalnızca kullanıcı verir. Onaylanmadan ajan model indirmez / Ollama kurmaz / gerçek LLM çağrısı yapmaz.
