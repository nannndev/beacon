import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import EndpointEditor from './EndpointEditor'
import type { TestConfig } from '../types'


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

    await user.click(screen.getByRole('button', { name: /Web Page HTML document load/i }))

    expect(screen.getByPlaceholderText('Endpoint name')).toHaveValue('Website homepage')
    expect(screen.getByPlaceholderText('https://example.com/')).toHaveValue('https://example.com/')
    expect(screen.getByRole('button', { name: 'POST' })).toBeDisabled()
    expect(screen.queryByDisplayValue('Content-Type')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Accept')).toBeInTheDocument()
    expect(screen.getByText(/does not execute JavaScript or download page assets/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Web Page HTML document load/i })).toHaveAttribute('aria-pressed', 'true')
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
