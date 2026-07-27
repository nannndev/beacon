from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass(frozen=True)
class Mutation:
    mutation_id: str
    project_id: str
    base_revision: int
    operation: str
    target_id: Optional[str]
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Revision:
    id: str
    project_id: str
    revision: int
    base_revision: int
    mutation_id: str
    actor_device_id: str
    actor_device_name: Optional[str]
    actor_device_ip: Optional[str]
    operation: str
    target_type: str
    target_id: Optional[str]
    summary: str
    patch: dict[str, Any]
    created_at: str


class MutationConflict(Exception):
    def __init__(self, current_revision: int, target_id: Optional[str], latest_entity=None):
        super().__init__("Project source changed since this edit was created")
        self.current_revision = current_revision
        self.target_id = target_id
        self.latest_entity = latest_entity

    def to_dict(self) -> dict:
        return {
            "error": "revision_conflict",
            "current_revision": self.current_revision,
            "target_id": self.target_id,
            "latest_entity": self.latest_entity,
        }
