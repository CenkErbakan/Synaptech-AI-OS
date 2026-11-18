# SynapTech AI OS — Canlı sistem tam durum analizi

- **Rapor zamanı:** 2026-11-18T17:31:28Z (sorgu) / health 2026-11-18T17:30:50Z
- **Epoch:** `ops-2026-11-18` (startedAt `2026-11-18T16:05:49.393Z`)
- **Teşhis kısıtı:** Kod/servis/DB yazılmadı, tick tetiklenmedi, Ollama generate çağrılmadı.
- **Kanıt kaynakları:** `GET /api/system/health`, MSSQL Prisma salt-okunur sorgu, `ScheduledJobRun`, `AuditLog`, `Task`, `AgentMessage`, `WorkerInstance`, netstat, Win32_Process, Ollama `GET /api/tags`, Docker info, API süreç logu (PID 1656), kaynak kod yolları (davranış açıklaması; runtime kanıtıyla eşleştirildi).

`config/system-status.yaml` hâlâ “Faz 4 MVP / otonomi disabled / database not_installed” der. Bu dosya **runtime ile çelişir**. Aşağıdaki gerçeklik API+MSSQL’dir. Kanıt: VERIFIED (dosya vs health).

---

## 1. Yönetici özeti

Sistem **yerel otonomi döngüsünü çalıştırıyor** (timer + üç mode=`local` + `permanentLocalAutonomy=true` + kill switch kapalı). Bu, “ajanlar her 2 dakikada dört projeye yeni iş basıyor” anlamına gelmiyor.

Asıl tıkanma:

1. **AI CEO günde bir parent üretir.** Origin `scheduler-ai-ceo:ops-2026-11-18:2026-11-18`. Aynı UTC gününde sonraki `daily-ceo-review` işleri **Ollama çağırmadan** `skippedReason=idempotent_cycle_exists` ile biter. Job status `succeeded` görünür; gerçek plan yoktur.
2. Epoch’ta **yalnızca 4 görev** var: 1 CEO parent (`planned`) + 3 çocuk (security, growth-lead, cto) hepsi `synaptech-ai-os` ve **done**. Bekleyen child yok. `local-agent-pass` `processed:[]`.
3. Model katmanı **en fazla 3 görev** üretir (`LocalModelProvider.generateCeoPlan` + `normalizeLocalCeoPlanJson` slice 0..3). Dört proje kuralı prompt’ta var; şema/sağlayıcı 3 ile keser.
4. Tek gerçek CEO planı (`2026-11-18T16:32:49Z`, 91270 ms, qwen2.5:14b) OS güvenilirlik hedefine kilitlendi. Context’te dört `CompanyGoal` vardı; model hepsini seçmedi.
5. Growth “done” **dış lead değildir**. `public_fetch` yok; DB lead’leri `synaptech.software` (`self=true`).
6. `executionResult` 8000 karakterde kesildiği için kabul JSON’u yeniden parse edilemez. Motor `acceptanceMet=true` yazmış; bağımsız yeniden doğrulama **bozuk kayıt** yüzünden zayıf.
7. Developer / Tester / SEO / Content / Ads bu epoch’ta **görev almamış**. GitHub Draft PR ve outreach grant+mode ile kapalı.

**Önümüzdeki saatlerde hiçbir şey değişmezse:** timer 60 sn’de bir tick atar, CEO skip eder, ajan pass boş döner, UTC gün değişene kadar (2026-11-19T00:00Z = 03:00 TR) yeni plan yazılmaz.

---

## 2. Anlık runtime durumu

