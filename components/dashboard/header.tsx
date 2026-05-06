"use client";

import { CalendarDays, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SummaryStats } from "@/lib/types";
import { formatPercent } from "@/lib/data-utils";

interface HeaderProps {
  stats: SummaryStats;
  lastUpdated?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function Header({ stats, lastUpdated, onRefresh, isLoading }: HeaderProps) {
  return (
    <header className="glass border-b border-border/50 sticky top-0 z-40">
      <div className="mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center glow-sm">
            <CalendarDays className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              周补习时间表 Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              补习课程排期管理系统
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Quick Stats */}
          <div className="hidden md:flex items-center gap-6">
            <StatItem label="总课程" value={stats.totalSessions.toString()} />
            <StatItem label="老师" value={stats.totalTeachers.toString()} />
            <StatItem label="科目" value={stats.totalSubjects.toString()} />
            <StatItem
              label="平均出勤率"
              value={formatPercent(stats.avgAttendanceRate)}
              highlight
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                更新于 {lastUpdated}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} data-icon="inline-start" />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

function StatItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="text-center">
      <p
        className={`text-lg font-semibold ${
          highlight ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
