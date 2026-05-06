import { Session, DAY_ORDER } from "./types";

// Generate realistic mock data for development
const branches = ["东区分行", "西区分行", "南区分行", "北区分行"];
const levels = ["中", "小"] as const;
const subjects = ["数学", "英语", "语文", "物理", "化学", "生物"];
const grades = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"];
const teachers = ["张老师", "李老师", "王老师", "赵老师", "刘老师", "陈老师", "杨老师", "黄老师", "周老师", "吴老师"];
const months = ["2024-01", "2024-02", "2024-03"];

// Time slots
const timeSlots = [
  { start: "08:00", end: "09:30" },
  { start: "09:45", end: "11:15" },
  { start: "13:00", end: "14:30" },
  { start: "14:45", end: "16:15" },
  { start: "16:30", end: "18:00" },
  { start: "19:00", end: "20:30" },
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSessions(count: number): Session[] {
  const sessions: Session[] = [];

  for (let i = 0; i < count; i++) {
    const dayIndex = Math.floor(Math.random() * 7);
    const day = DAY_ORDER[dayIndex];
    const timeSlot = randomFrom(timeSlots);
    const month = randomFrom(months);
    const level = randomFrom(levels);
    
    // Determine grade based on level
    const gradeOptions = level === "小" 
      ? grades.slice(0, 6) // Elementary grades
      : grades.slice(6);   // Middle/High school grades
    
    const attendanceRoll = Math.random();
    let attendance: "Present" | "Absent" | "None";
    if (attendanceRoll < 0.7) {
      attendance = "Present";
    } else if (attendanceRoll < 0.85) {
      attendance = "Absent";
    } else {
      attendance = "None";
    }

    sessions.push({
      id: `session-${i}`,
      branch: randomFrom(branches),
      level,
      day,
      dayIndex,
      startTime: timeSlot.start,
      endTime: timeSlot.end,
      subject: randomFrom(subjects),
      grade: randomFrom(gradeOptions),
      teacher: randomFrom(teachers),
      month,
      attendance,
      date: generateDate(month, dayIndex),
    });
  }

  return sessions;
}

function generateDate(month: string, dayIndex: number): string {
  const [year, m] = month.split("-").map(Number);
  // Find a valid date for this day of week in the month
  const firstDay = new Date(year, m - 1, 1);
  const firstDayOfWeek = firstDay.getDay();
  const targetDayOfWeek = (dayIndex + 1) % 7; // Convert to Sunday=0 format
  
  let dayOfMonth = 1 + (targetDayOfWeek - firstDayOfWeek + 7) % 7;
  // Add some randomness for different weeks
  const weekOffset = Math.floor(Math.random() * 4) * 7;
  dayOfMonth += weekOffset;
  
  // Make sure it's a valid date
  const maxDays = new Date(year, m, 0).getDate();
  if (dayOfMonth > maxDays) {
    dayOfMonth -= 7;
  }
  
  return `${year}-${String(m).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

// Generate 200 sessions for demo
export const mockSessions: Session[] = generateSessions(200);

// Export filter options
export const mockFilterOptions = {
  branches,
  levels: ["中", "小"],
  days: DAY_ORDER,
  subjects,
  grades,
  teachers,
  months,
};