| Öğe | Değer | Kanıt | Seviye |
| --- | --- | --- | --- |
| API health | `ok:true`, DB latency 4 ms, phase alanı health’de `"5D"` | `GET http://127.0.0.1:3101/api/system/health` 17:30:50Z | VERIFIED |
| API PID | **1656** `node --import tsx src/index.ts`; dinleme 127.0.0.1:3101 | netstat + Win32_Process CreationDate 18.11.2026 20:26:53 | VERIFIED |
| WorkerId | `worker-Cenk-1656-ec28f0ce` role `api-embedded-scheduler` status running lastSeen 17:30:55Z | health + `WorkerInstance` | VERIFIED |
| Dashboard | HTTP 200, ~4.06 s, PID **32384** :3100 | curl + netstat | VERIFIED |
| Scheduler timerActive | **true** | health.scheduler.timerActive | VERIFIED |
| lastTickAt | `2026-11-18T17:29:55.514Z` | health | VERIFIED |
| lastTickTrigger | timer (EMBED_SCHEDULER + `startAutonomyScheduler` 60s) | süreç komutu + kod `autonomy-scheduler.ts` `intervalMs=60_000` | VERIFIED / INFERRED (trigger alanı health’de yok; job run + timerActive) |
| Lease | sorgu anında `WorkerLease` **boş** (tick bitince `releaseLease`) | `prisma.workerLease.findMany()` | VERIFIED |
| CONTROLLED_AUTONOMY_MODE | `local` | API start komutu (298844) | VERIFIED (süreç env dump yok; dotenvx 18 key override:true → diğer key’ler UNKNOWN) |
| SCHEDULER_AI_CEO_MODE | `local` | aynı start komutu + job result `"mode":"local"` | VERIFIED |
| LOCAL_AGENT_EXECUTION_MODE | `local` | start + agent_pass result | VERIFIED |
| MODEL_PROVIDER | `local` | start komutu | VERIFIED |
| LOCAL_LLM_MODEL | qwen2.5:14b | start + Ollama tags + audit modelId | VERIFIED |
| AGENT_REPO_TOOLS_MODE | `read_only` | start komutu | VERIFIED (launch) |
| AGENT_SANDBOX_MODE | `isolated` | start + audit `sandboxMode:isolated` | VERIFIED |
| GITHUB_WRITE_MODE | launch `off` | start komutu | VERIFIED launch; dotenv override UNKNOWN |
| EMAIL_OUTREACH_MODE | launch `off` | start komutu | VERIFIED launch |
| CLOUD_AGENT_LIVE_ENABLED | `false` | start | VERIFIED launch |
| CURSOR_CLOUD_MODE | `mock` | start | VERIFIED launch |
| LOCAL_OPS_UNLIMITED_DAILY | `true` | start | VERIFIED launch |
| EMBED_SCHEDULER | `1`, WORKER_MODE `false` | start | VERIFIED |
| permanentLocalAutonomy | **true** | `SystemSetting` owner grants | VERIFIED |
| continuousAutomation | **true** (agent_pass resultJson) | `ScheduledJobRun` 17:29:55Z | VERIFIED |
| Kill switch | enabled **false**, source **database**, reason `coord-test-setup` | `getKillSwitch()` | VERIFIED (dosya `config/kill-switch.json` reason farklı; runtime DB) |
| Ollama | :11434 PID 30552; model qwen2.5:14b 14.8B Q4_K_M, tools capability | GET /api/tags (generate yok) | VERIFIED |
| Docker | Desktop 29.8.0, containers=5 | `docker info` | VERIFIED (tester bu epoch’ta komut çalıştırmadı) |
| MSSQL | health.database.ok true | health | VERIFIED |
| Cloud/On-Demand | live kapalı; `CLOUD_ON_DEMAND_VERIFIED` kod varsayılanı false | env.ts + start | INFERRED (process env dump yok) |
| deferred_llm_queue | **[]** | `readDeferredLlmQueue()` | VERIFIED |
| Owner inbox | pendingCount **0** | `listOwnerDecisionQueue` | VERIFIED |
| Stale worker satırları | 17436, 6008, 7324, … hâlâ `status=running` | `WorkerInstance` | VERIFIED (süreçler ölü; tablo stale) |

dotenvx log: “injected env (18) from ../../.env // override: true”. **Token/değer yazılmadı.** Launch ile .env çakışması mümkün; grant kapıları DB’de false olduğu için GitHub/outreach yine kapalı.

---

## 3. Son 24 saat CEO döngüleri

### 3.1 Gerçek Ollama CEO (epoch içi asıl plan)

| Alan | Değer |
| --- | --- |
| Zaman | **2026-11-18T16:32:49.123Z** |
| Audit | `ai.scheduler_ceo_cycle` “Zamanlanmış yerel AI CEO planı doğrulandı ve görevler yazıldı.” |
| Tetik | timer (`daily-ceo-review` cron `*/2 * * * *`) — INFERRED (job aynı gün; audit trigger alanı metadata parse’da extra=null) |
| realAiExecution | **true** |
| Model | qwen2.5:14b |
| Süre | **91270 ms** |
| Parent | `6b4939af-7b71-416a-b86c-1bfdfaa6adc5` |
| Origin | `scheduler-ai-ceo:ops-2026-11-18:2026-11-18` |
| Çocuk | 3: security, growth-lead, cto — hepsi **synaptech-ai-os** |
| goalsAddressed (parent title) | “AI OS güvenilir operasyon hedefini ele alarak…” |
| Kullanılan hedef (context) | Aktif 4 goal vardı; plan başlığı yalnızca `os-reliability` | VERIFIED title + goals listesi |
| Atlanan ajanlar | developer, tester, seo-specialist, content-manager, ads-manager, ceo-self | VERIFIED (çocuk yok) |
| Engel | yok (yazıldı) | VERIFIED |

