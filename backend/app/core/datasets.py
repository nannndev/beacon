"""Test data for data-driven runs.

A dataset is a list of rows (column -> string value) parsed from CSV or JSON.
During a load run every request takes the next row; during a scenario every
virtual-user journey takes one. A row's values are visible as {{column}}
variables for that request or journey only; they never overwrite the
environment.

Datasets are supplied with the run rather than stored in the project, so a
large file never ends up in the project YAML or in Git.
"""
from __future__ import annotations

import csv
import io
import json
import random
import threading
from typing import Any, Dict, List, Optional, Tuple

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 100_000
MODES = ("sequential", "random")

Row = Dict[str, str]


class DatasetError(ValueError):
    """The dataset could not be parsed; the message is shown to the user."""


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"))
    return str(value)


def _parse_json(text: str) -> List[Row]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise DatasetError(f"Invalid JSON (line {error.lineno}): {error.msg}") from None
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        data = data["rows"]
    if not isinstance(data, list):
        raise DatasetError("JSON test data must be an array of objects")
    rows = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            raise DatasetError(f"JSON row {index} is not an object")
        rows.append({str(key).strip(): _cell(value) for key, value in item.items() if str(key).strip()})
    return rows


def _parse_csv(text: str) -> List[Row]:
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    try:
        header = next(reader)
    except StopIteration:
        return []
    columns = [name.strip() for name in header]
    if not any(columns):
        raise DatasetError("The CSV header row is empty")
    if len(set(c for c in columns if c)) != len([c for c in columns if c]):
        raise DatasetError("The CSV header has duplicate column names")
    rows = []
    for values in reader:
        if not any(value.strip() for value in values):
            continue  # blank line
        rows.append({
            column: (values[i] if i < len(values) else "")
            for i, column in enumerate(columns) if column
        })
        if len(rows) > MAX_ROWS:
            break
    return rows


def parse_dataset(text: str, data_format: Optional[str] = None) -> List[Row]:
    """Parse CSV or JSON test data. The format is detected when not given."""
    if not isinstance(text, str):
        raise DatasetError("Test data must be text")
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise DatasetError(f"Test data is larger than {MAX_BYTES // (1024 * 1024)} MB")
    text = text.lstrip("﻿")
    fmt = (data_format or "").lower()
    if fmt not in ("csv", "json"):
        fmt = "json" if text.lstrip()[:1] in ("[", "{") else "csv"
    rows = _parse_json(text) if fmt == "json" else _parse_csv(text)
    if not rows:
        raise DatasetError("Test data has no rows")
    if len(rows) > MAX_ROWS:
        raise DatasetError(f"Test data has more than {MAX_ROWS:,} rows")
    return rows


def summarize(rows: List[Row], preview: int = 5) -> dict:
    columns: List[str] = []
    for row in rows:
        for column in row:
            if column not in columns:
                columns.append(column)
    return {"rows": len(rows), "columns": columns, "preview": rows[:preview]}


class DataFeeder:
    """Hands out rows to concurrent workers, in order (wrapping around) or at
    random. Returns (row_number, row) with row_number starting at 1."""

    def __init__(self, rows: List[Row], mode: str = "sequential", seed: Optional[int] = None):
        if not rows:
            raise DatasetError("Test data has no rows")
        self.rows = rows
        self.mode = mode if mode in MODES else "sequential"
        self._lock = threading.Lock()
        self._next = 0
        self._random = random.Random(seed)

    def next(self) -> Tuple[int, Row]:
        with self._lock:
            if self.mode == "random":
                index = self._random.randrange(len(self.rows))
            else:
                index = self._next % len(self.rows)
                self._next += 1
        return index + 1, self.rows[index]


def feeder_from_request(data: Any) -> Optional[DataFeeder]:
    """Build a feeder from a run request's optional `dataset` object:
    {"text": "...", "format": "csv"|"json", "mode": "sequential"|"random"}
    or {"rows": [...], "mode": ...}. Raises DatasetError on bad input."""
    if not isinstance(data, dict):
        return None
    spec = data.get("dataset")
    if spec in (None, {}, ""):
        return None
    if not isinstance(spec, dict):
        raise DatasetError("dataset must be an object")
    if isinstance(spec.get("rows"), list):
        rows = _parse_json(json.dumps(spec["rows"]))
        if not rows:
            raise DatasetError("Test data has no rows")
    else:
        rows = parse_dataset(spec.get("text") or "", spec.get("format"))
    return DataFeeder(rows, str(spec.get("mode") or "sequential").lower())
