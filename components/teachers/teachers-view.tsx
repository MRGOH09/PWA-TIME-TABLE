"use client";

import { useState, useMemo } from "react";
import { Session } from "@/lib/types";
import { calculateTeacherStats, calculateHeatmapData } from "@/lib/data-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeachersTable } from "./teachers-table";
import { TeachersHeatmap } from "./teachers-heatmap";
import { TeacherModal } from "./teacher-modal";
import { TableIcon, Grid3X3 } from "lucide-react";

interface TeachersViewProps {
  sessions: Session[];
}

export function TeachersView({ sessions }: TeachersViewProps) {
  const [selectedTeacher, setSelectedTeacher] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "heatmap">("table");

  const teacherStats = useMemo(
    () => calculateTeacherStats(sessions),
    [sessions]
  );

  const heatmapData = useMemo(
    () => calculateHeatmapData(sessions),
    [sessions]
  );

  const selectedTeacherSessions = useMemo(
    () =>
      selectedTeacher
        ? sessions.filter((s) => s.teacher === selectedTeacher)
        : [],
    [sessions, selectedTeacher]
  );

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
      <Card className="glass border-border/50">
        <CardHeader className="py-4 border-b border-border/50">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-base font-medium">
              老师工作量统计
            </CardTitle>
            <Tabs
              value={viewMode}
              onValueChange={(v) => setViewMode(v as "table" | "heatmap")}
            >
              <TabsList className="bg-muted/50 h-9">
                <TabsTrigger value="table" className="gap-2 px-3">
                  <TableIcon className="size-4" />
                  <span className="hidden sm:inline">表格</span>
                </TabsTrigger>
                <TabsTrigger value="heatmap" className="gap-2 px-3">
                  <Grid3X3 className="size-4" />
                  <span className="hidden sm:inline">热力图</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {viewMode === "table" ? (
            <TeachersTable
              stats={teacherStats}
              onTeacherClick={setSelectedTeacher}
            />
          ) : (
            <TeachersHeatmap
              data={heatmapData}
              onTeacherClick={setSelectedTeacher}
            />
          )}
        </CardContent>
      </Card>

      <TeacherModal
        teacherName={selectedTeacher}
        sessions={selectedTeacherSessions}
        onClose={() => setSelectedTeacher(null)}
      />
    </div>
  );
}
