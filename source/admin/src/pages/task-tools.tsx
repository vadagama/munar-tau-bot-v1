import { Button, Space, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { useCabinetIdentity } from "../lib/identity";
import { CommonWorks } from "./common-works";
import { JobTemplates } from "./job-templates";

export function TaskToolsPage({ templates = false }: { templates?: boolean }) {
  const navigate = useNavigate();
  const { roles } = useCabinetIdentity();
  if (!roles.some(role => ["chairman", "administrator", "deputy"].includes(role))) {
    return <Typography.Paragraph>Нет доступа к управлению заданиями.</Typography.Paragraph>;
  }
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Button onClick={() => navigate("/tasks")}>К заданиям</Button>
    <Typography.Title level={2}>{templates ? "Шаблоны заданий" : "Общие работы"}</Typography.Title>
    {templates
      ? <JobTemplates onCreated={id => navigate("/tasks?task=" + encodeURIComponent(id))} />
      : <CommonWorks onTask={id => navigate("/tasks?common_work=" + encodeURIComponent(id))} />}
  </Space>;
}
