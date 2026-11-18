import { PageHeader } from "@/components/common/page-parts";
import { ModeView } from "@/components/mode/mode-view";
import { OwnerGrantsPanel } from "@/components/views/owner-grants-panel";

export default function GrantsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Owner yetkileri"
        description="Dış işlem kapıları varsayılan kapalıdır. Bu ekran ağ çağrısı başlatmaz."
      />
      <ModeView
        real={<OwnerGrantsPanel />}
        demo={
          <p className="text-sm text-muted-foreground">
            DEMO’da yetki kaydı tutulmaz. Gerçek görünüme geçin.
          </p>
        }
      />
    </div>
  );
}
