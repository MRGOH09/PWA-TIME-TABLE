"use client";

import { Session, GanttRow, TIME_START, TIME_END, getAttendanceStatus } from "@/lib/types";
import { getSessionPosition } from "@/lib/data-utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface GanttChartProps {
  rows: GanttRow[];
  onSessionClick: (session: Session) => void;
  getDayLabel: (day: string) => string;
}

// Generate time axis labels
const timeLabels = Array.from({ length: TIME_END - TIME_START + 1 }, (_, i) => {
  const hour = TIME_START + i;
  return `${hour}:00`;
});

export function GanttChart({ rows, onSessionClick, getDayLabel }: GanttChartProps) {
  return (
    <div className="w-full">
      {/* Time axis header */}
      <div className="flex border-b border-border/50">
        <div className="w-20 shrink-0 px-2 py-2 text-xs text-muted-foreground bg-muted/30">
          日期
        </div>
        <div className="flex-1 relative">
          <div className="flex">
            {timeLabels.map((label, i) => (
              <div
                key={label}
                className="flex-1 text-center text-xs text-muted-foreground py-2 border-l border-border/30 first:border-l-0"
                style={{ minWidth: "50px" }}
              >
                {i % 2 === 0 ? label : ""}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rows */}
      {rows.map((row, rowIndex) => (
        <div
          key={`${row.branch}-${row.day}`}
          className={cn(
            "flex border-b border-border/30 last:border-b-0",
            rowIndex % 2 === 0 ? "bg-card/50" : "bg-card/30"
          )}
        >
          {/* Day label */}
          <div className="w-20 shrink-0 px-2 py-3 text-sm text-foreground font-medium flex items-center">
            {getDayLabel(row.day)}
          </div>

          {/* Session bars container */}
          <div className="flex-1 relative h-12">
            {/* Grid lines */}
            <div className="absolute inset-0 flex pointer-events-none">
              {timeLabels.map((_, i) => (
                <div
                  key={i}
                  className="flex-1 border-l border-border/20 first:border-l-0"
                  style={{ minWidth: "50px" }}
                />
              ))}
            </div>

            {/* Session bars */}
            {row.sessions.map((session) => (
              <SessionBar
                key={session.id}
                session={session}
                onClick={() => onSessionClick(session)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface SessionBarProps {
  session: Session;
  onClick: () => void;
}

const statusColors: Record<string, string> = {
  full: "bg-status-full hover:bg-status-full/80 border-status-full/50",
  high: "bg-status-high hover:bg-status-high/80 border-status-high/50",
  mid: "bg-status-mid hover:bg-status-mid/80 border-status-mid/50",
  low: "bg-status-low hover:bg-status-low/80 border-status-low/50",
  unmarked: "bg-status-unmarked hover:bg-status-unmarked/80 border-status-unmarked/50",
};

function SessionBar({ session, onClick }: SessionBarProps) {
  const { left, width } = getSessionPosition(session);
  const status = getAttendanceStatus(
    session.attendance === "Present" ? 100 : session.attendance === "Absent" ? 0 : 50,
    session.attendance !== "None"
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "absolute top-1 bottom-1 rounded-md border text-xs font-medium",
            "flex items-center justify-center px-1 overflow-hidden",
            "transition-all cursor-pointer shadow-sm",
            statusColors[status]
          )}
          style={{
            left: `${left}%`,
            width: `${Math.max(width, 3)}%`,
          }}
        >
          <span className="truncate text-background/90">
            {session.subject}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-popover/95 backdrop-blur-sm border-border"
      >
        <div className="text-sm">
          <p className="font-medium">{session.subject}</p>
          <p className="text-muted-foreground">
            {session.startTime} - {session.endTime}
          </p>
          <p className="text-muted-foreground">
            {session.teacher} | {session.grade}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
