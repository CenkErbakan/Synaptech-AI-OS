# Faz 5E — Yerel AI CEO pilot hazırlığı

**Durum (2026-11-18):** Hazırlık tamam; **Ollama kurulu değil**; model **indirilmedi**; gerçek LLM çağrısı **yapılmadı**.

## Sistem incelemesi

| Öğe | Sonuç |
|-----|--------|
| GPU | NVIDIA GeForce RTX 5070 Ti, **16303 MiB** (~16 GB) VRAM |
| RAM (beyan) | 64 GB |
| `ollama` PATH | **Yok** (`ollama` komutu tanınmıyor) |
| `http://127.0.0.1:11434/api/tags` | **Bağlantı yok** |
| Cloud live | Kapalı kalacak |
| On-Demand | Kapalı kalacak |

## Model önerisi (16 GB VRAM)

| Öncelik | Model | Gerekçe |
|---------|--------|---------|
| **Önerilen** | `qwen2.5:14b` | Yapılandırılmış JSON / planlama için güçlü; Q4–Q5 ile ~9–11 GB VRAM; 16 GB’ta headroom |
| Alternatif | `llama3.1:8b` | Daha az VRAM (~5–6 GB); kalite 14B’den düşük ama güvenli |
| Kaçının (bu pilot) | 32B+ / 70B | 16 GB’a sığmaz veya aşırı swap |

Kalite: CEO şirket değerlendirmesi + JSON plan için 14B sınıfı yeterli. Kod ajanı yerine geçmez (Cloud coding ayrı kapı).

## Kod hazırlığı (yapıldı)

- `MODEL_PROVIDER=local` yolu: sessiz **mock fallback kaldırıldı**
- Bağlantı yoksa `IntegrationUnavailable` (mock yanıt yok)
- Salt-okunur MSSQL bağlamı: `local-ceo-context.ts`
- Pilot endpoint: `POST /api/ai/local-ceo/pilot` (`LOCAL_AI_PILOT=true` + Owner)
- Onay/bütçe/Cloud self-change güvenlik metni local prompt’ta
- Deterministik özet LLM çıktısından ayrı kayıt

## Güvenli test prosedürü (Owner onayından sonra)

1. Ollama’yı Windows’a kur: https://ollama.com/download  
2. `ollama serve` (veya servis) → `curl http://127.0.0.1:11434/api/tags`  
3. `ollama pull qwen2.5:14b`  
4. `.env` (ücretli API yok):

```env
MODEL_PROVIDER=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434
LOCAL_LLM_MODEL=qwen2.5:14b
LOCAL_AI_PILOT=true
CLOUD_AGENT_LIVE_ENABLED=false
CURSOR_CLOUD_MODE=mock
CLOUD_ON_DEMAND_VERIFIED=false
```

5. API’yi yeniden başlat  
6. `GET /api/ai/status` → `realAiAvailable: true`, `localUnavailable: false`  
7. Owner: `POST /api/ai/local-ceo/pilot` body `{"chatMessage":"Özetle şirket durumunu"}`  
8. Kanıt kontrolü: `modelId`, `durationMs`, `jsonValid`, `contentSha256`, `groundingRatio`, `realAiExecution: true`  
9. Başarısız bağlantıda mock olmadığını doğrula (503/IntegrationUnavailable)

## Onay

- Dosya: `tasks/approvals/T-P5E-001-real-provider-pilot.md`
- Tür: **real_ai_provider_pilot**
- Proje: **synaptech-ai-os**
- production_deploy **değil**
