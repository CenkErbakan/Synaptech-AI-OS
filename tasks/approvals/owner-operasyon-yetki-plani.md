---
title: "Owner yetki planı — çalışan AI şirketi (tek belge)"
type: approval-plan
project: synaptech-ai-os
date: "2026-11-18"
status: awaiting_owner
liveNotStarted: true
---

# Tek Owner yetki planı

Bu belge yeni bir “faz” değildir. Mevcut T-P5E-009 akışını korur ve gerçek çalışma için gereken **tüm** kapıları bir yerde toplar. Ajan bu maddeleri kendine yetki saymaz.

Onayı yalnızca siz verirsiniz. Onaylanan işi ajan production’da yürütmez (merge/deploy/ileti/harcama/push).

## A — 24 saat yerel döngü (T-P5E-009, duruyor)

Koşullar değişmedi: UTC **2026-11-19** öncesi açılmaz; kota silinmez; Cloud/On-Demand kapalı.

| Alan | Değer |
|------|--------|
| Pencere kodu SHA | `544D67EE432524595E056C6AAE4ED8A2F265D7E8C58E1666E21383121C7760B6` (`autonomy-window.ts`, değişmedi) |
| CEO scheduler SHA (idle skip sonrası) | `BB23DE7A69D9E7F8D0083AE6331F5F245A01CD0877D5920DC7521942ABC75FBC` |
| Eski bundle SHA | `9B4F3CF7…AF1083` — **artık geçerli değil** (idle bağlantısı) |

UTC 19’da açılış için ayrıca:

1. CEO headroom ≥ 1, ajan ≥ 2 (T-P5E-009 overlay: 2 / 8 / 2).
2. `openAutonomyWindow({ taskId: "T-P5E-009" })` + env local profili (Owner yazar).
3. Tek timer sahibi; ikinci worker yok.
4. Açık görev sayısı `LOCAL_OPS_OPEN_TASK_CAP` (48) altında değilse CEO **yeni iş uydurmaz**; mevcut kuyruk ajanlara kalır. Bugün panoda Planlandı 93 — açılışta CEO skip beklenir; bu kasıtlıdır.

Süre dolunca pencere kapanır; süresiz yenileme yoktur.

## B — Kalıcı yerel operasyon (24s sonra, ayrı onay)

Qwen yerelde ücretli API kotasına bağlanmaz. Kalıcı politika:

- Eşzamanlı LLM = 1
- Kuyruk tavanı + idle skip + hata backoff
- Kill switch
- 24s (veya sizin yazacağınız yeni süre) pencere **veya** açık süreli kalıcı onay — ikisi birden sessiz açılmaz
- Cloud / ücretli API yok

Günlük CEO 2 / ajan 8 **yalnızca T-P5E-009 penceresinde** kalır. Kalıcı olarak kaldırılması bu madde B onayını ister.

## C — Dört proje repo doğrulama (kod aracı önkoşulu)

Owner, dashboard/MSSQL’de tek tek işaretler. Ajan `verified` yapmaz.

| Proje | Beklenen |
|-------|----------|
| synaptech-ai-os | Verified local/GitHub kök |
| synaptech (website) | Verified veya yalnızca kamu analiz |
| subify | Verified (önceki testte vardı; yeniden doğrula) |
| marivo | Verified değilse kod aracı yok; araştırma sürer |

Doğrulanmamış projede: SEO/growth/analiz evet; sandbox patch hayır.

## D — Yazılım zinciri (otomatik yönetim, yayın yok)

CEO → CTO → Developer → Tester → Security → CTO.

İzinli: izole snapshot, sandbox patch, Docker test, secret/diff tarama, acceptance.

Kapalı (ayrı dar onay D1 olmadan): `ai/<task-id>` push, GitHub Draft PR.

Kapalı (asla otomatik): merge, production deploy, AI OS’nin kendi policy/kill-switch/approval/credential değiştirmesi.

**D1 — ilk gerçek push/PR:** tek repo, en az yetkili GitHub kimliği, `GITHUB_WRITE_MODE` live yokken bile ayrı onay; merge sizde.

## E — Büyüme ve müşteri

İzinli: Lead kaydı (kaynak URL, şirket, sektör, ihtiyaç, verified bayrak), SEO bulgusu, blog/ads **taslak**.

Kapalı: müşteri e-posta/DM/toplu ileti, blog yayın, reklam harcaması, mükerrer günlük blog otomasyonu ile çakışan görev.

Hepsi Onay Merkezi kuyruğunda.

## F — Yasak (bu planda da yetki yok)

Ücretli AI API, Cursor Cloud Agent otomatik start, On-Demand, ana repo doğrudan yazma, korumalı dosyalar (`.cursor`, `config`, `AGENTS.md`, güvenlik politikası).

## Geri alma

Kill switch; tüm `*_MODE=off`; pencere kapat. GitHub yazma zaten off.

## Bu turda yapılmayanlar (bilinçli)

Canlı Ollama CEO, timer’ı local’e alma, push/PR, müşteri ileti, production, kota sıfırlama, T-P5E-009 pencere kaydı.
