from copy import deepcopy

from backend.app.repository import Repository


class MemoryRepository(Repository):
    def __init__(self, data=None):
        self.data = deepcopy(data)

    def load(self):
        return deepcopy(self.data)

    def save(self, data):
        self.data = deepcopy(data)


def flatten_requests(items):
    result = []
    for item in items or []:
        if item.get("type") == "request":
            result.append(item)
        else:
            result.extend(flatten_requests(item.get("items", [])))
    return result
