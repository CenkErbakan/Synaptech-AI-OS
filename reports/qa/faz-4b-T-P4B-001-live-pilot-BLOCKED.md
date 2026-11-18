# Faz 4B — T-P4B-001 canlı pilot: **BLOCKED**

**Tarih:** 2026-11-18  
**Karar:** Canlı Cloud Agent **başlatılmadı**.  
**Gerekçe:** Owner’ın zorunlu kontrollerinden biri kanıtlanamadı.

## Özet

Açık canlı pilot onayı alındı; ancak zorunlu kontrollerden **ikisi** başarısız. Talimat gereği **hiçbir canlı işlem** yapılmadı.

**Birincil blokaj:** GitHub ruleset (`master` + PR zorunluluğu) kanıtlanamadı.  
**İkincil blokaj:** Yerel API `activeRuns=1` (eski **mock** kayıt `CREATING` durumunda takılı; 2026-11-17).

| İşlem | Yapıldı mı? |
| --- | --- |
| `CLOUD_AGENT_LIVE_ENABLED=true` | Hayır |
| `CURSOR_CLOUD_MODE=live` | Hayır |
| `POST /v1/agents` | Hayır |
| İkinci agent / Automations / On-Demand açma | Hayır |
| Faz 5 | Hayır |

## Zorunlu kontrol sonuçları

| # | Kontrol | Sonuç | Kanıt |
| --- | --- | --- | --- |
| 1 | GitHub ruleset etkin, `master` kapsar, PR zorunlu | **BLOCKED** | `gh` 2.104.0 kurulu ama oturum yok; `GH_TOKEN`/`GITHUB_TOKEN` yok; tarayıcı MCP yalnızca localhost; Computer Use izinli değil |
| 2 | Cursor GitHub App → Pilot erişimi | Geçti (plausible) | `GET /v1/agents` 200; `GET /v1/secrets?repo=...Pilot` 200 (403 değil); named Pilot env yok (beklenen) |
| 3 | Kill switch kapalı | Geçti | `config/kill-switch.json` → `enabled: false` |
| 4 | Aktif Cloud run = 0 | **BLOCKED** | API `activeRuns=1`; run `0e1d05eb-…` → `cursorStatus=CREATING`, `executionMode=mock` (stale). Cursor tarafında CREATING/RUNNING yok |
| 5 | Allow-list yalnızca Pilot | Geçti | `["https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot"]` |
| 6 | On-Demand kapalı (Owner beyanı) | Geçti | `CLOUD_ON_DEMAND_VERIFIED=true`; On-Demand açılmadı |
| 7 | `cloud_agent_run` + contentVersion eşleşmesi | Beklemede | Canlı kapı açılmadığı için yeni onay/execute zinciri başlatılmadı |
| 8 | İçerik/politika değişiminde red | Hazır | `executeApprovedCloudRun` hash uyuşmazlığında engeller |

## Brief hash

- Beklenen: `d4d07e3a5acb478318bb5c1e717f3d6b5f70c6517e2a2970d9a01f052cf1dd04`
- Ölçülen: `d4d07e3a5acb478318bb5c1e717f3d6b5f70c6517e2a2970d9a01f052cf1dd04`
- Eşleşme: **evet**

## Live bayraklarının son durumu (değiştirilmedi)

- `CLOUD_AGENT_LIVE_ENABLED=false`
- `CURSOR_CLOUD_MODE=mock`

Script: `node apps/api/scripts/verify-live-preflight.mjs` → `status: BLOCKED`  
Blokaj satırı: `github_ruleset_master_pr: GITHUB_TOKEN/GH_TOKEN yok — ruleset doğrulanamadı`

## Canlı run alanları (bu tur)

| Alan | Değer |
| --- | --- |
| Gerçek run başlatıldı mı? | **Hayır** |
| Cursor Agent / Run ID | yok |
| GitHub branch | yok |
| Oluşturulan dosyalar | yok |
| Test sonuçları | yok (pilot repo’ya yazılmadı) |
| Dashboard görev durumu | canlı dispatch yok |
| Token tüketimi | 0 (create yok) |
| Kullanım hakkı | programatik olarak bilinmiyor; On-Demand açılmadı |
| Kök neden | (1) Ruleset doğrulanamadı (2) MSSQL’de stale mock `CREATING` run kapasiteyi dolduruyor |

## Owner’ın engeli kaldırması için

### A) GitHub ruleset kanıtı
Aşağıdakilerden **biri**:

1. `.env` içine (commit etmeden) salt-okunur `GH_TOKEN` / `GITHUB_TOKEN` (Pilot + ruleset okuma), **veya**
2. `gh auth login`

Doğrulanacak hedef:

- `default_branch: master`
- active ruleset + **pull_request** kuralı + `master` kapsamı

### B) Aktif run kapasitesi
Stale mock kaydı temizlenmeli (`0e1d05eb-67d3-412d-b41b-5591a87037b1`, `CREATING` / mock). Owner onayıyla bu kaydı `failed`/`cancelled` işaretleyebilirim; şu an dokunulmadı.

Her iki engel kalkınca aynı canlı onay metniyle yeniden isteyin.

## Not

Cursor tarafında eski bir `SynapTech` environment kaydı listeleniyor (tarihsel uyarı). Tek başına blokaj değil.