### 3.2 Sonraki CEO job’ları (LLM yok)

Örnekler (hepsi `ScheduledJobRun` status=succeeded, `realAiExecution:false`):

| startedAt | finishedAt | skippedReason | parentTaskId |
| --- | --- | --- | --- |
| 17:18:28Z | 17:19:04Z | `idempotent_cycle_exists` | 6b4939af… |
| 17:21:33Z | 17:21:53Z | aynı | aynı |
| 17:24:22Z | 17:24:23Z | aynı (~480 ms) | aynı |
| 17:26:57Z | 17:26:58Z | aynı | aynı |
| 17:29:55Z | 17:29:55Z | aynı (~429 ms) | aynı |

Kod: `apps/api/src/ai/ai-ceo-scheduler.ts` `runScheduledAiCeoCycle` — `dayKey = UTC YYYY-MM-DD`, `existingParent` origin eşleşirse **provider.generateCeoPlan çağrılmaz**.

Job “succeeded” = handler hata fırlatmadı. **Yeni iş üretimi başarısı değildir.**

### 3.3 Epoch öncesi / 24s içi diğer CEO audit’leri

- `2026-11-18T01:18:47Z` yerel qwen **7938 ms** realAi true — epoch `16:05:49Z` öncesi; arşivlenmiş/eski döneme ait olabilir. Legacy karıştırılmamalı.
- Çok sayıda `mock-ceo-v1` 0–5 ms `realAiExecution:false` (01:09–15:50Z). MOCK. Gerçek iş değil.

### 3.4 Neden tek proje?

Context (MSSQL, `buildLocalCeoSafeContext`):

- Goals: os-reliability (synaptech-ai-os, dataSource `mssql:ScheduledJobRun`), website-seo (synaptech, **not_connected**), subify-quality, marivo-growth.
- Opportunities: 5 kayıt, 4 projeye dağılmış (`suggestedAgentId` cto/tester/growth-lead).
- Model prompt: “tasks dizisinde en fazla 3 madde” (`local-provider.ts`).
- Scheduler instruction dört proje ister; sağlayıcı 3 görev keser.
- Parent title kanıtı: model OS hedefini seçti.

Kanıt: VERIFIED (goals + parent title + kod limiti). Niyet “saplanma” değil; **prompt + 3-task cap + tek güçlü OS goal**.

---

## 4. Görev ve kuyruk envanteri (yalnızca ops-2026-11-18)

| Metrik | Sayı |
| --- | --- |
| Toplam epoch görev | **4** |
| CEO parent | **1** (`planned`, attempts 0, executionKind `real_ai_pending`) |
| Child | **3** |
| planned | 1 (yalnızca parent) |
| in_progress / testing / in_review / blocked / failed / awaiting_approval | **0** |
| done | **3** |
| En eski bekleyen child | **yok** (`oldestPending: null`) |
| Takılmış child | **[]** |
| Owner pending | 0 |
| Arşiv (board health job result) | activeCount=4, archivedCount=528 (legacy arşiv; epoch’a karışmaz) |

### 4.1 Görev tablosu

| taskId | Ajan | Proje | status | attempts | last real LLM | blockedReason |
| --- | --- | --- | --- | --- | --- | --- |
| `6b4939af-7b71-416a-b86c-1bfdfaa6adc5` | ceo | synaptech-ai-os | planned | 0 | yok (CEO self skip) | null |
| `d5a02f1d-264d-4708-9c7f-5e615e5f5755` | security | synaptech-ai-os | done | 2 | 17:18:56Z 7648 ms | null |
| `db1d72e1-34f7-4d1b-99f7-270d9cd3a9ec` | growth-lead | synaptech-ai-os | done | 2 | 17:19:04Z 8388 ms | null |
| `290bb940-3961-4057-bfbc-9deb2b4609b1` | cto | synaptech-ai-os | done | 3 | 17:22:42Z 14981 ms | null |

### 4.2 Retry / backoff / lease skip / idempotency

