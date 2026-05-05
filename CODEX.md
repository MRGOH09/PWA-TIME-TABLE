# AGENTS.md

## Project Name

周补习时间表 Dashboard

## Project Goal

Build a Vercel-hosted web dashboard that reads tuition class schedule and attendance data from Lark Base and displays a weekly schedule plus attendance performance for internal staff across multiple branches.

The dashboard helps staff understand:

- The fixed weekly tuition timetable for each branch
- Which teacher teaches which subject + grade at which time
- Class size and headcount per slot
- Attendance performance per slot, per teacher, per week, per month
- Comparison of branches, subjects, grades, and 中学/小学 segments

This project is similar in deployment style to the existing Vercel + Python Serverless + Lark Base REST API project pattern (Daycare Manpower Gantt), where static frontend files are served by Vercel and Python API routes read data from Lark Base.

The project is **read-only**. No create/update/delete features in V1. Do not implement editing.

---

# 1. Technical Stack

Use a simple Vercel project structure.

Do not use React unless explicitly requested.

Use:

- HTML
- CSS
- Vanilla JavaScript
- Python Serverless Functions on Vercel
- Lark Base REST API
- `requests` Python library only

Expected structure:

```text
/
├── index.html
├── manifest.json
├── sw.js
├── requirements.txt
├── api/
│   └── schedule.py
└── js/
    └── gantt.js
```

There is no editable version planned for V1.

Do not create `api/update-schedule.py`, `api/create-schedule.py`,
or `api/delete-schedule.py`.

---

# 2. Deployment Platform

Deploy on Vercel.

Use Vercel Python Serverless Functions.

Each Python API file must expose a `handler` class that inherits from:

```python
from http.server import BaseHTTPRequestHandler
```

The project may not need `vercel.json` unless required.

Note: the working directory is `老师时间表` (Chinese characters).
Local Vercel CLI may fail when project directory name contains Chinese characters.
Prefer pushing to GitHub and letting Vercel build from the remote.

---

# 3. Environment Variables

