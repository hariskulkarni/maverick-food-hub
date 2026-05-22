'use client';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

const COLORS = ['#f23e5c', '#c01e44', '#ff7aa0', '#5b8c5a', '#3a73c1', '#9b59b6'];

export function ChartsClient({ kind, data }: { kind: 'sales' | 'sellers' | 'paymix' | 'peak'; data: any[] }) {
  if (kind === 'sales')
    return (
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Line type="monotone" dataKey="revenue" stroke="#f23e5c" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  if (kind === 'sellers')
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 30 }}>
          <XAxis type="number" hide />
          <YAxis dataKey="name" type="category" fontSize={11} width={120} />
          <Tooltip />
          <Bar dataKey="qty" fill="#f23e5c" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  if (kind === 'paymix')
    return (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="revenue" nameKey="method" cx="50%" cy="50%" outerRadius={80} innerRadius={40} label>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  if (kind === 'peak')
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <XAxis dataKey="hour" fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Bar dataKey="count" fill="#c01e44" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  return null;
}
