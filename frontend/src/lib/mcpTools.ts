// Catalog of the tools the Beacon MCP server exposes to a connected AI agent.
// Mirrors backend/app/mcp_server.py — keep in sync when tools are added there.
// Surfaced on the MCP page so users can see exactly what their agent can do.
import type { LucideIcon } from 'lucide-react'
import {
  FolderKanban, List, Info, Plus, Trash2, FolderPlus, Play, Send,
  Workflow, Download, Terminal, ListTree, Pencil, Copy, FolderPen,
  FolderMinus, Move,
} from 'lucide-react'

export interface McpTool {
  name: string
  desc: string
  icon: LucideIcon
}

export interface McpToolGroup {
  label: string
  tools: McpTool[]
}

export const MCP_TOOL_GROUPS: McpToolGroup[] = [
  {
    label: 'Discover',
    tools: [
      { name: 'list_projects', desc: 'List all projects in the workspace.', icon: FolderKanban },
      { name: 'list_endpoints', desc: 'List every endpoint in the active project.', icon: List },
      { name: 'get_config', desc: "The active project's base URL, variables, and endpoint count.", icon: Info },
      { name: 'get_tree', desc: 'The full folder/endpoint tree with ids and methods.', icon: ListTree },
    ],
  },
  {
    label: 'Author endpoints',
    tools: [
      { name: 'create_endpoint', desc: 'Create an endpoint (URL, method, headers, body).', icon: Plus },
      { name: 'update_endpoint', desc: 'Edit fields of an existing endpoint.', icon: Pencil },
      { name: 'duplicate_endpoint', desc: 'Clone an endpoint as a new copy.', icon: Copy },
      { name: 'delete_endpoint', desc: 'Remove an endpoint.', icon: Trash2 },
      { name: 'add_endpoint_from_curl', desc: 'Create an endpoint from a curl command.', icon: Terminal },
    ],
  },
  {
    label: 'Organize',
    tools: [
      { name: 'create_folder', desc: 'Create a folder to group endpoints.', icon: FolderPlus },
      { name: 'rename_folder', desc: 'Rename a folder.', icon: FolderPen },
      { name: 'delete_folder', desc: 'Delete a folder (optionally with contents).', icon: FolderMinus },
      { name: 'move_item', desc: 'Move or reorder an endpoint/folder.', icon: Move },
      { name: 'import_collection', desc: 'Import Postman/OpenAPI/HAR collections.', icon: Download },
    ],
  },
  {
    label: 'Run & test',
    tools: [
      { name: 'send_request', desc: 'Send one request and inspect the full response.', icon: Send },
      { name: 'run_endpoint', desc: 'Fire an endpoint N times, optionally concurrently.', icon: Play },
      { name: 'run_scenario', desc: 'Run endpoints in order as a chained flow.', icon: Workflow },
    ],
  },
]

export const MCP_TOOL_COUNT = MCP_TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0)
