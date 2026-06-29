import React from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'

interface KVEditorProps {
  data: Record<string, any>
  onChange: (data: Record<string, any>) => void
  label?: string
}

export function KVEditor({ data, onChange, label }: KVEditorProps) {
  const entries = Object.entries(data || {})

  const updateEntry = (index: number, key: string, value: any) => {
    const newEntries = [...entries]
    newEntries[index] = [key, value]
    onChange(Object.fromEntries(newEntries))
  }

  const addEntry = () => {
    onChange({ ...data, '': '' })
  }

  const removeEntry = (index: number) => {
    const newEntries = entries.filter((_, i) => i !== index)
    onChange(Object.fromEntries(newEntries))
  }

  return (
    <div className="space-y-3">
      {label && <div className="text-sm font-medium mb-2">{label}</div>}
      {entries.map(([key, value], index) => {
        const valStr = String(value)
        const isTemplate = valStr.includes('{{') && valStr.includes('}}')
        return (
          <div key={index} className="flex gap-2 items-center">
            <Input
              value={key}
              onChange={(e) => updateEntry(index, e.target.value, value)}
              placeholder="Key"
              className="flex-1"
            />
            <div className="flex-1 relative">
              <Input
                value={valStr}
                onChange={(e) => updateEntry(index, key, e.target.value)}
                placeholder="Value (use {{var}} for dynamic)"
                className={`font-mono pr-16 ${isTemplate ? 'template-var' : ''}`}
              />
              {isTemplate && (
                <Badge variant="template" className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px]">
                  template
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeEntry(index)}
              className="text-red-400 hover:text-red-500"
            >
              ×
            </Button>
          </div>
        )
      })}
      <Button variant="outline" size="sm" onClick={addEntry} className="mt-1">
        + Add
      </Button>
    </div>
  )
}