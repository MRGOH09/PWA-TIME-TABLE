"use client";

import { useMemo } from "react";
import { Session, DAY_ORDER, getAttendanceStatus } from "@/lib/types";
import { formatDuration, getSessionDuration, formatPercent } from "@/lib/data-utils";
import { DAY_LABELS, STATUS_LABELS } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, CalendarDays, BookOpen, TrendingUp } from "lucide-react";

interface TeacherModalProps {
  teacherName: string | null;
  sessions: Session[];
  onClose: () => void;
}

const statusBadgeClasses: Record<string, string> = {
  full: "status-full border",
  high: "status-high border",
  mid: "status-mid border",
  low: "status-low border",
  unmarked: "status-unmarked border",
};

export function TeacherModal({ teacherName, sessions, onClose }: TeacherModalProps) {
  const stats = useMemo(() => {
    if (!sessions.length) return null;

    const totalHours = sessions.reduce((sum, s) => sum + getSessionDuration(s), 0);
    const markedSessions = sessions.filter((s) => s.attendance !== "None");
    const presentSessions = sessions.filter((s) => s.attendance === "Present");
    const presentRate = markedSessions.length > 0
      ? (presentSessions.length / markedSessions.length) * 100
      : 0;

    const subjectCounts: Record<string, number> = {};
    const dayCounts: Record<string, number> = {};
    const monthCounts: Record<string, number> = {};

    sessions.forEach((s) => {
      subjectCounts[s.subject] = (subjectCounts[s.subject] || 0) + 1;
      dayCounts[s.day] = (dayCounts[s.day] || 0) + 1;
      monthCounts[s.month] = (monthCounts[s.month] || 0) + 1;
    });

    return {
      totalHours,
      totalSessions: sessions.length,
      presentRate,
      subjectCounts,
      dayCounts,
      monthCounts,
    };
  }, [sessions]);

  if (!teacherName || !stats) return null;

  const attendanceStatus = getAttendanceStatus(stats.presentRate, true);

  return (
    <Dialog open={!!teacherName} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl bg-card/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold flex items-center gap-3">
            <span className="size-3 rounded-full bg-primary" />
            {teacherName}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              icon={Clock}
              label="总时长"
              value={formatDuration(stats.totalHours)}
              color="text-primary"
            />
            <StatCard
              icon={CalendarDays}
              label="课程数"
              value={stats.totalSessions.toString()}
              color="text-status-high"
            />
            <StatCard
              icon={BookOpen}
              label="科目数"
              value={Object.keys(stats.subjectCounts).length.toString()}
              color="text-status-mid"
            />
            <StatCard
              icon={TrendingUp}
              label="出勤率"
              value={formatPercent(stats.presentRate)}
              color={`text-status-${attendanceStatus === "full" || attendanceStatus === "high" ? "high" : attendanceStatus === "mid" ? "mid" : "low"}`}
            />
          </div>

          <Separator />

          {/* Weekly Schedule Matrix */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-foreground">
              每周工作分布
            </h3>
            <div className="flex gap-2 flex-wrap">
              {DAY_ORDER.map((day) => {
                const count = stats.dayCounts[day] || 0;
                const hasData = count > 0;
                return (
                  <div
                    key={day}
                    className={`flex flex-col items-center p-3 rounded-lg border ${
                      hasData
                        ? "bg-primary/10 border-primary/30"
                        : "bg-muted/20 border-border/30"
                    }`}
                  >
                    <span className="text-xs text-muted-foreground">
                      {DAY_LABELS[day as keyof typeof DAY_LABELS]}
                    </span>
                    <span
                      className={`text-lg font-semibold ${
                        hasData ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Subject Distribution */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-foreground">
              科目分布
            </h3>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(stats.subjectCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([subject, count]) => (
                  <Badge
                    key={subject}
                    variant="outline"
                    className="bg-muted/30 text-foreground"
                  >
                    {subject}: {count}
                  </Badge>
                ))}
            </div>
          </div>

          {/* Recent Sessions */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-foreground">
              最近课程 (最多显示10条)
            </h3>
            <ScrollArea className="h-[150px] rounded-lg border border-border/50 p-3">
              <div className="flex flex-col gap-2">
                {sessions.slice(0, 10).map((session) => {
                  const status = getAttendanceStatus(
                    session.attendance === "Present" ? 100 : session.attendance === "Absent" ? 0 : 50,
                    session.attendance !== "None"
                  );
                  return (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/20 border border-border/30"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-foreground">
                          {session.subject}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {DAY_LABELS[session.day as keyof typeof DAY_LABELS]} {session.startTime}
                        </span>
                      </div>
                      <Badge className={`text-xs ${statusBadgeClasses[status]}`}>
                        {STATUS_LABELS[status]}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  return (
    <Card className="bg-muted/20 border-border/30">
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className={`size-5 ${color}`} />
        <div>
          <p className={`text-lg font-semibold ${color}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
