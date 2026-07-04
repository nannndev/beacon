import os

import PyInstaller.__main__

if __name__ == "__main__":
    PyInstaller.__main__.run([
        "run.py",
        "--onefile",
        "--name", "backend",
        "--clean",
        "--noconfirm",
        "--log-level", "INFO",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--add-data", f"app{os.pathsep}app",
    ])

    PyInstaller.__main__.run([
        "run_mcp.py",
        "--onefile",
        "--name", "mcp_server",
        "--clean",
        "--noconfirm",
        "--log-level", "INFO",
        "--add-data", f"app{os.pathsep}app",
    ])

    print("\nBackend + MCP server built as dist/backend and dist/mcp_server")
    print("(.exe on Windows). Run `npm run desktop:prepare` from frontend/ to")
    print("copy them into src-tauri/ with the required <target-triple> suffix.")