- CTO: 17:20:38 planned acceptanceMet=false (8106 ms); 17:21:52 planned false (18865 ms); 17:22:42 done true. `CONTROLLED_AUTONOMY_MAX_RETRIES` default 2; 3. deneme done (attempts=3). Escalation yok.
- `local-agent-pass` boş geçişler: skip LLM (aday yok). Lease skip kaydı yok (`leases: []` sorgu anı).
- CEO: `idempotent_cycle_exists` her ~2 dk. Sonsuz **yeni başlık** döngüsü yok; sonsuz **boş CEO job** var.
- Duplicate riski: `findDuplicateOpenTask` epoch+normalizeTitle; child idempotencyKey title içerir. Parent günlük tek.

### 4.3 DispatchState notu

Done çocuklarda `dispatchState` hâlâ `"ready"` göründü (ör. security). `executeOneLocalAgentTask` done iken `not_applicable` yazmalı; 17:29:55 update ile ready kalması **INFERRED sapma** veya sonraki job’un yeniden ready yazması (`dispatchAutonomousChildren` her CEO skip’te parent children’ı `ready` yapar). Kod: `evaluateAndDispatchAutonomous` AUTO → `dispatchState=ready`. **CEO skip, done görevleri tekrar ready işaretler.** Child status done kaldığı için ajan pass onları **seçmez** (`status in planned|in_progress|backlog`). Zararsız gürültü + kafa karışıklığı.

---

## 5. Dokuz ajan yetenek / çalışma tablosu

Sütunlar: epoch görev | aktif | 24s audit (realOk sayacı kaba) | son LLM | acceptance | araçlar

| Ajan | Epoch görev | Aktif | 24s `ai.local_agent_execution` | Son gerçek LLM | executionKind | Acceptance | Kullanabildiği araç (kod+bu tur kanıt) | Kullanamadığı / kullanılmayan | Neden iş yok / bitmedi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ceo | 1 parent planned | 1 | 0 agent exec | 16:32 plan 91 s REAL_LLM | parent `real_ai_pending` | N/A (self skip `ceo_self_skip`) | MSSQL read context, plan JSON | yazma/onay/cloud | Parent hiç ajan pass’e girmez. Yeni plan gün sonuna kilitli. |
| cto | 1 done | 0 | ≥3 real (2 fail accept, 1 ok) | 17:22:42 14.9 s | local_llm | true (audit findingCategory **dependency_analysis**) | repo_read (package.json vb.) | git_push, defect satır iddiası | Görev bitti. |
| developer | 0 | 0 | 0 | yok | — | — | isolated sandbox_patch (kod) | push/PR | CEO görev vermedi. |
| tester | 0 | 0 | 0 | yok | — | — | isolated docker allow-list (kod); Docker daemon ayakta | package.json scripts | Görev yok; bu turda test kanıtı yok. |
| security | 1 done | 0 | real → done 7648 ms | 17:18:56 | local_llm | true (motor) | repo_read path’ler VERIFIED | yayın/policy değişimi | Tam verifier JSON truncated. İlk tur blocked (bağ); sonra repo_read. |
| growth-lead | 1 done | 0 | real → planned sonra done 8388 ms | 17:19:04 | local_llm | true (motor) | teoride public_fetch; **bu turda repo_read**, public_fetch **yok** | outreach, self-URL lead | Yanlış iş (teknik borç). Dış şirket yok. |
| seo-specialist | 0 | 0 | 0 | yok | — | — | seo_engine (growth_cycle zinciri) | — | CEO+growth_cycle executedSteps=[] |
| content-manager | 0 | 0 | 0 | yok | — | — | content draft DB (drafts=2 eski) | blog_publish | Görev yok. |
| ads-manager | 0 | 0 | 0 | yok | — | — | ads taslak | ad_launch, spend grant false | Görev yok. |

**Ayrı kanallar**

- DETERMINISTIC: `SCHEDULER_AI_CEO_MODE=local` iken ceo_cycle deterministik yola düşmez. 24s mock CEO audit’leri epoch öncesi/eski mode.
- MOCK: mock-ceo-v1 audit’leri REAL değil.
- REAL_LLM: CEO 91 s; security/growth/cto qwen çağrıları (süreler audit).
- REAL_TOOL: repo_read/list/head security+cto+growth truncated JSON’da. public_fetch **yok**. sandbox_command/diff **yok**. Docker test **yok**. HTTP lead fetch bu epoch child’ında **yok**.

Model metni ≠ araç. Growth done, public_fetch yok → **metin + repo okuma**, dış araştırma değil.

---

## 6. Scheduler → CEO → ajan zinciri

