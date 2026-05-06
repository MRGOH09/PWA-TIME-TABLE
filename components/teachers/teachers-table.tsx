"use client";

import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TeachersTableProps {
  stats: TeacherStats[];
  onTeacherClick: (teacher: string) => void;
}

type SortField = "name" | "totalHours" | "sessionsCount" | "presentRate";
type SortDirection = "asc" | "desc";

const statusBadgeClasses: Record<string, string> = {
  full: "status-full border",
  high: "status-high border",
  mid: "status-mid border",
  low: "status-low border",
  unmarked: "status-unmarked border",
};

export function TeachersTable({ stats, onTeacherClick }: TeachersTableProps) {
  const [sortField, setSortField] = useState<SortField>("totalHours");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedStats = [...stats].sort((a, b) => {
    const multiplier = sortDirection === "asc" ? 1 : -1;
    switch (sortField) {
      case "name":
        return multiplier * a.name.localeCompare(b.name);
      case "totalHours":
        return multiplier * (a.totalHours - b.totalHours);
      case "sessionsCount":
        return multiplier * (a.sessionsCount - b.sessionsCount);
      case "presentRate":
        return multiplier * (a.presentRate - b.presentRate);
      default:
        return 0;
    }
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1 -ml-3 text-muted-foreground hover:text-foreground"
      onClick={() => handleSort(field)}
    >
      {children}
      {sortField === field ? (
        sortDirection === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-50" />
      )}
    </Button>
  );

  return (
    <ScrollArea className="h-[400px]">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead>
              <SortButton field="name">老师</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="totalHours">总时长</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="sessionsCount">课程数</SortButton>
            </TableHead>
            <TableHead>
              <SortButton field="presentRate">出勤率</SortButton>
            </TableHead>
            <TableHead className="text-muted-foreground">分行分布</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedStats.map((stat) => {
            const status = getAttendanceStatus(stat.presentRate, true);
            return (
              <TableRow
                key={stat.name}
                className="border-border/30 hover:bg-muted/30 cursor-pointer"
                onClick={() => onTeacherClick(stat.name)}
              >
                <TableCell className="font-medium text-foreground">
                  {stat.name}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDuration(stat.totalHours)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {stat.sessionsCount}
                </TableCell>
                <TableCell>
                  <Badge className={cn("text-xs", statusBadgeClasses[status])}>
                    {formatPercent(stat.presentRate)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(stat.branchCounts)
                      .slice(0, 3)
                      .map(([branch, count]) => (
                        <Badge
                          key={branch}
                          variant="outline"
                          className="text-xs bg-muted/30"
                        >
                          {branch.replace("分行", "")}: {count}
                        </Badge>
                      ))}
                    {Object.keys(stat.branchCounts).length > 3 && (
                      <Badge variant="outline" className="text-xs bg-muted/30">
                        +{Object.keys(stat.branchCounts).length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
