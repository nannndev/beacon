import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CliPage } from './CliPage'


describe('CliPage documentation', () => {
  it('documents preflight, discovery, execution, CI, and exit codes in the desktop app', () => {
    render(<CliPage onBack={vi.fn()} />)

    expect(screen.getByText('beacon validate .')).toBeInTheDocument()
    expect(screen.getByText('beacon list endpoints .')).toBeInTheDocument()
    expect(screen.getAllByText('beacon ci init github .').length).toBeGreaterThan(0)
    expect(screen.getByText('beacon run .')).toBeInTheDocument()
    expect(screen.getByText('GitHub Actions')).toBeInTheDocument()
    expect(screen.getByText('130')).toBeInTheDocument()
    expect(screen.getByText('Preflight and discovery')).toBeInTheDocument()
    expect(screen.getByText('CI workflow generation')).toBeInTheDocument()
    expect(screen.getByText('--github')).toBeInTheDocument()
  })
})
