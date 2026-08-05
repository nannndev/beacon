import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { Button } from '../ui/button'
import { Copy, Check, Terminal } from 'lucide-react'
import { toast } from '../ui/toast'
import { toCurl } from '../../lib/curl'
import { toJsFetch, toPythonRequests, toGoHttp, toRawHttp, CurlSource } from '../../lib/codeSnippets'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: CurlSource
  absoluteUrl: string
}

type Language = 'curl' | 'javascript' | 'python' | 'go' | 'http'

const LANGUAGES = [
  { id: 'curl', label: 'cURL' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'http', label: 'Raw HTTP' },
] as const

type TokenType = 'keyword' | 'string' | 'comment' | 'flag' | 'number' | 'default'
type Token = { text: string; type: TokenType }

function tokenizeCode(code: string): Token[] {
  if (!code) return []
  const tokens: Token[] = []
  const keywords = /\b(const|let|var|import|from|requests|client|err|nil|http|package|func|main|return|fetch|response|def|io|strings|bytes|multipart|url|Values|NewReader|ReadAll|Println)\b/
  
  const re = /(\/\/[^\n]*|#[^\n]*)|("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`)|(--?\w+[\w-]*)|(\b\d+\b)|([a-zA-Z_]\w*)|(\s+)|([^\s\w]+)/g
  
  let match: RegExpExecArray | null
  while ((match = re.exec(code)) !== null) {
    const t = match[0]
    if (match[1]) {
      tokens.push({ text: t, type: 'comment' })
    } else if (match[2]) {
      tokens.push({ text: t, type: 'string' })
    } else if (match[3]) {
      tokens.push({ text: t, type: 'flag' })
    } else if (match[4]) {
      tokens.push({ text: t, type: 'number' })
    } else if (match[5]) {
      tokens.push({ text: t, type: keywords.test(t) ? 'keyword' : 'default' })
    } else if (match[6] || match[7]) {
      tokens.push({ text: t, type: 'default' })
    }
  }
  return tokens
}

function highlightCode(code: string): React.ReactNode {
  const tokens = tokenizeCode(code)
  return tokens.map((tok, i) => {
    let className = 'text-slate-200'
    if (tok.type === 'comment') {
      className = 'text-zinc-500 italic'
    } else if (tok.type === 'string') {
      className = 'text-emerald-400 dark:text-emerald-400'
    } else if (tok.type === 'flag') {
      className = 'text-cyan-400 font-semibold'
    } else if (tok.type === 'keyword') {
      className = 'text-sky-400 dark:text-sky-400 font-semibold'
    } else if (tok.type === 'number') {
      className = 'text-amber-400'
    }
    return <span key={i} className={className}>{tok.text}</span>
  })
}

export function CodeSnippetDialog({ open, onOpenChange, form, absoluteUrl }: Props) {
  const [activeTab, setActiveTab] = useState<Language>('curl')
  const [copied, setCopied] = useState(false)

  // Reset tab to cURL on open
  useEffect(() => {
    if (open) {
      setActiveTab('curl')
      setCopied(false)
    }
  }, [open])

  const codeSnippet = useMemo(() => {
    switch (activeTab) {
      case 'curl':
        return toCurl(form, absoluteUrl)
      case 'javascript':
        return toJsFetch(form, absoluteUrl)
      case 'python':
        return toPythonRequests(form, absoluteUrl)
      case 'go':
        return toGoHttp(form, absoluteUrl)
      case 'http':
        return toRawHttp(form, absoluteUrl)
      default:
        return ''
    }
  }, [activeTab, form, absoluteUrl])

  const handleCopy = () => {
    navigator.clipboard?.writeText(codeSnippet)
      .then(() => {
        setCopied(true)
        toast.success('Code snippet copied to clipboard!')
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        toast.error('Failed to copy code snippet.')
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-background border-border shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">Generate Code Snippet</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Copy this endpoint request as a functional code snippet for script integrations.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Custom tab bar */}
          <div className="flex gap-1.5 border-b border-border pb-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                type="button"
                onClick={() => {
                  setActiveTab(lang.id)
                  setCopied(false)
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === lang.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>

          {/* Code display block */}
          <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-[#07090d] shadow-inner">
            <div className="flex items-center justify-between border-b border-border/80 bg-[#090c12] px-4 py-2">
              <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase">
                {activeTab === 'http' ? 'http/1.1 raw' : `${activeTab} snippet`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs text-slate-300 hover:text-white hover:bg-white/5"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : 'Copy Code'}
              </Button>
            </div>

            <div className="relative p-4 overflow-auto max-h-[380px] min-h-[250px] bg-[#07090d] scrollbar-thin">
              <pre className="m-0 font-mono text-xs leading-[1.6] text-slate-200 whitespace-pre overflow-x-auto">
                <code>{highlightCode(codeSnippet)}</code>
              </pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
