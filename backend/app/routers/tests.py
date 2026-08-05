from fastapi import APIRouter, HTTPException

from ..core.tester import EndpointTest
from ..state import store

router = APIRouter(tags=["endpoints"])


@router.get("/tests")
def get_tests():
    return store.current_config.tests


def _parse_endpoint(test_data: dict) -> EndpointTest:
    """Build an EndpointTest from a request body, turning bad input into a
    clear HTTP 400 instead of an unhandled 500."""
    if not isinstance(test_data, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    try:
        return EndpointTest.from_dict(test_data)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Missing required field: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid endpoint: {e}")


@router.post("/tests")
def add_test(test_data: dict):
    test = _parse_endpoint(test_data)
    store.current_config.tests.append(test)
    store.save()
    return test.to_dict()


@router.put("/tests/{test_id}")
def update_test(test_id: str, test_data: dict):
    for i, t in enumerate(store.current_config.tests):
        if t.id == test_id:
            store.current_config.tests[i] = _parse_endpoint(test_data)
            store.save()
            return store.current_config.tests[i].to_dict()
    raise HTTPException(status_code=404, detail="Endpoint not found")


@router.delete("/tests/{test_id}")
def delete_test(test_id: str):
    store.current_config.tests = [t for t in store.current_config.tests if t.id != test_id]
    store.save()
    return {"status": "deleted"}


@router.post("/tests/{test_id}/duplicate")
def duplicate_test(test_id: str):
    orig = next((t for t in store.current_config.tests if t.id == test_id), None)
    if not orig:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    new_test = EndpointTest(
        None,
        f"{orig.name} (copy)",
        orig.url,
        orig.method,
        dict(orig.headers),
        dict(orig.payload),
        orig.payload_type,
        dict(orig.extractors),
        dict(orig.run_config) if orig.run_config else None,
        list(orig.assertions),
        orig.target_type,
        dict(orig.auth) if orig.auth else None,
        dict(orig.mock_response) if getattr(orig, "mock_response", None) else None,
    )
    new_test.inherited_auth = list(getattr(orig, "inherited_auth", []))
    store.current_config.tests.append(new_test)
    store.save()
    return new_test.to_dict()
