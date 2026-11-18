---
title: "Onay talebi — Subify salt-okunur CTO repo-araç pilotu"
type: approval-request
project: synaptech-ai-os
agent: orchestrator
date: "2026-11-18"
status: applied
appliedAt: "2026-11-18T01:57:27Z"
appliedBy: owner
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | real_ai_provider_pilot |
| İsteyen ajan | orchestrator |
| Proje | synaptech-ai-os / subify |
| Görev kimliği | T-P5E-005 |
| Risk | Yüksek |

## Açıklama

Ajan repo araç altyapısı (RepositoryToolAdapter + sandbox allow-list + bağımsız kabul doğrulayıcı) mock/unit testlerle eklendi; varsayılan **kapalı**.

Bu onay **yalnızca bir kez**, dar kapsamlıdır:

1. `subify` için Owner, keşifteki GitHub URL + yerel okuma kökünü **doğrular** ve MSSQL `Project.githubRepoUrl` yazar (veya eşdeğer verified bağ).
2. `AGENT_REPO_TOOLS_MODE=read_only` kısa süre açılır.
3. Tek CTO salt-okunur inceleme (gerçek dosya okuma + kanıt kaydı); **yazma / push / PR / Cloud / sandbox write yok**.
4. Bitince `AGENT_REPO_TOOLS_MODE=off`.

Kapsam dışı: Developer yazma, Tester canlı sandbox (ayrı onay), Marivo/SynapTech bağ doğrulama, T-P5E-004 görevlerini yeniden çalıştırma veya done işaretleme, On-Demand, production.

## Değişiklik özeti (Owner onay sonrası manuel)

1. Subify bağını doğrula (`https://github.com/CenkErbakan/Subify` + yerel read root — keşif: `tasks/ops/project-repo-bindings.proposed.json`)
2. `.env`: `AGENT_REPO_TOOLS_MODE=read_only`, `AGENT_SANDBOX_MODE=off`, Cloud live kapalı
3. API restart → tek CTO inspect / execute
4. Kanıt kontrolü → `AGENT_REPO_TOOLS_MODE=off`

## Bağlı sürüm

- Tür: content_sha256
- `apps/api/src/ai/repo/repository-tool-adapter.ts` → `BBA659D9E22178D1F1E134320085149CE0707C280DE772B44C66673FB7E02AC1` (Subify .sln/.csproj/requirements + skip site-packages; Owner pilot öncesi)
- `apps/api/src/ai/repo/sandbox-runner.ts` → `A217D27C2F7489DBEC13CA6E3D2A64825F13C8A590F71EE4C2F10D0FA94F369C`
- `apps/api/src/ai/repo/acceptance-verifier.ts` → `9FF6708027A3D193637A73717DCD68CEC98025F8C207263C371FED1ADF2281B0` (CTO: repo_read tek başına yetmez; ≥2 dosya yolu atfı)
- Rapor: `reports/qa/faz-5e-agent-repo-tools-rapor.md`

## Geri alma planı

- `AGENT_REPO_TOOLS_MODE=off`, `AGENT_SANDBOX_MODE=off`
- API yeniden başlat
- İstenirse Subify `githubRepoUrl` geri alınır; silme yok

## Not

Onaylanmadan gerçek Subify dosya okuma / tool-enabled ajan çalıştırılmaz. Bu onay başka çalıştırmaya veya yazma/sandbox pilotuna aktarılamaz.
