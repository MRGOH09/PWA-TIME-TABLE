"use client";

import { TeacherStats, getAttendanceStatus } from "@/lib/types";
import { formatDuration, formatPercent } from "@/lib/data-utils";
import { STATUS_LABELS } from "@/lib/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle } from "lucide-react";

interface UnderperformTableProps {
  stats: TeacherStats[];
}

const statusBadgeClasses: Record<string, string> = {
  full: "status-full border",
  high: "status-high border",
  mid: "status-mid border",
  low: "status-low border",
  unmarked: "status-unmarked border",
};

export function UnderperformTable({ stats }: UnderperformTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/50 hover:bg-transparent">
          <TableHead className="text-muted-foreground">老师</TableHead>
          <TableHead className="text-muted-foreground">课程数</TableHead>
          <TableHead className="text-muted-foreground">总时长</TableHead>
          <TableHead className="text-muted-foreground w-[200px]">出勤率</TableHead>
          <TableHead className="text-muted-foreground">状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stats.map((stat) => {
          const status = getAttendanceStatus(stat.presentRate, true);
          return (
            <TableRow
              key={stat.name}
              className="border-border/30 hover:bg-muted/30"
            >
              <TableCell className="font-medium text-foreground">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-status-low" />
                  {stat.name}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {stat.sessionsCount}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDuration(stat.totalHours)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Progress
                    value={stat.presentRate}
                    className="h-2 flex-1"
                    style={{
                      // Custom indicator color based on status
                      // @ts-expect-error CSS custom property
                      "--progress-indicator-color":
                        status === "low"
                          ? "hsl(0, 75%, 55%)"
                          : status === "mid"
                          ? "hsl(40, 90%, 55%)"
                          : "hsl(160, 75%, 50%)",
                    }}
                  />
                  <span className="text-sm text-muted-foreground w-12 text-right">
                    {formatPercent(stat.presentRate)}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <Badge className={`text-xs ${statusBadgeClasses[status]}`}>
                  {STATUS_LABELS[status]}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
