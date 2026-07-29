"""PyInstaller entry point for the packaged MCP server.

`app/mcp_server.py` uses package-relative imports (`from .core.tester import
...`), which fail when PyInstaller runs a module directly as a top-level
script. This launcher sits at the backend root and imports via absolute
package imports instead, then starts the MCP server (stdio transport by
default; BEACON_MCP_TRANSPORT can override). Storage path comes from the
BEACON_DATA_DIR env var the Tauri shell / client config injects.
"""
import multiprocessing

if __name__ == "__main__":
    # Required by PyInstaller one-file executables. Some MCP/AnyIO dependency
    # paths may initialize multiprocessing helpers during shutdown; without
    # this guard the frozen child re-enters stdio bootstrap after stdin closes
    # and prints a misleading "I/O operation on closed file" traceback.
    multiprocessing.freeze_support()
    from app.mcp_server import main

    main()
