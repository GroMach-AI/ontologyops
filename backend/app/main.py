from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

# Auto-load persisted local secrets (.env) at startup so model API keys
# survive backend restarts. The env file is written by /api/models/{id}/local-secret.
_env_file = Path(os.getenv("ONTOLOGYOPS_ENV_FILE", "../.env")).resolve()
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

from app.api.data_sources import dataset_router, router as data_sources_router
from app.api.agent import router as agent_router
from app.api.governance import router as governance_router
from app.api.models import router as models_router
from app.api.ontology_drafts import router as ontology_drafts_router
from app.api.pipelines import router as pipelines_router
from app.api.overview import router as overview_router
from app.api.resources import router as resources_router


app = FastAPI(title="OntologyOps API")
app.include_router(data_sources_router)
app.include_router(dataset_router)
app.include_router(agent_router)
app.include_router(governance_router)
app.include_router(models_router)
app.include_router(ontology_drafts_router)
app.include_router(pipelines_router)
app.include_router(overview_router)
app.include_router(resources_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
