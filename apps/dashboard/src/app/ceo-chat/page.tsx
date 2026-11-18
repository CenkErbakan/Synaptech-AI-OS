import { PageHeader } from "@/components/common/page-parts";
import { CeoChatPanel } from "@/components/views/ceo-chat-panel";

export default function CeoChatPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI CEO Chat"
        description="Faz 5B: gerçek MSSQL bağlamı. LLM yok — gerçek AI konuşması gibi gösterilmez."
      />
      <CeoChatPanel />
    </div>
  );
}
