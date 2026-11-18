# SynapTech AI OS — Cursor Guard

Gerçek engelleme katmanı: `guard.mjs` + `policy.json`. Bu klasörde **henüz `.cursor/hooks.json` yoktur**; etkinleştirme ayrı bir adımda (önce gözlem, sonra zorunlu) yapılır.

## Çalıştırma

```text
node .cursor/hooks/guard.mjs <event> [--observe]
```

stdin: JSON (Windows'ta PowerShell borusu). stdout: her zaman geçerli JSON. exit kodu: 0.

`--observe`: kararı denetim kaydına yazar ama her zaman `allow` / `continue: true` döner.

## Beklenen `hooks.json` şekli (henüz oluşturma)

Önce gözlem:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [{ "command": "node .cursor/hooks/guard.mjs preToolUse --observe", "timeout": 10, "failClosed": true }],
    "beforeShellExecution": [{ "command": "node .cursor/hooks/guard.mjs beforeShellExecution --observe", "timeout": 10, "failClosed": true }],
    "beforeMCPExecution": [{ "command": "node .cursor/hooks/guard.mjs beforeMCPExecution --observe", "timeout": 10, "failClosed": true }],
    "subagentStart": [{ "command": "node .cursor/hooks/guard.mjs subagentStart --observe", "timeout": 10, "failClosed": true }],
    "subagentStop": [{ "command": "node .cursor/hooks/guard.mjs subagentStop --observe", "timeout": 10 }],
    "beforeSubmitPrompt": [{ "command": "node .cursor/hooks/guard.mjs beforeSubmitPrompt --observe", "timeout": 10 }],
    "sessionStart": [{ "command": "node .cursor/hooks/guard.mjs sessionStart --observe", "timeout": 10 }],
    "stop": [{ "command": "node .cursor/hooks/guard.mjs stop --observe", "timeout": 10 }],
    "afterShellExecution": [{ "command": "node .cursor/hooks/guard.mjs afterShellExecution --observe", "timeout": 10 }],
    "afterFileEdit": [{ "command": "node .cursor/hooks/guard.mjs afterFileEdit --observe", "timeout": 10 }]
  }
}
```

Sonra zorunlu mod: komutlardan `--observe` kaldırılır. Güvenlik kritik olaylarda `failClosed: true` kalır.

## Politika

`policy.json` değerleri `config/budget-policy.yaml` eşzamanlılık sınırlarıyla uyumlu olmalıdır (`maxConcurrent: 2`, `slotTtlMinutes: 30`, `maxLaunchesPerConversation: 12`). Tutarlılık `pnpm test:guards` ile denetlenir.

## Durum ve denetim

- Denetim: `.synaptech/audit/YYYY-MM-DD.jsonl` (maskelenir; istem/dosya içeriği yazılmaz)
- Slotlar: `.synaptech/state/subagents.json`
- Kill switch: `config/kill-switch.json` → `enabled: true` iken okuma dışı araçlar ve `subagentStart` reddedilir

## Test

```text
pnpm test:guards
```
