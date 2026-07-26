import { useEffect, useState } from 'react'
import { Laptop, Loader2, Radio } from 'lucide-react'
import { api } from '../../lib/api'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { toast } from '../ui/toast'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onJoined: () => Promise<void> | void
}

export function JoinLocalProjectDialog({ open, onOpenChange, onJoined }: Props) {
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [deviceName, setDeviceName] = useState('My Beacon device')
  const [joining, setJoining] = useState(false)
  const [pending, setPending] = useState<{ address: string; requestId: string; projectName: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setCode('')
    setPending(null)
  }, [open])

  useEffect(() => {
    if (!open || !pending) return
    let cancelled = false
    const poll = async () => {
      try {
        const result = await api.localJoinStatus(pending.address, pending.requestId)
        if (cancelled) return
        if (result.status === 'approved') {
          toast.success(`Joined ${result.project_name || pending.projectName}`)
          await onJoined()
          onOpenChange(false)
          return
        }
        if (result.status === 'rejected') {
          setPending(null)
          setJoining(false)
          toast.error('The host rejected this join request')
          return
        }
      } catch (error: any) {
        if (!cancelled) toast.error(error?.message || 'Lost connection to the host')
        return
      }
      if (!cancelled) window.setTimeout(poll, 1000)
    }
    const timer = window.setTimeout(poll, 800)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, pending, onJoined, onOpenChange])

  const valid = address.trim().includes(':') && /^\d{6}$/.test(code)
  const join = async () => {
    if (!valid || joining) return
    setJoining(true)
    try {
      const result = await api.joinLocalProject(address.trim(), code, deviceName.trim() || 'Beacon device')
      setPending({ address: result.address, requestId: result.request_id, projectName: result.project_name })
    } catch (error: any) {
      toast.error(error?.message || 'Could not join local project')
    } finally {
      setJoining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Radio className="h-4 w-4 text-blue-500" /> Join local project</DialogTitle>
          <DialogDescription>Use the host address and pairing code shown on your teammate's Beacon.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="join-address" className="text-xs">Host address</Label>
            <Input id="join-address" value={address} onChange={(event) => setAddress(event.target.value)}
              placeholder="192.168.1.24:7341" className="font-mono" autoComplete="off" />
          </div>
          <div className="grid grid-cols-[150px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="join-code" className="text-xs">Pairing code</Label>
              <Input id="join-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" className="font-mono text-base tracking-[0.2em]" inputMode="numeric" autoComplete="one-time-code" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="device-name" className="text-xs">This device</Label>
              <div className="relative"><Laptop className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="device-name" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} className="pl-9" />
              </div>
            </div>
          </div>
          {pending ? (
            <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-4 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-blue-500" />
              <div className="mt-2 text-sm font-semibold">Waiting for host approval</div>
              <p className="mt-1 text-[11px] text-muted-foreground">Ask the owner of {pending.projectName} to approve this device as Viewer or Editor.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-600 dark:text-amber-400">
              Debug LAN transport is not encrypted yet. Only connect on a trusted local network.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || joining} onClick={join}>
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
            {pending ? 'Waiting for approval' : joining ? 'Requesting access' : 'Request access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
