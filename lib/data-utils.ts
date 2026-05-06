import {
  Session,
  FilterState,
  SummaryStats,
  TeacherStats,
  GanttRow,
  TrendDataPoint,
  HeatmapCell,
  DAY_ORDER,
  TIME_START,
  TIME_END,
} from "./types";

// Parse time string to hours (decimal)
export function parseTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours + minutes / 60;
}

// Calculate session duration in hours
export function getSessionDuration(session: Session): number {
  return parseTime(session.endTime) - parseTime(session.startTime);
}

// Get session position for Gantt chart (percentage)
export function getSessionPosition(session: Session): { left: number; width: number } {
  const totalRange = TIME_END - TIME_START;
  const start = parseTime(session.startTime) - TIME_START;
  const duration = getSessionDuration(session);

  return {
    left: (start / totalRange) * 100,
    width: (duration / totalRange) * 100,
  };
}

// Apply filters to sessions
export function filterSessions(sessions: Session[], filters: FilterState): Session[] {
  return sessions.filter((session) => {
    if (filters.branch.length && !filters.branch.includes(session.branch)) return false;
    if (filters.level.length && !filters.level.includes(session.level)) return false;
    if (filters.day.length && !filters.day.includes(session.day)) return false;
    if (filters.subject.length && !filters.subject.includes(session.subject)) return false;
    if (filters.grade.length && !filters.grade.includes(session.grade)) return false;
    if (filters.teacher.length && !filters.teacher.includes(session.teacher)) return false;
    if (filters.month.length && !filters.month.includes(session.month)) return false;
    if (filters.attendance.length && !filters.attendance.includes(session.attendance)) return false;
    return true;
  });
}

// Calculate summary statistics
export function calculateSummaryStats(sessions: Session[]): SummaryStats {
  const presentCount = sessions.filter((s) => s.attendance === "Present").length;
  const absentCount = sessions.filter((s) => s.attendance === "Absent").length;
  const unmarkedCount = sessions.filter((s) => s.attendance === "None").length;
  const markedCount = presentCount + absentCount;

  return {
    totalSessions: sessions.length,
    totalTeachers: new Set(sessions.map((s) => s.teacher)).size,
    totalSubjects: new Set(sessions.map((s) => s.subject)).size,
    avgAttendanceRate: markedCount > 0 ? (presentCount / markedCount) * 100 : 0,
    presentCount,
    absentCount,
    unmarkedCount,
  };
}

// Calculate teacher statistics
export function calculateTeacherStats(sessions: Session[]): TeacherStats[] {
  const teacherMap = new Map<string, TeacherStats>();

  sessions.forEach((session) => {
    let stats = teacherMap.get(session.teacher);
    if (!stats) {
      stats = {
        name: session.teacher,
        totalHours: 0,
        sessionsCount: 0,
        presentRate: 0,
        branchCounts: {},
        dayCounts: {},
      };
      teacherMap.set(session.teacher, stats);
    }

    stats.totalHours += getSessionDuration(session);
    stats.sessionsCount++;
    stats.branchCounts[session.branch] = (stats.branchCounts[session.branch] || 0) + 1;
    stats.dayCounts[session.day] = (stats.dayCounts[session.day] || 0) + 1;
  });

  // Calculate present rates
  teacherMap.forEach((stats, teacher) => {
    const teacherSessions = sessions.filter((s) => s.teacher === teacher);
    const markedSessions = teacherSessions.filter((s) => s.attendance !== "None");
    const presentSessions = teacherSessions.filter((s) => s.attendance === "Present");
    stats.presentRate = markedSessions.length > 0 ? (presentSessions.length / markedSessions.length) * 100 : 0;
  });

  return Array.from(teacherMap.values()).sort((a, b) => b.totalHours - a.totalHours);
}

// Group sessions for Gantt chart
export function groupSessionsForGantt(sessions: Session[]): GanttRow[] {
  const groups = new Map<string, GanttRow>();

  sessions.forEach((session) => {
    const key = `${session.branch}-${session.day}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        branch: session.branch,
        day: session.day,
        sessions: [],
      };
      groups.set(key, row);
    }
    row.sessions.push(session);
  });

  // Sort by branch, then by day
  return Array.from(groups.values()).sort((a, b) => {
    if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);
    return DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
  });
}

// Calculate attendance trend data
export function calculateAttendanceTrend(sessions: Session[]): TrendDataPoint[] {
  const dateMap = new Map<string, TrendDataPoint>();

  sessions.forEach((session) => {
    if (!session.date) return;

    let point = dateMap.get(session.date);
    if (!point) {
      point = {
        date: session.date,
        presentRate: 0,
        presentCount: 0,
        absentCount: 0,
        unmarkedCount: 0,
        total: 0,
      };
      dateMap.set(session.date, point);
    }

    point.total++;
    if (session.attendance === "Present") point.presentCount++;
    else if (session.attendance === "Absent") point.absentCount++;
    else point.unmarkedCount++;
  });

  // Calculate rates
  dateMap.forEach((point) => {
    const marked = point.presentCount + point.absentCount;
    point.presentRate = marked > 0 ? (point.presentCount / marked) * 100 : 0;
  });

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Calculate heatmap data for teachers x days
export function calculateHeatmapData(sessions: Session[]): HeatmapCell[] {
  const cellMap = new Map<string, HeatmapCell>();

  sessions.forEach((session) => {
    const key = `${session.teacher}-${session.day}`;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        teacher: session.teacher,
        day: session.day,
        hours: 0,
        sessions: [],
      };
      cellMap.set(key, cell);
    }
    cell.hours += getSessionDuration(session);
    cell.sessions.push(session);
  });

  return Array.from(cellMap.values());
}

// Extract unique values for filters
export function extractFilterOptions(sessions: Session[]) {
  return {
    branches: [...new Set(sessions.map((s) => s.branch))].sort(),
    levels: [...new Set(sessions.map((s) => s.level))].sort(),
    days: DAY_ORDER.filter((d) => sessions.some((s) => s.day === d)),
    subjects: [...new Set(sessions.map((s) => s.subject))].sort(),
    grades: [...new Set(sessions.map((s) => s.grade))].sort(),
    teachers: [...new Set(sessions.map((s) => s.teacher))].sort(),
    months: [...new Set(sessions.map((s) => s.month))].sort(),
  };
}

// Format time for display
export function formatTime(time: string): string {
  return time;
}

// Format duration for display
export function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

// Format percentage
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