```
setInterval 60s (startAutonomyScheduler)
  → schedulerTick(trigger=timer)  [autonomy-scheduler.ts]
    → due jobs:
       daily-ceo-review */2  → runScheduledAiCeoCycle
         → [idempotent?] skip LLM
         → else LocalModelProvider.generateCeoPlan → validateAndGroundPlanTasks → Task+AgentMessage
         → dispatchAutonomousChildren (AUTO → dispatchState=ready, Cloud yok)
         → runControlledAutonomyTick(ceoCycle)
       local-agent-pass */1 → runControlledAutonomyTick(skipCeo=true)
         → runLocalAgentExecutionPass (LLM lease 1, tickMax≤4)
            → inspectForRole / growth research
            → provider.executeAgentWork
            → verifyAcceptanceIndependently
            → Task status + AgentMessage result
```

| Aşama | Kod | Son başarılı | Son hata / skip | Neden geçildi/geçilmedi |
| --- | --- | --- | --- | --- |
| Timer | `startAutonomyScheduler` | 17:29:55 tick | stale worker satırları | timerActive true |
| Job due | `isDue` cron dakika | ceo 2 dk, agent 1 dk, recon 5, growth 10 | growth last 17:23:22 | |
| AI CEO | `runScheduledAiCeoCycle` | 16:32:49 real plan | sonra hep idempotent | existingParent origin |
| Task write | prisma.task.create | 3 child | — | |
| AgentMessage | handoff 16:32; result 17:18–17:22 | — | |
| Dispatch | `dispatchAutonomousChildren` | AUTO ready | Cloud POLICY-AUTO kapalı | yerel ajan için yeterli |
| ModelProvider | `local-provider.ts` complete **timeout yok** (fetch generate) | CTO 15 s | — | |
| ToolActions | RepositoryToolAdapter / growth-engine | repo_read | public_fetch yok | growth eski yolda repo inspect |
| Acceptance | `acceptance-verifier.ts` | audit acceptanceMet true | JSON 8000 kesik | bağımsız re-parse fail |
| CEO feedback | `buildLocalCeoSafeContext` recentAgentResults + epochChildTitles | instruction kodda var | **yeni plan yok** (idempotent) | öğrenme bir sonraki UTC güne erteli |

### CEO görev yazdığı halde ajanlar neden “işlemiyor” görünüyor?

1. **İşlediler ve bitirdiler.** 17:18–17:22 arası üç çocuk done. Şu an kuyruk boş.
2. Dashboard “CEO her tick planlıyor” sanısı: job succeeded + skip.
3. Parent `planned` durur; CEO ajan pass’e girmez.
4. Yeni child üretilmez (günlük idempotency + 3 görev hepsi done).
5. Growth/SEO görünür iş yok çünkü yanlış rol ataması ve growth_cycle `executedSteps:[]`.

---

## 7. Acceptance reddi nedenleri

### 7.1 İlk döngü (kullanıcı kanıtı + bağ)

İlk otonom CEO sonrası security/growth `acceptance_not_met`, cto `unverified_evidence`:

- Beklenen: security repo_read+path; growth dış public_fetch; cto repo_read + findingKind.
- Gerçek: `repo_binding_unverified` / `blocked` (bağ o anda verified değildi).
- CTO blockedReason plan grounding (`mssql:Task` boş tablo riski); yürütme yine de başladı.
- Çözüm yeri: `project-repo-registry.ts` + `acceptance-verifier.ts` (gevşetme değil, bağ/kanıt). Kriter değiştirilmedi.

### 7.2 Bu tur kayıtları (kesik JSON)

| taskId | Agent | Beklenen | Model/audit iddiası | toolActions (truncated) | Eksik | Verifier | Modül |
| --- | --- | --- | --- | --- | --- | --- | --- |
| d5a02f1d | security | repo_read + path + risk/analiz | audit acceptanceMet true, 7648 ms | repo_head, repo_list, repo_read ×N; path package.json, docker-compose.yml, testler | public_fetch gerekmez; tam reasons yok | Kesik JSON → re-parse UNKNOWN; motor true | `local-agent-execution.ts` slice(0,8000) **kayıt hatası** |
| db1d72e1 | growth-lead | public_fetch dış URL trusted | audit true 8388 ms | **repo_read**, public_fetch **false**, self lead’ler | dış URL | Sıkı kural sonra eklendi; o anki motor true | `growth-engine.ts` + verifier public_fetch; görev konusu yanlış |
| 290bb940 | cto | repo_read ≥2 path + findingKind | 17:20/17:21 findingCategory **none** accept false; 17:22 **dependency_analysis** true | repo_read paths | ilk denemelerde findingKind none | verifier doğru reddetti sonra geçti | `acceptance-verifier.ts` + execution findingKind enjeksiyonu |

