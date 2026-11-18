# Üç child görev — salt okunur yürütme kontrolü

Kanıt anı: `2026-11-18T19:22:53Z`. Kaynak: MSSQL (Task, AgentMessage, AuditLog, ScheduledJobRun, Lead, GrowthScanRun) + GET `/api/system/*`, `/api/ops/*`, `/api/ai/*`. Kod değişmedi, tick tetiklenmedi, Ollama çağrılmadı.

CEO parent: `ffd9dea3-4ed3-454b-b008-94bb3e3d9f02`  
origin: `scheduler-ai-ceo:ops-2026-11-18:cycle:c6f7d85f-8b0c-44ac-8500-2d4f5d850c54`  
model: `qwen2.5:14b` · status: **in_review** · blockedReason: **children_not_all_accepted** · finishedAt: yok

## Tablo (istenen 3 child)

| Task ID | Proje | Ajan | Durum | Gerçek LLM | Gerçek araçlar | Acceptance | Somut çıktı | Engel |
|---|---|---|---|---|---|---|---|---|
| `935d6b6e-4964-4761-8f0a-d72dc3af8a7d` | synaptech | seo-specialist | done / not_applicable · attempts=1 | evet qwen2.5:14b · 7791 ms · providerInvoked | repo_head, repo_list, repo_read (SynapTech.sln, csproj, README, Docker), **public_fetch seo_scan** | bağımsız **true** (modelAcceptanceIgnored) · draftKind=seo_findings | Scan `c83fc199` succeeded measured=4; evidence v2 sha256 eşleşti | Yeni SeoFinding satırı yok (dedupe); öneriler genel |
| `79648c69-821d-4613-a795-9498bed95dfe` | subify | cto | **planned/ready** · attempts=0 (satır); executionResult attempts=3 escalated | evet qwen2.5:14b · 5 başarılı çağrı (8056, 9586, 6628, 9685, 6296 ms) | repo_head `673b3c39…`, repo_list (40 dosya), repo_read: Subtitle.sln, frontend/package.json, Auth/Video/Wallet csproj, requirements-dev.txt | bağımsız **false** · findingKind=**none** | Dosya okuma var; verified_defect yok | Verifier: “yalnızca repo_read + yol atfı kapsamlı teknik denetim değildir”; escalation sonrası Owner onay satırı attempts=0 ile tekrar kuyruk |
| `6999d63a-7db9-462a-930f-430735c4f826` | marivo | growth-lead | done / not_applicable · attempts=1 | evet qwen2.5:14b · 4973 ms · providerInvoked | **public_fetch** `https://www.ebso.org.tr/` | bağımsız **true** · draftKind=research_brief | CRM Lead `1f4213de…` EBSO verified=true, sourceKind=public_company_page | Lead `projectSlug=synaptech` (görev marivo); izto/tobb fetch failed; “fit bekleniyor” |

Evidence v2: üç child’ta da `AgentMessage.kind=evidence` gövdesi JSON parse edildi; sha256 yeniden hesaplandı ve **eşleşti** (`truncated=false`). CTO’da 5 ayrı kanıt sürümü var; son compactResult sha `e5b2c45c…`.

## A–G

**A. Üç ajanın kaçı gerçekten çalıştı?** 3/3. Hepsi `ai.local_agent_execution` + `realAiExecution=true` + `modelId=qwen2.5:14b`.

**B. Üç görevin kaçı bağımsız kabulden geçti?** 2/3 (SEO, Growth). CTO geçmedi.

**C. Growth gerçekten dış müşteri buldu mu?** Dış **public_fetch** ve 1 doğrulanmış CRM kaydı var (EBSO). Satış/anlaşma yok; izto.org.tr ve tobb.org.tr fetch başarısız; lead Marivo’ya değil varsayılan `synaptech` slug’ına yazıldı.

**D. CTO Subify için gerçek teknik bulgu üretti mi?** Gerçek **repo_read** var (doğrulanmış Subify kökü, HEAD `673b3c39…`). Bağımsız verifier `findingKind=none` dediği için **verified_defect / yapı-borç kanıtı kabul edilmedi**. Model “borç yok” dedi; bu acceptance değil.

**E. SEO SynapTech sitesi için kaynaklı bulgu çıkardı mı?** Evet araç katmanı: `public_fetch` path=`seo_scan`, scan run succeeded **measured=4**. `SeoFinding` tablosunda 19:00Z sonrası **yeni satır yok** — upsert mevcut dedupe kayıtlarını saydı. Repo tarafı kurumsal C# checkout (`SynapTech.sln`); GSC/GA4 bağlı değil.

**F. CEO bu sonuçlardan sonraki planını oluşturabilecek mi?** Bu parent **kapanmadı** (`in_review` / `children_not_all_accepted`). Buna rağmen scheduler **üç ek CEO parent** yazdı (19:16, 19:19, 19:22). Yani “sonraki plan” child kabulünü beklemeden üretildi.

**G. Tek en önemli engel:** CTO bağımsız kabul eşiği (`findingKind=none`) parent’ı kapatamıyor; aynı anda CEO min-interval/kuyruk disiplini delinerek yeni planlar LLM slotunu dolduruyor. Asıl teslim tıkanması: **Subify CTO görevinin doğrulanmış teknik bulgu üretememesi + tekrar plan üretimi.**

## 12–15 kısa kanıt

Yeni CEO parent’lar (orijinal 3 bitmeden):  
`eda26e19…` (security/seo/cto), `6f33d804…` (tester/cto/growth), `bcce354e…` (tester). Circuit `lastSuccessAt=19:22:35Z`, `openUntil=null`.

Son ~30 dk LLM: 4 CEO başarı (10831 / 8071 / 6298 / 7307 ms); ajan süreleri ~5–18 sn. Hata: 18:55 CEO `local_llm_invalid_json` dönemi; 19:22:47 CTO `This operation was aborted` (başka görev `9062620c…`). Audit sayımı: `ai.local_agent_execution` 13, `ai.scheduler_ceo_cycle` 5, `approval.approved` 3, `dispatch.auto_ready` 7.

Scheduler: PID **19196**, `timerActive=true`, `ticking=false`, `lastTickAt=19:22:02Z`, worker `worker-Cenk-19196-8f99743c`. Tick anında lease tutulmuş; snapshot’ta `WorkerLease` boş (tick arası serbest). `pendingReady=7`. `local-agent-pass` enabled/succeeded.

Kill switch: DB `enabled=false`. Cloud live `false`. `GITHUB_WRITE_MODE=off` → canlı push/PR yok. **Owner grant değerleri kapalı değil:** githubRepoCreate, githubPushDraftPr, customerOutreach, productionDeploy **true**; financialSpend **false**. Çalışma anında yazma adaptörü yine `github_write_mode_off`.

## Hâlâ BLOCKED

- GitHub push/PR (env mode off; bağlar read_only)
- Müşteri e-postası (bu döngüde send yok)
- Production deploy / finansal harcama
- Cloud live / ücretli API
- website-seo GSC/GA4 not_connected
- CEO parent kapanışı (CTO acceptance)
- Günlük yapay kota bu kontrolde geri açılmadı (`unlimitedDaily=true` zaten runtime’da)
