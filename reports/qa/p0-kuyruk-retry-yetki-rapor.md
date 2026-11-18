# P0 kuyruk / retry / acceptance / yetki

Kod birim testleri: **131 geçti** (integration-observation env kaynaklı 1 başarısız: schedulerAiCeoMode local vs off — bu P0 ile ilgili değil). Odaklı P0 dosyaları 35/35.

Canlı restart: API **PID 2824**, `timerActive=true`, worker `worker-Cenk-2824-ba67c9ce`, epoch `ops-2026-11-18` korundu. Görev silinmedi.

## Kodda hazır (kanıt: test + kaynak)

- `ceo_event_pending` artık cooldown/kuyruk/parent atlamıyor.
- `unresolved_ceo_parent`, cooldown, minInterval, queue_cap, work_in_flight.
- Duplicate: açık başlık + aynı proje/ajan.
- LLM çağrısı kuyruk slotu yokken yok.
- Onay `attempts` sıfırlamaz; `retryBudget` yoksa `retry_budget_exhausted`.
- Provider bütçesi evidence sayısı + attempts (immutable geçmiş).
- CTO: “borç bulunamadı” defect iddiası değil; sözleşme inspection vs verified_defect.
- Lead `projectSlug` görevden; `verifiedSource` / `qualifiedLead` / `outreachEligible`.
- SEO upsert: created vs reused + updatedAt.
- Parent: done / waiting_owner_decision / partial_child_failure / children_in_flight.
- Done child `already_done` skip.

## Canlıda kanıtlanan (19:38:47Z)

Grant önceki: github/outreach/deploy **true**. Audit’li kapatma sonrası hepsi **false**, `permanentLocalAutonomy=true`, mismatch **[]**.

Orijinal üç child:

- SEO `935d6b6e…` done (önceki döngü).
- Growth `6999d63a…` done.
- CTO `79648c69…` **awaiting_approval / blocked / retry_budget_exhausted**, attempts=2 (artık 0 değil).
- Parent `ffd9dea3…` **in_review / waiting_owner_decision**.

EBSO lead: `projectSlug=marivo`, verifiedSource=true, **qualifiedLead=false**, outreachEligible=false.

Eski süreç 19:25–19:37 arasında hâlâ yeni CEO parent yazdı (`8a7873d6`, `f108739f`, `7a0656e8`, `d3edb8f5`). Yeni süreç 19:38:21Z. Bu dört parent kod düzeltmesinin canlı kanıtı değil.

pendingReady önceki raporda 7; restart anında exec **11** (DB child planned/in_progress/backlog 19). Düşüş henüz ölçülmedi — eski fırtına kuyruğu duruyor.

## A–J

**A.** Üç (aslında daha fazla) parent: `ceo_event_pending` idle’ı eziyordu + starving minInterval atlıyordu. Kodda önlendi. Canlıda 19:38 sonrası yeni parent **görülmedi**; 19:37 parent eski süreç.

**B.** pendingReady 7→11 (artış, eski süreç). Yeni kod düşürmeyi henüz kanıtlamadı.

**C.** Retry döngüsü kodda kapalı; canlı CTO `retry_budget_exhausted` (ek Ollama yok varsayımı: budgetDead erken çıkış). Owner `retryBudget>0` olmadan yeniden koşmaz.

**D.** Sözleşme inspection: ≥2 `repo_read` yolu + `structure_inspection`/`dependency_analysis`, defect iddiası yok. `verified_defect` ancak satır/config/digest. Aynı dosyaları 5. kez okumak yetmez.

**E.** Kod Marivo slug yazar. Canlı EBSO marivo’ya bağlandı ama **qualifiedLead=false** (oda sayfası ≠ satın alma).

**F.** SEO scan+dedupe kodda ayrıldı. Yeni measured finding yoksa follow-on yok. Canlıda bu restart’ta yeni SEO işi yok.

**G.** Parent `waiting_owner_decision` / `children_in_flight` yazıldı. Toplu silme yok.

**H.** Evet: dış grant’ler kapalı. GitHub mode off. Cloud live false.

**I.** Scheduler timer+lease ayakta, yerel otonomi grant’i açık. Eşzamanlı tek LLM korundu.

**J.** Bu düzeltmenin tamamladığı yeni iş: 0 yeni done. Zaten done: SEO+Growth (1+1). CTO tamamlanmadı (Owner kararı). Lead nitelik düzeltmesi 1 kayıt.

BLOCKED: GitHub/e-posta/deploy/harcama; GSC/GA4; CTO için Owner retryBudget veya inconclusive kapanış; kuyruktaki eski parent çocukları.
