import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell, type DemoRole } from "../components/AppShell";
import { AgentPage } from "../features/agent/AgentPage";
import { GovernancePage } from "../features/governance/GovernancePage";
import { HomePage } from "../features/home/HomePage";
import { ModelPage } from "../features/model/ModelPage";
import { OntologyPage } from "../features/ontology/OntologyPage";
import { PipelinePage } from "../features/pipeline/PipelinePage";

export default function App() {
  const [role, setRole] = useState<DemoRole>("modeler");

  return (
    <AppShell role={role} onRoleChange={setRole}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/data-pipeline" element={<PipelinePage role={role} />} />
        <Route path="/ontology" element={<OntologyPage role={role} />} />
        <Route path="/apps/agent" element={<AgentPage role={role} />} />
        <Route path="/governance" element={<GovernancePage role={role} />} />
        <Route path="/models" element={<ModelPage role={role} />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AppShell>
  );
}
