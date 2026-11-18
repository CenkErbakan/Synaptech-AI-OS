---
title: "Onay talebi — zamanlanmış yerel AI CEO (ilk canlı scheduler çalıştırması)"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: approved
approved_by: owner
approved_at: "2026-11-18"
applied_at: "2026-11-18T01:18:47Z"
result: "reports/qa/faz-5e-tp5e003-live-rapor.md"
---

# Onay talebi — uygulandı (tek döngü)

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | real_ai_provider_pilot *(zamanlanmış canlı; production_deploy değil)* |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os |
| Görev kimliği | T-P5E-003 |
| Risk | Yüksek |
| Owner kararı | **onaylandı** — tek gerçek yerel AI CEO döngüsü |

## Açıklama

Faz 5E entegrasyonu ve mock testler tamam. Bu onay, **ilk canlı zamanlanmış yerel AI CEO döngüsünü** açmak içindir:

- `SCHEDULER_AI_CEO_MODE=local`
- Ollama `qwen2.5:14b`
- Günde en fazla 1 değerlendirme
- Görevlerin MSSQL’e yazılması ve ajan handoff

Kapsam dışı: Cloud live, On-Demand, production/VPS, müşteri iletişimi, blog/reklam.

## Değişiklik özeti (Owner manuel, onay sonrası)

1. `.env`: `SCHEDULER_AI_CEO_MODE=local`, `MODEL_PROVIDER=local`, `LOCAL_AI_PILOT` isteğe bağlı
2. API yeniden başlat
3. Tek tick veya bir günlük `ceo_cycle` gözlemi
4. Dashboard otonomi + görev panosu doğrulama

## Bağlı sürüm

- Tür: content_sha256
- `apps/api/src/ai/ai-ceo-scheduler.ts` → `5B50160F150E27F5FE626A9A0B4B68CB9A4CFD85731D37EEEA6C531E059BF332`
- `apps/api/src/ai/plan-grounding.ts` → `BE446DDA5256A54D79AAE6CEEDE1D888E1C5C02EE6438860D016D0506EEB2B8B`
- `apps/api/src/ai/llm-call-guard.ts` → `77DF9FA4CE0CBDAFAE19EAE54C797B10F28AA48625BA74A668A740375F2795B2`
- `apps/api/src/engines/autonomy-scheduler.ts` → `D70E3AF15CA78E46F27105D84639E60B89A6C41E2BC1FC3CC198CC01CF525108`
- Rapor: `reports/qa/faz-5e-scheduler-ai-ceo-entegrasyon-rapor.md`

## Geri alma planı

- `SCHEDULER_AI_CEO_MODE=off`
- API yeniden başlat
- İstenirse `origin` `scheduler-ai-ceo:*` görevleri arşivle (silme yok)

## Not

Entegrasyon kodu onayı **değildir**; yalnızca canlı scheduler LLM açılışı içindir. Onaylanmadan ajan `local` moda geçmez / yeni gerçek model çağrısı başlatmaz.
