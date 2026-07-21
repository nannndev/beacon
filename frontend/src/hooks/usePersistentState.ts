import { useEffect, useState } from 'react'

/**
 * useState backed by localStorage. Survives component unmount (e.g. navigating
 * to the History/MCP pages, which unmount the workspace tree) and app restarts,
 * so UI toggles like collapsed sections don't reset every time.
 */
export function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [key, state])

  return [state, setState]
}
