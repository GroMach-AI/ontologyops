import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell, type DemoRole } from "../components/AppShell";
import { AgentPage } from "../features/agent/AgentPage";
import { GovernancePage } from "../features/governance/GovernancePage";
import { HomePage } from "../features/home/HomePage";
import { ModelPage } from "../features/model/ModelPage";
import { OntologyDetailPage } from "../features/ontology/OntologyDetailPage";
import { OntologyPage, type Ontology } from "../features/ontology/OntologyPage";
import { PipelinePage } from "../features/pipeline/PipelinePage";

export default function App() {
  const [role, setRole] = useState<DemoRole>("modeler");
  const [ontologies, setOntologies] = useState<Ontology[]>([]);

  return (
    <AppShell role={role} onRoleChange={setRole} ontologies={ontologies}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/data-pipeline" element={<PipelinePage role={role} />} />
        <Route path="/ontology" element={<OntologyPage role={role} ontologies={ontologies} onCreated={(o) => setOntologies((p) => [...p, o])} />} />
        <Route path="/ontology/:id" element={<OntologyDetailPage role={role} ontologies={ontologies} onUpdate={(updated) => setOntologies((items) => items.map((item) => item.id === updated.id ? updated : item))} />} />
        <Route path="/apps/agent" element={<AgentPage role={role} />} />
        <Route path="/governance" element={<GovernancePage role={role} />} />
        <Route path="/models" element={<ModelPage role={role} />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AppShell>
  );
}
