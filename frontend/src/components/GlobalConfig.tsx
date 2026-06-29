import React from 'react'
import { TestConfig } from '../types'

interface Props {
  config: TestConfig
  onSave: (c: TestConfig) => void
}

export default function GlobalConfig({ config, onSave }: Props) {
  return (
    <div className="bg-zinc-900 rounded-3xl p-5">
      <h2 className="font-semibold mb-3">Global Config</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm">Base URL</label>
          <input 
            value={config.base_url} 
            onChange={e => onSave({ ...config, base_url: e.target.value })}
            className="w-full bg-zinc-800 p-2 rounded mt-1 text-sm" 
          />
        </div>
        <div>
          <label className="text-sm">Variables</label>
          <div className="text-xs text-zinc-400 mt-2">Use {'{{access_token}}'} etc in headers/payload. Editable in full editor.</div>
        </div>
      </div>
    </div>
  )
}