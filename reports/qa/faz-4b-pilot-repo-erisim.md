# Faz 4B — Pilot repo erişim doğrulama (salt okuma)

**Tarih:** 2026-11-17  
**Script:** `apps/api/scripts/verify-pilot-repo-readonly.mjs`  
**POST /v1/agents:** yok · **Live:** kapalı · **Push:** yok  

## Bayraklar

| Bayrak | Değer |
|--------|--------|
| `CLOUD_AGENT_LIVE_ENABLED` | **false** |
| `CURSOR_CLOUD_MODE` | unset / mock beklenen |
| `CLOUD_ON_DEMAND_VERIFIED` (.env) | **false** (Owner sözlü beyan var) |
| API anahtarı | Var (değer yazdırılmadı) |

## Allow-list (SynapTech OS)

| Kontrol | Sonuç |
|---------|--------|
| `CLOUD_AGENT_ALLOWED_REPOS` | **Boş** |
| Pilot eşleşmesi | **Hayır** → **blok** |
| Üretim SynapTech allow-list’te | Hayır (iyi) |

Owner `.env` güncellemesi hâlâ gerekli:

```env
CLOUD_AGENT_ALLOWED_REPOS=https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot
CLOUD_ON_DEMAND_VERIFIED=true
CLOUD_AGENT_LIVE_ENABLED=false
CURSOR_CLOUD_MODE=mock
```

## Cursor API salt-okunur sinyaller

| Probe | Sonuç |
|-------|--------|
| `GET /v1/agents?limit=5` | 200 — auth OK |
| `GET /v1/environments` | 200 — **1** kayıt: `https://github.com/CenkErbakan/SynapTech` |
| `GET .../environments?repo=...SynapTech-AI-OS-Pilot` | 200 — **items: []** (named env yok) |
| `GET .../environments?repo=.../SynapTech` | 200 — hâlâ SynapTech environment görünüyor |
| `GET /v1/secrets?repo=github.com/CenkErbakan/SynapTech-AI-OS-Pilot` | 200 — items boş (403 değil) |
| `GET /v1/models` | 200 |

**Geçmiş agent listesi** hâlâ `SynapTech` / `AIDrivingOs` gösteriyor → tarihsel kayıt; App scope kanıtı değil.

## Erişim yorumu

1. **Kesin `repository_access` kanıtı yok** — v1’de bu hata create/environment yazımında gelir; bu turda create yapılmadı.  
2. Pilot için named environment yok → beklenen (yeni izole repo).  
3. Cursor hâlâ **SynapTech** adlı environment listeliyor → App’i yalnızca Pilot’a indirdiyseniz:
   - Ya eski environment kaydı API’de kalıyor,
   - Ya GitHub App kurulumu / Cursor tarafı henüz daralmamış.
4. Owner beyanı (“yalnızca Pilot”) kabul edilir; **live create anında** `repository_access` / başarı nihai kanıt olur.

**Verdict:** `blocked` (allow-list boş).  
Allow-list + On-Demand env düzeltildikten sonra teknik verdict: `access_plausible_awaiting_live_approval` (kesin create-öncesi doğrulama sınırlı).

## Kalan ön koşullar (ilk gerçek pilot)

1. `.env`: allow-list = yalnızca Pilot URL  
2. `.env`: `CLOUD_ON_DEMAND_VERIFIED=true`  
3. Cursor/GitHub App: Pilot-only teyidi; mümkünse eski SynapTech Cloud environment’ını arşivleyin/silin (Owner UI)  
4. Kill switch kapalı  
5. Aktif cloud run = 0  
6. Görev `T-P4B-001` + `cloud_agent_run` Owner onayı  
7. **Ayrı açık metin:** tek live run başlat  
8. O an: geçici `CLOUD_AGENT_LIVE_ENABLED=true` + `CURSOR_CLOUD_MODE=live`  
9. Bitince live bayrakları kapat  

## Yapılmayanlar

Gerçek Cloud Agent · `POST /v1/agents` · push · Automations · On-Demand değiştirme
