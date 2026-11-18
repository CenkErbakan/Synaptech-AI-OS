# SynapTech AI OS — Faz 4B Pilot Hazırlık ve Güvenlik Doğrulama

**Tarih:** 2026-11-17  
**Kapsam:** Yalnızca hazırlık + doğrulama  
**Yapılmayanlar:** Gerçek Cloud Agent başlatma · GitHub push · Automations · On-Demand değiştirme · Faz 4B live execute  

Bu belge Owner açık onayı olmadan **durur**. Gerçek pilot ayrı onay ister.

---

## 1. Cursor Cloud Agents bağlantı ön koşulları

| Ön koşul | Durum (2026-11-17 yerel kontrol) | Not |
|----------|----------------------------------|-----|
| Faz 4A adapter + mock testler | Hazır | `cursor-adapter.unit.test.ts` 13/13 |
| `CLOUD_AGENT_LIVE_ENABLED` | **false** | Live create engelli |
| `CURSOR_CLOUD_MODE` | mock / unset | Live değil |
| `CURSOR_API_KEY` backend’de | **Yok** | Anahtar uzunluğu 0; değer okunmadı/yazdırılmadı |
| `CLOUD_AGENT_ALLOWED_REPOS` | **Boş** | İzole test repo henüz tanımlı değil |
| `CLOUD_ON_DEMAND_VERIFIED` | **false** | Owner manuel doğrulaması bekleniyor |
| Kill switch dosyası | `enabled: false` | Owner kapalı tutuyor |
| `config/budget-policy.yaml` → `cloud.cloud_agents_enabled` | **false** | Korumalı politika |
| `config/integrations.yaml` → cursor/github | `not_connected` | Korumalı kayıt |
| Hesap kalan kullanım API | Desteklenmiyor | Bireysel Pro’da programatik yok |

**Bağlantı doğrulama (canlı API çağrısı yapılmadı):**  
Anahtar yokken uzak `GET /v1/agents` çağrılmadı. Pilot öncesi Owner anahtarı `.env`’e koyduktan sonra yalnızca `POST /api/cloud/verify` (Owner) ile kimlik doğrulama yapılmalı; bu da henüz ücretli agent create değildir.

---

## 2. On-Demand Spending — Owner doğrulaması gerekli

Politika beyanı (`budget-policy.yaml`): `on_demand_usage: disabled`.  
Programatik doğrulama **mümkün değil**.

### Owner’dan istenen işlem

1. Açın: https://cursor.com/dashboard/spending  
2. On-Demand / usage-based spending’in **Disabled / kapalı** olduğunu kontrol edin.  
3. Bulut ajanının On-Demand zorunlu kılıp kılmadığını ekranda okuyun.  
4. Bu sohbette kısaca bildirin: örn. `On-Demand kapalı, doğruladım`.  
5. (İsteğe bağlı) `.env` içinde `CLOUD_ON_DEMAND_VERIFIED=true` yapın — ajan bu dosyaya yazmaz.

**Kritik belirsizlik (forum / dokümantasyon):**  
Bazı Cursor kaynakları Cloud Agents’ın On-Demand’in açık olmasını gerektirdiğini belirtir; başka kaynaklar dahil kullanımın önce düştüğünü söyler. Planınız **Cursor Pro (legacy)** ise:

- On-Demand kapalı kalacaksa ve Cloud Agent açılışı On-Demand zorunlu kılıyorsa → **pilot durdurulur**.  
- Tahmin veya “muhtemelen ücretsiz” iddiası yapılmaz.

---

## 3. İzole GitHub test repository gereksinimleri

### Oluşturulacak repo (Owner / manuel)

- Yeni, boş veya minimal **yalnızca pilot** deposu (ör. `synaptech-cloud-pilot-sandbox`).  
- SynapTech / Subify / Marivo kaynak kodu **içermez**.  
- Public veya private; private tercih.

### Branch koruması

- `main` / `master`: doğrudan push yok; PR zorunlu.  
- Cloud Agent: `workOnCurrentBranch: false` (yeni `cursor/...` veya `agent/*` branch).  
- Otomatik merge yok.  
- Production deploy workflow yok veya `workflow` izinleri dar.

### Cursor hesabında

- GitHub App / source control bağlantısı bu test reposuna erişebilmeli.  
- `CLOUD_AGENT_ALLOWED_REPOS=https://github.com/<org>/<pilot-repo>` (yalnızca bu URL).

