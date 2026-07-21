import { useCallback, useEffect, useState } from 'react'


export type AppView = 'workspace' | 'history' | 'mcp'

export function parseAppView(pathname: string, search: string): { view: AppView; runId: string | null } {
  const params = new URLSearchParams(search)
  if (pathname === '/history') return { view: 'history', runId: params.get('run') }
  if (pathname === '/mcp') return { view: 'mcp', runId: null }
  return { view: 'workspace', runId: null }
}

export function withHistoryStep(
  payload: Record<string, unknown>,
  historyId: string,
  stepIndex: number,
): Record<string, unknown> {
  return { ...payload, history_id: historyId, history_step_index: stepIndex }
}

export function useAppView() {
  const read = () => parseAppView(window.location.pathname, window.location.search)
  const [state, setState] = useState(read)

  useEffect(() => {
    const onPopState = () => setState(read())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((view: AppView, runId?: string | null) => {
    const url = view === 'history'
      ? `/history${runId ? `?run=${encodeURIComponent(runId)}` : ''}`
      : view === 'mcp'
        ? '/mcp'
        : '/'
    window.history.pushState({}, '', url)
    setState({ view, runId: view === 'history' ? runId || null : null })
  }, [])

  return {
    ...state,
    openHistory: (runId?: string | null) => navigate('history', runId),
    openWorkspace: () => navigate('workspace'),
    openMcp: () => navigate('mcp'),
  }
}
