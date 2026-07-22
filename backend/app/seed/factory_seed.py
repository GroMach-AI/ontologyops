from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import duckdb


@dataclass(frozen=True)
class SeedSummary:
    database_path: Path
    views: tuple[str, ...]
    rows: dict[str, int]


TABLES: tuple[str, ...] = (
    "suppliers",
    "materials",
    "purchase_orders",
    "purchase_order_lines",
    "inventory",
    "quality_inspections",
)


def seed_factory_demo(data_dir: Path) -> SeedSummary:
    data_dir.mkdir(parents=True, exist_ok=True)
    database_path = data_dir / "ontologyops.duckdb"
    if database_path.exists():
        database_path.unlink()

    connection = duckdb.connect(str(database_path))
    try:
        _create_schema(connection)
        _insert_seed_rows(connection)
        _export_parquet(connection, data_dir)
        rows = {
            table_name: connection.execute(
                f"SELECT COUNT(*) FROM {table_name}"
            ).fetchone()[0]
            for table_name in TABLES
        }
    finally:
        connection.close()

    return SeedSummary(database_path=database_path, views=TABLES, rows=rows)


def _create_schema(connection: duckdb.DuckDBPyConnection) -> None:
    connection.execute(
        """
        CREATE TABLE suppliers (
            supplier_id VARCHAR PRIMARY KEY,
            name VARCHAR,
            supplier_type VARCHAR,
            risk_level VARCHAR,
            on_time_delivery_rate DOUBLE,
            quality_pass_rate DOUBLE,
            contract_unit_price DOUBLE
        );
        CREATE TABLE materials (
            material_id VARCHAR PRIMARY KEY,
            code VARCHAR,
            name VARCHAR,
            category VARCHAR,
            safety_stock INTEGER,
            criticality VARCHAR
        );
        CREATE TABLE purchase_orders (
            purchase_order_id VARCHAR PRIMARY KEY,
            order_number VARCHAR,
            supplier_id VARCHAR,
            status VARCHAR,
            ordered_at DATE,
            promised_at DATE,
            delivered_at DATE,
            risk_level VARCHAR
        );
        CREATE TABLE purchase_order_lines (
            purchase_order_line_id VARCHAR PRIMARY KEY,
            purchase_order_id VARCHAR,
            material_id VARCHAR,
            quantity INTEGER,
            received_quantity INTEGER,
            delivery_status VARCHAR
        );
        CREATE TABLE inventory (
            inventory_id VARCHAR PRIMARY KEY,
            material_id VARCHAR,
            warehouse VARCHAR,
            quantity_on_hand INTEGER,
            safety_stock INTEGER,
            updated_at TIMESTAMP
        );
        CREATE TABLE quality_inspections (
            inspection_id VARCHAR PRIMARY KEY,
            purchase_order_id VARCHAR,
            supplier_id VARCHAR,
            material_id VARCHAR,
            inspected_at DATE,
            result VARCHAR,
            failure_reason VARCHAR,
            failed_quantity INTEGER
        );
        """
    )


def _insert_seed_rows(connection: duckdb.DuckDBPyConnection) -> None:
    connection.executemany(
        "INSERT INTO suppliers VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("SUP-001", "华东精铸", "铸造", "high", 0.72, 0.86, 188.0),
            ("SUP-002", "北辰电子", "电子", "medium", 0.91, 0.98, 72.5),
            ("SUP-003", "恒信五金", "五金", "low", 0.97, 0.99, 14.8),
        ],
    )
    connection.executemany(
        "INSERT INTO materials VALUES (?, ?, ?, ?, ?, ?)",
        [
            ("MAT-001", "M-ENG-01", "伺服电机", "核心部件", 80, "critical"),
            ("MAT-002", "M-CAS-02", "机身铸件", "结构件", 40, "high"),
            ("MAT-003", "M-SCR-03", "固定螺丝", "标准件", 500, "low"),
        ],
    )
    connection.executemany(
        "INSERT INTO purchase_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("PO-001", "PO-2026-001", "SUP-001", "open", "2026-06-02", "2026-06-18", None, "high"),
            ("PO-002", "PO-2026-002", "SUP-001", "closed", "2026-05-01", "2026-05-16", "2026-05-22", "medium"),
            ("PO-003", "PO-2026-003", "SUP-002", "open", "2026-06-12", "2026-06-28", None, "low"),
            ("PO-004", "PO-2026-004", "SUP-003", "closed", "2026-06-01", "2026-06-12", "2026-06-11", "low"),
        ],
    )
    connection.executemany(
        "INSERT INTO purchase_order_lines VALUES (?, ?, ?, ?, ?, ?)",
        [
            ("POL-001", "PO-001", "MAT-001", 120, 0, "overdue"),
            ("POL-002", "PO-002", "MAT-002", 60, 60, "late"),
            ("POL-003", "PO-003", "MAT-001", 80, 0, "on_track"),
            ("POL-004", "PO-004", "MAT-003", 1000, 1000, "on_time"),
        ],
    )
    connection.executemany(
        "INSERT INTO inventory VALUES (?, ?, ?, ?, ?, ?)",
        [
            ("INV-001", "MAT-001", "上海一号仓", 25, 80, "2026-06-20 09:00:00"),
            ("INV-002", "MAT-002", "上海一号仓", 95, 40, "2026-06-20 09:00:00"),
            ("INV-003", "MAT-003", "上海一号仓", 1200, 500, "2026-06-20 09:00:00"),
        ],
    )
    connection.executemany(
        "INSERT INTO quality_inspections VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("QI-001", "PO-002", "SUP-001", "MAT-002", "2026-05-23", "failed", "气孔超标", 8),
            ("QI-002", "PO-004", "SUP-003", "MAT-003", "2026-06-12", "passed", None, 0),
        ],
    )


def _export_parquet(connection: duckdb.DuckDBPyConnection, data_dir: Path) -> None:
    for table_name in TABLES:
        path = (data_dir / f"{table_name}.parquet").as_posix().replace("'", "''")
        connection.execute(f"COPY {table_name} TO '{path}' (FORMAT PARQUET)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--data-dir", default="../../data")
    args = parser.parse_args()
    summary = seed_factory_demo(Path(args.data_dir).resolve())
    print(f"Seeded {summary.database_path}")
    print(summary.rows)


if __name__ == "__main__":
    main()
