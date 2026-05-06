"use client";

import { useMemo } from "react";
import { Session } from "@/lib/types";
import {
  calculateAttendanceTrend,
  calculateSummaryStats,
  calculateTeacherStats,
} from "@/lib/data-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendChart } from "./trend-chart";
import { StackChart } from "./stack-chart";
import { UnderperformTable } from "./underperform-table";

interface AttendanceViewProps {
  sessions: Session[];
}

export function AttendanceView({ sessions }: AttendanceViewProps) {
  const trendData = useMemo(
    () => calculateAttendanceTrend(sessions),
    [sessions]
  );

  const stats = useMemo(() => calculateSummaryStats(sessions), [sessions]);

  const teacherStats = useMemo(
    () => calculateTeacherStats(sessions),
    [sessions]
  );

  // Get underperforming sessions (low attendance rate)
  const underperformers = useMemo(() => {
    return teacherStats
      .filter((t) => t.presentRate < 80 && t.presentRate > 0)
      .sort((a, b) => a.presentRate - b.presentRate)
      .slice(0, 10);
  }, [teacherStats]);

  if (sessions.length === 0) {
    return (
      <Card className="glass border-border/50">
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">暂无数据，请调整筛选条件</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="总出席"
          value={stats.presentCount}
          total={stats.totalSessions}
          color="text-status-high"
          bgColor="bg-status-high/10"
        />
        <StatCard
          label="总缺席"
          value={stats.absentCount}
          total={stats.totalSessions}
          color="text-status-low"
          bgColor="bg-status-low/10"
        />
        <StatCard
          label="未点名"
          value={stats.unmarkedCount}
          total={stats.totalSessions}
          color="text-status-unmarked"
          bgColor="bg-status-unmarked/10"
        />
        <StatCard
          label="出勤率"
          value={stats.avgAttendanceRate.toFixed(1) + "%"}
          color={
            stats.avgAttendanceRate >= 80
              ? "text-status-high"
              : stats.avgAttendanceRate >= 60
              ? "text-status-mid"
              : "text-status-low"
          }
          bgColor={
            stats.avgAttendanceRate >= 80
              ? "bg-status-high/10"
              : stats.avgAttendanceRate >= 60
              ? "bg-status-mid/10"
              : "bg-status-low/10"
          }
        />
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="glass border-border/50">
          <CardHeader className="py-4 border-b border-border/50">
            <CardTitle className="text-base font-medium">出勤率趋势</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <TrendChart data={trendData} />
          </CardContent>
        </Card>

        <Card className="glass border-border/50">
          <CardHeader className="py-4 border-b border-border/50">
            <CardTitle className="text-base font-medium">出勤分布</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <StackChart data={trendData} />
          </CardContent>
        </Card>
      </div>

      {/* Underperformers */}
      {underperformers.length > 0 && (
        <Card className="glass border-border/50">
          <CardHeader className="py-4 border-b border-border/50">
            <CardTitle className="text-base font-medium text-status-low">
              需关注: 出勤率低于 80% 的老师
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <UnderperformTable stats={underperformers} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number | string;
  total?: number;
  color: string;
  bgColor: string;
}

function StatCard({ label, value, total, color, bgColor }: StatCardProps) {
  return (
    <Card className={`${bgColor} border-border/30`}>
      <CardContent className="p-4">
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-muted-foreground">
          {label}
          {total && (
            <span className="text-muted-foreground/70"> / {total}</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
