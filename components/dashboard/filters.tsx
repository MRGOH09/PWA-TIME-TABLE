"use client";

import { X, Filter, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterState } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FilterOptions {
  branches: string[];
  levels: string[];
  days: string[];
  subjects: string[];
  grades: string[];
  teachers: string[];
  months: string[];
}

interface FiltersProps {
  filters: FilterState;
  options: FilterOptions;
  onFilterChange: (key: keyof FilterState, values: string[]) => void;
  onClearAll: () => void;
}

const filterConfig: {
  key: keyof FilterState;
  label: string;
  optionsKey: keyof FilterOptions;
}[] = [
  { key: "branch", label: "分行", optionsKey: "branches" },
  { key: "level", label: "中/小", optionsKey: "levels" },
  { key: "day", label: "礼拜", optionsKey: "days" },
  { key: "subject", label: "科目", optionsKey: "subjects" },
  { key: "grade", label: "年级", optionsKey: "grades" },
  { key: "teacher", label: "老师", optionsKey: "teachers" },
  { key: "month", label: "月份", optionsKey: "months" },
  { key: "attendance", label: "出勤", optionsKey: "branches" }, // Will use attendance options
];

const attendanceOptions = ["Present", "Absent", "None"];
const attendanceLabels: Record<string, string> = {
  Present: "出席",
  Absent: "缺席",
  None: "未点名",
};

export function Filters({
  filters,
  options,
  onFilterChange,
  onClearAll,
}: FiltersProps) {
  const activeFilterCount = Object.values(filters).reduce(
    (count, arr) => count + arr.length,
    0
  );

  return (
    <div className="glass rounded-lg border border-border/50 p-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">筛选</span>
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {activeFilterCount} 项
            </Badge>
          )}
        </div>
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="text-xs text-muted-foreground hover:text-foreground h-7"
          >
            <X className="size-3 mr-1" data-icon="inline-start" />
            清除全部
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {filterConfig.map(({ key, label, optionsKey }) => {
          const isAttendance = key === "attendance";
          const availableOptions = isAttendance
            ? attendanceOptions
            : options[optionsKey];
          const selectedValues = filters[key];

          return (
            <FilterSelect
              key={key}
              label={label}
              options={availableOptions}
              selectedValues={selectedValues}
              onSelect={(value) => {
                const newValues = selectedValues.includes(value)
                  ? selectedValues.filter((v) => v !== value)
                  : [...selectedValues, value];
                onFilterChange(key, newValues);
              }}
              getLabel={isAttendance ? (v) => attendanceLabels[v] || v : undefined}
            />
          );
        })}
      </div>

      {/* Active filter tags */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border/50">
          {Object.entries(filters).map(([key, values]) =>
            values.map((value) => (
              <Badge
                key={`${key}-${value}`}
                variant="outline"
                className="gap-1 pr-1 bg-primary/10 border-primary/30 text-primary"
              >
                {key === "attendance"
                  ? attendanceLabels[value] || value
                  : value}
                <button
                  onClick={() =>
                    onFilterChange(
                      key as keyof FilterState,
                      values.filter((v) => v !== value)
                    )
                  }
                  className="ml-1 rounded-full hover:bg-primary/20 p-0.5"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  options: string[];
  selectedValues: string[];
  onSelect: (value: string) => void;
  getLabel?: (value: string) => string;
}

function FilterSelect({
  label,
  options,
  selectedValues,
  onSelect,
  getLabel = (v) => v,
}: FilterSelectProps) {
  const hasSelection = selectedValues.length > 0;

  return (
    <Select
      value=""
      onValueChange={onSelect}
    >
      <SelectTrigger
        className={cn(
          "h-9 min-w-[100px] text-sm",
          hasSelection && "border-primary/50 bg-primary/5"
        )}
      >
        <span className="flex items-center gap-1.5">
          {label}
          {hasSelection && (
            <Badge
              variant="secondary"
              className="size-5 p-0 flex items-center justify-center text-xs"
            >
              {selectedValues.length}
            </Badge>
          )}
        </span>
        <ChevronDown className="size-4 ml-auto opacity-50" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option}
              value={option}
              className={cn(
                selectedValues.includes(option) &&
                  "bg-primary/10 text-primary font-medium"
              )}
            >
              <span className="flex items-center gap-2">
                {selectedValues.includes(option) && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
                {getLabel(option)}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
