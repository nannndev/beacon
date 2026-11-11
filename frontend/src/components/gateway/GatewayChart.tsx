import React, { useMemo, useState } from 'react'
import { Activity, ArrowUpRight, BarChart2, Clock, Cpu, Layers, Zap } from 'lucide-react'
import { Card } from '../ui/card'
import { ProviderLogo } from './ProviderLogo'
import type { GatewayStats, GatewayUsage } from '../../types'

interface GatewayChartProps {
  usage: GatewayUsage[]
  stats: GatewayStats | null
}

type ChartMetric = 'requests' | 'tokens' | 'latency' | 'distribution'

export function GatewayChart({ usage, stats }: GatewayChartProps) {
  const [metric, setMetric] = useState<ChartMetric>('requests')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // Sort chronological for charting
  const chronUsage = useMemo(() => {
    return [...usage].sort((a, b) => a.ts - b.ts)
  }, [usage])

  // Summary calculations
  const totalTokens = (stats?.input_tokens || 0) + (stats?.output_tokens || 0)
  const totalReqs = stats?.requests || chronUsage.length
  const totalErrors = stats?.errors || chronUsage.filter((u) => u.status === 'error').length
  const successRate = totalReqs > 0 ? Math.round(((totalReqs - totalErrors) / totalReqs) * 100) : 100

  const avgLatency = useMemo(() => {
    if (!chronUsage.length) return 0
    const sum = chronUsage.reduce((acc, u) => acc + (u.duration_ms || 0), 0)
    return Math.round(sum / chronUsage.length)
  }, [chronUsage])

  const p95Latency = useMemo(() => {
    if (!chronUsage.length) return 0
    const latencies = chronUsage.map((u) => u.duration_ms || 0).sort((a, b) => a - b)
    const idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
    return latencies[idx] || 0
  }, [chronUsage])

  // Bucket usage for timeline chart (group by time slices if many points, or render point-by-point)
  const chartPoints = useMemo(() => {
    if (!chronUsage.length) {
      // Provide an empty/baseline state
      return []
    }

    // If less than 40 points, use each request directly
    if (chronUsage.length <= 40) {
      return chronUsage.map((u, i) => ({
        index: i,
        time: new Date(u.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        requests: 1,
        tokensIn: u.input_tokens || 0,
        tokensOut: u.output_tokens || 0,
        totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0),
        latency: u.duration_ms || 0,
        status: u.status,
        provider: u.provider,
        model: u.model,
      }))
    }

    // Otherwise bucket into 30 buckets
    const bucketCount = 30
    const minTs = chronUsage[0].ts
    const maxTs = chronUsage[chronUsage.length - 1].ts
    const step = Math.max(1, (maxTs - minTs) / bucketCount)

    const buckets: Array<{
      index: number
      time: string
      requests: number
      tokensIn: number
      tokensOut: number
      totalTokens: number
      latency: number
      status: 'success' | 'error'
      provider: string
      model: string
    }> = []

    for (let b = 0; b < bucketCount; b++) {
      const bStart = minTs + b * step
      const bEnd = bStart + step
      const items = chronUsage.filter((u) => u.ts >= bStart && (b === bucketCount - 1 ? u.ts <= bEnd : u.ts < bEnd))

      if (items.length > 0) {
        const sumIn = items.reduce((acc, u) => acc + (u.input_tokens || 0), 0)
        const sumOut = items.reduce((acc, u) => acc + (u.output_tokens || 0), 0)
        const avgLat = Math.round(items.reduce((acc, u) => acc + (u.duration_ms || 0), 0) / items.length)
        const hasErr = items.some((u) => u.status === 'error')
        const first = items[0]

        buckets.push({
          index: b,
          time: new Date(bStart * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          requests: items.length,
          tokensIn: sumIn,
          tokensOut: sumOut,
          totalTokens: sumIn + sumOut,
          latency: avgLat,
          status: hasErr ? 'error' : 'success',
          provider: first.provider,
          model: first.model,
        })
      }
    }

    return buckets
  }, [chronUsage])

  // Provider Distribution
  const providerStats = useMemo(() => {
    const map = new Map<string, { provider: string; requests: number; tokens: number; errors: number; avgLatency: number; latencies: number[] }>()
    for (const u of chronUsage) {
      const cur = map.get(u.provider) || { provider: u.provider, requests: 0, tokens: 0, errors: 0, avgLatency: 0, latencies: [] }
      cur.requests += 1
      cur.tokens += (u.input_tokens || 0) + (u.output_tokens || 0)
      if (u.status === 'error') cur.errors += 1
      cur.latencies.push(u.duration_ms || 0)
      map.set(u.provider, cur)
    }

    const total = Math.max(1, chronUsage.length)
    return Array.from(map.values())
      .map((item) => {
        const sumLat = item.latencies.reduce((a, b) => a + b, 0)
        return {
          ...item,
          avgLatency: item.latencies.length ? Math.round(sumLat / item.latencies.length) : 0,
          pct: Math.round((item.requests / total) * 100),
        }
      })
      .sort((a, b) => b.requests - a.requests)
  }, [chronUsage])

  // Dimensions for SVG chart
  const svgWidth = 800
  const svgHeight = 220
  const padLeft = 45
  const padRight = 20
  const padTop = 20
  const padBottom = 35

  const plotW = svgWidth - padLeft - padRight
  const plotH = svgHeight - padTop - padBottom

  // Value bounds depending on selected metric
  const { maxVal, getY, pointsPath, areaPath } = useMemo(() => {
    if (!chartPoints.length) {
      return { maxVal: 10, getY: () => 0, pointsPath: '', areaPath: '' }
    }

    let rawMax = 10
    if (metric === 'requests') {
      rawMax = Math.max(...chartPoints.map((p) => p.requests), 5)
    } else if (metric === 'tokens') {
      rawMax = Math.max(...chartPoints.map((p) => p.totalTokens), 100)
    } else if (metric === 'latency') {
      rawMax = Math.max(...chartPoints.map((p) => p.latency), 200)
    }

    const maxVal = Math.ceil(rawMax * 1.15)
    const getY = (v: number) => padTop + plotH * (1 - Math.min(1, Math.max(0, v / maxVal)))
    const getX = (i: number) => padLeft + (chartPoints.length === 1 ? plotW / 2 : (i / (chartPoints.length - 1)) * plotW)

    const coords = chartPoints.map((p, i) => {
      const val = metric === 'requests' ? p.requests : metric === 'tokens' ? p.totalTokens : p.latency
      return { x: getX(i), y: getY(val) }
    })

    // Construct SVG path
    let pointsPath = ''
    coords.forEach((pt, i) => {
      pointsPath += i === 0 ? `M ${pt.x},${pt.y}` : ` L ${pt.x},${pt.y}`
    })

    const areaPath = `${pointsPath} L ${coords[coords.length - 1].x},${padTop + plotH} L ${coords[0].x},${padTop + plotH} Z`

    return { maxVal, getY, pointsPath, areaPath }
  }, [chartPoints, metric, plotW, plotH])

  const hoveredPoint = hoverIndex !== null ? chartPoints[hoverIndex] : null

  return (
    <Card className="p-4 space-y-4 border-border/80 bg-card/60 backdrop-blur-sm shadow-sm">
      {/* Metric Cards Banner */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            <Activity className="w-3.5 h-3.5 text-cyan-500" />
            <span>Requests</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-foreground">{totalReqs.toLocaleString()}</span>
            <span className={`text-[10.5px] font-medium font-mono ${successRate >= 98 ? 'text-emerald-500' : 'text-amber-500'}`}>
              {successRate}% ok
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span>Tokens</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-foreground">{totalTokens.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground font-mono">total</span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span>Avg Latency</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-foreground">{avgLatency}</span>
            <span className="text-[10px] text-muted-foreground font-mono">ms</span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            <Zap className="w-3.5 h-3.5 text-emerald-500" />
            <span>P95 Speed</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-foreground">{p95Latency}</span>
            <span className="text-[10px] text-muted-foreground font-mono">ms</span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/50 p-2.5 col-span-2 sm:col-span-1">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>Active Providers</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-emerald-500 font-mono">
              {providerStats.length || stats?.connected_providers || 0}
            </span>
            <span className="text-[10.5px] text-muted-foreground">connected</span>
          </div>
        </div>
      </div>

      {/* Chart Controls & Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
        <div className="flex items-center gap-1.5">
          <BarChart2 className="w-4 h-4 text-cyan-500" />
          <span className="text-xs font-semibold text-foreground">Traffic Analytics</span>
        </div>

        <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-xs">
          {(
            [
              { id: 'requests', label: 'Requests', icon: Activity },
              { id: 'tokens', label: 'Token Volume', icon: Cpu },
              { id: 'latency', label: 'Latency (ms)', icon: Clock },
              { id: 'distribution', label: 'Provider Share', icon: Layers },
            ] as const
          ).map((item) => {
            const Icon = item.icon
            const active = metric === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMetric(item.id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-muted text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className={`w-3 h-3 ${active ? 'text-cyan-500' : ''}`} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Chart Rendering Area */}
      {metric === 'distribution' ? (
        /* Provider Distribution View */
        <div className="space-y-3 pt-1">
          {providerStats.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No traffic recorded across providers yet. Fire a prompt from Agent or Playground to see live share.
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {providerStats.map((p) => (
                <div
                  key={p.provider}
                  className="rounded-lg border border-border/80 bg-background/50 p-3 space-y-2 hover:border-cyan-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ProviderLogo provider={p.provider} size="sm" badge />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate capitalize">{p.provider}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {p.requests} req · {p.tokens.toLocaleString()} tok
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-foreground">{p.pct}%</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{p.avgLatency}ms avg</div>
                    </div>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.max(4, p.pct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* SVG Timeline Chart View */
        <div className="relative pt-1">
          {chartPoints.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              No gateway traffic logged yet. Test endpoints, use Beacon AI, or fire requests via curl to populate real-time graphs.
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-lg bg-background/40 border border-border/60 p-2">
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-auto overflow-visible select-none"
              >
                <defs>
                  <linearGradient id="chartGradientCyan" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="chartGradientPurple" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A855F7" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#A855F7" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="chartGradientAmber" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y = padTop + plotH * ratio
                  const val = Math.round(maxVal * (1 - ratio))
                  return (
                    <g key={ratio}>
                      <line
                        x1={padLeft}
                        y1={y}
                        x2={svgWidth - padRight}
                        y2={y}
                        stroke="currentColor"
                        strokeOpacity="0.08"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={padLeft - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-muted-foreground font-mono text-[9px]"
                      >
                        {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                      </text>
                    </g>
                  )
                })}

                {/* Area Fill */}
                <path
                  d={areaPath}
                  fill={
                    metric === 'requests'
                      ? 'url(#chartGradientCyan)'
                      : metric === 'tokens'
                      ? 'url(#chartGradientPurple)'
                      : 'url(#chartGradientAmber)'
                  }
                />

                {/* Main Curve Line */}
                <path
                  d={pointsPath}
                  fill="none"
                  stroke={
                    metric === 'requests' ? '#06B6D4' : metric === 'tokens' ? '#A855F7' : '#F59E0B'
                  }
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Interactive Points */}
                {chartPoints.map((p, i) => {
                  const getX = (idx: number) =>
                    padLeft + (chartPoints.length === 1 ? plotW / 2 : (idx / (chartPoints.length - 1)) * plotW)
                  const val = metric === 'requests' ? p.requests : metric === 'tokens' ? p.totalTokens : p.latency
                  const cx = getX(i)
                  const cy = getY(val)
                  const isHovered = hoverIndex === i

                  return (
                    <g key={i} className="cursor-pointer" onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)}>
                      {isHovered && (
                        <line
                          x1={cx}
                          y1={padTop}
                          x2={cx}
                          y2={padTop + plotH}
                          stroke="#06B6D4"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                          opacity="0.6"
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isHovered ? 5 : 2.5}
                        fill={p.status === 'error' ? '#EF4444' : metric === 'requests' ? '#06B6D4' : metric === 'tokens' ? '#A855F7' : '#F59E0B'}
                        stroke="#090D16"
                        strokeWidth="1.5"
                        className="transition-all duration-150"
                      />
                    </g>
                  )
                })}

                {/* X-axis labels */}
                {chartPoints.length > 0 && (
                  <>
                    <text
                      x={padLeft}
                      y={svgHeight - 12}
                      textAnchor="start"
                      className="fill-muted-foreground font-mono text-[9.5px]"
                    >
                      {chartPoints[0].time}
                    </text>
                    {chartPoints.length > 1 && (
                      <text
                        x={svgWidth - padRight}
                        y={svgHeight - 12}
                        textAnchor="end"
                        className="fill-muted-foreground font-mono text-[9.5px]"
                      >
                        {chartPoints[chartPoints.length - 1].time}
                      </text>
                    )}
                  </>
                )}
              </svg>

              {/* Hover Tooltip Float */}
              {hoveredPoint && (
                <div
                  className="absolute top-3 right-3 rounded-lg border border-border bg-card/90 backdrop-blur-md p-2.5 text-xs shadow-xl space-y-1 z-20 pointer-events-none animate-in fade-in duration-100"
                >
                  <div className="flex items-center gap-2 border-b border-border/60 pb-1">
                    <ProviderLogo provider={hoveredPoint.provider} size="xs" />
                    <span className="font-medium text-foreground capitalize">{hoveredPoint.provider}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">({hoveredPoint.time})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] pt-0.5">
                    <span className="text-muted-foreground">Requests:</span>
                    <span className="font-mono text-right font-semibold text-foreground">{hoveredPoint.requests}</span>
                    <span className="text-muted-foreground">Tokens:</span>
                    <span className="font-mono text-right text-purple-400 font-semibold">{hoveredPoint.totalTokens.toLocaleString()}</span>
                    <span className="text-muted-foreground">Latency:</span>
                    <span className="font-mono text-right text-amber-500 font-semibold">{hoveredPoint.latency}ms</span>
                    <span className="text-muted-foreground">Status:</span>
                    <span className={`font-mono text-right font-semibold ${hoveredPoint.status === 'error' ? 'text-red-500' : 'text-emerald-500'}`}>
                      {hoveredPoint.status}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
