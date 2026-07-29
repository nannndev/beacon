import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ImportDialog } from './ImportDialog'

describe('ImportDialog', () => {
  it('allows a direct import when the preview endpoint is unavailable', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined)
    const onPreview = vi.fn().mockRejectedValue(new Error('Not Found'))

    render(
      <ImportDialog
        open
        onOpenChange={vi.fn()}
        onImport={onImport}
        onPreview={onPreview}
        onOpenExistingFolder={vi.fn()}
        onCloneRepository={vi.fn()}
        onImportRepositoryCandidate={vi.fn()}
        onInitializeRepository={vi.fn()}
        fetchTemplate={vi.fn().mockResolvedValue({
          openapi: '3.0.3',
          info: { title: 'Demo' },
          paths: {},
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /load template/i }))

    expect(await screen.findByText(/Preview unavailable: Not Found/i)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Import project' })
    expect(submit).toBeEnabled()

    fireEvent.click(submit)
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('openapi'),
    })))
  })

  it('clones and opens a Git-backed project from the import dialog', async () => {
    const user = userEvent.setup()
    const onCloneRepository = vi.fn().mockResolvedValue({
      mode: 'opened', project_id: 'project-1', project_name: 'Checkout API', path: '/tmp/projects/checkout-api',
      missing_private_values: [],
    })
    const onOpenChange = vi.fn()

    render(
      <ImportDialog
        open
        onOpenChange={onOpenChange}
        onImport={vi.fn()}
        onPreview={vi.fn()}
        onOpenExistingFolder={vi.fn()}
        onCloneRepository={onCloneRepository}
        onImportRepositoryCandidate={vi.fn()}
        onInitializeRepository={vi.fn()}
        fetchTemplate={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /git repo/i }))
    fireEvent.change(screen.getByPlaceholderText('git@github.com:team/api-project.git'), {
      target: { value: 'git@github.com:team/checkout-api.git' },
    })
    fireEvent.change(screen.getByPlaceholderText('/Users/you/Projects'), {
      target: { value: '/tmp/projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /clone & inspect/i }))

    await waitFor(() => expect(onCloneRepository).toHaveBeenCalledWith(
      'git@github.com:team/checkout-api.git',
      '/tmp/projects',
    ))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens a folder containing an existing Beacon project', async () => {
    const user = userEvent.setup()
    const onOpenExistingFolder = vi.fn().mockResolvedValue(undefined)

    render(
      <ImportDialog
        open
        onOpenChange={vi.fn()}
        onImport={vi.fn()}
        onPreview={vi.fn()}
        onOpenExistingFolder={onOpenExistingFolder}
        onCloneRepository={vi.fn()}
        onImportRepositoryCandidate={vi.fn()}
        onInitializeRepository={vi.fn()}
        fetchTemplate={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /folder/i }))
    fireEvent.change(screen.getByPlaceholderText('/Users/you/Projects/team-api'), {
      target: { value: '/tmp/team-api' },
    })
    fireEvent.click(screen.getByRole('button', { name: /open project/i }))

    await waitFor(() => expect(onOpenExistingFolder).toHaveBeenCalledWith('/tmp/team-api'))
  })

  it('shows discovered API definitions and imports the selected candidate', async () => {
    const user = userEvent.setup()
    const onImportRepositoryCandidate = vi.fn().mockResolvedValue(undefined)
    const onCloneRepository = vi.fn().mockResolvedValue({
      mode: 'inspection_required',
      inspection_mode: 'import_candidates',
      cloned_path: '/tmp/checkout-api',
      repository_path: '/tmp/checkout-api',
      repository_name: 'checkout-api',
      candidates: [{
        path: 'docs/openapi.yaml', format: 'openapi3', format_label: 'OpenAPI 3', warnings: [],
        summary: { name: 'Checkout API', endpoints: 8, folders: 2, environments: 1, warnings: 0 },
      }],
    })

    render(
      <ImportDialog
        open
        onOpenChange={vi.fn()}
        onImport={vi.fn()}
        onPreview={vi.fn()}
        onOpenExistingFolder={vi.fn()}
        onCloneRepository={onCloneRepository}
        onImportRepositoryCandidate={onImportRepositoryCandidate}
        onInitializeRepository={vi.fn()}
        fetchTemplate={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /git repo/i }))
    await user.type(screen.getByPlaceholderText('git@github.com:team/api-project.git'), 'git@github.com:team/checkout-api.git')
    await user.type(screen.getByPlaceholderText('/Users/you/Projects'), '/tmp')
    await user.click(screen.getByRole('button', { name: /clone & inspect/i }))

    expect(await screen.findByText('docs/openapi.yaml')).toBeInTheDocument()
    expect(screen.getByText(/8 endpoints/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /import selected api/i }))

    await waitFor(() => expect(onImportRepositoryCandidate).toHaveBeenCalledWith(
      '/tmp/checkout-api', 'docs/openapi.yaml',
    ))
  })
})
