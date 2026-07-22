from fastapi import FastAPI

from app.api.data_sources import dataset_router, router as data_sources_router
from app.api.ontology import router as ontology_router
from app.api.agent import router as agent_router
from app.api.governance import router as governance_router
from app.api.models import router as models_router
from app.api.pipelines import router as pipelines_router
from app.api.overview import router as overview_router
from app.api.resources import router as resources_router


app = FastAPI(title="OntologyOps API")
app.include_router(data_sources_router)
app.include_router(dataset_router)
app.include_router(ontology_router)
app.include_router(agent_router)
app.include_router(governance_router)
app.include_router(models_router)
app.include_router(pipelines_router)
app.include_router(overview_router)
app.include_router(resources_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
