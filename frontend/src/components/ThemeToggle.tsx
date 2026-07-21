import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'
import { getThemePref, applyThemePref, resolveTheme, subscribeTheme, type ResolvedTheme } from '../lib/theme'

export function ThemeToggle() {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme())

  // Reflect changes made elsewhere (Settings, or the OS while on 'system').
  useEffect(() => subscribeTheme(() => setResolved(resolveTheme())), [])

  return (
    <Button
      variant="outline"
      size="icon"
      // Toggling from the header sets an explicit light/dark (leaves 'system').
      onClick={() => applyThemePref(resolveTheme() === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
      title={`Theme: ${getThemePref()} — click for ${resolved === 'dark' ? 'light' : 'dark'}`}
    >
      {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
