import { cx } from '../../components/ui'

/*
  Small charts drawn as inline SVG rather than pulled from a charting library.
  Four modest charts do not justify ~200KB of runtime on a page that should
  paint instantly, and these inherit the theme tokens directly.
*/

/* -------------------------------------------------------- Revenue bars */

export function RevenueChart({
  data,
  format,
}: {
  data: { label: string; total: number; bookings: number }[]
  format: (value: number) => string
}) {
  const max = Math.max(...data.map((point) => point.total), 1)
  const hasAny = data.some((point) => point.total > 0)

  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 140 }}>
        {data.map((point, index) => {
          const height = (point.total / max) * 100
          const isCurrent = index === data.length - 1

          return (
            <div key={point.label} className="group relative flex h-full flex-1 flex-col justify-end">
              {/* Value sits above the current month only; labelling every bar
                  turns a chart into a crowded table. */}
              {isCurrent && point.total > 0 && (
                <span className="tabular mb-1 text-center text-xs font-medium text-brand-700 dark:text-brand-300">
                  {format(point.total)}
                </span>
              )}
              <div
                title={`${point.label}: ${format(point.total)} · ${point.bookings} booking${point.bookings === 1 ? '' : 's'}`}
                className={cx(
                  'w-full rounded-t-md transition-all duration-700',
                  isCurrent
                    ? 'bg-gradient-to-t from-brand-700 to-brand-500'
                    : 'bg-[var(--border-strong)] group-hover:bg-brand-400',
                )}
                style={{ height: `${Math.max(height, point.total > 0 ? 4 : 1.5)}%` }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex gap-2">
        {data.map((point, index) => (
          <span
            key={point.label}
            className={cx(
              'flex-1 text-center text-xs',
              index === data.length - 1
                ? 'font-medium text-[var(--text-primary)]'
                : 'text-[var(--text-muted)]',
            )}
          >
            {point.label}
          </span>
        ))}
      </div>

      {!hasAny && (
        <p className="mt-3 text-center text-sm text-[var(--text-muted)]">
          No confirmed revenue in the last six months yet.
        </p>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- Donut ring */

export function OccupancyRing({
  percent,
  occupied,
  total,
}: {
  percent: number
  occupied: number
  total: number
}) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const filled = (Math.min(100, percent) / 100) * circumference

  return (
    <div className="relative flex items-center justify-center">
      <svg viewBox="0 0 140 140" className="size-36 -rotate-90">
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          strokeWidth="14"
          className="stroke-[var(--surface-sunken)]"
        />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className="stroke-brand-500 transition-[stroke-dasharray] duration-1000"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-3xl font-semibold tracking-tight">{percent}%</span>
        <span className="tabular text-xs text-[var(--text-muted)]">
          {occupied}/{total} rooms
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Horizontal bar */

export function BarList({
  items,
  emptyMessage,
}: {
  items: { label: string; value: number; total: number; note?: string }[]
  emptyMessage: string
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--text-muted)]">{emptyMessage}</p>
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const percent = item.total > 0 ? (item.value / item.total) * 100 : 0

        return (
          <li key={item.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{item.label}</span>
              <span className="tabular shrink-0 text-[var(--text-muted)]">
                {item.note ?? `${item.value}/${item.total}`}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                className={cx(
                  'h-full rounded-full transition-[width] duration-700',
                  percent >= 90
                    ? 'bg-amber-500'
                    : percent > 0
                      ? 'bg-brand-500'
                      : 'bg-transparent',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
