import { forwardRef, useState, type ReactNode } from 'react'

interface Props {
  items: unknown[]
  /** Fixed row height in px (rows MUST render at exactly this height). */
  rowHeight: number
  overscan?: number
  className?: string
  render: (item: any, index: number) => ReactNode
}

/**
 * Minimal fixed-height windowed list: renders only the rows in view (plus
 * overscan), so a 1000-line log doesn't create 1000 DOM nodes. Forwards its ref
 * to the scroll container, so an external "scroll to bottom" (auto-follow) still
 * works — setting scrollTop = scrollHeight fires onScroll and re-windows.
 */
export const VirtualList = forwardRef<HTMLDivElement, Props>(function VirtualList(
  { items, rowHeight, overscan = 8, className, render },
  ref,
) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(240)

  const total = items.length
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visible = Math.ceil(viewHeight / rowHeight) + overscan * 2
  const end = Math.min(total, start + visible)
  const slice = items.slice(start, end)

  return (
    <div
      ref={(el) => {
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
        if (el && el.clientHeight && el.clientHeight !== viewHeight) setViewHeight(el.clientHeight)
      }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className={className}
    >
      <div style={{ height: total * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: start * rowHeight, left: 0, right: 0 }}>
          {slice.map((item, i) => render(item, start + i))}
        </div>
      </div>
    </div>
  )
})
