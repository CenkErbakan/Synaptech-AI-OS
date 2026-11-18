# Developer + Tester sandbox iş akışı — durum raporu

Tarih: 2026-11-18  
Kapsam: Mevcut ajan altyapısı genişletmesi  
Canlı Ollama / Subify yazma: **yok** (T-P5E-006 onayı bekleniyor)

## Özet

AI Developer izole sandbox’ta patch + diff kanıtı üretebilir; AI Tester aynı (veya bağlı) sandbox’ta allow-list komutla gerçek test çalıştırır. Kabul doğrulayıcı model iddiasını tek başına kabul etmez. T-P5E-004/005 kayıtlarına dokunulmadı.

## 1) Kabul doğrulayıcı

| Rol | Kabul koşulu | Model `acceptanceMet` |
|-----|--------------|------------------------|
| CTO | `findingKind` ayrımı: `structure_inspection` / `dependency_analysis` / `verified_defect`; yalnızca `repo_read`+yol ≠ kapsamlı denetim; defect için satır/config veya digest | Yok sayılır / yetersiz |
| Developer | Boş olmayan `sandbox_diff` | Yok sayılır |
| Tester | Gerçek `sandbox_command` + `exitCode===0` + `stdoutDigest` | Yok sayılır; exit≠0 → done yok |

## 2) Developer sandbox

- Verified `localReadRoot` → temp kopya (`materializeSandboxCopy`; `.env`/secrets kopyalanmaz)
- `proposedPatches` yalnızca sandbox’a (`applySandboxPatches`); yol jail; `.env`/pem reddi
- Ana repo / master / production yazılmaz
- Diff yoksa `codeChangeApplied=false`
- Keyfi shell yok; oturum `executionResult.sandbox` + handoff mesajı (developer→tester)

## 3) Tester

- Linked developer sandbox veya taze kopya
- Allow-list: `pnpm_test`, `npm_test`, `node_test`, …
- Komut gerçek spawn (`shell:false`); kanıt: command, exitCode, digest
- Başarısız testte `done` yok
- Sonuç AgentMessage: **tester→cto**

## 4) Kanıt alanları

`headSha`, dosya digest, `sandbox_diff`, test komutu, `exitCode`, `modelId`, `taskId`, `realAiExecution`, `findingCategory` — mock kanıtlar `mock*` önekli / `realAiExecution=false`.

Lease, timeout, kill switch, idempotency korunur. Ağ/dış araç/push/PR/Cloud otomatik yok.

## 5) Testler

| Suite | Sonuç |
|-------|--------|
| `sandbox-dev-tester.unit.test.ts` | geçti (fixture: fail→patch→pass) |
| `repository-tools.unit.test.ts` | geçti |
| `local-agent-execution.integration.test.ts` | geçti |
| **Toplam** | **13/13** |

Gerçek Subify/Marivo/SynapTech dosyalarına yazılmadı.

## 6) Onay

`tasks/approvals/T-P5E-006-developer-tester-sandbox-pilot.md` (pending)

## Kapalı mod

```
AGENT_REPO_TOOLS_MODE=off
AGENT_SANDBOX_MODE=off
LOCAL_AGENT_EXECUTION_MODE=off
CLOUD_AGENT_LIVE_ENABLED=false
CURSOR_CLOUD_MODE=mock
```
