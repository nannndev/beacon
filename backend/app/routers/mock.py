from fastapi import APIRouter, Request, Response, HTTPException
from ..state import store
from ..core.templating import TemplateResolver

router = APIRouter()

@router.api_route("/mock/projects/{project_id}/{mock_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def mock_endpoint(project_id: str, mock_path: str, request: Request):
    """Catch-all API mock endpoint resolver.
    
    Looks up the project by ID, flattens its tree to find the endpoint matching
    both normalized url and HTTP method, and if mock mode is enabled, evaluates
    the mock response body through TemplateResolver.
    """
    # 1. Lookup the project
    project = next((p for p in store.projects if p.get("id") == project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 2. Find matching endpoint in current project configuration
    project_auth = project.get("auth")
    items = project.get("items")
    tests_data = []
    if items:
        tests_data = store._flatten_items(items, project_auth)
    else:
        tests_data = [
            {**test, "_inherited_auth": [project_auth] if project_auth else []}
            for test in project.get("tests", [])
        ]
        
    matching_endpoint = None
    req_path_normalized = mock_path.strip("/")
    req_method = request.method.upper()

    for data in tests_data:
        endpoint_url = str(data.get("url") or "").strip("/")
        endpoint_method = str(data.get("method") or "POST").upper()
        if endpoint_url == req_path_normalized and endpoint_method == req_method:
            matching_endpoint = data
            break

    if not matching_endpoint:
        raise HTTPException(
            status_code=404, 
            detail=f"No mock endpoint found matching {req_method} /{mock_path}"
        )

    # 3. Check if mock_response is defined and enabled
    mock_resp = matching_endpoint.get("mock_response")
    if not mock_resp or not mock_resp.get("enabled"):
        raise HTTPException(
            status_code=404,
            detail=f"Mock response is not enabled for {req_method} /{mock_path}"
        )

    # 4. Resolve variables in mock response body
    env = store.get_active_env(project)
    variables = {**store.global_variables, **env.get("variables", {})}
    
    resolver = TemplateResolver(variables)
    
    raw_body = mock_resp.get("body", "")
    resolved_body = resolver.resolve(raw_body)
    
    status_code = int(mock_resp.get("status", 200))
    headers = {k: resolver.resolve(v) for k, v in mock_resp.get("headers", {}).items()}
    
    media_type = headers.get("Content-Type") or headers.get("content-type") or "text/plain"
    
    return Response(
        content=resolved_body,
        status_code=status_code,
        headers=headers,
        media_type=media_type
    )
