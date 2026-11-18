import { AutonomyPanel } from "@/components/views/autonomy-panel";
import { PageHeader } from "@/components/common/page-parts";

export default function AutonomyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Otonom Faaliyet"
        description="Faz 5A: scheduler, fırsat, CEO planı ve AUTO görevler. Deterministik — LLM değil."
      />
      <AutonomyPanel />
    </div>
  );
}
