# Ajan iş akışları

**Orkestratör:** Ana sohbet ajanı. Alt ajanlar `.cursor/agents/` altındadır.  
**Eşzamanlılık:** Aynı anda en fazla **2** alt ajan; oturum başına en fazla **12** başlatma (`config/budget-policy.yaml`, hook zorlar).  
**İç içe derinlik:** Cursor sınırı nedeniyle alt ajanlardan yeni alt ajan istenmez; orkestratör sırayla çağırır.

Sistem Faz 2’dedir ve otonom değildir. Kanıt olmadan “tamamlandı” denmez.

## Yazılım

```text
ceo → cto (plan) → developer → tester → cto (inceleme) → kullanıcı onayı
```

1. **ceo** — öncelik, kabul kriteri, onay ihtiyacı (readonly; dosyaya orkestratör yazar)
2. **cto** — teknik plan / mimari (readonly)
3. **developer** — yalnızca `agent/<görev-id>-<slug>` branch; PR metni `tasks/pr-drafts/`
4. **tester** — izole test; rapor `reports/qa/`
5. **cto** — kod incelemesi
6. Korumalı merge / deploy gerekiyorsa → onay talebi → kullanıcı; yürütme Faz 3’te güvenilir yürütücü (şimdi manuel)

İsteğe bağlı: **security** bağımlılık veya riskli değişikliklerde.

## İçerik

```text
ceo → growth-lead → seo-specialist → content-manager → seo-specialist (kontrol) → yayın onayı
```

1. **growth-lead** — konu / takvim önerisi
2. **seo-specialist** — anahtar kelime ve yapı (readonly)
3. **content-manager** — `content/blog/drafts/{tr,en}/` taslak; yayın yok
4. **seo-specialist** — SEO kontrolü (`seo_review`)
5. Kullanıcı `blog_publish` onayı; SynapTech mevcut blog otomasyonuyla mükerrer konu kontrolü zorunlu

## Reklam

```text
ceo → growth-lead → ads-manager → performans analizi → kampanya önerisi → kullanıcı onayı
```

1. **growth-lead** — strateji çerçevesi
2. **ads-manager** — taslak / öneri (readonly); hesap bağlı değilse gerçek metrik yok
3. Kullanıcı veri sağladıysa analiz; kampanya başlatma / bütçe → onay türleri; ajan yürütmez

## Günlük / haftalık (manuel veya ileride otomasyon)

| Çıktı | Sorumlu | Klasör |
|-------|---------|--------|
| Günlük CEO | ceo | `reports/daily/` |
| Haftalık şirket | ceo | `reports/weekly/` |
| Haftalık güvenlik | security | `reports/security/` |
| SEO / reklam notları | seo / ads | `marketing/` |

Otomasyonlar kapalıdır; bkz. [automation-plan.md](automation-plan.md).

## Devir bloğu

Her alt ajan çıktısını şu blokla bitirir:

```text
### DEVİR
- Görev: <id> — <başlık>
- Proje: synaptech | subify | marivo
- Durum önerisi: planned | in_progress | testing | in_review | awaiting_approval | done | failed
- Sonraki adım: <ajan id> | kullanıcı
- Kanıt: <komut ve sonuç, dosya yolları>
- Riskler / açık sorular: <...>
- Onay gerekli mi: hayır | evet: <onay türü> — <gerekçe>
```

Şablon: `tasks/templates/handoff.md`.

## Orkestrasyon kuralları

- Basit işleri alt ajana devretme; doğrudan yap.
- Readonly ajan çıktısını orkestratör ilgili klasöre yazar.
- Alt ajan önceki sohbeti görmez; her devirde görev kimliği, proje, kabul kriteri ve dosyalar verilir.
- Bir görev en fazla **2** kez yeniden denenir; sonra kullanıcıya dön.
- Onay kapıları: `.cursor/rules/20-approval-gates.mdc`.

Kaynak kurallar: `.cursor/rules/10-orchestration.mdc`, `AGENTS.md`.
