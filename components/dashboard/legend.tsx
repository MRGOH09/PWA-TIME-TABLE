"use client";

import { STATUS_LABELS } from "@/lib/constants";
import type { AttendanceStatus } from "@/lib/types";

const statusStyles: Record<AttendanceStatus, string> = {
  full: "bg-status-full",
  high: "bg-status-high",
  mid: "bg-status-mid",
  low: "bg-status-low",
  unmarked: "bg-status-unmarked",
};

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <span className="text-muted-foreground text-xs">出勤状态:</span>
      {(Object.keys(STATUS_LABELS) as AttendanceStatus[]).map((status) => (
        <div key={status} className="flex items-center gap-1.5">
          <span className={`size-3 rounded-sm ${statusStyles[status]}`} />
          <span className="text-muted-foreground">{STATUS_LABELS[status]}</span>
        </div>
      ))}
    </div>
  );
}
