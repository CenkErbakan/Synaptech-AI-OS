# SynapTech AI OS — Faz 4B Bağlantı Doğrulama (salt okuma)

**Tarih:** 2026-11-17  
**Script:** `apps/api/scripts/verify-cursor-readonly.mjs`  
**POST /v1/agents:** çağrılmadı · **Live create:** yok · **Push:** yok  

## 1. Cursor API kimlik doğrulama

| Kontrol | Sonuç |
|---------|--------|
| `CURSOR_API_KEY` varlık | Evet (uzunluk 69; değer yazdırılmadı) |
| `GET /v1/agents?limit=1` | **HTTP 200** |
| `CLOUD_AGENT_LIVE_ENABLED` | **false** |
| Live create denemesi | Yok |

**Sonuç:** API anahtarı geçerli. Auth başarılı.

## 2. GitHub / Cursor bağlantısı

| Kontrol | Sonuç |
|---------|--------|
| Public GitHub API `.../SynapTech-AI-OS-Pilot` | **404** → repo büyük olasılıkla **private** |
| `GET /v1/environments?repo=github.com/CenkErbakan/SynapTech-AI-OS-Pilot` | HTTP 200, `items: []` |
| Cursor hesabında GitHub App sinyali | Evet — listede önceki agent kaydı `https://github.com/CenkErbakan/SynapTech` üzerinde (IDLE) |

**Yorum:**

- Cursor hesabınız GitHub’a bağlı görünüyor (başka bir repo üzerinde geçmiş agent).
- Pilot repo private olduğu için public doğrulama yapılamadı.
- Named environment listesi boş; bu tek başına “erişim yok” kanıtı değildir.
- **Owner teyidi gerekli:** Cursor → Cloud Agents / GitHub App ayarlarında `SynapTech-AI-OS-Pilot` deposuna erişim açık mı?
- **Güvenlik:** Allow-list’e **yalnızca** Pilot URL girin. `SynapTech` (üretim) allow-list’e **asla** eklenmemeli.

## 3. Owner’ın uygulaması gereken değişiklikler

Ajan `config/**` ve `.env` (secret) yazmaz. Aşağıyı **siz** uygulayın.

### 3a. Yerel `.env` (secret — commit etme)

```env
CLOUD_AGENT_LIVE_ENABLED=false
CURSOR_CLOUD_MODE=mock
CLOUD_ON_DEMAND_VERIFIED=true
CLOUD_AGENT_ALLOWED_REPOS=https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot
```

İsteğe bağlı (`.git` sonekli de kabul):

```env
CLOUD_AGENT_ALLOWED_REPOS=https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot.git
```

`CURSOR_API_KEY` zaten var; tekrar yazdırmayın / sohbete yapıştırmayın.

### 3b. Korumalı `config/integrations.yaml` (öneri — ajan uygulamadı)

`cursor-cloud-agents-api` ve `github` için `status` / not güncellemesi Owner onayıyla:

```yaml
# github:
#   status: connected_pilot_only   # veya not_connected kalabilir; pilot tek repo
# cursor-cloud-agents-api:
#   status: credential_verified_live_disabled
```

Tam dosya değişikliğini siz seçin; güvenlik politikasını (`docs/security-policy.md`, hooks) **değiştirmeyin**.

### 3c. Korumalı `config/budget-policy.yaml` (öneri — ajan uygulamadı)

```yaml
cloud:
  cloud_agents_enabled: false   # live run onayına kadar false kalsın
  # cost_gate.status: in_progress  # isteğe bağlı Owner notu
```

`cloud_agents_enabled: true` yapmayın; live run ayrı onaydır.

### 3d. Korumalı `config/system-status.yaml` (öneri — ajan uygulamadı)

```yaml
phase:
  current: 4
  label: "Faz 4B hazırlık — live kapalı"
integrations:
  cursor: credential_verified_live_disabled
  github: pilot_repo_pending_app_grant  # App erişimi teyidine göre güncelleyin
```

### 3e. `.env.example` (ajan güncelleyebilir — secret yok)

Örnek allow-list satırı dokümantasyon amaçlı güncellenebilir; live yine false.

## 4. Cloud çalıştırma izni

| Bayrak | Durum |
|--------|--------|
| `CLOUD_AGENT_LIVE_ENABLED` | false |
| Live client create kilidi | Aktif (bayrak false iken 403 `live_disabled`) |
| Bu turda `POST /v1/agents` | **Yok** |

## 5. Tek run / Owner onay / kill switch

| Kontrol | Kanıt |
|---------|--------|
| `maxConcurrentRuns: 1` | Unit test 13/13 |
| `autoRetry: false` | Unit test |
| `cloud_agent_run` + boundVersion | Faz 4A integration |
| Kill switch → 423 / execute engeli | Faz 4A integration (dosyaya yazmadan) |
| Kill switch dosyası şu an | `enabled: false` |

## 6. Kullanım / harcama belirsizlikleri

| Konu | Durum |
|------|--------|
| On-Demand Owner beyanı | Kapalı (sözlü doğrulama) |
| `.env` `CLOUD_ON_DEMAND_VERIFIED` | Hâlâ **false** — Owner true yapsın |
| Kalan havuz % | Programatik yok |
| Cloud’un On-Demand zorunluluğu | Bu turda create yapılmadığı için runtime’da doğrulanmadı |
| Tek run maliyeti | Bilinmiyor; tahmin yazılmaz |
| Token (run sonrası) | Live run sonrası `GET .../usage` |

## 7. Hazır TypeScript görev özeti

Dosya: `tasks/T-P4B-001-pilot-ts-hello.md`  
İçerik: `greet(name)` tek fonksiyon + hafif doğrulama; `main` dışı branch; `autoCreatePR: false`.

## Bloklayanlar (live run öncesi)

1. Owner: `.env` → `CLOUD_AGENT_ALLOWED_REPOS` + `CLOUD_ON_DEMAND_VERIFIED=true`  
2. Owner: Cursor GitHub App’te **Pilot** repo erişimi teyidi  
3. Owner: ayrı mesajla **tek live run** onayı  
4. O an: geçici `CLOUD_AGENT_LIVE_ENABLED=true` (bitince false)

## Verdict

`auth_ok_with_blockers` — kimlik doğrulama tamam; allow-list / On-Demand env bayrağı / private repo App erişimi Owner tarafında.

**Dur:** İlk live run için ayrı Owner onayı bekleniyor.
