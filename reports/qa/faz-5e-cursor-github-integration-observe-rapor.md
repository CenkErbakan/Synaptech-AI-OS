# Cursor + GitHub entegrasyon gözlem raporu

**Tarih:** 2026-11-18  
**Kapsam:** Salt-okunur denetim + durum gösterimi düzeltmesi  
**Yasaklananlar:** Yeni Cloud Agent, On-Demand, push/merge/deploy, Ollama pilotu, `config/system-status.yaml` değişikliği

## Özet cevaplar

| Soru | Sonuç |
|------|--------|
| Cursor Cloud credential var mı? | **Evet** (`credentialConfigured=true`, değer yazılmaz) |
| Cursor Cloud bağlantısı doğrulandı mı? | **Hayır** — `GET /v1/agents?limit=1` **zaman aşımı** (`connectivityVerified=false`) |
| Geçmiş başarılı Cloud pilotu görünüyor mu? | MSSQL’de **50 AgentRun** var (`pastPilotExists=true`); hepsi `executionMode=mock` (`live_count=0`). `pastSuccessfulLiveRun=false`. T-P4B-001 görev dosyası duruyor; bu turda live satır bulunamadı (silinmedi, gözlemde live yok) |
| GitHub API erişimi çalışıyor mu? | **Evet (repo erişimi)** — `git ls-remote` ile Subify/Marivo/SynapTech OK; `GITHUB_TOKEN` yok |
| GitHub App kurulumu doğrulandı mı? | **UNKNOWN** — App ID/kurulum kanıtı yok; API/git erişimi App sayılmaz |
| Statik config otomatik değişti mi? | **Hayır** |

## `resolveCursorCredentials` hatası

Doğru export: **`getCursorCredentialStatus`** (`apps/api/src/cursor/credentials.ts`).  
`resolveCursorCredentials` **yoktur** — önceki eval yanlış isim kullanmıştı. Test: `tests/integration-observation.unit.test.ts` bunu kilitler.

## Config beyanı vs gözlem

| Alan | `configDeclaredStatus` | `observedRuntimeStatus` |
|------|------------------------|-------------------------|
| Cursor | `none` | credential var · canlı bağlantı başarısız (timeout) · live kapalı |
| GitHub App | `not_connected` | App **UNKNOWN** · repo erişimi var |
| IDE / tarayıcı | — | Cursor IDE / GitHub web **kanıt sayılmaz** |

Endpoint: `GET /api/integrations/status`  
Dashboard üst şerit: **Config …** ve **Gözlem · …** ayrı satırlar.

## Dört proje

| Proje | Verified (MSSQL) | Repo URL | Local remote uyumu | Readonly erişim |
|-------|------------------|----------|--------------------|-----------------|
| subify | **true** | github.com/CenkErbakan/Subify | true | true (git ls-remote) |
| marivo | false | github.com/CenkErbakan/marivo | true | true |
| synaptech | false | github.com/CenkErbakan/SynapTech | true | true |
| synaptech-ai-os | false | yok | false | unknown |

## Modlar (değiştirilmedi)

- `CLOUD_AGENT_LIVE_ENABLED=false`
- `CURSOR_CLOUD_MODE=mock`
- Scheduler / sandbox / local agent: off (önceki güvenlik durumu)

## Eksik somut yapılandırma

1. Cursor Cloud **bağlantı** (credential var ama API timeout — ağ/firewall/base URL kontrolü)
2. Bilinçli: live bayrakları kapalı (isteğe bağlı açılmaz)
3. GitHub App kurulumu + doğrulanabilir kanıt (App ID)
4. İsteğe bağlı `GITHUB_TOKEN` (şu an git credential ile erişim var)
5. Marivo / SynapTech / synaptech-ai-os için **MSSQL verified** `githubRepoUrl`

## Testler

`vitest run tests/integration-observation.unit.test.ts` → **2/2 geçti**  
Dashboard `tsc --noEmit` → geçti  
Canlı `GET /api/integrations/status` → **200**, secret sızıntısı yok

## Değişen dosyalar

- `apps/api/src/engines/integration-observation.ts` (yeni)
- `apps/api/src/modules/integrations/routes.ts` (yeni)
- `apps/api/src/app.ts`, `agent-runtime-summary.ts`, `system/routes.ts`
- `apps/dashboard/.../phase-strip.tsx`, `agents-runtime-panel.tsx`
- `apps/api/tests/integration-observation.unit.test.ts`
