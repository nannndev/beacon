import { useEffect, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Button } from '../ui/button'
import { QueryParamsEditor } from '../QueryParamsEditor'
import { PayloadEditor } from '../PayloadEditor'
import { parseQueryParams } from '../../lib/queryParams'
import type { Endpoint } from '../../types'

interface Props {
  endpoint: Endpoint | null
  onOpenChange: (open: boolean) => void
  /** Persist the edited endpoint; `send` asks the caller to fire it afterwards. */
  onSave: (endpoint: Endpoint, send: boolean) => Promise<void>
}

/** Edit just the query string and body of a saved request, without the full editor. */
export function QuickEditDialog({ endpoint, onOpenChange, onSave }: Props) {
  const [url, setUrl] = useState('')
  const [payload, setPayload] = useState<any>({})
  const [busy, setBusy] = useState<'save' | 'send' | null>(null)

  useEffect(() => {
    if (!endpoint) return
    setUrl(endpoint.url || '')
    setPayload(endpoint.payload ?? {})
  }, [endpoint])

  // GraphQL bodies are split into query/variables fields that only the full editor handles.
  const bodyEditable = endpoint && endpoint.payload_type !== 'graphql' && endpoint.target_type !== 'web'
  const hasBody = bodyEditable && !['GET', 'HEAD'].includes(endpoint!.method)

  const save = async (send: boolean) => {
    if (!endpoint) return
    setBusy(send ? 'send' : 'save')
    try {
      await onSave({ ...endpoint, url: url.trim(), ...(bodyEditable ? { payload } : {}) }, send)
      onOpenChange(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={Boolean(endpoint)} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !busy) { e.preventDefault(); void save(true) } }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="font-mono text-xs font-extrabold text-cyan-600 dark:text-cyan-400">{endpoint?.method}</span>
            <span className="truncate">{endpoint?.name}</span>
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{url}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={hasBody ? 'body' : 'params'} key={endpoint?.id}>
          <TabsList>
            <TabsTrigger value="params">Params ({parseQueryParams(url).length})</TabsTrigger>
            {bodyEditable && <TabsTrigger value="body">Body</TabsTrigger>}
          </TabsList>
          <TabsContent value="params" className="max-h-[55vh] overflow-y-auto pt-2">
            <QueryParamsEditor url={url} onChange={setUrl} />
          </TabsContent>
          {bodyEditable && (
            <TabsContent value="body" className="max-h-[55vh] overflow-y-auto pt-2">
              <PayloadEditor value={payload} onChange={setPayload} payloadType={endpoint?.payload_type} />
            </TabsContent>
          )}
        </Tabs>
        <p className="text-[10px] text-muted-foreground">Type <code className="font-mono">{'{{'}</code> in any field to insert a variable or random value.</p>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>Cancel</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={Boolean(busy)}>
            {busy === 'save' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save
          </Button>
          <Button onClick={() => save(true)} disabled={Boolean(busy)} title="Save & Send (⌘/Ctrl + Enter)" className="gap-1.5">
            {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Save & Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