Use these Vercel environment variables:

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_BASE_TOKEN
LARK_TABLE_ID
```

`LARK_BASE_TOKEN` is the Lark Base app token.

`LARK_TABLE_ID` is the target table ID for the tuition schedule + attendance.

Do not hardcode credentials in source files.

There is no separate staff roster table for V1. Teacher names live in
the schedule table directly.

---

# 4. Lark API Flow

The backend API should:

1. Read environment variables
2. Request Lark tenant access token
3. Read records from Lark Base
4. Normalize Lark field values into clean JSON
5. Return JSON to frontend

Lark token endpoint:

```text
POST https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal
```

Lark records endpoint:

```text
GET https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records
```

Use:

```http
Authorization: Bearer <tenant_access_token>
```

The records API must support pagination.

Use `page_size=500` and loop with `page_token` until all records are retrieved.

Important: the table can hold thousands of session-level rows
(observed at >4,000). The backend must paginate, never assume one page is enough.

---

# 5. Lark Base Fields

The current Lark Base table contains these fields:

```text
No
Class
年纪
科目
礼拜
时间
分行
月份
looklookup
FORMULA 中小
None
Present
Absent
Teacher
LOOKUP老师名字
Date
日期
```

## Field meaning

```text
No                  自动编号 / formula / lock
Class               composite text label, eg "Thursday 08:00-09:30 ..."
年纪                grade, eg F1, F2, F3, F4, F5, F6, 标5, 标6
科目                subject code, eg SN, AM, ACC, BI
礼拜                day of week, eg 1.MON ... 7.SUN
时间                time range text, eg 08:00-09:30
分行                branch code, eg PU
月份                month, eg 1.JAN ... 12.DEC
looklookup          lookup of teacher full name
FORMULA 中小        formula deciding 中学 / 小学
None                班级总人数 not yet marked attendance
Present             已点名出席人数
Absent              已点名缺席人数
Teacher             teacher short name, eg CHUA
LOOKUP老师名字      teacher display name, eg MS.CHUA
Date                date text, eg 1/1/2026
日期                date type, eg 2026/01/01
```

Every row represents **one class session on one specific date**.

The dashboard derives the "weekly fixed timetable" by deduping rows
on `(分行, 礼拜, 时间, 科目, 年纪, Teacher)` — each unique combination
is one weekly slot. Multiple rows under the same combination are
historical sessions across different `日期` and contribute to attendance metrics.

---

# 6. Class Size Convention

Total students in a session:

```text
classSize = None + Present + Absent
```

The total is conserved before and after attendance is taken:

```text
Before marking:  None = total,    Present = 0,   Absent = 0
After marking:   None = 0,        Present + Absent = total
```

So `classSize` is always the headcount of that class.

For an unmarked session, `Present` and `Absent` are zero and
attendance rate is undefined — treat as 未点名.

---

# 7. Weekly Template

The week is fixed.

The dashboard does not need real dates for the schedule layout.

Valid weekday values:

```text
1.MON
2.TUE
3.WED
4.THU
5.FRI
6.SAT
7.SUN
```

Create a `dayOrder` value from these labels.

Example:

```js
"1.MON" -> 1
"4.THU" -> 4
```

Months use a similar format:

```text
1.JAN  2.FEB  3.MAR  4.APR
5.MAY  6.JUN  7.JUL  8.AUG
9.SEP  10.OCT 11.NOV 12.DEC
```

Create a `monthOrder` from those labels.

---

# 8. Time Axis

The Gantt chart time axis is fixed:

```text
08:00 to 22:00
```

In 24-hour format:

```text
08:00–22:00
```

Convert times into minutes from midnight.

Examples:

```text
08:00 = 480
08:30 = 510
22:00 = 1320
```

The time parser must handle these formats:

```text
08:00-09:30
8:00-9:30
8.00-9.30
08:00–09:30
08:00—09:30
8:00 - 9:30
```

Important parsing rules:

* Trim whitespace
* Support `–`, `—`, and `-` as separators
* Support `:` and `.` as hour/minute separators
* Pad single-digit hours
* Support 24-hour format (no AM/PM in current data)
* Treat invalid time ranges safely and do not break the page

Axis start:

```text
480
```

Axis end:

```text
1320
```

---

# 9. Branches, Grades, Subjects

## Branches

Branch codes are short labels (eg `PU`).
Multiple branches share the same Lark table.
The dashboard must be **branch-aware** at all times.
The default landing view is "all branches" with branch as a top filter.

## Grades

Grade values follow the Malaysian school system:

```text
F1, F2, F3, F4, F5, F6   (中学 secondary)
标5, 标6                  (小学 primary, label may vary)
```

The `FORMULA 中小` field maps grades into:

```text
中学
小学
```

Use `FORMULA 中小` for the 中小 filter and segmenting summary cards.

## Subjects

Subject codes come straight from the Lark `科目` field
(eg `SN`, `AM`, `ACC`, `BI`).

Do not hardcode a subject whitelist. Generate the subject filter list
dynamically from data.

---

# 10. API Output Format

`GET /api/schedule` should return:

```json
{
  "success": true,
  "updatedAt": "2026-05-05T22:00:00+08:00",
  "records": [
    {
      "recordId": "recxxxx",
      "no": 7,
      "branch": "PU",
      "day": "4.THU",
      "dayOrder": 4,
      "timeRange": "08:00-09:30",
      "startMinutes": 480,
      "endMinutes": 570,
      "subject": "SN",
      "grade": "F2",
      "level": "中学",
      "teacher": "CHUA",
      "teacherDisplay": "MS.CHUA",
      "month": "1.JAN",
      "monthOrder": 1,
      "date": "2026-01-01",
      "none": 34,
      "present": 0,
      "absent": 0,
      "classSize": 34
    }
  ]
}
```

The frontend should derive the weekly template, attendance metrics,
filters, and aggregations from this raw record set.

Always include `recordId` even though V1 is read-only — it makes
debugging and any future V2 editing path simpler.

---

# 11. Field Normalization Rules

Lark field values may come in different shapes.

Create helper functions to extract values safely.

Handle:

## Text / single select

```json
{"text": "PU"}
```

Return:

```text
PU
```

## Number

```json
34
```

Return number.

## Multi-select / lookup-like fields

```json
[
  {"text": "Su Yong Chua"}
]
```

Return:

```text
"Su Yong Chua"
```

For multi-value lookups, join with `, ` or return as array per field
contract above.

## Date field

Lark date fields can be:

```json
1735689600000
```

(epoch millis), or a `{"value": [...]}` shape.

Convert to ISO date `YYYY-MM-DD` for the API output.

## Empty fields

Return:

```text
""
```

for string fields,

```text
0
```

for numeric fields.

Do not crash if a field is missing.

---

# 12. View Modes

The dashboard offers three top-level views switchable via tabs:

```text
[ 周课表 Gantt ]   [ 老师工作量 ]   [ 出勤表现 ]
```

Switching tabs does not reload data — it only changes which view renders.

All three views share the same top filter row.

---

# 13. Gantt Chart Layout

The chart shows:

* Horizontal axis: time (08:00–22:00)
* Vertical axis: weekday rows, grouped by 分行

Default layout:

```text
PU
  1.MON
  2.TUE
  3.WED
  4.THU
  5.FRI
  6.SAT
  7.SUN

