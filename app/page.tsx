"use client";

import { useState, useMemo } from "react";
import { TabType } from "@/lib/types";
import { calculateSummaryStats, extractFilterOptions } from "@/lib/data-utils";
import { useScheduleData } from "@/hooks/use-schedule-data";
import { useFilters } from "@/hooks/use-filters";

import { Header } from "@/components/dashboard/header";
import { TabsNav } from "@/components/dashboard/tabs-nav";
import { Filters } from "@/components/dashboard/filters";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { GanttView } from "@/components/gantt/gantt-view";
import { TeachersView } from "@/components/teachers/teachers-view";
import { AttendanceView } from "@/components/attendance/attendance-view";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>("gantt");
  const { sessions, filterOptions, lastUpdated, isLoading, isRefreshing, refresh } =
    useScheduleData();

  const { filters, filteredSessions, updateFilter, clearAll } = useFilters(sessions);

  // Derive stats from filtered sessions
  const stats = useMemo(
    () => calculateSummaryStats(filteredSessions),
    [filteredSessions]
  );

  // Derive available filter options from all sessions
  const availableOptions = useMemo(
    () => (sessions.length > 0 ? extractFilterOptions(sessions) : filterOptions),
    [sessions, filterOptions]
  );

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        stats={stats}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        isLoading={isRefreshing}
      />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 flex flex-col gap-6">
        {/* Summary Cards - Mobile only */}
        <div className="lg:hidden">
          <SummaryCards stats={stats} />
        </div>

        {/* Tabs Navigation */}
        <TabsNav activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Filters */}
        <Filters
          filters={filters}
          options={availableOptions}
          onFilterChange={updateFilter}
          onClearAll={clearAll}
        />

        {/* View Content */}
        <div className="flex-1">
          {activeTab === "gantt" && <GanttView sessions={filteredSessions} />}
          {activeTab === "teachers" && (
            <TeachersView sessions={filteredSessions} />
          )}
          {activeTab === "attendance" && (
            <AttendanceView sessions={filteredSessions} />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-4 text-center text-sm text-muted-foreground">
        <p>周补习时间表 Dashboard v2.0 | 数据来自飞书 Base</p>
      </footer>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header skeleton */}
      <header className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <Skeleton className="h-6 w-12" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
            <Skeleton className="h-9 w-20" />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 flex flex-col gap-6">
        {/* Tabs skeleton */}
        <Skeleton className="h-12 w-full rounded-lg" />

        {/* Filters skeleton */}
        <Skeleton className="h-24 w-full rounded-lg" />

        {/* Content skeleton */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[400px] w-full rounded-lg" />
        </div>
      </main>
    </div>
  );
}
