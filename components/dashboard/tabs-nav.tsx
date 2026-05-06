"use client";

import { Calendar, Users, BarChart3 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabType } from "@/lib/types";

interface TabsNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const tabs = [
  { id: "gantt" as const, label: "周课表 Gantt", Icon: Calendar },
  { id: "teachers" as const, label: "老师工作量", Icon: Users },
  { id: "attendance" as const, label: "出勤表现", Icon: BarChart3 },
];

export function TabsNav({ activeTab, onTabChange }: TabsNavProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => onTabChange(v as TabType)}
      className="w-full"
    >
      <TabsList className="w-full justify-start bg-card/50 backdrop-blur-sm border border-border/50 p-1 h-auto flex-wrap">
        {tabs.map(({ id, label, Icon }) => (
          <TabsTrigger
            key={id}
            value={id}
            className="flex items-center gap-2 px-4 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
