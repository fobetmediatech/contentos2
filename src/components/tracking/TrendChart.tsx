import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

interface ChartPoint {
  date: string
  value: number | null
}

interface TrendChartProps {
  data: ChartPoint[]
  label: string
  color?: string
  type?: 'line' | 'bar'
  /** Full-precision formatter for the tooltip value. */
  formatter?: (value: number) => string
  /** Compact formatter for Y-axis ticks (defaults to `formatter`, then K/M compaction). */
  axisFormatter?: (value: number) => string
  emptyMessage?: string
}

/** Compact large numbers for axis ticks: 425730 → "426K", 1_620_975 → "1.6M". */
function compactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}

const GRID_COLOR = 'rgba(245,237,214,0.06)'
const AXIS_COLOR = '#8B7D6B'

const tooltipStyle: React.CSSProperties = {
  backgroundColor: '#2C2218',
  border: '1px solid rgba(245,237,214,0.12)',
  borderRadius: '8px',
  color: '#F5EDD6',
  fontFamily: '"DM Mono", monospace',
  fontSize: '11px',
  padding: '8px 12px',
}

const axisStyle = {
  fill: AXIS_COLOR,
  fontFamily: '"DM Mono", monospace',
  fontSize: 10,
}

function NoData({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full text-[#8B7D6B] font-mono text-xs">
      {message}
    </div>
  )
}

export function TrendChart({
  data,
  label,
  color = '#E07B3A',
  type = 'line',
  formatter,
  axisFormatter,
  emptyMessage,
}: TrendChartProps) {
  const validPoints = data.filter((d) => d.value !== null)

  if (validPoints.length === 0) {
    return <NoData message={emptyMessage ?? 'No data yet'} />
  }

  if (validPoints.length === 1) {
    return <NoData message="Need 2+ fetches for a trend" />
  }

  // Use the array index as the X key so same-day fetches (identical date labels)
  // stay distinct — otherwise Recharts collapses duplicate categories and the
  // tooltip resolves every hover to the first matching point (showing 0).
  const indexed = data.map((d, i) => ({ ...d, i }))
  const labelForIndex = (v: unknown) => indexed[Number(v)]?.date ?? ''

  // Axis ticks: compact (426K) so they fit; tooltip keeps full precision.
  const yTickFormatter = (v: number) =>
    axisFormatter ? axisFormatter(v) : formatter ? formatter(v) : compactNumber(v)

  const tooltipFormatter = (value: unknown) => {
    const num = typeof value === 'number' ? value : Number(value)
    return [formatter ? formatter(num) : num.toLocaleString(), label]
  }

  const commonAxes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
      <XAxis
        dataKey="i"
        type="category"
        tick={axisStyle}
        tickLine={false}
        axisLine={false}
        tickFormatter={labelForIndex}
      />
      <YAxis
        tick={axisStyle}
        tickLine={false}
        axisLine={false}
        tickFormatter={yTickFormatter}
        width={52}
      />
    </>
  )

  if (type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={indexed} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          {commonAxes}
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={tooltipFormatter}
            labelFormatter={labelForIndex}
            labelStyle={{ color: '#C4A882', marginBottom: 4 }}
            cursor={{ fill: 'rgba(224,123,58,0.06)' }}
          />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={indexed} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        {commonAxes}
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={tooltipFormatter}
          labelFormatter={labelForIndex}
          labelStyle={{ color: '#C4A882', marginBottom: 4 }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: '#1A1410', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