KL
  1.MON
  ...
```

When a single branch is selected (filter `分行 = PU`), the branch
grouping collapses to a single set of weekday rows.

Each bar represents one **weekly slot** — one unique
`(分行, 礼拜, 时间, 科目, 年纪, Teacher)` group, not a single session.

Bar position:

```text
left  = startMinutes - axisStartMinutes
width = endMinutes  - startMinutes
```

Axis start: `480`
Axis end:   `1320`

Overlapping slots inside the same `(分行, 礼拜)` row must be stacked
into separate vertical lanes via a layout helper similar to
`layoutRecordLanes()` in the daycare project.
Do not let bars overlap visually.

---

# 14. Bar Content

Inside each Gantt bar, show compact information:

```text
SN F2
MS.CHUA
30人
```

Where:

```text
Line 1:  科目 + 年纪
Line 2:  老师显示名字 (LOOKUP老师名字)
Line 3:  班级总人数 (None + Present + Absent)
```

If the slot has historical attendance across many sessions within the
current filters, append a small attendance rate badge:

```text
出 80%
```

On click, open detail panel or modal showing:

```text
分行：PU
礼拜：4.THU
时间：08:00-09:30
科目：SN
年纪：F2
中小：中学
老师：MS.CHUA

班级总人数：30
本期出勤率：80%
最近出勤率：85%

历史 sessions（N）
  2026-01-01  None 30  P 0   A 0   未点名
  2026-01-08  None 0   P 27  A 3   出 90%
  2026-01-15  None 0   P 24  A 6   出 80%
  ...
