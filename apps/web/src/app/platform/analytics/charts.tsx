'use client';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

const COLORS = ['#1f3a73', '#a35e1d', '#2f6b3a', '#4a3a6a', '#a06a1c', '#888'];

export function AnalyticsCharts({ kind, data }: { kind: 'gmv'|'peaks'|'paymix'|'dist'; data: any[] }) {
  if (kind === 'gmv')
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Line type="monotone" dataKey="gmv" stroke="#a35e1d" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  if (kind === 'peaks')
    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <XAxis dataKey="hour" fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Bar dataKey="count" fill="#4a3a6a" radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  if (kind === 'paymix')
    return (
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="gmv" nameKey="method" cx="50%" cy="50%" outerRadius={70} innerRadius={36} label>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  if (kind === 'dist')
    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
          <XAxis type="number" hide />
          <YAxis dataKey="label" type="category" fontSize={11} width={100} />
          <Tooltip />
          <Bar dataKey="count" fill="#1f3a73" radius={[0,6,6,0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  return null;
}
