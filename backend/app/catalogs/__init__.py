"""Built-in project catalogs."""

from .jsonplaceholder import (
    JSONPLACEHOLDER_TEMPLATE_ID,
    build_jsonplaceholder_project,
    stable_catalog_id,
)

__all__ = [
    "JSONPLACEHOLDER_TEMPLATE_ID",
    "build_jsonplaceholder_project",
    "stable_catalog_id",
]
