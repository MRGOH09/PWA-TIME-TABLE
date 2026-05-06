"use client";

import { Session, getAttendanceStatus } from "@/lib/types";
import { formatDuration, getSessionDuration } from "@/lib/data-utils";
import { STATUS_LABELS, DAY_LABELS } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, User, BookOpen, MapPin, GraduationCap } from "lucide-react";

interface SlotModalProps {
  session: Session | null;
  relatedSessions: Session[];
  onClose: () => void;
}

const statusBadgeVariants: Record<string, string> = {
  full: "status-full border",
  high: "status-high border",
  mid: "status-mid border",
  low: "status-low border",
  unmarked: "status-unmarked border",
};

export function SlotModal({ session, relatedSessions, onClose }: SlotModalProps) {
  if (!session) return null;

  const duration = getSessionDuration(session);
  const status = getAttendanceStatus(
    session.attendance === "Present" ? 100 : session.attendance === "Absent" ? 0 : 50,
    session.attendance !== "None"
  );

  return (
    <Dialog open={!!session} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl bg-card/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold flex items-center gap-3">
            <span className="size-3 rounded-full bg-primary" />
            {session.subject} - {session.grade}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6">
          {/* Session Info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <InfoItem
              icon={Clock}
              label="时间"
              value={`${session.startTime} - ${session.endTime}`}
              subValue={formatDuration(duration)}
            />
            <InfoItem
              icon={User}
              label="老师"
              value={session.teacher}
            />
            <InfoItem
              icon={MapPin}
              label="分行"
              value={session.branch}
            />
            <InfoItem
              icon={GraduationCap}
              label="日期"
              value={DAY_LABELS[session.day as keyof typeof DAY_LABELS] || session.day}
              subValue={session.date}
            />
          </div>

          {/* Attendance Status */}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border/50">
            <BookOpen className="size-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">出勤状态:</span>
            <Badge className={statusBadgeVariants[status]}>
              {STATUS_LABELS[status]}
            </Badge>
          </div>

          <Separator />

          {/* Related Sessions History */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-foreground">
              相关课程记录 ({relatedSessions.length})
            </h3>
            <ScrollArea className="h-[200px] rounded-lg border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="text-muted-foreground">日期</TableHead>
                    <TableHead className="text-muted-foreground">时间</TableHead>
                    <TableHead className="text-muted-foreground">分行</TableHead>
                    <TableHead className="text-muted-foreground">出勤</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatedSessions.slice(0, 20).map((s) => {
                    const sStatus = getAttendanceStatus(
                      s.attendance === "Present" ? 100 : s.attendance === "Absent" ? 0 : 50,
                      s.attendance !== "None"
                    );
                    return (
                      <TableRow
                        key={s.id}
                        className="border-border/30 hover:bg-muted/30"
                      >
                        <TableCell className="text-sm">
                          {s.date || DAY_LABELS[s.day as keyof typeof DAY_LABELS]}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.startTime} - {s.endTime}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.branch}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs ${statusBadgeVariants[sStatus]}`}
                          >
                            {STATUS_LABELS[sStatus]}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface InfoItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subValue?: string;
}

function InfoItem({ icon: Icon, label, value, subValue }: InfoItemProps) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border/30">
      <Icon className="size-4 text-muted-foreground mt-0.5" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
        {subValue && (
          <p className="text-xs text-muted-foreground">{subValue}</p>
        )}
      </div>
    </div>
  );
}
