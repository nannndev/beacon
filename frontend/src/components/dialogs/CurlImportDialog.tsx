import { useState, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Terminal, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react'
import { parseCurlCommand, type ParsedCurl } from '../../lib/curlParser'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (parsed: ParsedCurl) => void
}

export function CurlImportDialog({ open, onOpenChange, onImport }: Props) {
  const [curlText, setCurlText] = useState('')

  const { parsed, error } = useMemo(() => {
    if (!curlText.trim()) return { parsed: null, error: null }
    try {
      const res = parseCurlCommand(curlText)
      return { parsed: res, error: null }
    } catch (err: any) {
      return { parsed: null, error: err?.message || 'Could not parse cURL command' }
    }
  }, [curlText])

  const handleApply = () => {
    if (!parsed) return
    onImport(parsed)
    onOpenChange(false)
    setCurlText('')
  }

  const sampleCurl = `curl -X POST "https://api.retailku.com/v1/auth/login" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer my_token" \\
  -d '{"email": "admin@retailku.com", "password": "secret"}'`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Terminal className="h-5 w-5 text-cyan-500" />
            Import Endpoint from cURL
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Paste cURL Command (DevTools, Postman, Terminal)
            </label>
            <textarea
              value={curlText}
              onChange={(e) => setCurlText(e.target.value)}
              placeholder={`Paste your cURL command here...\n\nExample:\n${sampleCurl}`}
              rows={6}
              spellCheck={false}
              className="mt-1.5 w-full rounded-lg border border-border bg-[#07090d] p-3 font-mono text-xs text-slate-100 placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* Live Parsed Preview */}
          {parsed ? (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-cyan-500">
                  <CheckCircle2 className="h-4 w-4" /> Live Parsed Preview
                </span>
                <span className="rounded bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-600 dark:text-cyan-400 uppercase">
                  {parsed.method}
                </span>
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="truncate text-foreground/90 font-semibold" title={parsed.url}>
                  {parsed.url || '<Base URL>'}
                </div>

                {Object.keys(parsed.headers).length > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Headers ({Object.keys(parsed.headers).length}):{' '}
                    <span className="text-foreground">{Object.keys(parsed.headers).join(', ')}</span>
                  </div>
                )}

                {parsed.payload && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    Payload ({parsed.payload_type}):{' '}
                    <span className="text-foreground">
                      {typeof parsed.payload === 'object' ? JSON.stringify(parsed.payload) : String(parsed.payload)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <Sparkles className="h-4 w-4 text-cyan-500 shrink-0" />
              <span>Copy "Copy as cURL" from browser DevTools Network tab and paste here.</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!parsed} onClick={handleApply} className="bg-cyan-600 hover:bg-cyan-700 text-white">
            Apply to Endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
