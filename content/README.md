# content/

Blog taslakları ve içerik takvimi. **Yayın yapılmaz.**

## Mevcut SynapTech blog otomasyonu

SynapTech’in çalışan bir blog otomasyonu vardır (`config/projects.yaml` → `existing_blog_automation`). Bu klasör onu **çoğaltmaz** ve yayın düzenini değiştirmez. Konu seçmeden önce `content/published-index.md` (varsa) ve mevcut taslaklar kontrol edilir; mükerrer içerik üretilmez.

## Yapı

```text
calendar/              Haftalık plan dosyaları
blog/drafts/tr/        Türkçe taslaklar
blog/drafts/en/        İngilizce taslaklar
templates/             blog-tr.md, blog-en.md
```

## Frontmatter (ContentDraftFrontmatterSchema)

Zorunlu / kullanılan alanlar: `title`, `lang`, `project`, `meta_title`, `meta_description`, `keywords`, `status`, `seo_review`, `publish_approval`, `created_at`.

Yeni taslaklar: `status: draft`, `seo_review: pending`, `publish_approval: pending`.

Meta başlık ≤ 60, meta açıklama ≤ 155 karakter. Trafik/hacim uydurulmaz (GSC bağlı değil).
