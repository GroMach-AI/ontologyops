import { expect, it } from "vitest";

import { normalizeLLMAnalysis } from "./OntologyPage";

it("keeps one AI recommendation separate from alternative answers", () => {
  const analysis = normalizeLLMAnalysis({
    entities: [],
    relationships: [],
    summary: "",
    questions: [{
      question: "供应商与采购订单的关系应采用哪种基数？",
      category: "relationship",
      suggested: ["保持检测的一对一", "改为多对一"],
      recommended: "改为多对一",
      recommendation_reason: "供应商主数据与采购订单通过 supplier_id 关联，供应商可对应多张订单。",
    }],
  });

  expect(analysis.questions[0]).toMatchObject({
    recommended: "改为多对一",
    recommendation_reason: "供应商主数据与采购订单通过 supplier_id 关联，供应商可对应多张订单。",
  });
});