```

---

# 15. Filters

The dashboard must support multi-dimensional filters.

Required filters:

```text
分行
中小
礼拜
科目
年纪
老师
月份
出勤状态
```

All filters apply to all three views (some are hidden in views where
they make no sense — see per-view notes).

## 分行 Filter

```text
全部
PU
... (dynamic from data)
```

## 中小 Filter

```text
全部
中学
小学
```

## 礼拜 Filter

```text
全部
1.MON
2.TUE
3.WED
4.THU
5.FRI
6.SAT
7.SUN
```

## 科目 Filter

Generate options dynamically from `科目` values in the data.

## 年纪 Filter

Generate options dynamically from `年纪` values.

Sort `F1 < F2 < F3 < F4 < F5 < F6`, then primary labels after that.

## 老师 Filter

Generate teacher options dynamically from `Teacher` and `LOOKUP老师名字`.

Search uses `Teacher` short name as canonical key.

Display uses `LOOKUP老师名字`.

## 月份 Filter

```text
全部
1.JAN ... 12.DEC
```

This filter scopes attendance metrics to the chosen month.

The 周课表 still shows the same template regardless of 月份, but the
attendance rate badge inside each bar reflects the chosen month.

## 出勤状态 Filter

```text
全部
未点名
全勤
高出勤
中出勤
低出勤
```

Definitions live in section 17.

This filter only applies to the Gantt view. Hide it in 老师工作量 and 出勤表现.

---

# 16. Dashboard Summary Cards

At the top, show summary cards. Cards update when filters change.

Cards (default):

```text
总分行数
总老师数
总周课时数
总课程数（dedupe）
本期总人次
本期到课人次
本期缺课人次
本期出勤率
```

"本期" means the currently filtered scope — month, week, all data, or
whatever combination of filters is active.

When `中小 = 中学` is selected, all metrics scope to 中学 only
(and similarly for 小学).

---

# 17. Attendance Status Logic

For each session row:

```text
classSize       = none + present + absent
attended        = present
attendanceRate  = present / (present + absent)   // only if present + absent > 0
```

Status (per session):

```text
未点名      present + absent === 0
全勤        present > 0 and absent === 0
高出勤      attendanceRate >= 0.8 and absent > 0
中出勤      0.5 <= attendanceRate < 0.8
低出勤      attendanceRate < 0.5
```

For a weekly slot (aggregated over its session history within current filters):

```text
slotPresent      = Σ present
slotAbsent       = Σ absent
slotAttendance   = slotPresent / (slotPresent + slotAbsent)
```

Use the same thresholds for the aggregated slot status.

If the slot has zero non-未点名 sessions, treat the slot as 未点名.

Color guide:

```text
未点名      #94a3b8   grey
低出勤      #ef4444   red
中出勤      #f59e0b   amber
高出勤      #10b981   green
全勤        #38bdf8   blue
```

---

# 18. Responsive Design

The dashboard must work on:

* Desktop
* Tablet
* Mobile phone

On mobile:

* Allow horizontal scrolling for the time axis
* Keep filters accessible (collapsible filter drawer is OK)
* Bar content can be more compact (drop teacher line if needed)
* Detail modal must be readable, max-height 85vh, scrollable

---

# 19. Auto Refresh

Implement auto refresh every 30 seconds.

Use cache-busting:

```js
fetch('/api/schedule?t=' + Date.now())
```

Avoid rerendering if data has not changed (compare a hash or
`updatedAt + records.length`).

Pause auto refresh when:

* The browser tab is hidden
* A detail modal is open
* The user is interacting with a filter dropdown

---

# 20. Error Handling

Frontend must handle:

* Lark API error
* Missing environment variables
* Empty records
* Invalid time range
* Network error

Show clear user-facing messages in Chinese.

Example:

```text
无法读取 Lark Base 数据，请检查 App 权限、Base Token、Table ID 或字段名称。
```

Backend should return structured errors:

```json
{
  "success": false,
  "error": "Missing LARK_BASE_TOKEN"
}
```

---

# 21. Security

Do not expose:

```text
LARK_APP_ID
LARK_APP_SECRET
tenant_access_token
```

to frontend.

All Lark API calls must happen in Vercel serverless functions.

Escape all user-generated content (teacher names, branch labels)
before inserting into HTML.

Do not use `innerHTML` with raw Lark data unless escaped.

---

# 22. Read-Only Constraint

V1 is **strictly read-only**.

Do not implement:

```text
A. 编辑课程
B. 编辑老师
C. 编辑出勤
D. 新增时段
E. 删除时段
```

Do not add 新增 / 编辑 / 删除 buttons in the UI.

Do not create:

```text
api/create-schedule.py
api/update-schedule.py
api/delete-schedule.py
```

If editing is requested in the future, that becomes V2 work and should
be tracked in a separate spec.

---

# 23. Coding Style

Keep code simple and readable.

Use clear function names.

Suggested frontend functions:

```js
loadSchedule()
normalizeRecords()
parseTimeRange()
parseDayOrder()
parseMonthOrder()
deriveWeeklySlots()
computeSlotAttendance()
getSlotStatus()
renderFilters()
applyFilters()
renderSummary()
renderGantt()
renderDetailModal()
escapeHtml()
```

Suggested backend functions:

```python
get_env()
get_tenant_access_token()
fetch_all_records()
extract_text()
extract_list()
extract_number()
extract_date()
parse_day_order()
parse_month_order()
parse_time_range()
normalize_record()
send_json()
send_error()
```

---

# 24. Important Implementation Notes

## Do not assume Lark values are always strings.

Many Lark fields may return:

```json
{"text": "..."}
```

or:

```json
[{"text": "..."}]
```

or raw values.

Write robust extraction helpers.

## Do not skip rows where None > 0 and Present + Absent === 0.

These are valid future or unmarked sessions and must appear as
未点名 inside the detail modal.

## Do not aggregate attendance across 中学 and 小学 by mistake.

When `中小 = 中学` is chosen, primary rows must be excluded from
both the count cards and the rate calculation.

## Do not display dates only in `Date` text format.

Internally normalize to `YYYY-MM-DD`.

Display in 中文 short form is fine, but the underlying value must be the ISO date.

## Keep Chinese labels in UI.

The main users are internal staff who prefer 中文.

## Class size formula

```text
classSize = none + present + absent
```

is the source of truth. Do not duplicate the value in another field.

## Weekly slot deduplication key

```text
key = `${branch}|${day}|${timeRange}|${subject}|${grade}|${teacher}`
```

Use this key to derive the weekly Gantt template from the row stream.

## Hours per teacher counts distinct slots, not sessions

A weekly recurring class is one "slot" regardless of how many sessions
it has accumulated. Do not multiply hours by session count.

---

# 25. Deliverables for V1

Create:

```text
index.html
js/gantt.js
api/schedule.py
requirements.txt
manifest.json
sw.js
```

V1 must support:

```text
Read Lark Base
Render weekly Gantt grouped by 分行
Filter by 分行 / 中小 / 礼拜 / 科目 / 年纪 / 老师 / 月份 / 出勤状态
Calculate per-slot attendance rate from history
Show 未点名 / 全勤 / 高出勤 / 中出勤 / 低出勤 colors
Show summary cards
Open detail modal with session history
老师工作量 view (section 27)
出勤表现 view (section 28)
Responsive layout
Auto refresh
```

Do not implement editing in V1.

---

# 26. UI Language

Use mostly Chinese UI labels.

Recommended title:

```text
周补习时间表 Dashboard
```

Recommended subtitle:

```text
查看每个分行、每个礼拜、每位老师的课表与出勤表现
```

Use these labels:

```text
分行
中小
礼拜
时间
科目
年纪
老师
月份
班级总人数
出勤率
出勤状态
未点名
全勤
高出勤
中出勤
低出勤
本期总人次
本期到课人次
本期缺课人次
```

---

# 27. Teachers Workload View

A second top-level view for understanding per-teacher workload.

## Goal

Help internal staff answer:

* Who teaches the most / least this week
* What does a single teacher's week look like
* Which subjects and grades each teacher covers
* Which branch each teacher is assigned to
* Each teacher's attendance performance over the filtered period

## Top Tabs

A tab bar sits between the page header and the filter bar:

```text
[ 周课表 Gantt ]   [ 老师工作量 ]   [ 出勤表现 ]
```

Switching tabs does not reload data.

## Shared Filters

The same top filter row applies across views.

When in the Teachers view:

* `分行` / `中小` / `礼拜` / `科目` / `年纪` / `老师` reduce the
  record set *before* aggregation.
* `月份` scopes attendance metrics to the chosen month.
* `出勤状态` is Gantt-only and may be hidden in this view
  (use `data-view-only="gantt"` markers).

## Per-Teacher Metrics

For each teacher, compute over the filtered record set:

```text
slots             每老师的周课时段数 (dedupe weekly)
hours             总周工时（小时）= Σ over distinct slots (endMinutes - startMinutes) / 60
sessions          记录的 session 数
totalHead         Σ classSize across sessions
attended          Σ present
absent            Σ absent
attendanceRate    attended / (attended + absent)
byDay             { dayOrder: hours }
byBranch          { branch: hours }
bySubject         { subject: hours }
byGrade           { grade: hours }
```

`hours` counts distinct weekly slots so a recurring class is not
multiplied by the number of sessions.

## Components

### A. Summary Cards

```text
老师总数
中学老师
小学老师
总周课时
人均周课时
本期到课人次
本期缺课人次
本期出勤率
```

### B. Leaderboard Table

Columns:

```text
老师 | 分行 | 中小 | 周课时 | 课程数 | 班级总人数 | 出勤率 | 工时占比
```

Behavior:

* Click any column header to sort. Default `周课时` desc.
* Numeric columns default desc, name/branch default asc.
* The 工时占比 column is a horizontal bar tinted by 中小 (中学 / 小学).
* Click any row to open the teacher detail modal.

### C. Heatmap

Grid of `老师 × 礼拜`, intensity = hours that day.

```text
              MON   TUE   WED   THU   FRI   SAT   SUN   总
