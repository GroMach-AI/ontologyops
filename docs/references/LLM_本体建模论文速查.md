# LLM 辅助本体建模 — 关键论文速查

## 1. OntoGenix

**标题**：OntoGenix: Leveraging Large Language Models for Enhanced Ontology Engineering from Datasets

**作者**：Mikel Val-Calvo, Mikel Egaña Aranguren, Juan Mulero-Hernández et al.

**发表**：*Information Processing & Management*, Vol 62(3), May 2025, Article 104042

**DOI**：https://doi.org/10.1016/j.ipm.2024.104042

**论文链接**：https://www.sciencedirect.com/science/article/pii/S0306457324004011

**核心方法**：四步 pipeline
1. Data preprocessing（数据预处理）
2. Ontology planning（本体规划）
3. LLM building（LLM 构建）
4. Entity improvement（实体改进）

**关键结论**：
- LLM 生成的本��与人类生成的本体在**大多数质量指标上相似**
- 但在**复杂建模场景**（多层继承、规则约束）中，人类显著优于 LLM
- 在 6 个商业数据集上验证，建模一致性良好

**对 OntologyOps 的启发**：LLM 适合做快速候选生成和简单建模，复杂语义结构仍需人类建模者把关。我们的"profiling + LLM 候选 + 人工审核"三层架构完全对齐此结论。

---

## 2. LLM as Oracles

**��题**：Large Language Models as Oracles for Instantiating Ontologies with Domain-Specific Knowledge

**作者**：Giovanni Ciatto, Andrea Agiollo, Matteo Magnini, Andrea Omicini（TU Delft / Università di Bologna）

**发表**：*Knowledge-Based Systems*, Vol 310, 2025, Article 112940

**DOI**：https://doi.org/10.1016/j.knosys.2024.112940

**论文链接**：https://research.tudelft.nl/en/publications/large-language-models-as-oracles-for-instantiating-ontologies-wit/

**核心方法**：
1. 给定初始 schema（类+属性+关系骨架）
2. 使用 query templates 多次查询 LLM
3. LLM 自动填充 instances，初始化本体
4. 人在生成结果上取舍/调整/补充

**关键结论**：
- 质量比 SOTA 高 **5 倍**，错误减少 **10 倍**
- **LLM 适合填充已知 schema，不适合从零定义 schema**（SWOT 分析核心结论）
- 营养学领域验证：从 meal 分类开始自动 instantiating 完整食谱本体

**对 OntologyOps 的启发**：
- **不要从零让 LLM 造本体**——先由 profiling 给出 schema 骨架（对象/属性），LLM 只负责"骨架上的丰富和细化"
- 我们的"profiling → LLM 候选 → 问答确认"流程恰好符合"已知骨架 + LLM 填充"的最佳实践

---

## 3. OntoKGen

**标题**：Leveraging LLM for Automated Ontology Extraction and Knowledge Graph Generation

**作者**：Mohammad Sadeq Abolhasani, Rong Pan（Arizona State University）

**发表**：arXiv:2412.00608, Dec 2024

**arXiv**：https://arxiv.org/abs/2412.00608

**PDF**：https://arxiv.org/pdf/2412.00608.pdf

**核心方法**：
1. **Adaptive Iterative Chain of Thought (CoT)** 算法
2. 交互式 UI：LLM 提问 → 用户回答 → LLM 基于回答细化 → 继续迭代
3. 生成 KG → 存入 Neo4j（无 schema 图数据库）
4. 为未来 RAG 系统集成做准备

**关键结论**：
- **"没有 universally correct ontology，本体正确性取决于用户需求"**——这是核心理念
- 用户完全控制最终本体输出
- 迭代式 CoT 优于一次性生成——每次交互消解一个不确定性
- RAM（可靠性/可维护性）领域的复杂技术文档验证通过

**对 OntologyOps 的启发**：
- **迭代式交互是 LLM 本体建模的核心范式**——我们当前的"单个问答+编辑推荐列表"已经体现了这个思路
- "没有 universally correct ontology"——这意味着工具的目标不是给出唯一答案，而是辅助建模者快速收敛到一个可用的本体结构
- 后续可考虑：问答环节不只是 3 个预设问题，而是一次真正对话，LLM 根据回答动态生成下一个问题

---

## 三篇论文的交叉结论

| 结论 | 来源 | OntologyOps 对齐情况 |
|---|---|---|
| LLM 不适合从零定义 schema，适合在骨架上丰富 | LLM as Oracles | ✅ profiling 层提供骨架 |
| 复杂建模场景人类优于 LLM | OntoGenix | ✅ 审核+编辑环节由人决定 |
| 迭代式交互优于一次性输出 | OntoKGen | ✅ 问答环节 + 编辑推荐列表 |
| 没有 universally correct ontology | OntoKGen | ✅ 工具辅助而非替代建模者 |
| LLM 在数据充分时质量可接近人类 | OntoGenix | ✅ 用真实数据驱动 LLM，不凭空造 |
