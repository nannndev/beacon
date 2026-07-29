import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSettingsPage } from './ProjectSettingsDialog'
import { api } from '../../lib/api'
import type { Project } from '../../types'

const project: Project = {
  id: 'project-1',
  name: 'Checkout API',
  environments: [],
  items: [],
}

describe('ProjectSettingsPage file sync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows external file changes and reloads them explicitly', async () => {
    vi.spyOn(api, 'projectFileSyncStatus').mockResolvedValue({
      linked: true,
      path: '/work/checkout-api',
      state: 'external_changes',
      last_synced_at: '2026-07-29T08:00:00Z',
      changes: [{ path: 'endpoints/login--1234.yaml', kind: 'modified' }],
      message: '1 project file changed outside Beacon',
    })
    vi.spyOn(api, 'reloadProjectFolder').mockResolvedValue({
      linked: true,
      path: '/work/checkout-api',
      state: 'clean',
      last_synced_at: '2026-07-29T08:01:00Z',
      changes: [],
      message: 'Project files are up to date',
    })
    const onProjectListChange = vi.fn().mockResolvedValue(undefined)

    render(
      <ProjectSettingsPage
        onBack={vi.fn()}
        project={project}
        onSharingStatusChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onProjectListChange={onProjectListChange}
      />,
    )

    expect(await screen.findByText('1 project file changed outside Beacon')).toBeInTheDocument()
    expect(screen.getByText('endpoints/login--1234.yaml')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reload from folder' }))

    await waitFor(() => expect(api.reloadProjectFolder).toHaveBeenCalledWith('project-1'))
    expect(await screen.findByText('Project files are up to date')).toBeInTheDocument()
    expect(onProjectListChange).toHaveBeenCalledOnce()
  })

  it('commits linked project changes through the constrained Git controls', async () => {
    vi.spyOn(api, 'projectFileSyncStatus').mockResolvedValue({
      linked: true, path: '/work/checkout-api', state: 'clean', last_synced_at: null,
      changes: [], message: 'Project files are up to date',
    })
    vi.spyOn(api, 'projectGitStatus').mockResolvedValue({
      available: true, repository: true, branch: 'main', remote_url: 'git@example.com:team/api.git',
      upstream: null, ahead: 0, behind: 0,
      changes: [{ path: 'beacon.yaml', status: 'M' }], message: '1 file change',
    })
    vi.spyOn(api, 'commitProjectGit').mockResolvedValue({
      available: true, repository: true, branch: 'main', remote_url: 'git@example.com:team/api.git',
      upstream: null, ahead: 0, behind: 0, changes: [], message: 'Working tree is clean',
    })

    render(
      <ProjectSettingsPage onBack={vi.fn()} project={project} onSharingStatusChange={vi.fn()}
        onSave={vi.fn()} onDelete={vi.fn()} onProjectListChange={vi.fn()} />,
    )

    expect(await screen.findByText('1 file change')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Describe this project change'), { target: { value: 'Update login assertion' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    await waitFor(() => expect(api.commitProjectGit).toHaveBeenCalledWith('project-1', 'Update login assertion'))
    expect(await screen.findByText('Working tree is clean')).toBeInTheDocument()
  })

  it('opens the last commit and switches between changed file patches', async () => {
    vi.spyOn(api, 'projectFileSyncStatus').mockResolvedValue({
      linked: true, path: '/work/checkout-api', state: 'clean', last_synced_at: null,
      changes: [], message: 'Project files are up to date',
    })
    vi.spyOn(api, 'projectGitStatus').mockResolvedValue({
      available: true, repository: true, branch: 'main', remote_url: 'https://github.com/team/api.git',
      upstream: 'origin/main', ahead: 0, behind: 0, changes: [], message: 'Working tree is clean',
    })
    vi.spyOn(api, 'projectGitDiff').mockResolvedValue({
      scope: 'last_commit',
      commit: { id: 'abc123', short_id: 'abc123', subject: 'Update API tests', author: 'Beacon User', committed_at: '2026-07-29T09:00:00Z' },
      files: [
        { path: 'beacon.yaml', status: 'M', additions: 1, deletions: 1, truncated: false, patch: '@@ -1 +1 @@\n-old name\n+new name' },
        { path: 'endpoints/login.yaml', status: 'A', additions: 1, deletions: 0, truncated: false, patch: '@@ -0 +1 @@\n+name: Login' },
      ],
    })

    render(
      <ProjectSettingsPage onBack={vi.fn()} project={project} onSharingStatusChange={vi.fn()}
        onSave={vi.fn()} onDelete={vi.fn()} onProjectListChange={vi.fn()} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Last commit' }))
    expect(await screen.findByText('Update API tests')).toBeInTheDocument()
    expect(screen.getByLabelText('Diff for beacon.yaml')).toHaveTextContent('+new name')

    fireEvent.click(screen.getByRole('button', { name: /endpoints\/login.yaml/ }))
    expect(screen.getByLabelText('Diff for endpoints/login.yaml')).toHaveTextContent('+name: Login')
  })

  it('switches a clean linked project to another Beacon branch', async () => {
    vi.spyOn(api, 'projectFileSyncStatus').mockResolvedValue({
      linked: true, path: '/work/checkout-api', state: 'clean', last_synced_at: null,
      changes: [], message: 'Project files are up to date',
    })
    vi.spyOn(api, 'projectGitStatus').mockResolvedValue({
      available: true, repository: true, branch: 'main', remote_url: 'https://github.com/team/api.git',
      upstream: 'origin/main', ahead: 0, behind: 0, changes: [], message: 'Working tree is clean',
    })
    vi.spyOn(api, 'projectGitBranches').mockResolvedValue({
      current: 'main', remote_url: 'https://github.com/team/api.git',
      local: [
        { name: 'main', full_name: 'main', kind: 'local', current: true, upstream: 'origin/main' },
        { name: 'feature/auth', full_name: 'feature/auth', kind: 'local', current: false, upstream: null },
      ],
      remote: [],
    })
    vi.spyOn(api, 'switchProjectGitBranch').mockResolvedValue({
      current: 'feature/auth', remote_url: 'https://github.com/team/api.git',
      local: [
        { name: 'main', full_name: 'main', kind: 'local', current: false, upstream: 'origin/main' },
        { name: 'feature/auth', full_name: 'feature/auth', kind: 'local', current: true, upstream: null },
      ],
      remote: [],
    })
    vi.spyOn(api, 'compareProjectGitBranch').mockResolvedValue({
      current: 'main', target: 'feature/auth', current_only_commits: 0, target_only_commits: 2,
      summary: { added: 1, modified: 1, deleted: 0 },
      files: [
        { path: 'beacon.yaml', status: 'modified', additions: 2, deletions: 1 },
        { path: 'endpoints/auth.yaml', status: 'added', additions: 20, deletions: 0 },
      ],
    })
    const onProjectListChange = vi.fn().mockResolvedValue(undefined)

    render(
      <ProjectSettingsPage onBack={vi.fn()} project={project} onSharingStatusChange={vi.fn()}
        onSave={vi.fn()} onDelete={vi.fn()} onProjectListChange={onProjectListChange} />,
    )

    const branchSelect = await screen.findByLabelText('Git branch')
    await screen.findByRole('option', { name: 'feature/auth' })
    fireEvent.change(branchSelect, { target: { value: 'feature/auth' } })
    await waitFor(() => expect(api.compareProjectGitBranch).toHaveBeenCalledWith('project-1', 'feature/auth'))
    expect(await screen.findByText('endpoints/auth.yaml')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }))

    await waitFor(() => expect(api.switchProjectGitBranch).toHaveBeenCalledWith('project-1', 'feature/auth'))
    expect(onProjectListChange).toHaveBeenCalledOnce()
  })
})
