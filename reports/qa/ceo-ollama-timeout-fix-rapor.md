# P0 — CEO Ollama timeout / tekrar döngüsü

Tarih: 2026-11-18 (UTC). Salt kanıt + tahmin ayrımı.

## 1. Kök neden (kanıt)

Üç katman birlikte döngüyü üretti; yalnızca timeout süresini artırmak çözüm değildi.

1. **Persist kırığı (18:11–18:14 UTC, run `becd97fa-…`)**  
   Model yanıtı ~208 sn’de geldi; `Task.idempotencyKey` NVarChar(128). Child anahtarı `scheduler-ai-ceo-child:{epoch}:{uuid}:{title60}` ≈ 135 karakter. Prisma: `The provided value for the column is too long`. Parent/child yazılmadı (veya yarım kaldı). Yeni cycle Task = 0.

2. **Timeout + circuit yok**  
   `stream:false` + `AbortSignal` 180s/300s; `num_predict` yok. Timeout `throw` → `ai.scheduler_ceo_cycle` audit yok → idle skip `lastCeoAt` güncellenmiyor → 2 dakikada yeni generate.  
   18:17–18:22 run `31b7d3fd-…`: `The operation was aborted due to timeout` (301 sn).

3. **Prompt şişmesi (kod kanıtı, token sayımı o an yoktu)**  
   Scheduler instruction: recentAgentResults + `payloadJson` 600 karakter excerpt + epoch başlık 1600. Pilot/ilk 91 sn yolunda instruction kısaydı. `format:json` + 8 uzun görev modeli uzatıyordu.

Tahmin (ayrı): JSON constrained decoding yavaş. Ölçülmedi.

## 2. GPU / VRAM / CPU

| Ölçüm | Değer | Kaynak |
| --- | --- | --- |
| GPU | NVIDIA GeForce RTX 5070 Ti 16303 MiB | nvidia-smi |
| Model | qwen2.5:14b Q4_K_M 14.8B | `/api/tags` |
| GPU yerleşimi | `size_vram=9480584559` (~9.0 GiB) | `/api/ps` |
| Runner | llama-server `-c 4096 -np 1` | süreç komutu |
| Teşhis anı VRAM | 13829 MiB used, GPU util %67, CPU host %91 | timeout öncesi |
| Başarı sonrası | VRAM 14336 MiB, GPU util %98 | security ajanı da LLM kullanıyor olabilir |
| RAM | ~28 GiB boş / 64 GiB | Win32_OperatingSystem |
| Ollama CLI PATH | yok; HTTP 127.0.0.1:11434 | |

Kanıt: ağırlıklar GPU’da. CPU yükü teşhis anında yüksekti; katman offload oranı Ollama logunda yok.

## 3. 91 sn vs timeout

| | İlk başarı ~16:32 UTC | Timeout/persist 17:50–18:22 |
| --- | --- | --- |
| Süre | 91270 ms | 180781 / 300769 / 301s abort; 18:11 ~208s sonra DB hatası |
| Origin | günlük `...:2026-11-18` | UUID cycle |
| Prompt | kısa instruction | excerpt + epoch listesi |
| Çıktı sınırı | yok | yok (sonra num_predict=640) |
| Persist | 3 child yazıldı | idempotencyKey taşması |

Kontrollü doğrulama: **95221 ms** — 91 sn bandı.

## 4. Düzeltilen dosyalar

- `apps/api/src/ai/providers/local-provider.ts` — stream, abort, num_ctx 4096, num_predict, metrik, duplicate lock
- `apps/api/src/ai/ceo-plan-prompt.ts` — kompakt prompt, clipIdempotencyKey
- `apps/api/src/ai/ceo-provider-circuit.ts` — 5/10/20/40/60 dk backoff
- `apps/api/src/ai/local-ceo-context.ts` — payloadJson prompt’a girmiyor
- `apps/api/src/ai/ai-ceo-scheduler.ts` — timeout catch, circuit, kısa instruction, key clip
- `apps/api/src/ai/llm-call-guard.ts` — lease 240s + renew
- `apps/api/src/engines/local-ops-policy.ts` — circuit skip
- `apps/api/src/engines/autonomy-scheduler.ts` — her tick `enabled:true` zorlaması kaldırıldı; timeoutSec güncellenir
- `apps/api/tests/ceo-ollama-timeout.unit.test.ts`

## 5. Timeout / lease

- Generate abort: **180 s** (şişirme 600/900 değil)
- LLM lease TTL: **240 s**, 20 sn heartbeat `renewLease`
- Timeout sonrası `tripCeoProviderCircuit` (ilk açık 5 dk)
- Eşzamanlı generate: in-process mutex + lease
- `ensureDefaultAutonomyJobs` artık enabled’ı her tick yeniden açmaz

## 6. Testler

`npx vitest run tests/ceo-ollama-timeout.unit.test.ts tests/parent-lifecycle-and-idle.unit.test.ts tests/faz5e-model-provider.unit.test.ts` → **19 passed**.

## 7. Kontrollü tek gerçek CEO

- `providerInvoked`: true
- `modelId`: qwen2.5:14b
- `model duration`: **95221 ms**
- `JSON validation`: true
- `prompt token` / `generated token`: provider `usage` üretti; **bu koşunun audit kaydına yazılmadı** (sonraki audit extra’ya eklendi; ikinci canlı çağrı yapılmadı)
- parent `6d4c75e4-c94c-43ab-8463-c7520c1f9043` origin `...:cycle:e55e512d-...`
- lease doğrulama scripti bittiğinde serbest; ardından security child LLM lease aldı

## 8. Yeni görevler

Evet: parent + 1 child (`5294c682-…`, security, synaptech-ai-os, status **in_progress**). Plan 3 görev önerdi (hepsi OS); diversity 1 child yazdı. Grounding: accepted 0, unverified 3.

## 9. Ajanlara dağıtım

Handoff `ceo → security`. CTO/developer/tester/growth/seo/content/ads bu cycle’da child yok.

## 10. Kalan

- Token metrikleri ilk başarı audit’inde yok (kod eklendi, tekrar generate yok).
- Dört proje dağılımı bu planda yok (model OS’e yığdı; kapı gevşetilmedi).
- Timer CEO 5 dk cooldown + circuit reset (başarıda kapatıldı).
- Eski 16:56 `running` job satırı duruyor; silinmedi.
