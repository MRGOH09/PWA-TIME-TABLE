// Status colors for charts
export const STATUS_COLORS = {
  full: "hsl(195, 85%, 60%)", // cyan
  high: "hsl(160, 75%, 50%)", // green
  mid: "hsl(40, 90%, 55%)", // amber
  low: "hsl(0, 75%, 55%)", // red
  unmarked: "hsl(240, 10%, 50%)", // gray
} as const;

// Chart colors
export const CHART_COLORS = {
  primary: "hsl(195, 85%, 60%)",
  secondary: "hsl(160, 75%, 50%)",
  tertiary: "hsl(40, 90%, 55%)",
  quaternary: "hsl(0, 75%, 55%)",
  muted: "hsl(240, 10%, 50%)",
} as const;

// Day labels (Chinese)
export const DAY_LABELS = {
  "礼拜一": "周一",
  "礼拜二": "周二",
  "礼拜三": "周三",
  "礼拜四": "周四",
  "礼拜五": "周五",
  "礼拜六": "周六",
  "礼拜日": "周日",
} as const;

// Status labels (Chinese)
export const STATUS_LABELS = {
  full: "全勤",
  high: "高出勤",
  mid: "中出勤",
  low: "低出勤",
  unmarked: "未点名",
} as const;

// Level labels
export const LEVEL_LABELS = {
  "中": "中学",
  "小": "小学",
} as const;

// Attendance status options
export const ATTENDANCE_OPTIONS = [
  { value: "Present", label: "出席" },
  { value: "Absent", label: "缺席" },
  { value: "None", label: "未点名" },
] as const;

// Tab configuration
export const TABS = [
  { id: "gantt", label: "周课表 Gantt", icon: "Calendar" },
  { id: "teachers", label: "老师工作量", icon: "Users" },
  { id: "attendance", label: "出勤表现", icon: "BarChart" },
] as const;
