# Proje ekleme — SynapTech AI OS (`synaptech-ai-os`)

**Tarih:** 2026-11-18  
**Kapsam:** MSSQL + Fastify API + Dashboard Gerçek görünüm  
**Production / diğer ürün kodları:** etkilenmedi  
**Cloud allow-list:** yalnızca Pilot (değiştirilmedi)

## Dört proje (MSSQL / API)

| Slug | Ad | Açıklama | cloudAgentEnabled | githubRepoUrl |
| --- | --- | --- | --- | --- |
| `synaptech` | SynapTech | Kurumsal web sitesi | false | null |
| `subify` | Subify | Abonelik ürünü | false | null |
| `marivo` | Marivo | Pazarlama ürünü | false | null |
| `synaptech-ai-os` | SynapTech AI OS | Şirket işletim sistemi (ajan orkestrasyonu, görev motoru, dashboard) | false | null |

Mevcut üç proje silinmedi / yeniden oluşturulmadı; `synaptech` kimliği korundu, açıklama “Kurumsal web sitesi” olarak netleştirildi.

## Görev taşıma

| Alan | Değer |
| --- | --- |
| Görev | `AI CEO Chat + Ekip İletişimi` |
| ID | `462490ee-bbf4-4ec3-b2ac-59e8134966ce` |
| Önceki proje | `synaptech` |
| Yeni proje | `synaptech-ai-os` |
| Event | `project_changed` eklendi (önceki event korundu: 1→2) |
| Bağlı onay | 1 kayıt; `projectId` güncellendi, silinmedi |
| Audit | `task.project_reassigned` |

## Dashboard

- Gerçek **Projeler** listesi: `/api/projects` (MSSQL)
- CEO formu: API’den proje çeker; `SynapTech AI OS` seçilebilir (varsayılan öneri `synaptech-ai-os`)
- DEMO: dördüncü proje `projectDetails` içinde; Gerçek/DEMO ayrımı korundu
- Genel bakış: API açıksa dört projeyi API’den gösterir

## Yetki / repository eşlemesi

- `Project.githubRepoUrl` + `Project.cloudAgentEnabled` alanları eklendi
- Yeni proje dahil tümünde `cloudAgentEnabled=false`
- `CLOUD_AGENT_ALLOWED_REPOS` hâlâ yalnızca  
  `https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot`
- Yeni projeye otomatik Cloud Agent erişimi **verilmedi**

## Testler

| Paket | Sonuç |
| --- | --- |
| `@synaptech/shared` `tests/projects.test.ts` | 4/4 geçti |
| `@synaptech/dashboard` demo-separation | 3/3 geçti |
| `@synaptech/api` cursor-adapter + pilot-policy | 17/17 geçti |
| `@synaptech/api` integration | 9/9 geçti |

## Owner notu — `config/projects.yaml` (korumalı)

Ajan `config/**` yazamaz. Gerçek UI artık API’yi kullanır; YAML hâlâ eski 3 projeyi listeler. İsterseniz Owner olarak şunu ekleyin:

```yaml
  - slug: synaptech-ai-os
    name: "SynapTech AI OS"
    description: "Şirket işletim sistemi (ajan orkestrasyonu, görev motoru, dashboard)"
    status: active
    goals: []
    risks: []
    responsible_agents: [ceo, cto, developer, tester, security]
    github:
      repo: null
      status: not_connected
      planned_permissions:
        - "contents: read"
        - "pull_requests: write (yalnızca agent/* / cursor/* branch'leri)"
        - "checks: read"
    source_code_policy: "Bu depo SynapTech AI OS çalışma alanıdır; üretim ürün kodlarına otomatik müdahale yok."
```

Ayrıca `synaptech` kaydındaki description’ı “Kurumsal web sitesi” ile hizalayabilirsiniz.

## Bilinçli olarak yapılmayanlar

- Üç mevcut projenin silinmesi
- Allow-list / live Cloud açma
- Production deploy
- Automations / Faz 5
