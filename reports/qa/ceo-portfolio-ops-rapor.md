# CEO portföy + teslimat zinciri

UTC 2026-11-18 ~18:45. Fixture testler geçti. Canlı ikinci plan JSON parse hatası; yeni Task yazılmadı.

## Diversity 3→1 (önceki cycle)

`pickDiversePersistable` önce projede 1 görev alır, sonra `remainingSlots` kadar doldurur. 3 OS önerisi + `max=1` (kuyruk slot) veya sessiz `continue` (duplicate) = 1 child. Red reason code yoktu.

Yeni politika: aynı projede kapasite varsa hepsi kalır; düşenler `queue_slot_exhausted` | `duplicate_open_title` | `not_in_stage_a_selection` | `structural_reject`.

## Aşama A (kanıt, LLM yok)

| Proje | skor | seçildi | gerekçe | önerilen ajan | kanıt |
| --- | --- | --- | --- | --- | --- |
| subify | 86 | evet | hedef + mssql + **repo verified** + hiç çalışmamış | cto | goal:subify-quality |
| marivo | 76 | evet | hedef + hiç çalışmamış; verified opportunity **0** | growth-lead | goal:marivo-growth |
| synaptech | 74 | evet | website-seo **not_connected** (araştırma OK, KPI yok) | seo-specialist | goal:website-seo |
| synaptech-ai-os | 60 | hayır | hedef var; son security işi 18:30; daha düşük öncelik | cto | goal:os-reliability |

`starvingCount=4`. Repo: yalnızca Subify `verified`+mssql.

## Canlı Aşama B

`runScheduledAiCeoCycle` (cooldown/idle uygulandı): provider **12.3 sn**, `local_llm_invalid_json`. Circuit açıldı. Model görev listesi yok. Persist drop yok. Token audit yok.

## Önceki gerçek Task (hâlâ duruyor)

- Parent cycle `6d4c75e4-…` + child `5294c682-…` security **done**, acc=true, evidence `repo_head,repo_list,repo_read`.
- Handoff ceo→security; result security→ceo; owner_notice.
- Developer/Tester/Growth/SEO/Content/Ads child **yok**.
- CTO follow-on bu security sonucunda tetiklenmez (yalnızca verified_defect / patch).

## Scheduler / Ollama

Tek dinleyici :3101. LLM lease boş. GPU ~%6, VRAM ~11800 MiB. Circuit: invalid JSON sonrası açık (yeniden deneme fırtınası yok).

## Kalan engeller

1. Canlı model bu turda geçerli JSON vermedi — dört projeye görev yazılmadı.
2. Marivo/synaptech için verified opportunity yok; growth/SEO çıktısı public_fetch/lead’e bağlı.
3. OS repo binding verified değil.
4. `recentlyServed` done child’ı sayacak düzeltme diskte; çalışan süreç bir sonraki restart’ta alır.
5. Security “done” yapı okuma; sandbox patch / Docker test zinciri bu görevde oluşmadı.
