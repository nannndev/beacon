import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api'
import { TestDataPicker, type TestData } from './TestDataPicker'

describe('TestDataPicker', () => {
  it('previews a CSV and reports it with its row order', async () => {
    const user = userEvent.setup()
    const preview = vi.spyOn(api, 'previewDataset').mockResolvedValue({
      rows: 2, columns: ['username', 'password'], preview: [],
    })
    const onChange = vi.fn()
    render(<TestDataPicker value={null} onChange={onChange} />)

    const file = new File(['username,password\nalice,1\nbob,2\n'], 'users.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Test data file'), file)

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(preview).toHaveBeenCalledWith('username,password\nalice,1\nbob,2\n', 'csv')
    expect(onChange.mock.calls[0][0]).toMatchObject({
      name: 'users.csv',
      spec: { format: 'csv', mode: 'sequential' },
      summary: { rows: 2 },
    })
    preview.mockRestore()
  })

  it('shows the loaded file and lets the user switch order or remove it', async () => {
    const user = userEvent.setup()
    const value: TestData = {
      name: 'users.csv',
      spec: { text: 'u\na', format: 'csv', mode: 'sequential' },
      summary: { rows: 1200, columns: ['username', 'password'], preview: [] },
    }
    const onChange = vi.fn()
    render(<TestDataPicker value={value} onChange={onChange} />)

    expect(screen.getByText('1,200 rows · 2 cols')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Row order'), 'random')
    expect(onChange).toHaveBeenLastCalledWith({ ...value, spec: { ...value.spec, mode: 'random' } })
    await user.click(screen.getByLabelText('Remove test data'))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
