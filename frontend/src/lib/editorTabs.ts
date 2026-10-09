// Open request-editor tabs. Pure helpers so the open/close/activate rules are
// testable without rendering the app.

export interface EditorTab {
  key: string
  /** null while the tab holds a not-yet-saved new endpoint. */
  testId: string | null
  /** Folder a new endpoint is created in, if any. */
  folderId: string | null
}

export interface EditorTabsState {
  tabs: EditorTab[]
  /** null shows the workspace (endpoint list) instead of an editor. */
  activeKey: string | null
}

export const emptyTabs: EditorTabsState = { tabs: [], activeKey: null }

let newTabCounter = 0

export function openEndpointTab(state: EditorTabsState, testId: string): EditorTabsState {
  const existing = state.tabs.find((tab) => tab.testId === testId)
  if (existing) return { ...state, activeKey: existing.key }
  const tab: EditorTab = { key: `endpoint:${testId}`, testId, folderId: null }
  return { tabs: [...state.tabs, tab], activeKey: tab.key }
}

export function openNewTab(state: EditorTabsState, folderId: string | null = null): EditorTabsState {
  newTabCounter += 1
  const tab: EditorTab = { key: `new:${Date.now()}:${newTabCounter}`, testId: null, folderId }
  return { tabs: [...state.tabs, tab], activeKey: tab.key }
}

/** Close a tab; when it was active, focus its right neighbour, else its left
 *  one, else the workspace. */
export function closeTab(state: EditorTabsState, key: string): EditorTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key)
  if (index === -1) return state
  const tabs = state.tabs.filter((tab) => tab.key !== key)
  if (state.activeKey !== key) return { tabs, activeKey: state.activeKey }
  const neighbour = tabs[index] || tabs[index - 1]
  return { tabs, activeKey: neighbour ? neighbour.key : null }
}

export function activateTab(state: EditorTabsState, key: string | null): EditorTabsState {
  if (key !== null && !state.tabs.some((tab) => tab.key === key)) return state
  return { ...state, activeKey: key }
}

/** Drop tabs whose endpoint no longer exists (deleted, or another project). */
export function pruneTabs(state: EditorTabsState, existingIds: Set<string>): EditorTabsState {
  let next = state
  for (const tab of state.tabs) {
    if (tab.testId && !existingIds.has(tab.testId)) next = closeTab(next, tab.key)
  }
  return next
}
