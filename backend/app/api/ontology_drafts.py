"""Ontology Drafts - Upload files + profiling + interactive QA + persistence."""
from __future__ import annotations

import json
import re
from io import StringIO
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import runtime_metadata_engine
from app.models.platform import UserOntology
from app.services.model_provider import ModelProviderService

router = APIRouter(prefix="/api/ontology-drafts", tags=["ontology-drafts"])

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".pdf", ".docx", ".doc", ".txt"}


def _profile_csv_or_excel(content: bytes, filename: str) -> dict:
    """Parse CSV/Excel and return column-level profiling."""
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(StringIO(content.decode("utf-8", errors="replace")), nrows=5000)
    else:
        df = pd.read_excel(content, nrows=5000, engine="openpyxl")

    columns = []
    for col in df.columns:
        series = df[col]
        non_null = series.dropna()
        unique = non_null.nunique()
        total = len(series)
        null_pct = round((total - len(non_null)) / max(total, 1) * 100, 1)
        inferred_type = str(series.dtype)
        sample_values = [str(v) for v in non_null.head(5).tolist()]

        columns.append({
            "name": str(col),
            "inferred_type": inferred_type,
            "total_rows": total,
            "unique_count": int(unique),
            "null_percent": null_pct,
            "sample_values": sample_values,
        })

    return {
        "source": filename,
        "type": "tabular",
        "total_rows": len(df),
        "columns": columns,
    }


def _classify_document_kind(filename: str) -> str:
    """Classify document by filename heuristics."""
    lower = filename.lower()
    if any(kw in lower for kw in ["经验", "heuristic", "know-how", "knowhow", "expert"]):
        return "expert_heuristics"
    return "data_description"


def _profile_document(filename: str, content: bytes | None = None) -> dict:
    profile = {
        "source": filename,
        "type": "document",
        "kind": _classify_document_kind(filename),
        "note": "文档解析仅支持 .txt；PDF/DOCX 将在后续版本支持。",
    }
    if content is not None and filename.lower().endswith(".txt"):
        text = content.decode("utf-8", errors="replace").strip()
        profile["text_preview"] = text[:3500]
        profile["total_chars"] = len(text)
        profile["note"] = f"文本已解析，共 {len(text)} 字符"
    return profile


def _detect_links(profiles: list[dict]) -> list[dict]:
    """Detect potential links across files by same-name columns or value overlay."""
    links = []
    tabular = [p for p in profiles if p.get("type") == "tabular"]
    for i in range(len(tabular)):
        for j in range(i + 1, len(tabular)):
            a_cols = {c["name"]: c for c in tabular[i]["columns"]}
            b_cols = {c["name"]: c for c in tabular[j]["columns"]}
            for name in set(a_cols.keys()) & set(b_cols.keys()):
                a_col = a_cols[name]
                b_col = b_cols[name]
                # Compute cardinality hints
                # If a col is fully unique (unique==total), it's the "one" side
                a_is_one = a_col["unique_count"] == a_col["total_rows"]
                b_is_one = b_col["unique_count"] == b_col["total_rows"]
                cardinality = "unknown"
                if a_is_one and b_is_one:
                    cardinality = "one_to_one"
                elif a_is_one and not b_is_one:
                    cardinality = "one_to_many"  # a is one, b is many
                elif not a_is_one and b_is_one:
                    cardinality = "many_to_one"  # a is many, b is one
                else:
                    cardinality = "many_to_many"
                links.append({
                    "type": "same_name",
                    "confidence": "medium" if a_is_one or b_is_one else "low",
                    "source_file": tabular[i]["source"],
                    "source_column": name,
                    "target_file": tabular[j]["source"],
                    "target_column": name,
                    "cardinality": cardinality,
                    "source_unique": a_col["unique_count"],
                    "source_total": a_col["total_rows"],
                    "target_unique": b_col["unique_count"],
                    "target_total": b_col["total_rows"],
                    "message": f"两个文件都有「{name}」列，可能代表同一业务实体。基数：{cardinality}（源:{a_col['unique_count']}/{a_col['total_rows']} 目标:{b_col['unique_count']}/{b_col['total_rows']}）",
                })
            for name, s_col in a_cols.items():
                if name not in b_cols:
                    for t_name, t_col in b_cols.items():
                        s_vals = set(s_col.get("sample_values", []))
                        t_vals = set(t_col.get("sample_values", []))
                        overlap = s_vals & t_vals
                        if len(overlap) >= 2 and len(s_vals) > 0:
                            links.append({
                                "type": "value_overlap",
                                "confidence": "low",
                                "source_file": tabular[i]["source"],
                                "source_column": name,
                                "target_file": tabular[j]["source"],
                                "target_column": t_name,
                                "message": f"「{name}」与「{t_name}」有 {len(overlap)} 个重复值，可能存在关联。",
                            })
                            break
    return links