### SynapTech tarafı allow-list

Allow-list dışı URL → execute reddedilir (adapter test edildi).

---

## 4. Tek Cloud Agent sınırı — doğrulama

| Katman | Kural | Kanıt |
|--------|--------|--------|
| Domain | `maxConcurrentRuns: 1` | `cursor-cloud.ts` literal |
| Adapter status | `maxConcurrentRuns: 1`, `autoRetry: false` | Unit test |
| Dispatch motoru | Aktif Cursor status’ta sistem geneli `count >= 1` → conflict | `cloud-dispatch.ts` |
| Aynı görev | Aktif run varken ikinci create yok | Integration + kod |
| Idempotency | `bc-<taskId>` + DB `idempotencyKey` filtered unique | Migration |

**Bu aşamada gerçek eşzamanlı live run denenmedi** (bilerek). Mock/unit katmanı tek run kuralını doğrular.

---

## 5. Görev bazlı Owner onay mekanizması — test özeti

Entegrasyon testi (Faz 4A, ücretli çağrı yok):

1. CEO görevi → `dispatchState: awaiting_execution_approval` + `cloud_agent_run` approval  
2. Owner `decide: approved` → **otomatik execute yok**  
3. `POST /api/cloud/runs/execute` (taskId + approvalId + repositoryUrl) → mock run  
4. Görev içeriği değişince boundVersion uyuşmazlığı → **400** (yeni onay gerekir)

Ajan kendi onayını veremez; execute Owner Bearer ister.

---

## 6. Kill switch — yeni çalıştırmaları engelleme

| Senaryo | Beklenen | Doğrulama |
|---------|----------|-----------|
| Kill switch açık + yeni CEO görevi | HTTP 423 | Integration test |
| Kill switch açık + Cloud execute | `killSwitchActive` | `cloud-dispatch` |
| Kill switch açılınca aktif run | Cancel API denenir; doğrulanamazsa uyarı | Kod yolu |
| Testlerin `config/kill-switch.json` yazması | Yazmaz | Integration assert + `KILL_SWITCH_SKIP_FILE_MIRROR` |

Gerçek korumalı dosya bu hazırlık turunda değiştirilmedi; ajan kill switch açıp kapatmaz.

---

## 7. Test görevi için minimum yetkiler

### Cursor API anahtarı
- Kullanıcı veya service account API key (Basic auth).  
- Yalnızca `apps/api` `.env` → `CURSOR_API_KEY`.  
- Frontend / Git / audit / prompt’a konmaz.

### GitHub (Cursor bağlantısı + repo)
**İzinli (minimum):**
- Test repo Contents: read + write (yalnızca agent/cursor branch’leri pratikte)  
- Pull requests: write (taslak PR; `autoCreatePR: false` önerilir ilk pilotta)  
- Metadata: read  
- Checks: read (varsa)

**Yasak:**
- Admin / settings / secrets / Actions permission yükseltme  
- Diğer private org repoları  
- SynapTech / Subify / Marivo  

### SynapTech OS rolleri
- Owner: approval decide + execute + kill switch  
- Ajanlar: onay üretemez, live bayrak değiştiremez  
- Pilot görev: tek assignee (ör. `developer` veya kontrollü `ceo` değerlendirme → tek Cloud run)

### Pilot execute parametreleri (öneri)
- `autoCreatePR: false`  
- `workOnCurrentBranch: false`  
- Model: hesap varsayılanı veya bilinen düşük maliyetli Composer (otomatik yükseltme yok)  
- `CLOUD_AGENT_LIVE_ENABLED=true` yalnızca o oturum; bitince `false`

---

## 8. Olası kullanım maliyeti ve doğrulanamayan noktalar

### Bilinen (dokümantasyon / forum özeti — kesin fatura değil)
- Cloud Agents: ayrı VM ücreti yok; model token kullanımı plan havuzundan / API fiyatından düşer.  
- Legacy Pro: dahil havuz + (açıksa) On-Demand.  
- İlk ortam kurulumunda geçici ücretsiz “setup” koşuları forumda anılmış; **güvenilerek maliyet sıfır varsayılmaz**.

### Doğrulanamıyor (programatik)
| Alan | Durum |
|------|--------|
| Kalan Cursor Models / Other Models yüzdesi | API yok → Dashboard manuel |
| On-Demand gerçekten kapalı mı | Yalnızca Owner spending sayfası |
| Tek run USD maliyeti | Pilot sonrası `GET .../usage` + manuel harcama ekranı |
| Cloud’un On-Demand zorunluluğu | Hesap/plan UI’sine bağlı |
| `measured_usage_per_run` | `budget-policy.yaml` hâlâ `null` |

