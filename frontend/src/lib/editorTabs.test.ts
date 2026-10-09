import { describe, expect, it } from 'vitest'

import { activateTab, closeTab, emptyTabs, openEndpointTab, openNewTab, pruneTabs } from './editorTabs'

describe('editor tabs', () => {
  it('reuses an already open endpoint tab', () => {
    let state = openEndpointTab(emptyTabs, 'a')
    state = openEndpointTab(state, 'b')
    state = openEndpointTab(state, 'a')
    expect(state.tabs.map((tab) => tab.testId)).toEqual(['a', 'b'])
    expect(state.activeKey).toBe('endpoint:a')
  })

  it('opens a separate tab for every new endpoint, keeping its folder', () => {
    const state = openNewTab(openNewTab(emptyTabs), 'folder-1')
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs[1]).toMatchObject({ testId: null, folderId: 'folder-1' })
    expect(state.activeKey).toBe(state.tabs[1].key)
  })

  it('focuses the right neighbour, then the left one, then the workspace on close', () => {
    let state = ['a', 'b', 'c'].reduce(openEndpointTab, emptyTabs)
    state = activateTab(state, 'endpoint:b')
    state = closeTab(state, 'endpoint:b')
    expect(state.activeKey).toBe('endpoint:c')
    state = closeTab(state, 'endpoint:c')
    expect(state.activeKey).toBe('endpoint:a')
    state = closeTab(state, 'endpoint:a')
    expect(state).toEqual({ tabs: [], activeKey: null })
  })

  it('keeps the active tab when closing a background one', () => {
    let state = ['a', 'b'].reduce(openEndpointTab, emptyTabs)
    state = closeTab(state, 'endpoint:a')
    expect(state.activeKey).toBe('endpoint:b')
  })

  it('prunes tabs for deleted endpoints but keeps unsaved new ones', () => {
    let state = openNewTab(['a', 'b'].reduce(openEndpointTab, emptyTabs))
    state = pruneTabs(state, new Set(['b']))
    expect(state.tabs.map((tab) => tab.testId)).toEqual(['b', null])
  })

  it('ignores activation of unknown tabs', () => {
    const state = openEndpointTab(emptyTabs, 'a')
    expect(activateTab(state, 'missing')).toBe(state)
    expect(activateTab(state, null).activeKey).toBeNull()
  })
})
