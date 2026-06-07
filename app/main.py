
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "buckettrail.db"

app = FastAPI(title="BucketTrail API")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


class Place(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    cat: Literal["see", "do", "eat", "hotel"]
    emoji: str
    lat: float
    lng: float
    addr: str = ""
    notes: str = ""
    url: str = ""
    done: bool = False


class Trip(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    type: Literal["day", "overnight"]
    date: str = ""
    notes: str = ""
    placeIds: list[str] = Field(default_factory=list)
    hotelIds: list[str] = Field(default_factory=list)
    done: bool = False
    doneDate: str = ""
    visited: dict[str, bool] = Field(default_factory=dict)


class AppState(BaseModel):
    places: list[Place] = Field(default_factory=list)
    trips: list[Trip] = Field(default_factory=list)


def get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO app_state (id, data_json, updated_at)
            VALUES (1, ?, ?)
            """,
            (json.dumps({"places": [], "trips": []}), datetime.now(timezone.utc).isoformat()),
        )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/")
def index() -> FileResponse:
    return FileResponse("app/static/index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/state", response_model=AppState)
def get_state() -> AppState:
    init_db()
    with get_conn() as conn:
        row = conn.execute("SELECT data_json FROM app_state WHERE id = 1").fetchone()
    if not row:
        return AppState()
    try:
        return AppState.model_validate_json(row["data_json"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Stored state is invalid") from exc


@app.put("/api/state", response_model=AppState)
def put_state(state: AppState) -> AppState:
    init_db()
    payload = state.model_dump()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE app_state
            SET data_json = ?, updated_at = ?
            WHERE id = 1
            """,
            (json.dumps(payload, ensure_ascii=False), datetime.now(timezone.utc).isoformat()),
        )
    return state
