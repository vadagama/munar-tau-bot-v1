import { Button, Typography } from "antd";
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
  const navigation = <Button onClick={() => navigate("/tasks")}>К заданиям</Button>;
  return templates
    ? <JobTemplates navigation={navigation} onCreated={id => navigate("/tasks?task=" + encodeURIComponent(id))} />
    : <CommonWorks navigation={navigation} onTask={id => navigate("/tasks?common_work=" + encodeURIComponent(id))} />;
}
