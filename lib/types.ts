// Schedule session data type
export interface Session {
  id: string;
  branch: string; // 分行
  level: "中" | "小"; // 中小
  day: string; // 礼拜 (礼拜一, 礼拜二, etc.)
  dayIndex: number; // 0-6 for sorting
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  subject: string; // 科目
  grade: string; // 年级
  teacher: string; // 老师
  month: string; // 月份
  attendance: "Present" | "Absent" | "None"; // 出勤状态
  date?: string; // 具体日期 YYYY-MM-DD
}

// Filter state
export interface FilterState {
  branch: string[];
  level: string[];
  day: string[];
  subject: string[];
  grade: string[];
  teacher: string[];
  month: string[];
  attendance: string[];
}

// Summary statistics
export interface SummaryStats {
  totalSessions: number;
  totalTeachers: number;
  totalSubjects: number;
  avgAttendanceRate: number;
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
}

// Teacher statistics
export interface TeacherStats {
  name: string;
  totalHours: number;
  sessionsCount: number;
  presentRate: number;
  branchCounts: Record<string, number>;
  dayCounts: Record<string, number>;
}

// Gantt chart row data
export interface GanttRow {
  branch: string;
  day: string;
  sessions: Session[];
}

// Attendance trend data point
export interface TrendDataPoint {
  date: string;
  presentRate: number;
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
  total: number;
}

// Heatmap cell data
export interface HeatmapCell {
  teacher: string;
  day: string;
  hours: number;
  sessions: Session[];
}

// Tab types
export type TabType = "gantt" | "teachers" | "attendance";

// Attendance status type
export type AttendanceStatus = "full" | "high" | "mid" | "low" | "unmarked";

// Get attendance status from rate
export function getAttendanceStatus(rate: number, hasData: boolean): AttendanceStatus {
  if (!hasData) return "unmarked";
  if (rate >= 100) return "full";
  if (rate >= 80) return "high";
  if (rate >= 60) return "mid";
  return "low";
}

// Day order for sorting
export const DAY_ORDER = [
  "礼拜一",
  "礼拜二",
  "礼拜三",
  "礼拜四",
  "礼拜五",
  "礼拜六",
  "礼拜日",
];

// Time range constants
export const TIME_START = 8; // 8:00
export const TIME_END = 22; // 22:00
export const TIME_SLOTS = TIME_END - TIME_START; // 14 hours
