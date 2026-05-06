"use client";

import { CalendarCheck, UserCheck, BookOpen, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SummaryStats } from "@/lib/types";
import { formatPercent } from "@/lib/data-utils";

interface SummaryCardsProps {
  stats: SummaryStats;
}

export function SummaryCards({ stats }: SummaryCardsProps) {
  const cards = [
    {
      label: "总课程数",
      value: stats.totalSessions.toString(),
      Icon: CalendarCheck,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "教师人数",
      value: stats.totalTeachers.toString(),
      Icon: UserCheck,
      color: "text-status-high",
      bgColor: "bg-status-high/10",
    },
    {
      label: "科目数",
      value: stats.totalSubjects.toString(),
      Icon: BookOpen,
      color: "text-status-mid",
      bgColor: "bg-status-mid/10",
    },
    {
      label: "平均出勤率",
      value: formatPercent(stats.avgAttendanceRate),
      Icon: TrendingUp,
      color: stats.avgAttendanceRate >= 80 ? "text-status-high" : stats.avgAttendanceRate >= 60 ? "text-status-mid" : "text-status-low",
      bgColor: stats.avgAttendanceRate >= 80 ? "bg-status-high/10" : stats.avgAttendanceRate >= 60 ? "bg-status-mid/10" : "bg-status-low/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="glass border-border/50 overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`size-10 rounded-lg ${card.bgColor} flex items-center justify-center`}>
                <card.Icon className={`size-5 ${card.color}`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                <p className="text-xs text-muted-foreground">{card.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