def _generate_qa_questions(profiles: list[dict], links: list[dict]) -> list[dict]:
    """Generate interactive QA questions for the user to confirm inferred structure."""
    questions = []
    tabular = [p for p in profiles if p.get("type") == "tabular"]
    for p in tabular:
        pk_candidates = [
            c["name"] for c in p["columns"]
            if c["unique_count"] == c["total_rows"] and c["null_percent"] == 0
        ]
        if pk_candidates:
            questions.append({
                "id": str(uuid4()),
                "category": "primary_key",
                "question": f"在「{p['source']}」中，以下列看起来像主键（唯一且无空值）：{', '.join(pk_candidates)}。请确认。",
                "suggested": pk_candidates,
            })
        enum_candidates = [
            c["name"] for c in p["columns"]
            if 2 <= c["unique_count"] <= 20 and c["null_percent"] < 30
        ]
        if enum_candidates:
            questions.append({
                "id": str(uuid4()),
                "category": "enum_property",
                "question": f"「{p['source']}」中 {', '.join(enum_candidates)} 的取值较少，是否作为枚举属性？",
                "suggested": enum_candidates,
            })
    for link in links:
        if link["confidence"] in ("high", "medium"):
            questions.append({
                "id": str(uuid4()),
                "category": "link",
                "question": link["message"],
                "suggested": [f"{link['source_file']}.{link['source_column']} ↔ {link['target_file']}.{link['target_column']}"],
            })
    return questions