### Pilot maliyet tutumu
- Tahmini “$X” **yazılmaz**.  
- Tek run; otomatik retry yok.  
- Run sonrası token (API destekliyorsa) MSSQL’e; harcama Owner’ın spending ekranından not edilir.

---

## 9. İlk gerçek pilot — çalıştırma öncesi kontrol listesi

Owner imzası olmadan hiçbir madde “tamam” sayılmaz.

### A. Hesap ve harcama
- [ ] https://cursor.com/dashboard/spending → On-Demand **kapalı** doğrulandı (Owner beyanı)
- [ ] Cloud Agent’ın On-Demand zorunlu kılmadığı teyit edildi **veya** zorunluysa pilot **iptal**
- [ ] Manuel kullanım notu alındı (Cursor Models % / Other Models %)
- [ ] `.env`: `CLOUD_ON_DEMAND_VERIFIED=true` (Owner)

### B. Kimlik bilgisi
- [ ] `CURSOR_API_KEY` yalnızca backend `.env` (commit yok)
- [ ] `POST /api/cloud/verify` başarılı (create değil)
- [ ] Anahtar dashboard/API yanıtında görünmüyor

### C. GitHub test repo
- [ ] İzole repo oluşturuldu
- [ ] `main` korumalı
- [ ] Cursor GitHub bağlantısı yalnızca bu repoya yeterli
- [ ] `CLOUD_AGENT_ALLOWED_REPOS=<tam https URL>`
- [ ] SynapTech/Subify/Marivo URL’leri listede yok

### D. SynapTech kontrolleri
- [ ] Kill switch `enabled: false`
- [ ] Aktif Cloud run sayısı = 0 (`GET /api/cloud/status`)
- [ ] `CLOUD_AGENT_LIVE_ENABLED` hâlâ false (açılacak an: pilot execute hemen öncesi)
- [ ] Automations kapalı (`budget-policy` / cursor.com/automations)
- [ ] Tek görev oluşturuldu; `cloud_agent_run` onayı Owner tarafından verildi
- [ ] Onay boundVersion = güncel görev içeriği
- [ ] Execute gövdesi: doğru `taskId`, `approvalId`, allow-list `repositoryUrl`

### E. Pilot anı (ayrı Owner “başlat” onayı)
- [ ] Owner açık metin: “Faz 4B tek live Cloud Agent run’ı başlat”
- [ ] `CLOUD_AGENT_LIVE_ENABLED=true` + `CURSOR_CLOUD_MODE=live` (geçici)
- [ ] Tek `POST /api/cloud/runs/execute`
- [ ] Sync / SSE veya polling ile durum
- [ ] `FINISHED` ≠ otomatik done; çıktı/PR ayrı kontrol
- [ ] Live bayrak tekrar `false`
- [ ] Kullanım + token raporu

### F. Acil durdurma
- [ ] Kill switch aç → yeni run yok + aktif iptal denemesi
- [ ] Cursor UI’dan run iptali yedek yol

---

## Sonuç / durma noktası

| Madde | Sonuç |
|-------|--------|
| Hazırlık raporu | Bu dosya |
| Gerçek Cloud Agent | **Başlatılmadı** |
| Push / Automations / On-Demand değişikliği | **Yok** |
| Blokleyen eksikler | API anahtarı yok · allow-list boş · On-Demand Owner doğrulaması yok · izole repo yok · live bayrak kapalı |

**Pilot hazır sayılmaz.** Owner’dan sıradaki girdiler:

1. On-Demand kapalı beyanı  
2. İzole repo URL  
3. Backend’e API anahtarı (kendisi yazar)  
4. Ardından ayrı mesaj: gerçek tek run onayı  

---

### DEVİR
- Görev: Faz 4B-prep — pilot hazırlık  
- Proje: synaptech  
- Durum önerisi: awaiting_approval  
- Sonraki adım: kullanıcı  
- Kanıt: env varlık kontrolü (anahtar yok); adapter 13/13; bu rapor  
- Riskler: Cloud Agent’ın On-Demand zorunluluğu doğrulanamadı  
- Onay gerekli mi: evet: cloud_agent_run (live) — gerçek pilot için ayrı Owner onayı
