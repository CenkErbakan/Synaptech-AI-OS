# T-P5E-005 — Subify salt-okunur CTO gerçek repo inceleme

Tarih: 2026-11-18  
Durum: **tamamlandı** → ardından araçlar kapatıldı  
Onay: Owner tek seferlik Subify CTO read-only

## Ön kontroller

| Kontrol | Sonuç |
|---------|--------|
| GitHub | `https://github.com/CenkErbakan/Subify` (private, default `master`) |
| Yerel remote | `https://github.com/CenkErbakan/Subify.git` eşleşti |
| HEAD | `673b3c39663e43d8bf55d960d02d2763a8557def` |
| Kök | `Subtitle.sln`, `frontend`, `video-subtitle-service` mevcut |
| MSSQL `subify.githubRepoUrl` | yazıldı; diğer 3 proje `null` kaldı |
| `AGENT_SANDBOX_MODE` | `off` |
| Cloud live | `false` / `mock` |
| T-P5E-004 görevleri | değiştirilmedi (`planned`, updatedAt 01:36) |

## Çalıştırma

- Yeni görev: `0440beb2-5f15-42d1-9781-4c5c62d8901d` (T-P5E-004 değil)
- `AGENT_REPO_TOOLS_MODE=read_only` + `LOCAL_AGENT_EXECUTION_MODE=local`
- 1 CTO Ollama çağrısı: `qwen2.5:14b`, **8207 ms**, `realAiExecution=true`
- `codeChangeApplied=false`, yazma/push/PR/Cloud yok
- İlk deneme şema/bağlam hatası; bağlam kısaltıldıktan sonra başarılı pass

## İncelenen gerçek dosyalar (repo_read)

HEAD: `673b3c39…57def`

| Dosya | digest |
|-------|--------|
| `Subtitle.sln` | `8977342ef2ee4bd2` |
| `frontend/package.json` | `7e871b0bd38873f7` |
| `video-subtitle-service/AuthService/AuthService.csproj` | `aea675fef367b082` |
| `video-subtitle-service/VideoService/VideoService.csproj` | `47090a3c2a803599` |
| `video-subtitle-service/VideoService.Tests/VideoService.Tests.csproj` | `cdcf4916bba93321` |
| `video-subtitle-service/WalletService/WalletService.csproj` | `3fe48bfad3d1ff95` |
| `video-subtitle-service/WalletService.Tests/WalletService.Tests.csproj` | `ac8c5b7e6f03081d` |
| `video-subtitle-service/dubbing_service/requirements-dev.txt` | `71d7dcf053eb4342` |

Liste: 40 aday dosya; modele 8 okuma özeti verildi.

## CTO dosya bazlı bulgular

- Çözüm yapısı: `Subtitle.sln` + `frontend` (esbuild minify asset paketi) + `video-subtitle-service` (.NET servisleri + Python dubbing requirements).
- Test altyapısı kanıtı: `VideoService.Tests` / `WalletService.Tests` `.csproj` okundu.
- Bağımlılık kanıtı: frontend `package.json` (esbuild); dubbing `requirements-dev.txt`; Auth/Video/Wallet csproj.
- Model risk notu (“MSSQL bağlılık”): bu turda `Program.cs` tool setinde yoktu; SQL Server kullanımı repoda başka dosyalarda mevcut ancak **satır numaralı Program.cs kanıtı bu pilotun repo_read listesinde değil** — risk iddiasını kısmi/güçlendirilmemiş kabul et.

## acceptanceMet

- Sonuç: **true** → görev `done`
- Gerekçe (bağımsız doğrulayıcı): model `acceptanceMet=true` + ≥2 gerçek dosya yolu atfı + `repo_read` kanıtı  
  (`repo_read` tek başına yeterli sayılmadı)
- `codeChangeApplied=false`

## MSSQL / Audit

- `Project.subify.githubRepoUrl` = Subify URL; `cloudAgentEnabled=false`
- Task + `executionResult` + `executionKind=local_llm` + toolEvidence
- AgentMessage `b9962077-713e-42a8-a3fa-e738de2507f8` (cto→ceo result)
- Audit: `approval.owner_tp5e005`, `ai.local_agent_execution`

## Pilot sonrası kapalı mod

```
AGENT_REPO_TOOLS_MODE=off
AGENT_SANDBOX_MODE=off
LOCAL_AGENT_EXECUTION_MODE=off
LOCAL_AGENT_EXECUTION_MAX_PER_DAY=4
CLOUD_AGENT_LIVE_ENABLED=false
CURSOR_CLOUD_MODE=mock
```

Ham kanıt: `reports/qa/faz-5e-tp5e005-live-result.json`
