import { PageHeader } from "@/components/common/page-parts";
import { ModeView } from "@/components/mode/mode-view";
import { TasksDemoBoard, TasksRealEmpty } from "@/components/views/tasks-board";

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Görev Panosu"
        description="Gerçek görünüm MSSQL görev motoruna bağlıdır. DEMO görünümü tarayıcı deposundadır ve API'yi değiştirmez."
      />
      <ModeView real={<TasksRealEmpty />} demo={<TasksDemoBoard />} />
    </div>
  );
}
