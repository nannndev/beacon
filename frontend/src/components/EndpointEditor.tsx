import React, { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { KVEditor } from './KVEditor'
import { TestConfig } from '../types'

interface Props {
  testId: string | null
  config: TestConfig
  onClose: () => void
  onSave: () => void
}

export default function EndpointEditor({ testId, config, onClose, onSave }: Props) {
  const [form, setForm] = useState<any>(getDefaultForm())

  function getDefaultForm() {
    return {
      name: 'New Endpoint',
      url: '/your-endpoint',
      method: 'POST',
      payload_type: 'json',
      headers: { 'Content-Type': 'application/json' },
      cookies: {},
      payload: {},
      extractors: {}
    }
  }

  useEffect(() => {
    if (testId) {
      const existing = config.tests.find((t: any) => t.id === testId)
      if (existing) {
        setForm({
          ...existing,
          headers: existing.headers || {},
          cookies: existing.cookies || {},
          payload: existing.payload || {},
          extractors: existing.extractors || {}
        })
      }
    } else {
      setForm(getDefaultForm())
    }
  }, [testId, config])

  const handleChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }))
  }

  const save = async () => {
    const headers = { ...(form.headers || {}) }
    const cookies = form.cookies || {}
    if (Object.keys(cookies).length > 0) {
      headers['Cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }

    const payloadToSend = {
      ...form,
      headers,
      cookies: undefined  // don't send cookies separately
    }

    const url = testId ? `/tests/${testId}` : `/tests`

    await fetch(url, {
      method: testId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadToSend)
    })

    onSave()
    onClose()
  }

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Button variant="ghost" size="sm" onClick={onClose} className="mb-2 -ml-3">
            ← Back to list
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">
            {testId ? 'Edit Endpoint' : 'Create New Endpoint'}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save Endpoint</Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <Label>Name</Label>
              <Input 
                value={form.name || ''} 
                onChange={(e) => handleChange('name', e.target.value)} 
              />
            </div>
            <div>
              <Label>Method</Label>
              <select 
                value={form.method} 
                onChange={(e) => handleChange('method', e.target.value)}
                className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                <option>POST</option>
                <option>GET</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
            </div>
            <div>
              <Label>Payload Type</Label>
              <select 
                value={form.payload_type} 
                onChange={(e) => handleChange('payload_type', e.target.value)}
                className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                <option value="json">JSON</option>
                <option value="form">Form</option>
                <option value="multipart">Multipart</option>
              </select>
            </div>
            <div className="md:col-span-4">
              <Label>URL</Label>
              <Input 
                value={form.url || ''} 
                onChange={(e) => handleChange('url', e.target.value)} 
                className="font-mono" 
              />
            </div>
          </CardContent>
        </Card>

        {/* Authorization - Dynamic per project */}
        <Card>
          <CardHeader>
            <CardTitle>Authorization Header</CardTitle>
          </CardHeader>
          <CardContent>
            <Label>Authorization (use {'{{variable}}'} for dynamic tokens per project)</Label>
            <Input 
              value={form.headers?.Authorization || ''} 
              onChange={(e) => handleChange('headers', { ...(form.headers || {}), Authorization: e.target.value })}
              placeholder="Bearer {{access_token}}"
              className={`font-mono ${ (form.headers?.Authorization || '').includes('{{') ? 'template-var' : '' }`}
            />
            <p className="text-xs text-muted-foreground mt-1">Supports {'{{access_token}}'}, {'{{api_key}}'} etc. Different APIs can have different auth vars.</p>
          </CardContent>
        </Card>

        {/* Headers */}
        <Card>
          <CardHeader>
            <CardTitle>Headers</CardTitle>
          </CardHeader>
          <CardContent>
            <KVEditor 
              data={form.headers || {}} 
              onChange={(h) => handleChange('headers', h)} 
            />
          </CardContent>
        </Card>

        {/* Cookies */}
        <Card>
          <CardHeader>
            <CardTitle>Cookies</CardTitle>
          </CardHeader>
          <CardContent>
            <KVEditor 
              data={form.cookies || {}} 
              onChange={(c) => handleChange('cookies', c)} 
              label="Will be sent as Cookie: header"
            />
          </CardContent>
        </Card>

        {/* Payload */}
        <Card>
          <CardHeader>
            <CardTitle>Payload</CardTitle>
          </CardHeader>
          <CardContent>
            <KVEditor 
              data={form.payload || {}} 
              onChange={(p) => handleChange('payload', p)} 
            />
            <div className="text-xs text-amber-400 mt-2">
              Dynamic: {'{{random_string}}'}, {'{{random_number}}'}, {'{{random_phone}}'}, {'{{access_token}}'}
            </div>
          </CardContent>
        </Card>

        {/* Extractors */}
        <Card>
          <CardHeader>
            <CardTitle>Response Extractors</CardTitle>
          </CardHeader>
          <CardContent>
            <KVEditor 
              data={form.extractors || {}} 
              onChange={(e) => handleChange('extractors', e)} 
              label="e.g. access_token → body.access_token (updates global vars after run)"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
