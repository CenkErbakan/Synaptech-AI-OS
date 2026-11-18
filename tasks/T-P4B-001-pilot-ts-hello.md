---
title: "Pilot — tek satır TypeScript yardımcısı"
type: task-brief
project: synaptech
agent: developer
date: "2026-11-17"
status: planned
pilot_repo: "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot"
---

# Görev özeti — Faz 4B tek Cloud run (henüz başlatılmadı)

## Kimlik

- Görev id: T-P4B-001
- Proje: synaptech (iş kaydı); kod yalnızca izole pilot repo
- Öncelik: Orta
- Sorumlu ajan: developer (tek Cloud Agent; zincir yok)

## Amaç

İzole pilot deposunda **minimal** bir TypeScript yardımcısı eklemek. Amaç entegrasyonu ölçmek; özellik geliştirmek değil.

## Kabul kriterleri

1. `src/hello.ts` (veya eşdeğeri) dosyası oluşur.
2. Dışa aktarılan fonksiyon: `greet(name: string): string` → `"Hello, <name>!"`
3. `src/hello.test.ts` veya basit `node --experimental-strip-types` / `tsc --noEmit` ile doğrulanabilir kontrol vardır (repo durumuna göre en hafif yol).
4. Pilot repo varsayılan branch’i `master`; hem `main` hem `master` korumalıdır — üzerine yazılmaz.
5. Değişiklikler yalnızca `cursor/...` veya `agent/...` branch’te kalır (`workOnCurrentBranch: false`).
6. `autoCreatePR: false` — PR otomatik açılmaz; otomatik merge ve deployment yasaktır.
7. Owner onayı `contentVersion` (görev + brief SHA-256 + branch politikası) ile birebir eşleşmeli; uyuşmazlıkta çalıştırma engellenir.
8. SynapTech / Subify / Marivo koduna dokunulmaz.

## Önerilen dosya içeriği (referans)

```typescript
/** Pilot smoke helper — SynapTech AI OS Faz 4B */
export function greet(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Hello!";
  return `Hello, ${trimmed}!`;
}
```

## Bağlam / sınırlar

- Repo: `https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot`
- Base ref: `master` (env: `CLOUD_AGENT_STARTING_REF=master`); `main` da korumalı
- Live create: yalnızca Owner ayrı “başlat” onayı + `CLOUD_AGENT_LIVE_ENABLED=true` anı
- Onay türü: `cloud_agent_run` — boundVersion = contentVersion
- Kill switch açıkken çalıştırma yok
- Otomatik merge / deployment: yasak

## Onay

- Gerekli mi: evet
- Tür: cloud_agent_run

## Veri kaynakları

- Gerçek pilot repo + Cursor API — DEMO yok.
