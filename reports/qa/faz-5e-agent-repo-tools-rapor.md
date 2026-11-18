# Ajan gerçek araç yetenekleri — durum raporu

Tarih: 2026-11-18  
Proje: synaptech-ai-os  
Kapsam: Mevcut ajan altyapısı genişletmesi (yeni faz/mimari yok)  
Canlı repo işlemi: **yok** (Owner onayı bekleniyor: T-P5E-005)

## Özet

Ajanlar artık yalnızca metin üretmek zorunda değil; **RepositoryToolAdapter**, **allow-list sandbox** ve **bağımsız kabul doğrulayıcı** eklendi. Varsayılan modlar kapalı (`AGENT_REPO_TOOLS_MODE=off`, `AGENT_SANDBOX_MODE=off`). Dört projenin GitHub eşlemeleri keşfedildi ama **doğrulanmadı** → araçlar engelli.

T-P5E-004 CTO/Developer görevleri silinmedi / done yapılmadı.

## Hangi gerçek araçlar kullanılabilir?

| Araç | Rol | Koşul | Durum |
|------|-----|-------|--------|
| `repo_list` / `repo_read` / `repo_head` | CTO, Developer | `AGENT_REPO_TOOLS_MODE=read_only` + **verified** bağ + yerel okuma kökü | Kod hazır; üretim kapalı |
| Mock repo inceleme | test | `AGENT_REPO_TOOLS_MODE=mock` | Unit testlerde geçti |
| Sandbox allow-list komut (`pnpm test/typecheck/lint`) | Tester (Developer taslak) | `AGENT_SANDBOX_MODE=isolated` + temp kopya | Kod hazır; üretim kapalı |
| Keyfi shell / push / PR / Cloud create | — | Yasak | Kapalı |
| Cursor Cloud | ayrı izin + allow-list + bütçe | `CLOUD_AGENT_LIVE_ENABLED` | Auto-dispatch kapalı |

Sabit allow-list: `pnpm_test`, `pnpm_typecheck`, `pnpm_lint`, `node_vitest_run_file` (timeout, `shell:false`, temp cwd).

## Hangi kabul kriterleri doğrulanabilir?

Bağımsız `verifyAcceptanceIndependently` model iddiasını ezer:

| İddia | Gerekli kanıt | Yoksa |
|-------|---------------|--------|
| Tester “test ettim” / `acceptanceMet=true` | `sandbox_command` + `exitCode=0` | false |
| Developer “kod geliştirdim” / `codeChangeApplied=true` | `sandbox_diff` | false |
| CTO inceleme `acceptanceMet=true` | en az bir `repo_read` | false |
| Görev `done` | yukarıdaki doğrulama true | `planned` kalır |

Repo içeriği `UNTRUSTED_REPO_CONTENT` olarak sarılır; README/talimatlar Owner politikasını değiştiremez. Secret’lar modele/log’a redakte edilir.

## Dört proje bağ durumu (tahmin yok)

Kaynak: `gh repo list` + yerel `git remote` → `tasks/ops/project-repo-bindings.proposed.json`  
MSSQL `githubRepoUrl`: dört projede de **null**

| Slug | Keşif URL | verified | Araç |
|------|-----------|----------|------|
| subify | https://github.com/CenkErbakan/Subify (private) | false | engelli |
| marivo | https://github.com/CenkErbakan/marivo (private) | false | engelli |
| synaptech | https://github.com/CenkErbakan/SynapTech (private) | false | engelli |
| synaptech-ai-os | GitHub origin yok; yerel workspace (commit yok) | false | engelli |

Doğrulanmadan otomatik değişiklik / clone / push başlatılmadı.

## İlk kabul testleri (bu tur)

1. **Subify CTO salt-okunur** — fixture + mock ile kaynak inceleme kanıtı üretildi; gerçek Subify ağacı için T-P5E-005 onayı gerekli.
2. **AI OS izole sandbox** — `materializeSandboxCopy` + allow-list komut kanıt kaydı unit testte doğrulandı.
3. **Mock/unit:** `apps/api/tests/repository-tools.unit.test.ts` → **6/6 geçti**
4. **Regresyon:** `local-agent-execution.integration.test.ts` → **5/5 geçti**
5. Onay dosyası: `tasks/approvals/T-P5E-005-agent-repo-tools-readonly-pilot.md`

## Eklenen bileşenler

- `apps/api/src/ai/repo/repository-tool-adapter.ts`
- `apps/api/src/ai/repo/sandbox-runner.ts`
- `apps/api/src/ai/repo/acceptance-verifier.ts`
- `apps/api/src/ai/repo/project-repo-registry.ts`
- `apps/api/src/ai/repo/secret-policy.ts`
- `packages/shared/src/domain/agent-tools.ts`
- `GET /api/ai/agents/repo-tools-status`
- Env: `AGENT_REPO_TOOLS_MODE`, `AGENT_SANDBOX_MODE` (varsayılan off)

## Sabit sınırlar (korundu)

On-Demand kapalı · Cloud live kapalı · production yok · müşteri/blog/reklam yok · sürekli ajan otomasyonu kapalı · T-P5E-004 görevlerine dokunulmadı.
