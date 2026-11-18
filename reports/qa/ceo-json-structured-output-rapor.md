# P0 CEO structured JSON

UTC 2026-11-18 ~19:15.

## JSON hatası (önceki)

Ham yanıt **saklanmamış** → gövde içeriği UNKNOWN.

Kod kanıtı: `stream:true` NDJSON son satır newline olmadan düşebiliyordu; `format:"json"` şemasızdı; parse hatası `local_llm_invalid_json` olarak yutuluyordu (18:35, 18:44, 18:55). 12 sn süre timeout değil.

## Düzeltme

- `format` = Ollama JSON Schema (`CEO_PLAN_OLLAMA_FORMAT`), CEO `stream:false`
- Stream leftover flush
- Fence ayıklama; düz metinden görev yok
- Hata ayrımı: empty / truncated / invalid_json / schema_validation_failed / persist_failed
- Audit: contentLen + sha256; ham body yok
- Circuit başarıda reset

## Test

49 unit (ceo-json-plan 16 + portföy/rol/timeout/idle). Hepsi geçti.

## Canlı

- providerInvoked true, qwen2.5:14b, **10831 ms**, JSON+schema valid
- Stage A: synaptech, subify, marivo
- Model 4 görev; OS `not_in_stage_a_selection` reddedildi
- Task: 1 parent + 3 child; 3 handoff
- synaptech/seo-specialist, subify/cto, marivo/growth-lead — `planned`/`ready`
- lease boş, circuit `lastSuccessAt` 19:15:42Z
- API PID 19196, tek :3101

BLOCKED: GitHub/e-posta/deploy/harcama; website metriği not_connected; Marivo verified opportunity 0; ajan pass henüz bu child’ları bitirmiş değil.
