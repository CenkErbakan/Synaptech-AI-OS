# tasks/

Ajan görev özetleri, devir notları, onay talepleri ve yerel PR taslakları.

**Faz 2 notu:** Bu klasördeki dosyalar görev motoru kaydı değildir. Dashboard bunları “Gerçek · Dosya” olarak listeler. Kalıcı görev motoru Faz 3’tedir.

## Adlandırma

| Tür | Yol |
|-----|-----|
| Görev özeti | `T-XXXX-<kısa-ad>.md` |
| Onay talebi | `approvals/<görev-id>-<tür>.md` |
| PR taslağı | `pr-drafts/<görev-id>.md` |

Şablonlar: `templates/`. Frontmatter alanlarını silmeyin; Dashboard okur (`DocumentFrontmatterSchema`).

## Frontmatter alanları

`title`, `type`, `project`, `agent`, `date`, `status`