unverified_evidence: child description’da kalmış olabilir; status done, blockedReason null.

---

## 8. Dört proje karşılaştırması

| Proje | CompanyGoal | Repo binding | Son CEO değerlendirme | Epoch görev | Aktif | Araç | Engel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| synaptech-ai-os | os-reliability (mssql:ScheduledJobRun) | verified owner_file, local root var, github URL yok | 16:32 plan buraya yazıldı | 4 | 1 parent | repo_read çalıştı | Yeni child yok |
| synaptech | website-seo **not_connected** | verified owner_file, local+github | fırsat var, görev yok | 0 | 0 | binding ok | CEO seçmedi; SEO dataSource bağlı değil |
| subify | subify-quality mssql:Opportunity | verified **mssql**, local+github | fırsat growth-lead | 0 | 0 | binding ok | CEO 3 slot’u OS’e harcadı |
| marivo | marivo-growth mssql:Opportunity | verified owner_file | fırsat growth-lead | 0 | 0 | binding ok | aynı |

**Dört proje kuralı var mı?** Evet, scheduler instruction string (`ai-ceo-scheduler.ts`). **Çalışıyor mu?** Bu plan çıktısında **hayır** (0/3 çocuk diğer projelerde). Zorunlu dağılım kodu yok; yumuşak prompt. Ek sert limit: max 3 görev.

---

## 9. Growth / GitHub / Outreach

| Soru | Cevap | Kanıt |
| --- | --- | --- |
| Growth dış şirket lead? | **Hayır** | 3 lead, hepsi `self:true`, synaptech.software, createdAt 00:10Z (epoch CEO’dan önce) |
| Kaynak harici mi? | Hayır | URL’ler kendi site |
| CRM gerçek mi? | HTTP title kazıntısı + HTML entity bozulması; kişisel veri yok; outreachConsent unknown | lead.notes CRM embed (değerler rapora dökülmedi) |
| SEO/Content/Ads dispatch | growth_cycle 17:23 `executedSteps:[]`, `realAiExecution:false` | ScheduledJobRun |
| GitHub read-only | bindings verified, localReadRoot true, writeAllowed false | registry |
| Developer patch | epoch görev yok | — |
| Tester Docker | daemon var; tester görevi yok | docker info |
| Draft PR engeli | `githubPushDraftPr=false` **ve** mode off → `owner_grant_required:githubPushDraftPr` / `github_write_mode_off` | `github-write-adapter.ts` + grants |
| Outreach engeli | `customerOutreach=false` → `owner_grant_required:customerOutreach`; mode off | `outreach-adapter.ts` |

---

## 10. Güvenlik ve yetki durumu

| Kapı | Durum |
| --- | --- |
| githubRepoCreate | false |
| githubPushDraftPr | false |
| customerOutreach | false |
| productionDeploy | false |
| financialSpend | false |
| permanentLocalAutonomy | true |
| Kill switch | false (DB) |
| Cloud live | false (launch) |
| Repo tools | read_only; writeAllowed false |
| Sandbox | isolated; ana repo yazılmaz (kod) |
| Korumalı yollar | `.cursor/**`, `config/**`, `AGENTS.md` vb. (politika; bu teşhiste değiştirilmedi) |
| Onay kuyruğu | 0 pending |
| contentDrafts | 2 (yayın iddiası yok) |
| seoFindings | 4 (epoch görevine bağlı değil) |

---

## 11. Kanıtlı kök nedenler

### A. CEO neden görevleri düzgün dağıtmıyor?

1. UTC-günlük tek parent (`idempotent_cycle_exists`) — `ai-ceo-scheduler.ts`.
2. Sağlayıcı **max 3 görev** — `local-provider.ts`.
3. Zorunlu proje round-robin yok; model `os-reliability` + OS title’a kilitlendi.
4. `website-seo` dataSource `not_connected` zayıf sinyal.
5. Instruction dört proje ister; şema 3 keser.

### B. Ajanlar neden gerçek işleri tamamlayamıyor?

Kısmen **tamamladılar** (3 done). Kalan boşluk: yanlış rol (growth=teknik borç), dış lead yok, developer/tester/seo/ads hiç iş almadı, kanıt sütunu 8000’de kırık, tester Docker’a bağlanmadı çünkü görev yok.

### C. Scheduler sıklığı?

