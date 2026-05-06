"use client";

import { useState, useMemo } from "react";
import { Session } from "@/lib/types";
import { groupSessionsForGantt } from "@/lib/data-utils";
import { DAY_LABELS } from "@/lib/constants";
import { GanttChart } from "./gantt-chart";
import { SlotModal } from "./slot-modal";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Legend } from "@/components/dashboard/legend";

interface GanttViewProps {
  sessions: Session[];
}

export function GanttView({ sessions }: GanttViewProps) {
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const ganttRows = useMemo(() => groupSessionsForGantt(sessions), [sessions]);

  // Group rows by branch
  const branchGroups = useMemo(() => {
    const groups = new Map<string, typeof ganttRows>();
    ganttRows.forEach((row) => {
      const existing = groups.get(row.branch) || [];
      existing.push(row);
      groups.set(row.branch, existing);
    });
    return Array.from(groups.entries());
  }, [ganttRows]);

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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Legend />
        <p className="text-sm text-muted-foreground">
          共 {sessions.length} 个课程
        </p>
      </div>

      <ScrollArea className="w-full">
        <div className="min-w-[800px]">
          {branchGroups.map(([branch, rows]) => (
            <Card key={branch} className="glass border-border/50 mb-4">
              <CardHeader className="py-3 px-4 border-b border-border/50">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                  <span className="size-2 rounded-full bg-primary" />
                  {branch}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <GanttChart
                  rows={rows}
                  onSessionClick={setSelectedSession}
                  getDayLabel={(day) => DAY_LABELS[day as keyof typeof DAY_LABELS] || day}
                />
              </CardContent>
            </Card>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <SlotModal
        session={selectedSession}
        relatedSessions={sessions.filter(
          (s) =>
            selectedSession &&
            s.teacher === selectedSession.teacher &&
            s.subject === selectedSession.subject
        )}
        onClose={() => setSelectedSession(null)}
      />
    </div>
  );
}
