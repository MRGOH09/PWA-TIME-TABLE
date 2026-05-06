"use client";

import { TrendDataPoint } from "@/lib/types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

interface StackChartProps {
  data: TrendDataPoint[];
}

const chartConfig = {
  presentCount: {
    label: "出席",
    color: "hsl(160, 75%, 50%)",
  },
  absentCount: {
    label: "缺席",
    color: "hsl(0, 75%, 55%)",
  },
  unmarkedCount: {
    label: "未点名",
    color: "hsl(240, 10%, 50%)",
  },
};

export function StackChart({ data }: StackChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground">
        暂无分布数据
      </div>
    );
  }

  // Format date for display
  const formattedData = data.map((d) => ({
    ...d,
    displayDate: d.date.slice(5), // MM-DD
  }));

  return (
    <ChartContainer config={chartConfig} className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={formattedData}
          margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.3}
            vertical={false}
          />
          <XAxis
            dataKey="displayDate"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="presentCount"
            stackId="a"
            fill="hsl(160, 75%, 50%)"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="absentCount"
            stackId="a"
            fill="hsl(0, 75%, 55%)"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="unmarkedCount"
            stackId="a"
            fill="hsl(240, 10%, 50%)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