- Timer **60 sn** (`startAutonomyScheduler`).
- `local-agent-pass` cron `*/1`.
- `daily-ceo-review` `*/2`.
- `run-reconciliation` `*/5`.
- `growth-cycle` `*/10`.
Son tick 17:29:55Z. Son başarısız job: bu 24s örneklerinde status failed **görülmedi** (ceo skip = succeeded).

### D. CEO yeni plan vs child işleme çakışması?

Aynı tick’te ceo_cycle önce, sonra controlled tick. Idempotent CEO **LLM tutmaz**. Ajan pass paralel job olarak 1 dk’da bir. LLM lease `llm:local:call` eşzamanlı 1. Çakışma: uzun CTO çağrısı (~15–19 s) diğer LLM’i bekletir; kuyruk boşken önemsiz.

### E. Dispatch yalnızca CEO tick sonunda mı?

**Hayır.** `local-agent-pass` bağımsız. Ayrıca her ceo_cycle (skip dahil) `dispatchAutonomousChildren` + `runControlledAutonomyTick` çalışır.

### F. Eksik gerçek araç bağlantıları?

- Growth: public_fetch bu child’da yok; self URL’ler.
- GitHub write: grant+mode kapalı (bilinçli).
- SMTP: mode/grant kapalı.
- Cloud: kapalı.
- Tester/developer: bağ var, görev yok.
- synaptech-ai-os: githubRepoUrl yok (yerel kök var).

### G. Kendi kendine düzelmesini engelleyen hatalar?

- Günlük CEO idempotency → boş kuyrukta yeni iş yok.
- Max 3 görev + tek proje seçimi.
- Done sonrası yeni child yok.
- executionResult truncation → denetim/öğrenme zayıf.
- Stale WorkerInstance running.
- growth_cycle executedSteps boş (ayrı zincir, AI CEO child’larından bağımsız).
- Parent forever planned.

### H. Hiçbir şey değişmezse önümüzdeki saatler?

- 60 sn timer, 1 dk agent_pass `processed:[]`.
- 2 dk CEO skip idempotent.
- 10 dk growth_cycle muhtemelen yine boş steps (INFERRED, son run boş).
- UTC 2026-11-19T00:00Z sonrası yeni origin günü → **yeni CEO LLM planı mümkün** (Ollama ayakta).
- Harcama/GitHub/e-posta/deploy yok.
- Kill switch kapalı kalır.

---

## 12. Önem sırasına göre ilk 10 somut düzeltme

1. **Günlük tek CEO parent’ı “öğrenme döngüsü”nden ayır:** child’lar done olduktan sonra aynı gün ikinci plan (veya idle skip yerine “queue empty → plan”) — `ai-ceo-scheduler.ts`.
2. **3 görev hard cap’i 4 proje kuralıyla hizala** — `local-provider.ts` / CeoPlanSchema; mümkünse proje başına min 0..n.
3. **Zorunlu proje çeşitliliği** (yumuşak prompt yetmedi) — plan-grounding veya post-filter.
4. **Rol kısıtı:** growth-lead’e tech-debt atamasını reddet — scheduler validation.
5. **Growth self-URL lead’i kanıt sayma** (kısmen kodda; bu done görev eski yoldan geçti).
6. **executionResult kesmeyi kaldır / kompakt JSON** — `local-agent-execution.ts` slice 8000 (kodda 24000 kompakt var; **çalışan süreç 17:26 restart** sonrası yeni iş olmadığı için eski 8000 kayıt duruyor).
7. **dispatchAutonomousChildren done görevleri tekrar ready yazmasın.**
8. **CEO parent’ı planned bırakma** (in_review/done) — kuyruk gürültüsü.
9. **growth_cycle executedSteps=[]** kök nedeni (zincir state) — `growth-coordination.ts`.
10. **Stale WorkerInstance** heartbeat/timeout — görünür “çoklu scheduler” yanılgısı.

Kabul kriterlerini gevşetme.

---

## 13. Çalışır durumdaki parçalar

- API+MSSQL+timer tek süreç PID 1656.
- Ollama qwen2.5:14b probe (tags).
- Gerçek CEO planı 91 s, 3 child, handoff mesajları.
- Ajan pass LLM+repo_read (security, cto; growth yanlış araç seti).
- LLM eşzamanlı 1, Cloud live kapalı, grant’ler kapalı.
- Repo bindings dört proje verified local read.
- Docker daemon ayakta.
- Dashboard 3100 health 200.
- Idempotency sonsuz aynı başlığı yeniden yazmıyor.

---

