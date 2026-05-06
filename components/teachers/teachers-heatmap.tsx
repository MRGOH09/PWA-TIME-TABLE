"use client";

import { useMemo } from "react";
import { HeatmapCell, DAY_ORDER } from "@/lib/types";
import { DAY_LABELS } from "@/lib/constants";
import { formatDuration } from "@/lib/data-utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TeachersHeatmapProps {
  data: HeatmapCell[];
  onTeacherClick: (teacher: string) => void;
}

export function TeachersHeatmap({ data, onTeacherClick }: TeachersHeatmapProps) {
  // Get unique teachers sorted by total hours
  const teachers = useMemo(() => {
    const teacherHours = new Map<string, number>();
    data.forEach((cell) => {
      teacherHours.set(
        cell.teacher,
        (teacherHours.get(cell.teacher) || 0) + cell.hours
      );
    });
    return Array.from(teacherHours.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [data]);

  // Find max hours for color scaling
  const maxHours = useMemo(
    () => Math.max(...data.map((d) => d.hours), 1),
    [data]
  );

  // Build lookup map
  const cellMap = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    data.forEach((cell) => {
      map.set(`${cell.teacher}-${cell.day}`, cell);
    });
    return map;
  }, [data]);

  const getIntensity = (hours: number): number => {
    return hours / maxHours;
  };

  return (
    <ScrollArea className="w-full">
      <div className="min-w-[600px] p-4">
        {/* Header - Days */}
        <div className="flex mb-2">
          <div className="w-24 shrink-0" />
          <div className="flex-1 flex">
            {DAY_ORDER.map((day) => (
              <div
                key={day}
                className="flex-1 text-center text-xs text-muted-foreground py-2"
              >
                {DAY_LABELS[day as keyof typeof DAY_LABELS] || day}
              </div>
            ))}
          </div>
        </div>

        {/* Rows - Teachers */}
        {teachers.map((teacher) => (
          <div key={teacher} className="flex mb-1">
            <button
              className="w-24 shrink-0 text-left text-sm text-foreground pr-2 truncate hover:text-primary transition-colors"
              onClick={() => onTeacherClick(teacher)}
            >
              {teacher}
            </button>
            <div className="flex-1 flex gap-1">
              {DAY_ORDER.map((day) => {
                const cell = cellMap.get(`${teacher}-${day}`);
                const hours = cell?.hours || 0;
                const intensity = getIntensity(hours);

                return (
                  <Tooltip key={day}>
                    <TooltipTrigger asChild>
                      <button
                        className={cn(
                          "flex-1 h-8 rounded-md transition-all",
                          hours > 0
                            ? "hover:ring-2 hover:ring-primary/50"
                            : "bg-muted/20"
                        )}
                        style={
                          hours > 0
                            ? {
                                backgroundColor: `oklch(0.75 ${0.15 * intensity} 200 / ${0.3 + intensity * 0.7})`,
                              }
                            : undefined
                        }
                        onClick={() => onTeacherClick(teacher)}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="bg-popover/95 backdrop-blur-sm border-border"
                    >
                      <div className="text-sm">
                        <p className="font-medium">
                          {teacher} - {DAY_LABELS[day as keyof typeof DAY_LABELS]}
                        </p>
                        {hours > 0 ? (
                          <>
                            <p className="text-muted-foreground">
                              时长: {formatDuration(hours)}
                            </p>
                            <p className="text-muted-foreground">
                              课程: {cell?.sessions.length || 0} 节
                            </p>
                          </>
                        ) : (
                          <p className="text-muted-foreground">无课程</p>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border/50">
          <span className="text-xs text-muted-foreground">工作量:</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">低</span>
            <div className="flex gap-0.5">
              {[0.2, 0.4, 0.6, 0.8, 1].map((intensity) => (
                <div
                  key={intensity}
                  className="size-4 rounded-sm"
                  style={{
                    backgroundColor: `oklch(0.75 ${0.15 * intensity} 200 / ${0.3 + intensity * 0.7})`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">高</span>
          </div>
        </div>
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
