type Props = {
  values: number[]
}

const SLATE = '#64748B'

/** Compact bar sparkline. Slate only — orange is reserved for FlameMark and primary buttons. */
export function Sparkline({ values }: Props) {
  if (values.length === 0) return null
  const max = Math.max(...values, 0)
  return (
    <div className="glance-spark" role="img" aria-label="Last 7 days">
      {values.map((value, index) => {
        const height = max > 0 ? Math.max(2, Math.round((value / max) * 28)) : 2
        return (
          <span
            key={`${index}-${value}`}
            className="glance-spark-bar"
            style={{ height, background: SLATE }}
          />
        )
      })}
    </div>
  )
}

export const SPARKLINE_COLOR = SLATE

export function sparklineIsSlate(color: string): boolean {
  const normalized = color.trim().toLowerCase()
  return normalized === SLATE.toLowerCase() || normalized === '#64748b'
}
