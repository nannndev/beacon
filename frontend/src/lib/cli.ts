import { isDesktop } from './platform'


export async function getCliPath(): Promise<string> {
  if (!isDesktop()) return ''
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('cli_path')
}
