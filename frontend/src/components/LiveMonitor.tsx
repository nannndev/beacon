import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'

interface Props {
  logs: string[]
}

export default function LiveMonitor({ logs }: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Live Monitor</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => { /* clear logic */ }}>
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-sm">
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">Attempts: <span className="font-mono font-semibold">0</span></div>
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-green-400">Success: <span className="font-mono font-semibold">0</span></div>
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-yellow-400">Rate Limited: <span className="font-mono font-semibold">0</span></div>
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-red-400">Errors: <span className="font-mono font-semibold">0</span></div>
        </div>

        <div className="log-container h-72 overflow-auto bg-black border border-zinc-800 rounded-lg p-4 text-xs font-mono">
          {logs.length === 0 ? (
            <div className="text-zinc-500">Run an endpoint to see live output here.</div>
          ) : (
            logs.map((line, i) => <div key={i} className="py-0.5">{line}</div>)
          )}
        </div>
      </CardContent>
    </Card>
  )
}