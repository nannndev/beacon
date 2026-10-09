import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import EndpointEditor from './EndpointEditor'
import type { TestConfig } from '../types'
import { api } from '../lib/api'


const config: TestConfig = {
  base_url: '',
  variables: {},
  tests: [],
}


describe('EndpointEditor Web Page target', () => {
  it('applies a safe document-load preset and explains the browser boundary', async () => {
    const user = userEvent.setup()
    render(
      <EndpointEditor
        testId={null}
        config={config}
        currentProjectName="Demo"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Web HTML load/i }))

    expect(screen.getByPlaceholderText('Endpoint name')).toHaveValue('Website homepage')
    expect(screen.getByPlaceholderText('https://example.com/')).toHaveValue('https://example.com/')
    expect(screen.getByRole('button', { name: 'POST' })).toBeDisabled()
    expect(screen.queryByDisplayValue('Content-Type')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Accept')).toBeInTheDocument()
    expect(screen.getByText(/does not execute JavaScript or download page assets/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Web HTML load/i })).toHaveAttribute('aria-pressed', 'true')
  })
})


describe('EndpointEditor authorization', () => {
  const renderEditor = () =>
    render(
      <EndpointEditor
        testId={null}
        config={config}
        currentProjectName="Demo"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

  it('collects Basic credentials separately instead of a single fake variable', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.selectOptions(screen.getByLabelText('Auth type'), 'basic')

    // The old editor emitted `Basic {{username:password}}` — an unencoded
    // header referencing a variable name that can never resolve.
    expect(screen.getByPlaceholderText('{{username}}')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('{{password}}')).toBeInTheDocument()
    expect(screen.queryByText(/username:password/)).not.toBeInTheDocument()
    expect(screen.getByText(/encoded at\s+request time/i)).toBeInTheDocument()
  })

  it('describes inheritance as coming from the folder or project', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.selectOptions(screen.getByLabelText('Auth type'), 'inherit')

    // Previously this claimed auth came from the environment, which nothing
    // in the backend implemented.
    expect(screen.getByText(/enclosing folder/i)).toBeInTheDocument()
    expect(screen.queryByText(/from the active environment/i)).not.toBeInTheDocument()
  })

  it('previews the bearer header it will send', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.selectOptions(screen.getByLabelText('Auth type'), 'bearer')

    expect(screen.getByText('Authorization: Bearer {{access_token}}')).toBeInTheDocument()
  })
})


describe('EndpointEditor unsaved changes', () => {
  const saved = {
    id: 'e1', name: 'Get user', url: '/users/1', method: 'GET',
    headers: {}, payload: {}, payload_type: 'json', extractors: {}, target_type: 'api',
  }
  const savedConfig = { ...config, tests: [saved] } as unknown as TestConfig

  it('flags edits and asks before discarding them', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EndpointEditor testId="e1" config={savedConfig} onClose={onClose} onSave={vi.fn()} />)

    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Endpoint name'), ' v2')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes immediately when nothing changed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EndpointEditor testId="e1" config={savedConfig} onClose={onClose} onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sends the on-screen edits as a draft', async () => {
    const user = userEvent.setup()
    const sendOnce = vi.spyOn(api, 'sendOnce').mockResolvedValue({ ok: true, status: 200, time_ms: 1 } as any)
    render(<EndpointEditor testId="e1" config={savedConfig} onClose={vi.fn()} onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /^Send$/ }))
    expect(sendOnce).toHaveBeenLastCalledWith('e1', {})

    await user.type(screen.getByPlaceholderText('Endpoint name'), ' v2')
    await user.click(screen.getByRole('button', { name: /^Send$/ }))
    expect(sendOnce).toHaveBeenLastCalledWith('e1', { draft: expect.objectContaining({ name: 'Get user v2', url: '/users/1' }) })
    sendOnce.mockRestore()
  })

  it('keeps its draft when another endpoint in the config changes', async () => {
    const user = userEvent.setup()
    const other = { ...saved, id: 'e2', name: 'Other' }
    const { rerender } = render(
      <EndpointEditor testId="e1" config={{ ...config, tests: [saved, other] } as unknown as TestConfig} onClose={vi.fn()} onSave={vi.fn()} />,
    )
    await user.type(screen.getByPlaceholderText('Endpoint name'), ' v2')

    rerender(
      <EndpointEditor testId="e1" config={{ ...config, tests: [saved, { ...other, name: 'Renamed elsewhere' }] } as unknown as TestConfig} onClose={vi.fn()} onSave={vi.fn()} />,
    )
    expect(screen.getByPlaceholderText('Endpoint name')).toHaveValue('Get user v2')
  })

  it('reports dirty state and ignores shortcuts while in a background tab', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    const sendOnce = vi.spyOn(api, 'sendOnce').mockResolvedValue({ ok: true, status: 200, time_ms: 1 } as any)
    render(<EndpointEditor testId="e1" config={savedConfig} onClose={vi.fn()} onSave={vi.fn()} active={false} onDirtyChange={onDirtyChange} />)

    await user.type(screen.getByPlaceholderText('Endpoint name'), 'x')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(sendOnce).not.toHaveBeenCalled()
    sendOnce.mockRestore()
  })

  it('reloads a saved GraphQL query instead of showing it empty', () => {
    const gql = { ...saved, method: 'POST', payload_type: 'graphql', payload: { query: '{ viewer { id } }', variables: { first: 2 } } }
    render(
      <EndpointEditor
        testId="e1"
        config={{ ...config, tests: [gql] } as unknown as TestConfig}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('{ viewer { id } }')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument()
  })
})
