# Otomasyon planı

**Durum: 7 otomasyonun tümü DEVRE DIŞI.**  
Cursor Automations repo dosyasıyla tanımlanamaz; yalnızca [cursor.com/automations](https://cursor.com/automations) veya Agents Window üzerinden kurulur. Bu belge ve `config/automations.yaml` plan/kayıt amaçlıdır.

**Onay olmadan hiçbir otomasyon etkinleştirilmez.**

## Küresel ayarlar

| Alan | Değer |
|------|--------|
| `global.enabled` | `false` |
| Varsayılan model | `composer-2.5[fast=false]` |
| Memories | disabled |
| `budget-policy` cloud.automations_enabled | `false` |
| Maliyet kapısı | `not_started` |

Cron notu: Türkiye UTC+3. Automations editöründe saat dilimi doğrulanmalıdır.

## Maliyet kapısı (zorunlu sıra)

Cloud Agents / Automations açılmadan önce:

1. Kullanıcı On-Demand’in kapalı olduğunu ve ilk kullanım harcama limiti ekranını kontrol eder. Bulut ajanı On-Demand gerektiriyorsa **durulur**.
2. Kullanıcı onayıyla test deposunda `composer-2.5` standart modelle **tek** pilot çalıştırma; tüketim ölçülür (`measured_usage_per_run` doldurulur).
3. Ölçüme göre sıklık önerilir; **her otomasyon için ayrı onay** alınır.

Kaynak: `config/budget-policy.yaml` → `cloud.cost_gate`.

## Otomasyonlar

### 1. `daily-ceo-review` — Günlük CEO operasyon değerlendirmesi

| Alan | Değer |
|------|--------|
| enabled | **false** |
| Faz | 5 |
| Tetikleyici | manuel veya cron |
| Sıklık | Hafta içi her gün 09:00 (TR) · cron UTC `0 6 * * 1-5` |
| Model | `composer-2.5[fast=false]` |
| Runtime | **local** (görev kayıtları Faz 3 API’de; bulut yerel veriye erişemez; Faz 5’te bulut adayı) |
| Ajanlar | ceo |
| Çıktı | `reports/daily/YYYY-MM-DD-ceo.md` |
| Ön koşullar | Maliyet kapısı; yerel oturum; Faz 3 API veya yeterli yerel görev dosyası; kullanıcı onayı |

### 2. `pr-test-review` — GitHub PR test incelemesi

| Alan | Değer |
|------|--------|
| enabled | **false** |
| Faz | 4 |
| Tetikleyici | git: PR açıldı / PR’ye push |
| Sıklık | olay tetikli |
| Model | `composer-2.5[fast=false]` |
| Runtime | **cloud** (GitHub olayı; depo GitHub’da olmalı) |
| Ajanlar | tester, cto |
| Araçlar | Comment on pull request (onay/merge yetkisi verilmez) |
| Ön koşullar | Maliyet kapısı; GitHub bağlantısı; test deposu; kullanıcı onayı |
| Not | Alternatif: legacy Pro’ya dahil Cursor Bugbot. PR Routing & Approval açılmaz. |

### 3. `weekly-security` — Haftalık güvenlik analizi

| Alan | Değer |
|------|--------|
| enabled | **false** |
| Faz | 5 |
| Tetikleyici | cron |
| Sıklık | Pazartesi 07:00 (TR) · `0 4 * * 1` |
| Model | `composer-2.5[fast=false]` |
| Runtime | **cloud** |
| Ajanlar | security |
| Çıktı | `reports/security/YYYY-Www.md` (PR ile önerilir) |
| Ön koşullar | Maliyet kapısı; GitHub deposu; kullanıcı onayı |

### 4. `weekly-seo` — Haftalık SEO fırsat taraması

| Alan | Değer |
|------|--------|
| enabled | **false** |
| Faz | 5 |
| Tetikleyici | cron |
| Sıklık | Salı 07:00 (TR) · `0 4 * * 2` |
| Model | `composer-2.5[fast=false]` |
| Runtime | **cloud** (herkese açık sayfalar; GSC bağlı değil) |
| Ajanlar | seo-specialist, growth-lead |
| Çıktı | `marketing/seo/YYYY-Www-firsatlar.md` |
| Ön koşullar | Maliyet kapısı; kullanıcı onayı; metrik uydurulmaz |

### 5. `weekly-content-plan` — Haftalık blog içerik planı

| Alan | Değer |
|------|--------|
| enabled | **false** |
| Faz | 5 |
| Tetikleyici | cron |
| Sıklık | Çarşamba 07:00 (TR) · `0 4 * * 3` |
| Model | `composer-2.5[fast=false]` |
| Runtime | **cloud** |
| Ajanlar | content-manager, seo-specialist |
| Çıktı | `content/calendar/YYYY-Www.md` |
| Ön koşullar | Maliyet kapısı; mevcut SynapTech blog otomasyonuyla mükerrer konu kontrolü; **yayın yok**; kullanıcı onayı |

### 6. `weekly-ads-review` — Haftalık reklam stratejisi

| Alan | Değer |
|------|--------|
| enabled | **false** |
| Faz | 5 |
| Tetikleyici | manuel (kullanıcı veri sağladığında) |
| Sıklık | Perşembe, veri ile |
| Model | `composer-2.5[fast=false]` |
| Runtime | **local** (Ads hesapları bağlı değil) |
| Ajanlar | ads-manager, growth-lead |
| Çıktı | `marketing/ads/YYYY-Www-degerlendirme.md` |
| Ön koşullar | Kullanıcı gerçek performans verisi; maliyet kapısı; kampanya/bütçe değişikliği yok; kullanıcı onayı |

### 7. `weekly-company-report` — Haftalık şirket raporu

| Alan | Değer |
|------|--------|
| enabled | **false** |
| Faz | 5 |
| Tetikleyici | cron |
| Sıklık | Cuma 16:00 (TR) · `0 13 * * 5` |
| Model | `composer-2.5[fast=false]` |
| Runtime | **cloud** |
| Ajanlar | ceo |
| Çıktı | `reports/weekly/YYYY-Www-sirket.md` |
| Ön koşullar | Maliyet kapısı; depoda rapor dosyaları; kullanıcı onayı |

## Faturalama notu

Automations Cloud Agent kullanımından düşer ve her zaman modelin maksimum bağlam penceresini kullanır. Kaynak: [Automations billing](https://cursor.com/docs/cloud-agent/automations).

Makine kaydı: `config/automations.yaml` (tüm `enabled: false`).
