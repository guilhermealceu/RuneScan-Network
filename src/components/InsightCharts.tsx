import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface RiskDatum {
  name: string;
  value: number;
  color: string;
}

interface SubnetDatum {
  name: string;
  label: string;
  ativos: number;
  index: number;
}

export function RiskDistributionChart({ data }: { data: RiskDatum[] }) {
  const visibleData = data.length ? data : [{ name: "Empty", value: 1, color: "#f8fafc" }];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={visibleData} dataKey="value" innerRadius={65} outerRadius={95} paddingAngle={8} cornerRadius={12} stroke="none">
          {visibleData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} className="outline-none" />)}
        </Pie>
        <Tooltip content={({ active, payload }) => active && payload?.length ? (
          <div className="rounded-2xl border border-black/5 bg-white/95 p-4 text-[12px] font-black shadow-2xl backdrop-blur-md">
            <span style={{ color: String(payload[0].payload.color) }}>{payload[0].name}: {payload[0].value} NODES</span>
          </div>
        ) : null} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function NetworkDensityChart({ data }: { data: SubnetDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorAtivos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="label" hide />
        <YAxis hide />
        <Tooltip content={({ active, payload }) => active && payload?.length ? (
          <div className="rounded-2xl border border-black/5 bg-white/95 p-4 text-[12px] font-black shadow-2xl backdrop-blur-md">
            <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-black/40">{payload[0].payload.name}</p>
            <p className="text-scan-ink">{payload[0].value} ACTIVE DEVICES</p>
          </div>
        ) : null} />
        <Area type="monotone" dataKey="ativos" stroke="#171717" strokeWidth={4} fillOpacity={1} fill="url(#colorAtivos)" activeDot={{ r: 8, strokeWidth: 0, fill: "#ef4444" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
