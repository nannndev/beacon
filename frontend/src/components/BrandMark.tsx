import beaconLight from '../assets/brand/beacon-mark-light-transparent.png'
import beaconDark from '../assets/brand/beacon-mark-dark-transparent.png'

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg'
  animated?: boolean
  className?: string
}

const sizeClass = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
}

export function BrandMark({ size = 'md', animated = true, className = '' }: BrandMarkProps) {
  return (
    <div
      className={`${sizeClass[size]} brand-mark relative shrink-0 overflow-hidden rounded-lg shadow-sm ring-1 ring-slate-950/10 dark:ring-white/10 ${animated ? 'brand-mark-animated' : ''} ${className}`}
      aria-hidden="true"
    >
      <img src={beaconLight} alt="" className="block h-full w-full object-cover dark:hidden" draggable={false} />
      <img src={beaconDark} alt="" className="hidden h-full w-full object-cover dark:block" draggable={false} />
      <span className="brand-mark-scan absolute inset-x-1 top-0 h-px bg-cyan-400/70 dark:bg-cyan-300/80" />
    </div>
  )
}
