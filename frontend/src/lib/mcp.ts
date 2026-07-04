// Desktop-only wrappers around the Tauri MCP registration commands.
// Guarded by isDesktop(); calling on web throws (the dialog is never shown there).
import { isDesktop } from './platform'

export type ClientState =
  | 'registered'
  | 'not_registered'
  | 'config_not_found'
  | 'cli_missing'

export interface McpStatus {
  claude_desktop: ClientState
  claude_code: ClientState
}

async function invoker() {
  if (!isDesktop()) throw new Error('MCP registration is desktop-only')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke
}

export async function getMcpStatus(): Promise<McpStatus> {
  const invoke = await invoker()
  return invoke<McpStatus>('mcp_status')
}

export async function getMcpServerPath(): Promise<string> {
  const invoke = await invoker()
  return invoke<string>('mcp_server_path')
}

export async function registerClaudeDesktop(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_register_claude_desktop')
}

export async function unregisterClaudeDesktop(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_unregister_claude_desktop')
}

export async function registerClaudeCode(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_register_claude_code')
}

export async function unregisterClaudeCode(): Promise<void> {
  const invoke = await invoker()
  await invoke('mcp_unregister_claude_code')
}