MS.CHUA       1.5h  .     1.5h  3h    1.5h  .     .     7.5h
CRYSTAL       .     3h    .     1.5h  .     3h    .     7.5h
```

Coloring:

* Empty cell uses `--panel-2`
* Filled cells use `rgba(56,189,248, intensity)` where
  `intensity = clamp(0.15 + 0.85 × hours/maxDayHours, 0, 0.95)`
* Click a teacher name in the first column to open detail.

### D. Teacher Detail Modal

Opened by clicking a teacher row or heatmap name.

Contents:

```text
姓名 + 中小 pill + 分行 pill

周课时
课程数
班级总人数
本期到课人次
本期缺课人次
本期出勤率

本周时间表 — mini Gantt: one short track per weekday,
            colored bars for each weekly slot

所有周课时段（N） — list:
  分行 · 礼拜 · 时间 · 科目 · 年纪 · 班级总人数 · 出勤率
```

## Cross-Linking from Gantt

In the Gantt slot detail modal, the teacher name becomes a clickable link.

Clicking it must:

1. Close the slot modal
2. Switch to the Teachers view (call `switchView('teachers')`)
3. Open that teacher's detail modal

## Suggested Frontend Functions

```js
computeTeacherStats(records)
sortTeacherStats(list)
renderTeachersSummary(stats, filtered)
renderTeachersTable(stats)
renderTeachersHeatmap(stats)
renderTeachersView(filtered)
openTeacherDetail(teacherKey, statsList)
switchView(view)
```

## Mobile

* Table allows horizontal scrolling
* Heatmap collapses label column to ~100px on narrow screens
* Detail modal max-width 560px, max-height 85vh, scrollable

---

# 28. Attendance Trend View

A third top-level view for tracking attendance performance over time.

## Goal

Help staff answer:

* How is attendance trending across weeks and months
* Which 分行 / 中小 / 科目 / 老师 segment is rising or falling
* When in the week is attendance highest / lowest
* Which slots consistently underperform

## Slicing Dimensions

The view has two stacked controls:

```text
横轴：[ 月份 | 礼拜 | 日期 ]
分组：[ 分行 | 中小 | 科目 | 年纪 | 老师 | 无 ]
```

* `横轴` chooses the time bucket
* `分组` chooses the legend / colored series

When `分组 = 无`, draw a single line / bar.

## Charts

### A. Attendance Rate Line Chart

X = the chosen 横轴 bucket
Y = attendance rate (0–100%)
Lines = one per group when `分组` is set.

### B. Headcount Stacked Bar Chart

X = the chosen 横轴 bucket
Y stacked = `present` (green) + `absent` (red) + `未点名` (grey).

### C. Slot Underperformance Table

Columns:

```text
分行 | 礼拜 | 时间 | 科目 | 年纪 | 老师 | 出勤率 | sessions
```

Sort by 出勤率 ascending. Show top 20.

This surfaces consistently weak slots that may need follow-up.

## Filters

Shared with other views. `出勤状态` is hidden here.

When `月份` filter is set, the 横轴 = 月份 chart still renders all months
but highlights the selected month.

## Suggested Frontend Functions

```js
computeAttendanceBuckets(records, axis, groupBy)
renderAttendanceLine(bucketed)
renderAttendanceStack(bucketed)
renderUnderperformingSlots(records)
renderAttendanceView(filtered)
```

## Mobile

* Use horizontal scroll for charts
* Stack the two controls vertically on narrow screens
* Underperformance table allows horizontal scroll

---

# 29. Future Considerations

These are explicitly out of scope for V1 but worth noting:

* PIN gate or Lark OAuth before public sharing
* Exporting attendance reports (CSV / PDF)
* Per-teacher attendance threshold alerts
* Branch-level KPIs comparing month-over-month
* Settings table inside Lark Base (eg attendance thresholds)
* Editable mode (V2) — separate spec

Do not implement the above in V1 unless explicitly requested.

---

# Current Progress — 2026-05-05

## V1 scaffolding shipped

Initial commit pushed to `MRGOH09/PWA-TIME-TABLE` (branch `main`).

Repository: https://github.com/MRGOH09/PWA-TIME-TABLE

Files created:

```text
.gitignore
AGENTS.md / CLAUDE.md / CODEX.md   (this spec, three identical copies)
index.html
manifest.json
sw.js
vercel.json
api/_lark.py
api/schedule.py
api/requirements.txt
js/gantt.js
```

All Python passes `python3 -m py_compile`.
JS passes `node --check`.
JSON passes `json.load`.

## What's implemented

Backend (`api/schedule.py` + `api/_lark.py`):

* Tenant access token flow on `open.larksuite.com`
* Pagination with `page_size=500` and `page_token` loop
* Field normalization for all 17 Lark fields in section 5
* `extract_text` / `extract_first_text` / `extract_number` / `extract_date`
* `parse_day_order` / `parse_month_order` / `parse_time_range`
* `normalize_record` returns the API contract from section 10
* `send_json` with CORS headers and no-store cache

Frontend (`index.html` + `js/gantt.js`):

* Three top-level tabs: 周课表 Gantt / 老师工作量 / 出勤表现
* Eight filters (`分行` / `中小` / `礼拜` / `科目` / `年纪` / `老师` /
  `月份` / `出勤状态`); the last one is Gantt-only
* Weekly slot derivation via dedupe key
  `${branch}|${day}|${timeRange}|${subject}|${grade}|${teacher}`
* Gantt grouped by 分行 → 礼拜, with overlapping slots stacked into lanes
* Bar color by attendance status: 未点名 / 全勤 / 高出勤 / 中出勤 / 低出勤
* Slot detail modal with full session history table
* Cross-link from slot modal teacher name → Teachers view detail
* Teachers view: summary cards, sortable leaderboard, 老师 × 礼拜 heatmap,
  teacher detail modal listing all weekly slots
* Attendance Trend view: line chart (rate by 月份/礼拜/日期 ×
  分行/中小/科目/年纪/老师), stacked bar (P / A / 未点名),
  underperforming-slots Top 20 table
* 30s auto refresh paused when tab hidden or modal open
* Responsive tweaks for screens narrower than 720px
* PWA manifest + service worker shell cache (`tuition-shell-v1`)

## Deployment configuration

Lark Open Platform App:

```text
LARK_APP_ID = cli_a9731ac2ccf89e17
```

Lark Base URL (region: jp.larksuite.com UI; API stays on
open.larksuite.com):

```text
LARK_BASE_TOKEN = HI4MbZfsiaU85bsZAYzj4zPnpng
LARK_TABLE_ID   = tblY1JhKUqxZ0dZZ
```

`LARK_APP_SECRET` is configured directly in Vercel only — never committed.

Required Lark scope for V1: `bitable:app:readonly` (read-only).
The App must be added to the Base with at least 可阅读 permission.

## Confirmed scope

* Read-only V1
* Multi-branch (current data observed: `PU`)
* Weekly fixed timetable derived from session-level rows
* Attendance broken down by 礼拜 and 月份
* Three views: 周课表 Gantt, 老师工作量, 出勤表现

## Pending

* Vercel deployment — env vars to be configured then deploy
* Lark App publish + 添加文档应用 to the target Base
* Smoke test against the live API once deployed
* Design refresh — current UI is functional dark dashboard;
  decision pending on direction (Apple Calendar / Linear / light /
  iOS / 商务报表 etc.)
* Mobile polish (label-col-w / minute-w already responsive,
  but full mobile pass not yet validated)
* Auth: V1 is fully public via the Vercel URL; revisit before
  sharing externally (PIN gate or Lark OAuth)

## Done so far in this session

```text
- Wrote three identical MD specs (AGENTS / CLAUDE / CODEX)
- Built api/_lark.py + api/schedule.py
- Built index.html + js/gantt.js + manifest.json + sw.js + vercel.json
- Verified syntax of all Python / JS / JSON
- git init in 老师时间表 (independent from parent home git repo)
- Pushed initial commit to MRGOH09/PWA-TIME-TABLE main
```

## Next Steps

1. Import repo on Vercel and set the four env vars
2. Trigger first deploy
3. Open the deployed URL and confirm `共 N 条记录` shows up
4. Iterate on visual design once a direction is chosen
5. Spot-check a few teacher modals + attendance charts with real data
