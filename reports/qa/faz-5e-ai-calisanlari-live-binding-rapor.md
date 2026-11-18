# AI Çalışanları — canlı MSSQL/API bağlama raporu

**Tarih:** 2026-11-18  
**Kapsam:** Dashboard `/ajanlar` + `GET /api/agents/runtime-summary`  
**Sınırlar:** Görev/audit/onay değiştirilmedi; yeni Ollama/Cloud çağrısı yok; production deploy yok.

## Sorun

Sayfa yalnızca ajan tanım dosyası + config entegrasyon etiketlerine bakıyordu. Gerçek Task / AgentMessage / Audit / AgentRun kayıtları kartlara yansımıyordu → “Kayıt yok”, “GitHub: bağlı değil”, yalnızca `composer-2.5`.

## Çözüm

| Katman | Değişiklik |
|--------|------------|
| API | `apps/api/src/engines/agent-runtime-summary.ts` — per-agent runtime özeti |
| Route | `GET /api/agents/runtime-summary` (`apps/api/src/modules/agents/routes.ts`) |
| Dashboard | `AgentsRuntimePanel` — 15 sn poll + manuel yenile; API hatasında canlı iddia yok |
| Üst çubuk | `PhaseStrip` — verified repo / Cloud / Scheduler canlı API’den |

### Ayrımlar

1. **Tanımlı Cursor modeli** (frontmatter) ≠ **son gerçek model** (executionResult / Task.model) ≠ **sağlayıcı** (local/mock/cloud/deterministic).
2. **GitHub App** (bağlı değil) ≠ **proje verified repo** (Subify MSSQL) ≠ **Cloud Agent yetkisi** (kapalı).
3. **Geçmiş Cloud pilot** ≠ **şu an live** (`CLOUD_AGENT_LIVE_ENABLED` + `CURSOR_CLOUD_MODE`).
4. **Birincil görev** gerçek `LOCAL_LLM` / T-P5E / repo_read skoruna göre; **en güncel kayıt** ayrı (mock test ezmez).
5. **currentlyWorking** yalnızca yürütme modları açıkken ve `in_progress` varken; modlar `off` iken “çalışıyor” yok.
6. **Tester** deterministic/fixture canlı AI sayılmaz → `lastTask: null`, kanal `NONE`.
7. `archivedAt IS NOT NULL` görevler sayılmaz.

## Kabul (MSSQL canlı sorgu + vitest)

Kanıt:
- `pnpm --filter @synaptech/api exec vitest run tests/agent-runtime-summary.integration.test.ts` → **geçti**
- Canlı `GET http://127.0.0.1:3101/api/agents/runtime-summary` → **200** (API yeniden başlatıldı)

| Kriter | Sonuç |
|--------|--------|
| CEO scheduler / T-P5E-003 | `ceoScheduler` audit + notlar; mode **off**; gerçek yerel sayacı ayrı |
| CTO T-P5E-005 done + ≥8 repo_read | `LOCAL_LLM`, title T-P5E-005, `repoReadCount=8`, model `qwen2.5:14b` |
| Developer T-P5E-004 gerçek LLM, kod yok | `LOCAL_LLM`, `codeChangeApplied=false`, model `qwen2.5:14b` |
| Tester canlı AI yok | `lastTask=null`, kanal `NONE`, uyarı notu |
| Subify verified | `https://github.com/CenkErbakan/Subify` |
| Diğer projeler verified değil | marivo / synaptech / synaptech-ai-os false |
| Cloud | geçmiş pilot var · live kapalı |
| Scheduler | **off** |
| currentlyWorking | tüm ajanlar **false** (modlar kapalı) |
| API kapanınca | Panel/Proxy `Bağlantı hatası` / 503 — eski veriyi “canlı” sunmaz |

## Operasyon notu

Çalışan API süreci eskiyse **yeniden başlatın** ki `/api/agents/runtime-summary` yüklensin. Dashboard ` /api/control/agents/runtime-summary` proxy’si `SYNAPTECH_API_URL` (varsayılan `http://127.0.0.1:3101`) üzerinden gider.

## Dosyalar

- `apps/api/src/engines/agent-runtime-summary.ts`
- `apps/api/src/modules/agents/routes.ts`
- `apps/api/tests/agent-runtime-summary.integration.test.ts`
- `apps/dashboard/src/app/ajanlar/page.tsx`
- `apps/dashboard/src/components/views/agents-runtime-panel.tsx`
- `apps/dashboard/src/components/layout/phase-strip.tsx`