## 14. Henüz gerçek çalışmayan parçalar

- Dört projeye görev dağıtımı (çıktı yok).
- SEO / content / ads ajan pass (görev yok).
- Developer sandbox patch (görev yok).
- Tester Docker test (görev yok).
- Dış müşteri lead (self URL).
- GitHub Draft PR / outreach / deploy / spend.
- CEO’nun ajan sonuçlarından **aynı gün** yeni plan.
- Bağımsız acceptance JSON arşivi (8000 kesik).
- `config/system-status.yaml` gerçek runtime beyanı.
- WorkerInstance stale cleanup.

---

## SORUN | KÖK NEDEN | ETKİLENEN MODÜL | KANIT | ÖNCELİK | ÖNERİLEN DÜZELTME

| SORUN | KÖK NEDEN | ETKİLENEN MODÜL | KANIT | ÖNCELİK | ÖNERİLEN DÜZELTME |
| --- | --- | --- | --- | --- | --- |
| CEO 2 dk’da “başarılı” ama plan yok | UTC gün origin + existingParent return | `ai-ceo-scheduler.ts` `idempotent_cycle_exists` | JobRun 17:24/17:26/17:29 resultJson skip; parent 6b4939af | P0 | Done kuyruk boşken aynı gün ikinci plan veya suffix=cycle |
| Tek projeye 3 görev | max 3 task + OS goal bias | `local-provider.ts` slice(0,3); context goals | 3/3 child synaptech-ai-os; diğer projeler 0 | P0 | 4 slot veya zorunlu slug çeşitliliği |
| Ajan pass boş | Child’lar done, yeni child yok | `local-agent-execution.ts` aday filtresi | agent_pass processed:[] 17:24–17:29 | P0 | CEO’nun yeni iş üretmesi (yukarı) |
| Growth dış müşteri yok | Self lead + repo_read görevi + public_fetch yok | `growth-engine.ts`, verifier, CEO atama | leads self=true; truncated kinds public_fetch false | P0 | Rol gate + self URL fail-closed (done eski kayıt durur) |
| Kanıt JSON okunamıyor | executionResult.slice(0,8000) | `local-agent-execution.ts` | rawLen 8000 Unterminated string | P1 | Kompakt kayıt (kod hazır; yeni yürütme şart) |
| CTO ilk 2 deneme fail | findingKind=none | `acceptance-verifier.ts` | audit 17:20, 17:21 findingCategory none | P1 | Prompt/tool footer (kriter gevşetme) — 3. deneme geçti |
| SEO/Content/Ads sıfır | CEO atamadı; growth_cycle steps boş | `ai-ceo-scheduler.ts`, `growth-coordination.ts` | epochAssigned 0; executedSteps:[] | P1 | Growth zinciri vs AI CEO child birleştir |
| Developer/Tester sıfır | Plan 3 slot dolu | local-provider + CEO JSON | görev yok | P2 | Yazılım zinciri ayrı policy |
| Draft PR/outreach kapalı | Grant false + mode off | grants, github-write-adapter, outreach-adapter | grants query | P2 | Owner kararı; teşhis açmaz |
| Stale workers running | kill sonrası satır update yok | worker-lease / WorkerInstance | 17436/6008 status running | P2 | lastSeen timeout |
| Parent sonsuz planned | CEO execute skip | `local-agent-execution.ts` ceo_self_skip | attempts 0 | P3 | Parent’ı kapama geçişi |
| Skip CEO done’ları ready yazar | dispatch AUTO update | `autonomy-dispatch.ts` | done + dispatchState ready | P3 | status!=done filtre |
| system-status.yaml yalan | korumalı eski beyan | `config/system-status.yaml` | autonomy disabled vs timer true | P3 | Owner güncellemesi |
| website-seo not_connected | veri kaynağı yok | CompanyGoal | goals query | P2 | Bağlı metrik veya CEO’ya “veri yok, uydurma” |
| Ollama timeout yok | fetch generate abort yok | `local-provider.ts` complete() | kod; uzun 91 s CEO yaşadı | P2 | AbortSignal |
| Kill reason dosya≠DB | iki kaynak | kill-switch | DB coord-test-setup | P3 | tek kaynak |
| HTML entity lead adları | decode yok | growth-engine titleFromHtml | KOB&#x130; | P3 | decode |
| Çoklu “running” worker yanılsaması | heartbeat durmuyor | WorkerInstance | tablo | P3 | stopReason yaz |

---

*Rapor sonu. Gizli token, SMTP şifresi, .env içerikleri dahil edilmedi.*
