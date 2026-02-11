'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#0F86FF', '#F43F5E'];

export default function WinLossChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={4}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'rgba(15, 23, 42, 0.9)',
            borderRadius: '12px',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            color: '#fff',
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
