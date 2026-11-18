import { PageHeader } from "@/components/common/page-parts";
import { ModeView } from "@/components/mode/mode-view";
import { ApprovalsDemo } from "@/components/views/approvals-demo";
import { ApprovalsReal } from "@/components/views/approvals-real";

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Onay Merkezi"
        description="Tek Owner karar kuyruğu: onay kayıtları ve onay bekleyen görevler. Merge, deploy, müşteri ileti, blog ve reklam harcaması ajan tarafından yapılmaz."
      />
      <ModeView real={<ApprovalsReal />} demo={<ApprovalsDemo />} />
    </div>
  );
}
