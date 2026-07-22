from io import BytesIO

import pandas as pd
from fastapi.testclient import TestClient

from app.main import app


def test_excel_upload_runs_fixed_pipeline(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path))
    buffer = BytesIO()
    pd.DataFrame([{"order_number": "PO-1", "quantity": 2}]).to_excel(buffer, index=False)
    client = TestClient(app)

    response = client.post(
        "/api/sources/upload",
        files={
            "file": (
                "orders.xlsx",
                buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "ready"
    run = client.post(f"/api/pipelines/{response.json()['pipeline_id']}/run", json={})
    assert run.status_code == 200
    assert run.json()["preview"]["row_count"] == 1
    assert run.json()["nodes"][1]["type"] == "raw_dataset"
