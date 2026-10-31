import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { KVEditor } from './KVEditor'
import { EnvironmentsDialog } from './dialogs/EnvironmentsDialog'
import type { Project } from '../types'

function ControlledKVWrapper({ initial = {} }: { initial?: Record<string, string> }) {
  const [data, setData] = useState<Record<string, string>>(initial)
  return <KVEditor data={data} onChange={setData} placeholderKey="Variable name" placeholderVal="Value" />
}

describe('KVEditor bug fixes', () => {
  it('allows adding multiple empty rows and typing colliding or numeric keys without losing rows', () => {
    render(<ControlledKVWrapper initial={{ existing_var: 'val1' }} />)

    const addBtn = screen.getByRole('button', { name: /add row/i })
    fireEvent.click(addBtn)
    fireEvent.click(addBtn)

    const keyInputs = screen.getAllByPlaceholderText('Key') as HTMLInputElement[]
    expect(keyInputs).toHaveLength(3)

    // Typing a duplicate key should keep all 3 rows intact and show a warning
    fireEvent.change(keyInputs[1], { target: { value: 'existing_var' } })
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(3)
    expect(screen.getAllByText(/duplicate key/i)).toHaveLength(2)

    // Typing a numeric key should not jump the row to the top of the list
    fireEvent.change(keyInputs[2], { target: { value: '100' } })
    const updatedKeyInputs = screen.getAllByPlaceholderText('Key') as HTMLInputElement[]
    expect(updatedKeyInputs.map((el) => el.value)).toEqual(['existing_var', 'existing_var', '100'])
  })

  it('syncs valid JSON edits immediately in JSON mode without requiring Apply JSON click', () => {
    const onChange = vi.fn()
    render(<KVEditor data={{ foo: 'bar' }} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '{"foo": "updated", "token": "abc"}' } })

    expect(onChange).toHaveBeenLastCalledWith({ foo: 'updated', token: 'abc' })
  })
})

describe('EnvironmentsDialog bug fixes', () => {
  const baseProject: Project = {
    id: 'p1',
    name: 'Demo',
    current_environment_id: 'env-1',
    items: [],
    environments: [
      { id: 'env-1', name: 'Staging', base_url: 'https://staging.example.com', variables: { api_key: '123' } },
    ],
  }

  it('preserves unsaved environment edits when the parent project prop refreshes on window focus', () => {
    const onSave = vi.fn()
    const { rerender } = render(
      <EnvironmentsDialog
        open={true}
        onOpenChange={() => {}}
        project={baseProject}
        activeEnvId="env-1"
        onSave={onSave}
      />,
    )

    const baseUrlInput = screen.getByDisplayValue('https://staging.example.com')
    fireEvent.change(baseUrlInput, { target: { value: 'https://edited.example.com' } })
    expect(screen.getByDisplayValue('https://edited.example.com')).toBeInTheDocument()

    // Simulate App.tsx fetchAll() creating a fresh project object reference while dialog is open
    const refreshedProject: Project = JSON.parse(JSON.stringify(baseProject))
    rerender(
      <EnvironmentsDialog
        open={true}
        onOpenChange={() => {}}
        project={refreshedProject}
        activeEnvId="env-1"
        onSave={onSave}
      />,
    )

    expect(screen.getByDisplayValue('https://edited.example.com')).toBeInTheDocument()
  })
})
