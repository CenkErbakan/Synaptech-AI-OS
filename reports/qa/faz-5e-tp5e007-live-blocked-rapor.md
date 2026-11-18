---
title: "T-P5E-007 — İlk canlı döngü BLOCKED (günlük LLM kotası)"
date: "2026-11-18"
task: T-P5E-007
status: BLOCKED
liveOllamaThisSession: false
continuousAutomation: false
---

# T-P5E-007 İlk canlı açılış — BLOCKED

Owner tek kontrollü döngüyü onayladı. Ön kontrollerde **günlük gerçek LLM kotası yetersiz** bulundu. Talimat gereği limit yükseltilmedi, kota sıfırlanmadı; **canlı Ollama çağrısı başlatılmadı**.

## 1) SHA doğrulama

| Kontrol | Sonuç |
|---------|--------|
| 8 dosya SHA | **OK** (hepsi eşleşti) |
| Bundle SHA-256 | **OK** `AA4F0BF5DF0AAB568500E5F8547F3500591DD325A0567662C5491D3428505CC1` |

Önceki pilot kayıtları (T-P5E-003…006-retry) değiştirilmedi.

## 2) Altyapı ön kontrol

| Kapı | Sonuç |
|------|--------|
| Ollama `qwen2.5:14b` | OK (`http://127.0.0.1:11434`) |
| Docker Engine | OK (`29.8.0`) |
| Kill switch | Kapalı (`enabled=false`) |
| Cloud live | Kapalı |
| On-Demand verified | false |
| API :3101 | Ayakta (scheduler job’ları deterministik tick atıyor) |

Kanıt: `reports/qa/faz-5e-tp5e007-preflight.json`, `reports/qa/faz-5e-tp5e007-quota-detail.json`

## 3) CONTROLLED_AUTONOMY_MODE=local vs continuousAutomation=false

- `continuousAutomation` kodda **her zaman `false`** (runtime-summary + tick orkestratör).
- `CONTROLLED_AUTONOMY_MODE=local` yalnızca CEO tick sonrası **ajan pass** kapısını açar; süresiz “otonom şirket” anlamına gelmez.
- API’de `SCHEDULER_AI_CEO_MODE=off` iken `daily-ceo-review` **deterministik** çalışır; gerçek Ollama CEO çağırmaz.
- Bu oturumda `CONTROLLED_AUTONOMY_MODE` **açılmadı** (kota engeli).

## 4) Kota (asıl engel)

UTC gün `2026-11-18` — `SCHEDULER_AI_CEO_MODE=local` / `LOCAL_AGENT_EXECUTION_MODE=local` varsayımıyla:

| Bütçe | used | max | Headroom (1 CEO + 2 ajan) |
|-------|------|-----|---------------------------|
| Scheduler AI CEO (gerçek) | **1** | **1** | **0** — `daily_llm_cap_reached` |
| Local agent (gerçek) | **9** | **4** | **negatif** — `daily_agent_llm_cap_reached` |

Not: `SCHEDULER_AI_CEO_MODE=off` iken status endpoint’i tüm CEO audit satırlarını (mock dahil ~12) gösterebilir; canlı local modda sayaç **yalnızca realAi** kullanır. Yine de gerçek CEO kotası bugün dolu.

Owner kuralı: *Kota yetersizse dur; limitleri değiştirme.* → **DURULDU.**

## 5) Canlı döngü sonucu

| Madde | Durum |
|-------|--------|
| Gerçek scheduler AI CEO tetikleme | **Yapılmadı** |
| CEO gerçek model çağrısı | **Yok** |
| Oluşturulan yeni görevler (bu onay) | **Yok** |
| Otomatik ajan LLM | **Yok** |
| MSSQL yeni AgentMessage (bu döngü) | **Yok** |

## 6) Otomasyon kapatma kanıtı

Canlı açılış yapılmadığı için “sonra kapatma” gerekmedi; mevcut durum zaten kapalı:

```
SCHEDULER_AI_CEO_MODE=off
LOCAL_AGENT_EXECUTION_MODE=off
CONTROLLED_AUTONOMY_MODE=off
AGENT_REPO_TOOLS_MODE=off
AGENT_SANDBOX_MODE=off
CLOUD_AGENT_LIVE_ENABLED=false
CURSOR_CLOUD_MODE=mock
continuousAutomation=false
```

API `/api/autonomy/status` (canlı): `schedulerAiCeoMode=off`, `localAgentExecution.mode=off`, `continuousAutomation=false`.

Scheduler timer API sürecinde job tick’leri atıyor; bunlar **deterministik** (AI CEO local değil). Gerçek Ollama otomasyonu etkin değil.

## 7) Dashboard / kabul

Yeni T-P5E-007 yürütme kartı yok. Önceki pilot kanıtları (CEO/CTO/Dev/Tester) MSSQL’de duruyor.

## 8) Sürekli günlük otonomi için kalan somut engeller

1. **Günlük CEO limiti 1** — bugün gerçek CEO kotası dolu; yeni UTC gün veya Owner’ın bilinçli limit politikası gerekir (bu turda yükseltilmedi).
2. **Günlük ajan limiti 4** — bugün 9 gerçek ajan çağrısı; headroom yok.
3. **Tek döngü ≠ sürekli 9 ajan** — tick max 2; sürekli çalışma ayrı onay.
4. **Verified repo + Docker** — kod/test için zorunlu; Marivo vb. doğrulanmamış bağda araçlar kapalı.
5. **Owner gated** — push/PR/merge/deploy/blog/ads/müşteri iletişimi hâlâ ayrı onay.
6. **PC/Ollama kapalıysa** fail-closed; Cloud’a sessiz geçiş yok.

## Sonuç

**BLOCKED — `daily_llm_cap_reached` (CEO + agent).**  
Şartların tamamı geçmeden canlı LLM başlatılmadı. Dokuz ajan sürekli çalıştırılmadı.
