import type { DemoRole } from "../../components/AppShell";

export type TrustedAnswer = {
  answer: string;
  objects: Array<{ type: string; id: string; label: string }>;
  evidence: Array<Record<string, unknown>>;
  provenance: {
    sources: string[];
    updated_at: string;
    metric_definition: string;
    ontology_version: string;
  };
  tool_calls: Array<{ name: string; status: string }>;
  model: { provider: string; model_name: string; mode: "real" | "mock" | "deterministic" };
};

export async function sendAgentMessage(message: string, role: DemoRole): Promise<TrustedAnswer> {
  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Demo-Role": role },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    throw new Error("智能问数暂时不可用，请确认本体版本已发布。");
  }
  return response.json() as Promise<TrustedAnswer>;
}