@router.post("/upload")
async def upload_and_profile(
    name: str = Form(...),
    scope: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Upload files, run profiling, detect links, generate QA questions."""
    profiles = []
    for f in files:
        if not f.filename:
            continue
        ext = f.filename.lower()
        if not any(ext.endswith(e) for e in ALLOWED_EXTENSIONS):
            continue
        content = await f.read()
        if ext.endswith((".csv", ".xlsx", ".xls")):
            profiles.append(_profile_csv_or_excel(content, f.filename))
        elif ext.endswith(".txt"):
            text = content.decode("utf-8", errors="replace")
            profiles.append({
                "source": f.filename, "type": "document",
                "kind": _classify_document_kind(f.filename),
                "text_preview": text[:3500],
                "total_chars": len(text),
                "note": f"文本已解析，共 {len(text)} 字符",
            })
        else:
            profiles.append(_profile_document(f.filename, content))

    links = _detect_links(profiles)
    questions = _generate_qa_questions(profiles, links)

    return {
        "draft": {"name": name, "scope": scope},
        "profiling": {
            "files_parsed": len(profiles),
            "columns_total": sum(len(p.get("columns", [])) for p in profiles),
            "details": profiles,
        },
        "links_detected": links,
        "qa_questions": questions,
    }


class AnalyzeRequest(BaseModel):
    draft: dict
    profiling: dict
    links_detected: list[dict]


@router.post("/analyze")
def analyze_with_llm(request: AnalyzeRequest):
    """Feed profiling results to LLM for semantic ontology analysis."""
    details = request.profiling.get("details", [])
    links = request.links_detected
    draft = request.draft

    tabular_files = []
    documents_expert = []
    documents_data = []
    for d in details:
        kind = d.get("kind", "")
        if d.get("type") == "tabular":
            cols_desc = "\n".join(
                f"  - {c['name']}: type={c['inferred_type']}, unique={c['unique_count']}, null={c['null_percent']}%, samples={c['sample_values'][:3]}"
                for c in d.get("columns", [])
            )
            tabular_files.append(f"文件: {d['source']} ({d.get('total_rows', '?')}行)\n{cols_desc}")
        elif d.get("type") == "document":
            if kind == "expert_heuristics":
                documents_expert.append(f"文件: {d['source']}\n{d.get('text_preview','')}")
            else:
                documents_data.append(f"文件: {d['source']}\n{d.get('text_preview','')}")

    links_desc = "\n".join(
        f"  [{l.get('confidence','?')}] {l['source_file']}.{l['source_column']} ↔ {l['target_file']}.{l['target_column']}: {l.get('message','')} 基数={l.get('cardinality','unknown')}"
        for l in links
    ) if links else "无自动检测到的潜在关系"

    expert_section = ""
    if documents_expert:
        expert_section = "\n\n**领域专家业务经验（请优先参照这些经验来识别实体和关系）**:\n" + "\n\n---\n\n".join(documents_expert) + "\n"
    data_doc_section = ""
    if documents_data:
        data_doc_section = "\n\n**业务说明文档**:\n" + "\n\n---\n\n".join(documents_data) + "\n"

    user_prompt = f"""你是一个企业本体建模专家。请基于以下真实数据的 profiling 结果，输出语义分析。

**本体名称**: {draft.get('name')}
**业务背景**: {draft.get('scope')}

**已解析的文件与字段**:
{"".join(tabular_files)}
{expert_section}{data_doc_section}
**程序自动检测到的潜在关系**:
{links_desc}

请按以下结构输出 JSON（不要输出其他内容，只输出 JSON 文本本身，不要使用 markdown 代码块包裹）：

{{
  "entities": [
    {{
      "name": "实体英文名",
      "label": "实体中文名",
      "description": "业务定义",
      "source_file": "来源文件",
      "properties": [
        {{ "name": "属性名", "type": "string|integer|float|date|boolean|enum", "is_key": true/false, "description": "业务含义" }}
      ]
    }}
  ],
  "relationships": [
    {{
      "name": "关系名",
      "from_entity": "起点实体",
      "to_entity": "终点实体",
      "type": "many_to_one|one_to_many|many_to_many",
      "description": "语义说明",
      "based_on": "依赖的列或检测到的关系"
    }}
  ],
  "questions": [
    {{
      "question": "向建模者确认的问题",
      "category": "entity|property|relationship|rule",
      "suggested": ["建议选项1", "建议选项2"]
    }}
  ],
  "summary": "一句话总结本体结构"
}}

要求：
1. 严格基于提供的实际数据，不编造不存在的实体或属性。
2. 实体命名用英文驼峰，label 用中文。
3. relationship 的 type 字段必须直接使用 profiling 中报告的基数（`cardinality` 字段），不要自行推断或改变方向。
4. relationship 的 description 字段请用自然语言描述，例如"客户可以下多个销售订单"、"一种物料可被多个采购订单引用"。不要用技术性表述。
5. 如果有不确定的地方，必须放入 questions 让建模者确认，不要在输出中猜测。questions 至少 3 个，必须是**数据驱动**的——每个问题必须基于 profiling 中实际存在的字段或检测到的关系。**绝对不要**提出 profiling 中没有任何依据的问题。每个问题必须指向具体的列名或关系名，用自然语言提问（如"customers.csv 的 region 列枚举值为华东/华南/西北，这是客户地域还是设备区域？"）。
6. questions 按重要性排序：①实体识别不确定的 ②关系基数不确定的 ③属性语义模糊的 ④业务规则待确认的。
7. 不要输出自由 SQL、表名、系统路径或任何可执行代码。
8. **不要使用 markdown 代码块包裹 JSON，不要任何前言后语，只输出 JSON 文本本身。**"""

    try:
        service = ModelProviderService(runtime_metadata_engine())
        completion = service._chat_for_ontology(user_prompt)
        text = _strip_to_json_text(completion.content)
        for attempt in range(2):
            if _is_parseable_json(text): break
            stronger = user_prompt + "\n\n【强制格式警告】你上次的回复无法被 JSON 解析。**本次必须**：\n- 只输出 JSON 文本本身，不要任何解释、前言、后语\n- 绝对不要使用 ```json 或 ``` 代码块\n- 不要在 JSON 外包含任何文字\n- 确保所有字符串内的换行符是 \\n 转义，不是真实换行"
            completion = service._chat_for_ontology(stronger)
            text = _strip_to_json_text(completion.content)
        return {
            "mode": completion.mode,
            "analysis": text,
            "provider": completion.provider,
            "model": completion.model_name,
        }
    except Exception as e:
        return {
            "mode": "mock",
            "analysis": str(e),
            "provider": "Mock Provider",
            "model": "ontologyops-mock",
        }


def _strip_to_json_text(content: str) -> str:
    s = (content or "").strip()
    if "```json" in s:
        s = re.sub(r"```json\s*", "", s)
        s = s.replace("```", "").strip()
    elif "```" in s:
        s = s.split("```", 1)[1].split("```", 1)[0].strip()
    elif "```" in s:
        s = s.split("```", 1)[1].split("```", 1)[0].strip()
    s = re.sub(r",(\s*[}\]])", r"\1", s)
    return s


def _is_parseable_json(text: str) -> bool:
    i = text.find("{")
    j = text.rfind("}")
    if i < 0 or j <= i:
        return False
    try:
        json.loads(text[i:j + 1])
        return True
    except Exception:
        return False


class RefineRequest(BaseModel):
    analysis: str  # raw LLM JSON text from analyze step
    answers: dict  # {question_id: answer}
    draft: dict


@router.post("/refine")
def refine_with_answers(request: RefineRequest):
    """Let LLM revise its ontology analysis based on user answers from QA."""
    answers_summary = "\n".join(
        f"  - Q: {qid[:40]} → A: {ans}" for qid, ans in request.answers.items()
    ) if request.answers else "用户未提供任何回答。"

    prompt = f"""之前你分析生成了一个本体结构的 JSON。现在建模者逐项回答了你的澄清问题。

**建模者的回答**：
{answers_summary}

请根据这些回答重新生成本体结构的 JSON。要求：
1. 按建模者的回答调整实体、属性和关系。
2. 如果回答确认某关系存在，保留它；如果回答跳过/拒绝某关系，移除它或标为候选。
3. 按之前的 JSON 结构输出（entities/properties/relationships/questions/summary）。
4. 只输出 JSON 文本，不要 markdown 围栏。"""

    try:
        service = ModelProviderService(runtime_metadata_engine())
        completion = service._chat_for_ontology(prompt)
        return {
            "mode": completion.mode,
            "analysis": completion.content,
            "provider": completion.provider,
            "model": completion.model_name,
        }
    except Exception as e:
        return {"mode": "mock", "analysis": str(e), "provider": "Mock Provider", "model": "ontologyops-mock"}


class SaveOntologyRequest(BaseModel):
    id: str
    name: str
    scope: str
    status: str = "draft"
    version: str = "0.1"
    objects: int = 0
    links: int = 0
    rules: int = 0
    entities: list[dict] = []
    relationships: list[dict] = []


@router.post("/list")
def save_user_ontology(request: SaveOntologyRequest) -> dict[str, object]:
    """Persist a user-created ontology to SQLite."""
    engine = runtime_metadata_engine()
    with Session(engine) as session:
        existing = session.get(UserOntology, request.id)
        if existing:
            existing.name = request.name
            existing.scope = request.scope
            existing.status = request.status
            existing.version = request.version
            existing.objects = request.objects
            existing.links = request.links
            existing.rules = request.rules
            existing.entities_json = json.dumps(request.entities, ensure_ascii=False)
            existing.relationships_json = json.dumps(request.relationships, ensure_ascii=False)
        else:
            onto = UserOntology(
                id=request.id,
                name=request.name,
                scope=request.scope,
                status=request.status,
                version=request.version,
                objects=request.objects,
                links=request.links,
                rules=request.rules,
                entities_json=json.dumps(request.entities, ensure_ascii=False),
                relationships_json=json.dumps(request.relationships, ensure_ascii=False),
            )
            session.add(onto)
        session.commit()
    return {"status": "saved", "id": request.id}


@router.get("/list")
def list_user_ontologies() -> dict[str, object]:
    """Load all user-created ontologies from SQLite."""
    engine = runtime_metadata_engine()
    with Session(engine) as session:
        items = session.scalars(
            select(UserOntology).order_by(UserOntology.created_at.desc())
        ).all()
        ontologies = []
        for item in items:
            ontologies.append({
                "id": item.id,
                "name": item.name,
                "scope": item.scope,
                "status": item.status,
                "version": item.version,
                "objects": item.objects,
                "links": item.links,
                "rules": item.rules,
                "updated": item.created_at.strftime("%Y-%m-%d %H:%M") if item.created_at else "刚刚",
                "entities": json.loads(item.entities_json),
                "relationships": json.loads(item.relationships_json),
            })
        return {"ontologies": ontologies}


class DeleteOntologyRequest(BaseModel):
    id: str


@router.post("/list/delete")
def delete_user_ontology(request: DeleteOntologyRequest) -> dict[str, str]:
    """Delete a user-created ontology by id."""
    engine = runtime_metadata_engine()
    with Session(engine) as session:
        item = session.get(UserOntology, request.id)
        if item is None:
            raise HTTPException(status_code=404, detail="Ontology not found")
        session.delete(item)
        session.commit()
    return {"status": "deleted", "id": request.id}
