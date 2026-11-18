# Faz 4B — T-P4B-001 son kontrol (canlı run yok)

**Tarih:** 2026-11-18  
**Durum:** `FINAL_GATE_PASS` — canlı Cloud Agent **başlatılmadı**; live bayraklar **değiştirilmedi**.  
**Sonraki adım:** Owner’ın açık “başlat” onayı bekleniyor.

## Özet karar

Pilot öncesi güvenlik kapıları kod ve doğrulama ile yerinde. Gerçek `POST /v1/agents` veya `CLOUD_AGENT_LIVE_ENABLED=true` yapılmadı.

## Zorunlu kurallar (doğrulandı)

| Kural | Durum | Kanıt |
| --- | --- | --- |
| `main` ve `master` korumalı base | Geçti | `apps/api/src/cursor/pilot-policy.ts` → `PROTECTED_BASE_REFS` |
| Çalışma yalnızca `cursor/` veya `agent/` | Geçti | `PILOT_ALLOWED_BRANCH_PREFIXES` + prompt kuralları |
| `workOnCurrentBranch=false` | Geçti | sabit; `assertPilotCreateOptions` ihlali reddeder |
| `autoCreatePR=false` | Geçti | sabit; ihlal create öncesi engellenir |
| Otomatik merge / deploy | Yasak | create seçeneklerinde yok; TrustedExecutor production no-op |
| Onay ↔ içerik hash eşleşmesi | Geçti | `executeApprovedCloudRun` `boundVersion !== currentVersion` → engeller |
| Live bayraklar | Kapalı kaldı | `.env`: `CLOUD_AGENT_LIVE_ENABLED=false`, `CURSOR_CLOUD_MODE=mock` |
| Canlı agent | Başlatılmadı | `liveAgentStarted: false` |

## Branch politikası

- Pilot repo varsayılan branch: **master**
- Base ref (env varsayılanı): `CLOUD_AGENT_STARTING_REF=master` (kod default; yalnızca `main`\|`master` kabul)
- Cursor create: base’den dallanır, **base’e yazmaz** (`workOnCurrentBranch: false`)
- Beklenen çalışma branch’i: `cursor/...` veya `agent/...`

## İçerik hash / onay bağlama

- Brief dosyası: `tasks/T-P4B-001-pilot-ts-hello.md`
- Brief SHA-256: `d4d07e3a5acb478318bb5c1e717f3d6b5f70c6517e2a2970d9a01f052cf1dd04`
- `contentVersion` bileşenleri: title + description + repo URL + `startingRef` + `autoCreatePR=false` + `workOnCurrentBranch=false` + korumalı base’ler + izinli branch önekleri + brief SHA
- Owner onayında `boundVersion` bu `contentVersion` ile **birebir** olmalı
- Brief, görev metni, repo veya politika değişirse execute **reddedilir**; yeni onay gerekir

## Ortam (canlı bayraklar — değiştirilmedi)

- `CLOUD_AGENT_LIVE_ENABLED=false`
- `CURSOR_CLOUD_MODE=mock`
- `CLOUD_ON_DEMAND_VERIFIED=true`
- `CLOUD_AGENT_ALLOWED_REPOS=https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot`
- Kill switch: `config/kill-switch.json` → `enabled: false` (Owner)

## Kod / test kanıtı

- Birim: `pilot-policy.unit.test.ts` + `cursor-adapter.unit.test.ts` → **17/17 geçti**
- Script: `node apps/api/scripts/verify-pilot-final-gate.mjs` → **exit 0 / FINAL_GATE_PASS**
- Yeni politika modülü: `apps/api/src/cursor/pilot-policy.ts`
- Execute kapısı: `apps/api/src/engines/cloud-dispatch.ts` (hash uyuşmazlığında validationError)

## Bilinçli olarak yapılmayanlar

- Cloud Agent create (live veya ücretli)
- `CLOUD_AGENT_LIVE_ENABLED` / `CURSOR_CLOUD_MODE` değiştirme
- Push, merge, deploy, PR açma
- GitHub branch protection API çağrısı (Owner GitHub’da `main`+`master` korumasını ayrıca doğrulamalı)

## Owner’dan beklenen açık onay

Bu rapor **çalıştırma onayı değildir**. Canlı tek pilot run için ayrıca ve açıkça onay gerekir, örneğin:

> “Faz 4B tek live Cloud Agent run başlat”

Onay verilmeden live bayrak açılmaz ve agent oluşturulmaz.
