import { PageHeader } from "@/components/common/page-parts";
import { TeamCommsPanel } from "@/components/views/team-comms-panel";

export default function TeamCommsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Ekip İletişimi"
        description="Faz 5B: zincir adımları, bağımlılıklar, AgentMessage. Deterministik koordinasyon."
      />
      <TeamCommsPanel />
    </div>
  );
}
