'use strict';

// ===================================================================
// Constants
// ===================================================================

const AXIS_START = 480;   // 08:00
const AXIS_END = 1320;    // 22:00
const AXIS_SPAN = AXIS_END - AXIS_START;
const REFRESH_MS = 30000;

const DAYS = ['1.MON', '2.TUE', '3.WED', '4.THU', '5.FRI', '6.SAT', '7.SUN'];
const MONTHS = [
  '1.JAN', '2.FEB', '3.MAR', '4.APR', '5.MAY', '6.JUN',
  '7.JUL', '8.AUG', '9.SEP', '10.OCT', '11.NOV', '12.DEC'
];

const STATUS_LABEL = {
  unmarked: '未点名',
  full: '全勤',
  high: '高出勤',
  mid: '中出勤',
  low: '低出勤',
};

// ===================================================================
// State
// ===================================================================

const state = {
  records: [],
  updatedAt: '',
  view: 'gantt',
  filters: {
    branch: '',
    level: '',
    day: '',
    subject: '',
    grade: '',
    teacher: '',
    month: '',
    status: '',
  },
  attendanceCtl: {
    axis: 'month',
    group: '',
    matrixDimension: 'branch',
    matrixBucket: 'month',
    matrixMetric: 'rate',
  },
  teacherSort: { col: 'hours', dir: 'desc' },
  underperfSort: { col: 'rate', dir: 'asc' },
  modalOpen: false,
  lastDataHash: '',
  authUser: null,
  installPromptEvent: null,
};

// ===================================================================
// Utilities
// ===================================================================

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uniqueSorted(values, comparator) {
  const set = new Set();
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') set.add(v);
  }
  const arr = Array.from(set);
  arr.sort(comparator || ((a, b) => String(a).localeCompare(String(b))));
  return arr;
}

function dayOrderOf(label) {
  if (!label) return 99;
  const m = String(label).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

function monthOrderOf(label) {
  if (!label) return 99;
  const m = String(label).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

function gradeOrderOf(label) {
  if (!label) return 99;
  const s = String(label).trim();
  let m = s.match(/^F\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/^标\s*(\d+)/);
  if (m) return 100 + parseInt(m[1], 10);
  m = s.match(/^(\d+)/);
  if (m) return 200 + parseInt(m[1], 10);
  return 999;
}

function pct(x) {
  if (x === null || x === undefined || isNaN(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

function hoursOf(rec) {
  if (rec.startMinutes == null || rec.endMinutes == null) return 0;
  const m = rec.endMinutes - rec.startMinutes;
  return m > 0 ? m / 60 : 0;
}

function slotKey(rec) {
  return [rec.branch, rec.day, rec.timeRange, rec.subject, rec.grade, rec.teacher].join('|');
}

function aggAttendance(rows) {
  let present = 0, absent = 0, none = 0;
  for (const r of rows) {
    present += r.present || 0;
    absent += r.absent || 0;
    none += r.none || 0;
  }
  // N is treated as Absent. Rate = P / (P + A + N) when at least some marking exists.
  // If nothing has been marked yet (P+A === 0), rate is null and the slot shows 未点.
  const markedSome = (present + absent) > 0;
  const total = present + absent + none;
  const rate = markedSome && total > 0 ? present / total : null;
  return { present, absent, none, rate, sessions: rows.length };
}

function statusForAttendance(present, absent, none) {
  none = none || 0;
  const total = present + absent + none;
  if (total === 0) return 'empty';
  if ((present + absent) === 0) return 'unmarked';
  if (absent === 0 && none === 0 && present > 0) return 'full';
  const rate = present / total;
  if (rate >= 0.8) return 'high';
  if (rate >= 0.5) return 'mid';
  return 'low';
}

function isoWeekOf(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function computeTeacherSlotMatrix(teacherKey, records, bucketBy) {
  const teacherRecs = records.filter(r => r.teacher === teacherKey);
  const slotMap = new Map();
  const bucketSet = new Set();

  function getBucket(r) {
    if (bucketBy === 'month') return r.month || '';
    if (bucketBy === 'week') return isoWeekOf(r.date) || '';
    return '';
  }

  for (const r of teacherRecs) {
    if (!r.day || !r.timeRange) continue;
    const sk = slotKey(r);
    if (!slotMap.has(sk)) {
      slotMap.set(sk, {
        key: sk,
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        subject: r.subject,
        grade: r.grade,
        level: r.level,
        teacher: r.teacher,
        teacherDisplay: r.teacherDisplay,
        classSize: 0,
        buckets: {},
      });
    }
    const slot = slotMap.get(sk);
    if ((r.classSize || 0) > slot.classSize) slot.classSize = r.classSize;
    const bk = getBucket(r);
    if (!bk) continue;
    bucketSet.add(bk);
    if (!slot.buckets[bk]) slot.buckets[bk] = { present: 0, absent: 0, none: 0, sessions: 0 };
    const b = slot.buckets[bk];
    b.present += r.present || 0;
    b.absent += r.absent || 0;
    b.none += r.none || 0;
    b.sessions += 1;
  }

  let buckets;
  if (bucketBy === 'month') {
    buckets = Array.from(bucketSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  } else {
    buckets = Array.from(bucketSet).sort();
  }

  const slots = Array.from(slotMap.values()).sort((a, b) =>
    (a.dayOrder - b.dayOrder) || ((a.startMinutes || 0) - (b.startMinutes || 0))
  );

  return { slots, buckets };
}

function bucketLabel(bucket, bucketBy) {
  if (bucketBy === 'month') {
    const m = String(bucket).split('.');
    return m[1] || bucket;
  }
  const m = String(bucket).match(/W(\d+)/);
  return m ? 'W' + m[1] : bucket;
}

function computeTeacherBucketTotals(teacherKey, records, bucketBy) {
  // Reuse the slot matrix to guarantee that the aggregate row
  // is mathematically the sum of every visible slot row in the matrix below.
  const { slots, buckets } = computeTeacherSlotMatrix(teacherKey, records, bucketBy);
  const totals = {};
  for (const bucket of buckets) {
    let present = 0, absent = 0, none = 0, sessions = 0;
    for (const slot of slots) {
      const data = slot.buckets[bucket];
      if (!data) continue;
      present += data.present;
      absent += data.absent;
      none += data.none;
      sessions += data.sessions;
    }
    const total = present + absent + none;
    const markedTotal = present + absent;
    // N counts as Absent for the rate. Rate is null only when nothing has been marked at all.
    totals[bucket] = {
      present, absent, none, sessions,
      total, markedTotal,
      rate: markedTotal > 0 && total > 0 ? present / total : null,
    };
  }
  return { buckets, totals };
}

function renderTeacherSummary(teacherKey, records, bucketBy) {
  const { buckets, totals } = computeTeacherBucketTotals(teacherKey, records, bucketBy);
  if (!buckets.length) {
    return '<p style="color:var(--muted);font-size:12px;">没有'
      + (bucketBy === 'month' ? '月份' : '周次')
      + '数据</p>';
  }

  const fmt = (n) => Number(n).toLocaleString();
  const headers = buckets
    .map(b => `<th class="num">${escapeHtml(bucketLabel(b, bucketBy))}</th>`)
    .join('');

  // Track P count for trend (only buckets that have any data)
  let prevP = null, lastP = null;
  const presentCells = buckets.map(b => {
    const t = totals[b];
    if (!t) return `<td class="num cell-empty">—</td>`;
    const hasData = t.present !== 0 || t.absent !== 0 || t.none !== 0;
    if (hasData) {
      if (lastP != null) prevP = lastP;
      lastP = t.present;
    }
    return `<td class="num">${fmt(t.present)}</td>`;
  }).join('');

  let presentTrend = '<td class="num trend-flat">—</td>';
  if (prevP != null && lastP != null) {
    const delta = lastP - prevP;
    const pct = prevP > 0 ? (delta / prevP * 100) : null;
    const pctStr = pct != null ? ` (${delta >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : '';
    if (delta === 0) {
      presentTrend = `<td class="num trend-flat">→ 0${pctStr}</td>`;
    } else if (delta > 0) {
      presentTrend = `<td class="num trend-up">↑ +${fmt(delta)}${pctStr}</td>`;
    } else {
      presentTrend = `<td class="num trend-down">↓ ${fmt(delta)}${pctStr}</td>`;
    }
  }

  const absentCells = buckets.map(b => {
    const t = totals[b];
    return `<td class="num">${t ? fmt(t.absent) : '—'}</td>`;
  }).join('');
  const noneCells = buckets.map(b => {
    const t = totals[b];
    if (!t) return `<td class="num cell-empty">—</td>`;
    return `<td class="num" style="color:var(--muted);">${fmt(t.none)}</td>`;
  }).join('');
  const totalCells = buckets.map(b => {
    const t = totals[b];
    return `<td class="num">${t ? fmt(t.total) : '—'}</td>`;
  }).join('');

  const rateCells = buckets.map(b => {
    const t = totals[b];
    if (!t || t.total === 0) return `<td class="num cell-empty">—</td>`;
    if (t.markedTotal === 0) return `<td class="num cell-unmarked" title="未点名 (${t.none}人)">未点</td>`;
    const r = t.rate;
    const status = statusForAttendance(t.present, t.absent, t.none);
    const tooltip = `P ${t.present}  A ${t.absent}  N ${t.none}  (N 当作缺席)`;
    return `<td class="num cell-${status}" title="${escapeHtml(tooltip)}">${(r * 100).toFixed(1)}%</td>`;
  }).join('');

  return `
    <div class="month-matrix-wrap">
      <table class="month-matrix">
        <thead><tr>
          <th>指标</th>
          ${headers}
          <th class="num">趋势 (出席)</th>
        </tr></thead>
        <tbody>
          <tr><td><b>出席 (P)</b></td>${presentCells}${presentTrend}</tr>
          <tr><td><b>缺课 (A)</b></td>${absentCells}<td class="num"></td></tr>
          <tr><td><b>未点 (N)</b></td>${noneCells}<td class="num"></td></tr>
          <tr><td><b>总人次</b></td>${totalCells}<td class="num"></td></tr>
          <tr><td><b>出勤率</b></td>${rateCells}<td class="num"></td></tr>
        </tbody>
      </table>
    </div>
    <div class="matrix-hint">
      出勤率 = 出席 ÷ (出席 + 缺课 + 未点名)，<b>未点名 (N) 当作缺席</b>（与下方矩阵公式一致）。
      整个 bucket 完全没有人被点名时显示"未点"，避免未发生的课错误显示 0%。
      <b>趋势</b> = 最近两个有数据${bucketBy === 'month' ? '月' : '周'}的<b>出席人次差</b>，括号内是百分比变化。
    </div>
  `;
}

function renderTeacherMatrix(teacherKey, records, bucketBy, valueMode) {
  const { slots, buckets } = computeTeacherSlotMatrix(teacherKey, records, bucketBy);
  if (!slots.length) {
    return '<p style="color:var(--muted);font-size:12px;">没有数据</p>';
  }
  if (!buckets.length) {
    return '<p style="color:var(--muted);font-size:12px;">'
      + (bucketBy === 'month' ? '没有月份数据' : '没有日期数据')
      + '</p>';
  }

  const headers = buckets
    .map(b => `<th class="num">${escapeHtml(bucketLabel(b, bucketBy))}</th>`)
    .join('');

  const rowsHtml = slots.map(slot => {
    let prevRate = null;
    let lastRate = null;
    const cells = buckets.map(b => {
      const data = slot.buckets[b];
      if (!data || (data.present === 0 && data.absent === 0 && data.none === 0)) {
        return `<td class="num cell-empty">—</td>`;
      }
      if ((data.present + data.absent) === 0) {
        return `<td class="num cell-unmarked" title="未点名 (${data.none}人)">未点</td>`;
      }
      // N counts as Absent: rate = P / (P+A+N)
      const total = data.present + data.absent + data.none;
      const rate = data.present / total;
      if (lastRate != null) prevRate = lastRate;
      lastRate = rate;
      const status = statusForAttendance(data.present, data.absent, data.none);
      const display = valueMode === 'count' ? `${data.present}/${total}` : pct(rate);
      const tooltip = `P ${data.present}  A ${data.absent}  N ${data.none}  sessions ${data.sessions}  (N 当作缺席)`;
      return `<td class="num cell-${status}" title="${escapeHtml(tooltip)}">${escapeHtml(display)}</td>`;
    }).join('');

    let trendCell = '<td class="num trend-flat">—</td>';
    if (prevRate != null && lastRate != null) {
      const delta = lastRate - prevRate;
      const deltaPct = (delta * 100).toFixed(0);
      if (Math.abs(delta) < 0.05) {
        trendCell = `<td class="num trend-flat">→ ${delta >= 0 ? '+' : ''}${deltaPct}%</td>`;
      } else if (delta > 0) {
        trendCell = `<td class="num trend-up">↑ +${deltaPct}%</td>`;
      } else {
        trendCell = `<td class="num trend-down">↓ ${deltaPct}%</td>`;
      }
    }

    return `<tr>
      <td>${escapeHtml(slot.day)}</td>
      <td>${escapeHtml(slot.timeRange)}</td>
      <td>${escapeHtml(slot.subject)} ${escapeHtml(slot.grade)}</td>
      <td>${escapeHtml(slot.branch || '-')}</td>
      <td class="num">${slot.classSize}</td>
      ${cells}
      ${trendCell}
    </tr>`;
  }).join('');

  return `
    <div class="month-matrix-wrap">
      <table class="month-matrix">
        <thead><tr>
          <th>礼拜</th>
          <th>时间</th>
          <th>课程</th>
          <th>分行</th>
          <th class="num">人数</th>
          ${headers}
          <th class="num">趋势</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="matrix-hint">
      出勤率 = 出席 ÷ (出席 + 缺课 + 未点名)，<b>未点名 (N) 当作缺席</b>。
      单元格颜色：蓝=真 100% (P+A+N=P) / 绿≥80% / 橙≥50% / 红&lt;50% / 灰=完全未点。
      趋势 = 最近两个有数据的${bucketBy === 'month' ? '月' : '周'}的差值。鼠标悬停看 P/A/N/sessions。
    </div>
  `;
}

function fmtNum(n) {
  return Number(n).toLocaleString();
}

function formatCountTrend(delta, prev) {
  if (delta == null) return '<span class="trend-flat">—</span>';
  const pctStr = (prev != null && prev > 0)
    ? ` (${delta >= 0 ? '+' : ''}${(delta / prev * 100).toFixed(1)}%)`
    : '';
  if (delta === 0) return `<span class="trend-flat">→ 0${pctStr}</span>`;
  if (delta > 0) return `<span class="trend-up">↑ +${fmtNum(delta)}${pctStr}</span>`;
  return `<span class="trend-down">↓ ${fmtNum(delta)}${pctStr}</span>`;
}

function monthDeltaPair(monthPMap) {
  const sorted = Array.from(monthPMap.keys()).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  if (sorted.length < 2) return { lastP: sorted.length === 1 ? monthPMap.get(sorted[0]) : null, prevP: null, delta: null };
  const lastMonth = sorted[sorted.length - 1];
  const prevMonth = sorted[sorted.length - 2];
  const lastP = monthPMap.get(lastMonth);
  const prevP = monthPMap.get(prevMonth);
  return { lastP, prevP, delta: lastP - prevP, lastMonth, prevMonth };
}

function monthFirstLastDelta(monthPMap) {
  const sorted = Array.from(monthPMap.keys()).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  if (sorted.length < 2) return { firstP: null, lastP: null, delta: null };
  const firstMonth = sorted[0];
  const lastMonth = sorted[sorted.length - 1];
  const firstP = monthPMap.get(firstMonth);
  const lastP = monthPMap.get(lastMonth);
  return { firstP, lastP, delta: lastP - firstP, firstMonth, lastMonth };
}

function weekOrderOf(label) {
  if (!label) return '';
  const m = String(label).match(/^(\d{4})-W(\d{2})$/);
  if (!m) return String(label);
  return `${m[1]}${m[2]}`;
}

function isoWeekStartDate(label) {
  const m = String(label || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return monday;
}

function compactDateLabel(date, includeMonth) {
  if (!date) return '';
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return includeMonth ? `${month}/${day}` : String(day);
}

function weekLabel(label) {
  const start = isoWeekStartDate(label);
  if (!start) return label || '';
  const weekNo = String(label).match(/W(\d{2})$/);
  return `${start.getUTCMonth() + 1}月 W${weekNo ? parseInt(weekNo[1], 10) : ''}`;
}

function weekFullLabel(label) {
  const start = isoWeekStartDate(label);
  if (!start) return label || '';
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${label} · ${compactDateLabel(start, true)}-${compactDateLabel(end, true)}`;
}

function ensureMetricBucket(map, key) {
  if (!map[key]) {
    map[key] = {
      present: 0,
      absent: 0,
      none: 0,
      sessions: 0,
      effectiveSessions: 0,
      unmarkedSessions: 0,
      effectiveHead: 0,
      effectivePresent: 0,
      effectiveAbsent: 0,
      effectiveNone: 0,
      pendingHead: 0,
    };
  }
  return map[key];
}

function addRecordToMetricBucket(bucket, r) {
  const present = r.present || 0;
  const absent = r.absent || 0;
  const none = r.none || 0;
  const total = present + absent + none;
  bucket.present += present;
  bucket.absent += absent;
  bucket.none += none;
  bucket.sessions += 1;
  if ((present + absent) > 0) {
    bucket.effectiveSessions += 1;
    bucket.effectiveHead += total;
    bucket.effectivePresent += present;
    bucket.effectiveAbsent += absent;
    bucket.effectiveNone += none;
  } else if (total > 0) {
    bucket.unmarkedSessions += 1;
    bucket.pendingHead += total;
  }
}

function weekOfRecord(r) {
  return isoWeekOf(r.date) || '';
}

function bucketEffectiveHead(bucket) {
  if (!bucket || !bucket.effectiveSessions) return null;
  return bucket.effectiveHead;
}

function valueDeltaPair(valueMap, sorter) {
  const sorted = Array.from(valueMap.keys()).sort(sorter);
  if (sorted.length < 2) {
    return { prev: null, last: sorted.length === 1 ? valueMap.get(sorted[0]) : null, delta: null };
  }
  const prevKey = sorted[sorted.length - 2];
  const lastKey = sorted[sorted.length - 1];
  const prev = valueMap.get(prevKey);
  const last = valueMap.get(lastKey);
  return { prev, last, delta: last - prev, prevKey, lastKey };
}

function formatAvgTrend(delta, prev) {
  if (delta == null || isNaN(delta)) return '<span class="trend-flat">—</span>';
  const signed = `${delta >= 0 ? '+' : ''}${fmtNum(Math.round(delta))}人`;
  const pctStr = (prev != null && prev > 0)
    ? ` (${delta >= 0 ? '+' : ''}${(delta / prev * 100).toFixed(1)}%)`
    : '';
  if (Math.abs(delta) < 0.05) return `<span class="trend-flat">→ 0${pctStr}</span>`;
  if (delta > 0) return `<span class="trend-up">↑ ${signed}${pctStr}</span>`;
  return `<span class="trend-down">↓ ${signed}${pctStr}</span>`;
}

function weekHeadCellHtml(weekData) {
  if (!weekData || weekData.sessions === 0) {
    return `<td class="num cell-empty">—</td>`;
  }
  const totalHead = bucketEffectiveHead(weekData);
  if (totalHead == null) {
    const tooltip = `未纳入：${weekData.unmarkedSessions} 课未点名`;
    return `<td class="num cell-empty" title="${escapeHtml(tooltip)}">—</td>`;
  }
  const status = statusForAttendance(
    weekData.effectivePresent || 0,
    weekData.effectiveAbsent || 0,
    weekData.effectiveNone || 0
  );
  const display = `${fmtNum(totalHead)}人`;
  const tooltip = [
    `有效总人数 ${fmtNum(totalHead)}`,
    `有效课 ${weekData.effectiveSessions}`,
    `未纳入未点名课 ${weekData.unmarkedSessions}`,
    `有效P ${weekData.effectivePresent || 0}`,
    `有效A ${weekData.effectiveAbsent || 0}`,
    `有效N ${weekData.effectiveNone || 0}`,
    `全部P/A/N ${weekData.present}/${weekData.absent}/${weekData.none}`,
  ].join('  ');
  return `<td class="num cell-${status}" title="${escapeHtml(tooltip)}">${escapeHtml(display)}</td>`;
}

function periodTrend(value, prevValue, hasPrev) {
  if (!hasPrev) {
    return { cls: 'contrib-new', label: '无上一期可比' };
  }
  const delta = value - (prevValue || 0);
  if (delta > 0) return { cls: 'contrib-up', label: `比上一期 +${fmtNum(delta)}` };
  if (delta < 0) return { cls: 'contrib-down', label: `比上一期 ${fmtNum(delta)}` };
  return { cls: 'contrib-flat', label: '与上一期相同' };
}

function contributionTrend(value, prevData) {
  return periodTrend(value, prevData ? (prevData.effectiveHead || 0) : 0, Boolean(prevData && prevData.effectiveSessions));
}

function classCountCellHtml(data, prevData) {
  if (!data || !data.effectiveSessions) {
    return `<td class="num cell-empty">—</td>`;
  }
  const value = data.effectiveHead || 0;
  const trend = contributionTrend(value, prevData);
  const tooltip = [
    `有效科数 ${fmtNum(value)}`,
    trend.label,
    `有效课次 ${data.effectiveSessions || 0}`,
    `未纳入未点名课次 ${data.unmarkedSessions || 0}`,
    `全部课 ${data.sessions || 0}`,
    `P ${data.present || 0}`,
    `A ${data.absent || 0}`,
    `N ${data.none || 0}`,
  ].join('  ');
  return `<td class="num cell-contrib ${trend.cls}" title="${escapeHtml(tooltip)}">${fmtNum(value)}</td>`;
}

function contributionTotalCellHtml(value) {
  return `<td class="num cell-contrib contrib-total"><b>${fmtNum(value)}</b></td>`;
}

function computeTeacherClassContributions(records, teacher, level) {
  const filtered = records.filter(r =>
    r.teacher === teacher && (!level || r.level === level) && r.day && r.timeRange
  );
  const slotMap = new Map();
  const monthSet = new Set();
  const weekSet = new Set();

  for (const r of filtered) {
    const sk = slotKey(r);
    if (!slotMap.has(sk)) {
      slotMap.set(sk, {
        key: sk,
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        subject: r.subject,
        grade: r.grade,
        level: r.level,
        classSize: 0,
        months: {},
        weeks: {},
      });
    }
    const slot = slotMap.get(sk);
    if ((r.classSize || 0) > slot.classSize) slot.classSize = r.classSize || 0;
    if (r.month) {
      monthSet.add(r.month);
      addRecordToMetricBucket(ensureMetricBucket(slot.months, r.month), r);
    }
    const wk = weekOfRecord(r);
    if (wk) {
      weekSet.add(wk);
      addRecordToMetricBucket(ensureMetricBucket(slot.weeks, wk), r);
    }
  }

  const slots = Array.from(slotMap.values()).sort((a, b) =>
    (a.dayOrder - b.dayOrder)
    || ((a.startMinutes || 0) - (b.startMinutes || 0))
    || String(a.subject || '').localeCompare(String(b.subject || ''))
    || String(a.grade || '').localeCompare(String(b.grade || ''))
  );
  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const weeks = Array.from(weekSet).sort((a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));
  return { slots, months, weeks };
}

function classifyAttendanceTrend(points) {
  if (points.length < 3) return 'insufficient';
  const values = points.map(p => p.avgPresent);
  const first = values[0];
  const last = values[values.length - 1];
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const range = Math.max(...values) - Math.min(...values);
  const totalDelta = last - first;
  const meaningfulDelta = Math.max(1, mean * 0.05);
  const stableRange = Math.max(2, mean * 0.1);
  const stepTolerance = 0.5;
  const deltas = values.slice(1).map((v, i) => v - values[i]);
  const mostlyUp = deltas.filter(d => d >= -stepTolerance).length >= deltas.length - 1;
  const mostlyDown = deltas.filter(d => d <= stepTolerance).length >= deltas.length - 1;

  if (totalDelta >= meaningfulDelta && mostlyUp) return 'improving';
  if (totalDelta <= -meaningfulDelta && mostlyDown) return 'declining';
  if (Math.abs(totalDelta) < meaningfulDelta || range <= stableRange) return 'steady';
  return 'steady';
}

function computeTeacherAttendanceClassTrend(records, teacher, level) {
  const filtered = records.filter(r =>
    r.teacher === teacher && (!level || r.level === level) && r.day && r.timeRange
  );
  const slotMap = new Map();
  const monthSet = new Set();

  for (const r of filtered) {
    if (!r.month) continue;
    const present = r.present || 0;
    const absent = r.absent || 0;
    const none = r.none || 0;
    if ((present + absent) === 0) continue;
    monthSet.add(r.month);
    const sk = slotKey(r);
    if (!slotMap.has(sk)) {
      slotMap.set(sk, {
        key: sk,
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        subject: r.subject,
        grade: r.grade,
        classSize: 0,
        months: {},
      });
    }
    const slot = slotMap.get(sk);
    if ((r.classSize || 0) > slot.classSize) slot.classSize = r.classSize || 0;
    if (!slot.months[r.month]) {
      slot.months[r.month] = { present: 0, absent: 0, none: 0, sessions: 0 };
    }
    slot.months[r.month].present += present;
    slot.months[r.month].absent += absent;
    slot.months[r.month].none += none;
    slot.months[r.month].sessions += 1;
  }

  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const groups = { improving: [], steady: [], declining: [] };
  let insufficient = 0;

  for (const slot of slotMap.values()) {
    const points = months
      .map(month => {
        const m = slot.months[month];
        if (!m || !m.sessions) return null;
        return {
          month,
          present: m.present,
          sessions: m.sessions,
          avgPresent: m.present / m.sessions,
          absent: m.absent,
          none: m.none,
        };
      })
      .filter(Boolean);
    const category = classifyAttendanceTrend(points);
    if (category === 'insufficient') {
      insufficient += 1;
      continue;
    }
    const first = points[0];
    const last = points[points.length - 1];
    groups[category].push({
      ...slot,
      points,
      firstAvg: first.avgPresent,
      lastAvg: last.avgPresent,
      delta: last.avgPresent - first.avgPresent,
      firstMonth: first.month,
      lastMonth: last.month,
    });
  }

  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta)
      || (a.dayOrder - b.dayOrder)
      || ((a.startMinutes || 0) - (b.startMinutes || 0))
    );
  }

  return { groups, months, insufficient };
}

function renderTeacherAttendanceClassTrend(records, teacher, level) {
  const { groups, insufficient } = computeTeacherAttendanceClassTrend(records, teacher, level);
  const totalClassified = groups.improving.length + groups.steady.length + groups.declining.length;
  if (!totalClassified) {
    return `
      <div class="issue-summary">
        <div class="issue-card good"><span>整体进步班</span><b>0</b></div>
        <div class="issue-card"><span>稳定保持班</span><b>0</b></div>
        <div class="issue-card low"><span>整体退步班</span><b>0</b></div>
      </div>
      <p style="color:var(--muted);font-size:12px;">目前没有足够月份可分类。每个班至少需要 3 个已点名月份。</p>`;
  }

  function sequenceLabel(slot) {
    return slot.points
      .map(p => `${String(p.month).split('.')[1] || p.month}:${p.avgPresent.toFixed(1)}`)
      .join(' → ');
  }

  function avgPresentTrend(delta, prev) {
    if (delta == null || isNaN(delta)) return '<span class="trend-flat">—</span>';
    const pctStr = prev > 0 ? ` (${delta >= 0 ? '+' : ''}${(delta / prev * 100).toFixed(1)}%)` : '';
    if (Math.abs(delta) < 0.05) return `<span class="trend-flat">→ 0${pctStr}</span>`;
    if (delta > 0) return `<span class="trend-up">↑ +${delta.toFixed(1)}人${pctStr}</span>`;
    return `<span class="trend-down">↓ ${delta.toFixed(1)}人${pctStr}</span>`;
  }

  function categoryTable(title, key, note) {
    const list = groups[key];
    if (!list.length) {
      return `
        <h4 class="issue-subtitle">${escapeHtml(title)} <span>${escapeHtml(note)}</span></h4>
        <p style="color:var(--muted);font-size:12px;">暂无班级。</p>`;
    }
    const rows = list.map(slot => `
      <tr>
        <td>${escapeHtml(slot.subject || '-')} ${escapeHtml(slot.grade || '')}</td>
        <td>${escapeHtml(slot.branch || '-')}</td>
        <td>${escapeHtml(slot.day || '-')}</td>
        <td>${escapeHtml(slot.timeRange || '-')}</td>
        <td class="num">${fmtNum(slot.classSize)}</td>
        <td class="num">${slot.firstAvg.toFixed(1)}</td>
        <td class="num">${slot.lastAvg.toFixed(1)}</td>
        <td class="col-trend">${avgPresentTrend(slot.delta, slot.firstAvg)}</td>
        <td>${escapeHtml(sequenceLabel(slot))}</td>
      </tr>`).join('');
    return `
      <h4 class="issue-subtitle">${escapeHtml(title)} <span>${escapeHtml(note)}</span></h4>
      <div class="month-matrix-wrap">
        <table class="data month-matrix issue-table">
          <thead><tr>
            <th>课程</th>
            <th>分行</th>
            <th>礼拜</th>
            <th>时间</th>
            <th class="num">人数</th>
            <th class="num">首月平均P/课</th>
            <th class="num">最近平均P/课</th>
            <th>变化</th>
            <th>月份走势</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  return `
    <div class="issue-summary">
      <div class="issue-card good"><span>整体进步班</span><b>${fmtNum(groups.improving.length)}</b></div>
      <div class="issue-card"><span>稳定保持班</span><b>${fmtNum(groups.steady.length)}</b></div>
      <div class="issue-card low"><span>整体退步班</span><b>${fmtNum(groups.declining.length)}</b></div>
      <div class="issue-card unmarked"><span>资料不足</span><b>${fmtNum(insufficient)}</b></div>
    </div>
    ${categoryTable('整体进步班', 'improving', '平均出席人数明显上升，允许中间小幅波动')}
    ${categoryTable('稳定保持班', 'steady', '没有明显上升/下降，或只属于正常小波动')}
    ${categoryTable('整体退步班', 'declining', '平均出席人数明显下降，允许中间小幅波动')}
    <div class="matrix-hint">
      分类口径：按每班“每月平均每课出席人数”判断，避免 4 次课月份和 5 次课月份直接比总 P 造成误判。
      只纳入 P+A&gt;0 的已点名课；完全未点名课不参与趋势。至少 3 个已点名月份才分类；
      明显变化门槛为至少 1 人或约 5%，稳定保持班包含正常波动。
    </div>`;
}

// ===================================================================
// Data loading + localStorage cache
// ===================================================================

const CACHE_KEY_BASE = 'tuition-schedule-cache-v2';

function cacheKey() {
  const user = state.authUser || {};
  const id = (user.email || user.username || 'anonymous').toLowerCase();
  return `${CACHE_KEY_BASE}:${id}`;
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveToLocalStorage(data) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({
      updatedAt: data.updatedAt,
      access: data.access || null,
      records: data.records,
      savedAt: Date.now(),
    }));
  } catch (e) {
    // localStorage may be full / disabled — silently ignore
  }
}

function applyData(data, source) {
  const newHash = `${data.updatedAt}|${(data.records || []).length}`;
  if (newHash === state.lastDataHash && state.records.length) {
    state.dataSource = source;
    updateMeta();
    return false;
  }
  state.lastDataHash = newHash;
  state.records = data.records || [];
  state.updatedAt = data.updatedAt || '';
  state.access = data.access || null;
  state.dataSource = source;
  rebuildFilters();
  renderAll();
  updateMeta();
  return true;
}

async function loadSchedule(opts) {
  // On initial open: render last cached snapshot immediately so the
  // user sees something while we wait for the network.
  if (opts && opts.useCache) {
    const cached = loadFromLocalStorage();
    if (cached) applyData(cached, 'cache');
  }

  try {
    // No ?t= cache-bust — we want CDN edge cache to work.
    const resp = await fetch('/api/schedule');
    const data = await resp.json();
    if (resp.status === 401) {
      location.replace('/api/auth_login');
      return;
    }
    if (!data || !data.success) {
      throw new Error(data && data.error ? data.error : '未知错误');
    }
    const changed = applyData(data, 'network');
    if (changed) saveToLocalStorage(data);
  } catch (err) {
    if (state.records.length) {
      // We already have something showing; keep it instead of clobbering with an error.
      console.warn('schedule fetch failed, keeping previous data:', err);
      return;
    }
    $('#meta').textContent = '无法读取 Lark Base 数据：' + (err.message || err);
    $('#meta').style.color = 'var(--status-low)';
  }
}

async function loadAuthState({ redirectIfNeeded = false } = {}) {
  const node = $('#auth-status');
  try {
    const resp = await fetch('/api/auth_me');
    const data = await resp.json();
    if (!data || !data.success) throw new Error('auth check failed');
    if (!data.authRequired) {
      if (node) node.style.display = 'none';
      return true;
    }
    if (data.authenticated) {
      state.authUser = data.user || null;
      const username = (data.user && (data.user.name || data.user.email || data.user.username)) || '已登录';
      if (node) {
        node.style.display = '';
        node.className = 'auth-chip ok';
        node.innerHTML = `${escapeHtml(username)} <button type="button" id="auth-logout">登出</button>`;
        $('#auth-logout').addEventListener('click', async () => {
          await fetch('/api/auth_logout', { method: 'POST' });
          try { localStorage.removeItem(cacheKey()); } catch (e) {}
          location.href = '/api/auth_login';
        });
      }
      return true;
    }
    state.authUser = null;
    if (redirectIfNeeded) {
      location.replace('/api/auth_login');
      return false;
    }
    if (node) {
      node.style.display = '';
      node.className = 'auth-chip warn';
      node.innerHTML = '未登录 <button type="button" id="auth-login">登录</button>';
      $('#auth-login').addEventListener('click', () => {
        location.href = '/api/auth_login';
      });
    }
    return false;
  } catch (err) {
    state.authUser = null;
    if (node) {
      node.style.display = '';
      node.className = 'auth-chip warn';
      node.textContent = '登录状态未知';
    }
    if (redirectIfNeeded) {
      location.replace('/api/auth_login');
    }
    return false;
  }
}

function updateMeta() {
  $('#meta').style.color = '';
  const tail = state.dataSource === 'cache'
    ? ' · <span style="color:var(--muted);">显示本地缓存，正在刷新…</span>'
    : '';
  const access = state.access && state.access.permission
    ? ` · 权限 ${escapeHtml(state.access.permission)}`
    : '';
  $('#meta').innerHTML = `共 ${state.records.length} 条记录 · 更新时间 ${escapeHtml(state.updatedAt || '-')}${access}${tail}`;
}

// ===================================================================
// Filter rebuild
// ===================================================================

function rebuildFilters() {
  const recs = state.records;

  const branches = uniqueSorted(recs.map(r => r.branch));
  const days = uniqueSorted(recs.map(r => r.day), (a, b) => dayOrderOf(a) - dayOrderOf(b));
  const subjects = uniqueSorted(recs.map(r => r.subject));
  const grades = uniqueSorted(recs.map(r => r.grade), (a, b) => gradeOrderOf(a) - gradeOrderOf(b));
  const teachers = uniqueSorted(recs.map(r => r.teacher));
  const months = uniqueSorted(recs.map(r => r.month), (a, b) => monthOrderOf(a) - monthOrderOf(b));

  fillSelect('#f-branch', branches, state.filters.branch);
  fillSelect('#f-day', days, state.filters.day);
  fillSelect('#f-subject', subjects, state.filters.subject);
  fillSelect('#f-grade', grades, state.filters.grade);
  fillSelect('#f-teacher', teachers, state.filters.teacher, (key) => {
    const r = recs.find(rr => rr.teacher === key);
    return r ? `${r.teacherDisplay || key}` : key;
  });
  fillSelect('#f-month', months, state.filters.month);
}

function fillSelect(sel, values, current, labelFn) {
  const node = $(sel);
  if (!node) return;
  const head = node.querySelector('option[value=""]');
  node.innerHTML = '';
  if (head) {
    node.appendChild(head);
  } else {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '全部';
    node.appendChild(opt);
  }
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labelFn ? labelFn(v) : v;
    node.appendChild(opt);
  }
  if (current && values.includes(current)) {
    node.value = current;
  } else {
    node.value = '';
  }
}

// ===================================================================
// Filtering
// ===================================================================

function passFilters(rec, includeStatus) {
  const f = state.filters;
  if (f.branch && rec.branch !== f.branch) return false;
  if (f.level && rec.level !== f.level) return false;
  if (f.day && rec.day !== f.day) return false;
  if (f.subject && rec.subject !== f.subject) return false;
  if (f.grade && rec.grade !== f.grade) return false;
  if (f.teacher && rec.teacher !== f.teacher) return false;
  if (f.month && rec.month !== f.month) return false;
  if (includeStatus && f.status) {
    const st = statusForAttendance(rec.present, rec.absent, rec.none);
    if (st !== f.status) return false;
  }
  return true;
}

function filteredRecords() {
  return state.records.filter(r => passFilters(r, false));
}

// ===================================================================
// Slot derivation (weekly template)
// ===================================================================

function deriveWeeklySlots(records) {
  const map = new Map();
  for (const r of records) {
    if (!r.day || r.startMinutes == null || r.endMinutes == null) continue;
    const key = slotKey(r);
    if (!map.has(key)) {
      map.set(key, {
        key,
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        endMinutes: r.endMinutes,
        subject: r.subject,
        grade: r.grade,
        level: r.level,
        teacher: r.teacher,
        teacherDisplay: r.teacherDisplay || r.teacher,
        sessions: [],
      });
    }
    map.get(key).sessions.push(r);
  }
  for (const slot of map.values()) {
    const agg = aggAttendance(slot.sessions);
    slot.present = agg.present;
    slot.absent = agg.absent;
    slot.none = agg.none;
    slot.attendanceRate = agg.rate;
    slot.sessionCount = agg.sessions;
    slot.classSize = Math.max(...slot.sessions.map(s => s.classSize || 0), 0);
    slot.status = statusForAttendance(slot.present, slot.absent, slot.none);
  }
  return Array.from(map.values());
}

// ===================================================================
// Render — top meta + summary cards
// ===================================================================

function renderAll() {
  renderSummary();
  if (state.view === 'gantt') renderGantt();
  if (state.view === 'teachers') renderTeachersView();
  if (state.view === 'subjects') renderSubjectsView();
  if (state.view === 'attendance') renderAttendanceView();
}

function renderSummary() {
  const records = filteredRecords();
  const slots = deriveWeeklySlots(records);
  const branches = new Set(records.map(r => r.branch).filter(Boolean));
  const teachers = new Set(records.map(r => r.teacher).filter(Boolean));
  let present = 0, absent = 0, none = 0;
  for (const r of records) {
    present += r.present || 0;
    absent += r.absent || 0;
    none += r.none || 0;
  }
  const markedSome = (present + absent) > 0;
  const total = present + absent + none;
  const rate = markedSome && total > 0 ? present / total : null;

  const cards = [
    { label: '总分行数', value: branches.size },
    { label: '总老师数', value: teachers.size },
    { label: '总周课时段数', value: slots.length },
    { label: '总记录数', value: records.length },
    { label: '本期到课人次', value: present, cls: 'high' },
    { label: '本期等同缺席', value: absent + none, cls: 'low' },
    { label: 'A/N 拆分', value: `${absent}/${none}`, cls: 'unmarked' },
    { label: '本期出勤率', value: pct(rate), cls: rate == null ? 'unmarked' : (rate >= 0.8 ? 'high' : (rate >= 0.5 ? 'mid' : 'low')) },
  ];

  $('#summary').innerHTML = cards.map(c => `
    <div class="card ${c.cls || ''}">
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="value">${escapeHtml(c.value)}</div>
    </div>
  `).join('');
}

// ===================================================================
// Render — Gantt view
// ===================================================================

function renderGantt() {
  const root = $('#gantt-root');
  let slots = deriveWeeklySlots(filteredRecords());

  if (state.filters.status) {
    slots = slots.filter(s => s.status === state.filters.status);
  }

  if (slots.length === 0) {
    root.innerHTML = '<div class="empty-msg">没有符合筛选条件的课程</div>';
    return;
  }

  // Group by branch
  const branchMap = new Map();
  for (const slot of slots) {
    const b = slot.branch || '(无分行)';
    if (!branchMap.has(b)) branchMap.set(b, []);
    branchMap.get(b).push(slot);
  }
  const branchNames = Array.from(branchMap.keys()).sort();

  const html = branchNames.map(branch => renderBranchBlock(branch, branchMap.get(branch), branchNames.length === 1)).join('');
  root.innerHTML = html;

  // Bind clicks on bars / mobile cards
  root.querySelectorAll('.bar, .mobile-slot-card').forEach(node => {
    node.addEventListener('click', () => {
      const key = node.getAttribute('data-key');
      const slot = slots.find(s => s.key === key);
      if (slot) openSlotModal(slot);
    });
  });
}

function renderBranchBlock(branch, slots, soloBranch) {
  const dayMap = new Map();
  for (const slot of slots) {
    if (!dayMap.has(slot.day)) dayMap.set(slot.day, []);
    dayMap.get(slot.day).push(slot);
  }
  const days = Array.from(dayMap.keys()).sort((a, b) => dayOrderOf(a) - dayOrderOf(b));

  const ticks = renderTicks();

  const rowsHtml = days.map(day => {
    const daySlots = dayMap.get(day);
    const lanes = layoutLanes(daySlots);
    const laneCount = Math.max(1, lanes.length);
    const rowH = 60 * laneCount;
    const labelHtml = `<div class="row-label" style="height:${rowH}px">${escapeHtml(day)}</div>`;
    const barsHtml = lanes.map((lane, laneIdx) => {
      return lane.map(slot => renderBar(slot, laneIdx, laneCount)).join('');
    }).join('');
    const rowHtml = `<div class="row" style="height:${rowH}px">${barsHtml}</div>`;
    return { labelHtml, rowHtml };
  });

  const labelsCol = '<div class="axis-spacer"></div>' + rowsHtml.map(r => r.labelHtml).join('');
  const timeline = `<div class="gantt-timeline-wrap"><div class="gantt-timeline">
    <div class="axis">${ticks}</div>
    ${rowsHtml.map(r => r.rowHtml).join('')}
  </div></div>`;

  const titleHtml = soloBranch
    ? ''
    : `<div class="branch-title">分行：${escapeHtml(branch)} <span class="small">${slots.length} 个时段</span></div>`;

  return `
    <div class="branch-block">
      ${titleHtml}
      <div class="gantt ${soloBranch ? 'solo' : ''}">
        <div class="gantt-labels">${labelsCol}</div>
        ${timeline}
      </div>
      ${renderMobileBranchList(slots)}
    </div>
  `;
}

function renderMobileBranchList(slots) {
  const dayMap = new Map();
  for (const slot of slots) {
    if (!dayMap.has(slot.day)) dayMap.set(slot.day, []);
    dayMap.get(slot.day).push(slot);
  }
  const days = Array.from(dayMap.keys()).sort((a, b) => dayOrderOf(a) - dayOrderOf(b));
  return `<div class="mobile-schedule-list">
    ${days.map(day => {
      const daySlots = dayMap.get(day).slice().sort((a, b) =>
        ((a.startMinutes || 0) - (b.startMinutes || 0))
        || String(a.subject || '').localeCompare(String(b.subject || ''))
        || String(a.grade || '').localeCompare(String(b.grade || ''))
      );
      return `<div class="mobile-day-block">
        <div class="mobile-day-heading">${escapeHtml(day)} · ${daySlots.length} 个时段</div>
        ${daySlots.map(renderMobileSlotCard).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function renderMobileSlotCard(slot) {
  const cls = slot.status && slot.status !== 'empty' ? slot.status : 'unmarked';
  const rateText = slot.attendanceRate == null
    ? (STATUS_LABEL[slot.status] || '未点名')
    : `${pct(slot.attendanceRate)} 出勤`;
  const teacher = slot.teacherDisplay || slot.teacher || '-';
  return `
    <button class="mobile-slot-card ${cls}" type="button" data-key="${escapeHtml(slot.key)}">
      <div class="slot-top">
        <div class="slot-time">${escapeHtml(slot.timeRange || '-')}</div>
        <div class="slot-rate">${escapeHtml(rateText)}</div>
      </div>
      <div class="slot-main">${escapeHtml(slot.subject || '?')} ${escapeHtml(slot.grade || '')}</div>
      <div class="slot-meta">
        <span>${escapeHtml(teacher)}</span>
        <span>${escapeHtml(slot.branch || '-')}</span>
        <span>${fmtNum(slot.classSize)}人</span>
        <span>${fmtNum(slot.sessionCount)}次</span>
      </div>
    </button>
  `;
}

function renderTicks() {
  let html = '';
  for (let h = 8; h <= 22; h++) {
    const minutes = h * 60 - AXIS_START;
    const left = `calc(${minutes} * var(--minute-w))`;
    html += `<div class="tick" style="left:${left}">${String(h).padStart(2, '0')}:00</div>`;
  }
  return html;
}

function layoutLanes(slots) {
  // Sort by start time
  const sorted = slots.slice().sort((a, b) => (a.startMinutes || 0) - (b.startMinutes || 0));
  const lanes = [];
  for (const slot of sorted) {
    let placed = false;
    for (const lane of lanes) {
      const last = lane[lane.length - 1];
      if ((slot.startMinutes || 0) >= (last.endMinutes || 0)) {
        lane.push(slot);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([slot]);
    }
  }
  return lanes;
}

function renderBar(slot, laneIdx, laneCount) {
  const left = (slot.startMinutes - AXIS_START);
  const width = Math.max(1, slot.endMinutes - slot.startMinutes);
  const top = laneIdx * 60 + 4;
  const height = 60 - 8;
  const cls = slot.status || 'unmarked';
  const att = slot.attendanceRate;
  const attBadge = att != null ? `<span class="att-badge">出 ${pct(att)}</span>` : '';
  const teacherShort = slot.teacherDisplay || slot.teacher || '';

  return `
    <div class="bar ${cls}" data-key="${escapeHtml(slot.key)}"
         style="left: calc(${left} * var(--minute-w)); width: calc(${width} * var(--minute-w)); top:${top}px; height:${height}px;">
      <div class="l1">${escapeHtml(slot.subject || '?')} ${escapeHtml(slot.grade || '')}</div>
      <div class="l2">${escapeHtml(teacherShort)}</div>
      <div class="l3">${slot.classSize}人 · ${escapeHtml(slot.timeRange)}</div>
      ${attBadge}
    </div>
  `;
}

// ===================================================================
// Slot modal
// ===================================================================

function openSlotModal(slot) {
  const sessions = slot.sessions.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const sessionsHtml = sessions.length
    ? `<table>
        <thead><tr><th>日期</th><th>None</th><th>P</th><th>A</th><th>状态</th></tr></thead>
        <tbody>${sessions.map(s => {
          const st = statusForAttendance(s.present, s.absent, s.none);
          return `<tr>
            <td>${escapeHtml(s.date || '-')}</td>
            <td>${s.none}</td>
            <td>${s.present}</td>
            <td>${s.absent}</td>
            <td>${escapeHtml(STATUS_LABEL[st] || st)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : '<p style="color:var(--muted);font-size:12px;">没有 session 记录</p>';

  const lvlPill = slot.level === '中学' ? '<span class="pill secondary-level">中学</span>'
                : slot.level === '小学' ? '<span class="pill primary-level">小学</span>'
                : '';

  const teacherLink = slot.teacher
    ? `<span class="clickable-name" data-teacher="${escapeHtml(slot.teacher)}" data-level="${escapeHtml(slot.level || '')}">${escapeHtml(slot.teacherDisplay || slot.teacher)}</span>`
    : '-';

  const html = `
    <h2>${escapeHtml(slot.subject)} ${escapeHtml(slot.grade)} ${lvlPill}</h2>
    <dl>
      <dt>分行</dt><dd>${escapeHtml(slot.branch || '-')}</dd>
      <dt>礼拜</dt><dd>${escapeHtml(slot.day || '-')}</dd>
      <dt>时间</dt><dd>${escapeHtml(slot.timeRange || '-')}</dd>
      <dt>科目</dt><dd>${escapeHtml(slot.subject || '-')}</dd>
      <dt>年纪</dt><dd>${escapeHtml(slot.grade || '-')}</dd>
      <dt>中小</dt><dd>${escapeHtml(slot.level || '-')}</dd>
      <dt>老师</dt><dd>${teacherLink}</dd>
      <dt>班级总人数</dt><dd>${slot.classSize}</dd>
      <dt>本期出勤率</dt><dd>${slot.attendanceRate == null ? '未点名' : pct(slot.attendanceRate)}</dd>
      <dt>状态</dt><dd>${escapeHtml(STATUS_LABEL[slot.status] || slot.status)}</dd>
    </dl>
    <h3>历史 sessions（${sessions.length}）</h3>
    ${sessionsHtml}
    <div class="actions">
      <button id="modal-close" type="button">关闭</button>
    </div>
  `;
  $('#modal-content').innerHTML = html;
  $('#modal-root').classList.add('show');
  state.modalOpen = true;
  $('#modal-close').addEventListener('click', closeModal);
  const link = $('#modal-content .clickable-name');
  if (link) {
    link.addEventListener('click', () => {
      const t = link.getAttribute('data-teacher');
      const lvl = link.getAttribute('data-level') || '';
      closeModal();
      switchView('teachers');
      openTeacherModal(t, lvl);
    });
  }
}

function closeModal() {
  $('#modal-root').classList.remove('show');
  $('#modal-content').classList.remove('wide');
  state.modalOpen = false;
}

// ===================================================================
// Teachers view
// ===================================================================

function computeTeacherStats(records, level) {
  const filtered = level ? records.filter(r => r.level === level) : records;
  const map = new Map();
  const monthSet = new Set();
  const weekSet = new Set();

  for (const r of filtered) {
    if (!r.teacher) continue;
    if (r.month) monthSet.add(r.month);
    const wk = weekOfRecord(r);
    if (wk) weekSet.add(wk);
    const key = r.teacher;
    if (!map.has(key)) {
      map.set(key, {
        teacher: key,
        teacherDisplay: r.teacherDisplay || key,
        slotKeys: new Set(),
        subjects: new Set(),
        grades: new Set(),
        branches: new Set(),
        levels: new Set(),
        slotClassSize: new Map(),
        present: 0, absent: 0, none: 0,
        months: {},
        weeks: {},
        monthPMap: new Map(),
        weekHeadMap: new Map(),
      });
    }
    const s = map.get(key);
    if (r.day && r.timeRange) {
      const sk = slotKey(r);
      s.slotKeys.add(sk);
      const prev = s.slotClassSize.get(sk) || 0;
      if ((r.classSize || 0) > prev) s.slotClassSize.set(sk, r.classSize || 0);
    }
    if (r.subject) s.subjects.add(r.subject);
    if (r.grade) s.grades.add(r.grade);
    if (r.branch) s.branches.add(r.branch);
    if (r.level) s.levels.add(r.level);
    s.present += r.present || 0;
    s.absent += r.absent || 0;
    s.none += r.none || 0;
    if (r.month) {
      if (!s.months[r.month]) s.months[r.month] = { present: 0, absent: 0, none: 0 };
      s.months[r.month].present += r.present || 0;
      s.months[r.month].absent += r.absent || 0;
      s.months[r.month].none += r.none || 0;
      s.monthPMap.set(r.month, (s.monthPMap.get(r.month) || 0) + (r.present || 0));
    }
    if (wk) addRecordToMetricBucket(ensureMetricBucket(s.weeks, wk), r);
  }

  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const weeks = Array.from(weekSet).sort((a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));

  const stats = [];
  for (const s of map.values()) {
    const total = s.present + s.absent + s.none;
    const markedSome = (s.present + s.absent) > 0;
    const rate = markedSome && total > 0 ? s.present / total : null;
    let classSizeSum = 0;
    s.slotClassSize.forEach(v => { classSizeSum += v; });
    const trend = monthDeltaPair(s.monthPMap);
    const overall = monthFirstLastDelta(s.monthPMap);
    for (const wk of weeks) {
      const avg = bucketEffectiveHead(s.weeks[wk]);
      if (avg != null) s.weekHeadMap.set(wk, avg);
    }
    const weekTrend = valueDeltaPair(s.weekHeadMap, (a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));
    stats.push({
      teacher: s.teacher,
      teacherDisplay: s.teacherDisplay,
      slots: s.slotKeys.size,
      subjects: Array.from(s.subjects).sort(),
      grades: Array.from(s.grades).sort((a, b) => gradeOrderOf(a) - gradeOrderOf(b)),
      branches: Array.from(s.branches).sort(),
      levels: Array.from(s.levels),
      present: s.present,
      absent: s.absent,
      none: s.none,
      total,
      classSize: classSizeSum,
      rate,
      months: s.months,
      weeks: s.weeks,
      monthPMap: s.monthPMap,
      weekHeadMap: s.weekHeadMap,
      trendDelta: trend.delta,
      lastP: trend.lastP,
      prevP: trend.prevP,
      overallDelta: overall.delta,
      overallFirstP: overall.firstP,
      overallLastP: overall.lastP,
      weekTrendDelta: weekTrend.delta,
      weekTrendPrev: weekTrend.prev,
      weekTrendLast: weekTrend.last,
    });
  }

  stats.sort((a, b) => b.present - a.present);
  return { stats, months, weeks };
}

function computeTeacherBreakdown(records, teacher, level, dimension) {
  const filtered = records.filter(r =>
    r.teacher === teacher && (!level || r.level === level) && r[dimension]
  );
  const map = new Map();
  const monthSet = new Set();
  const weekSet = new Set();

  for (const r of filtered) {
    const key = r[dimension];
    if (r.month) monthSet.add(r.month);
    const wk = weekOfRecord(r);
    if (wk) weekSet.add(wk);
    if (!map.has(key)) {
      map.set(key, {
        key,
        slotKeys: new Set(),
        present: 0, absent: 0, none: 0,
        slotClassSize: new Map(),
        months: {},
        weeks: {},
        monthPMap: new Map(),
        weekHeadMap: new Map(),
      });
    }
    const e = map.get(key);
    if (r.day && r.timeRange) {
      const sk = slotKey(r);
      e.slotKeys.add(sk);
      const prev = e.slotClassSize.get(sk) || 0;
      if ((r.classSize || 0) > prev) e.slotClassSize.set(sk, r.classSize || 0);
    }
    e.present += r.present || 0;
    e.absent += r.absent || 0;
    e.none += r.none || 0;
    if (r.month) {
      if (!e.months[r.month]) e.months[r.month] = { present: 0, absent: 0, none: 0 };
      e.months[r.month].present += r.present || 0;
      e.months[r.month].absent += r.absent || 0;
      e.months[r.month].none += r.none || 0;
      e.monthPMap.set(r.month, (e.monthPMap.get(r.month) || 0) + (r.present || 0));
    }
    if (wk) addRecordToMetricBucket(ensureMetricBucket(e.weeks, wk), r);
  }

  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const weeks = Array.from(weekSet).sort((a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));

  const stats = [];
  for (const e of map.values()) {
    const total = e.present + e.absent + e.none;
    const markedSome = (e.present + e.absent) > 0;
    const rate = markedSome && total > 0 ? e.present / total : null;
    let classSizeSum = 0;
    e.slotClassSize.forEach(v => { classSizeSum += v; });
    const trend = monthDeltaPair(e.monthPMap);
    const overall = monthFirstLastDelta(e.monthPMap);
    for (const wk of weeks) {
      const avg = bucketEffectiveHead(e.weeks[wk]);
      if (avg != null) e.weekHeadMap.set(wk, avg);
    }
    const weekTrend = valueDeltaPair(e.weekHeadMap, (a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));
    stats.push({
      key: e.key,
      slots: e.slotKeys.size,
      present: e.present,
      absent: e.absent,
      none: e.none,
      total,
      classSize: classSizeSum,
      rate,
      months: e.months,
      weeks: e.weeks,
      monthPMap: e.monthPMap,
      weekHeadMap: e.weekHeadMap,
      trendDelta: trend.delta,
      lastP: trend.lastP,
      prevP: trend.prevP,
      overallDelta: overall.delta,
      overallFirstP: overall.firstP,
      overallLastP: overall.lastP,
      weekTrendDelta: weekTrend.delta,
      weekTrendPrev: weekTrend.prev,
      weekTrendLast: weekTrend.last,
    });
  }

  if (dimension === 'grade') {
    stats.sort((a, b) => gradeOrderOf(a.key) - gradeOrderOf(b.key));
  } else {
    stats.sort((a, b) => b.present - a.present);
  }
  return { stats, months, weeks };
}

function renderTeachersView() {
  const records = filteredRecords();

  const all = computeTeacherStats(records);
  const sec = computeTeacherStats(records, '中学');
  const pri = computeTeacherStats(records, '小学');
  const totalP = all.stats.reduce((a, s) => a + s.present, 0);
  const totalA = all.stats.reduce((a, s) => a + s.absent, 0);
  const totalN = all.stats.reduce((a, s) => a + s.none, 0);
  const totalAll = totalP + totalA + totalN;
  const overallRate = (totalP + totalA) > 0 && totalAll > 0 ? totalP / totalAll : null;

  const cards = [
    { label: '老师总数', value: all.stats.length },
    { label: '中学老师', value: sec.stats.length },
    { label: '小学老师', value: pri.stats.length },
    { label: '本期总出席', value: fmtNum(totalP), cls: 'high' },
    { label: '本期等同缺席', value: fmtNum(totalA + totalN), cls: 'low' },
    { label: 'A/N 拆分', value: `${fmtNum(totalA)}/${fmtNum(totalN)}`, cls: 'unmarked' },
    { label: '本期出勤率', value: pct(overallRate), cls: overallRate == null ? 'unmarked' : (overallRate >= 0.8 ? 'high' : (overallRate >= 0.5 ? 'mid' : 'low')) },
  ];
  $('#teachers-summary').innerHTML = cards.map(c => `
    <div class="card ${c.cls || ''}">
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="value">${escapeHtml(c.value)}</div>
    </div>
  `).join('');

  $('#teachers-table-wrap').innerHTML = `
    <div class="subject-section-title">中学老师 <span class="small">按总出席降序 · 单元格 = 该月出席人次</span></div>
    ${renderTeacherLeaderboard(records, '中学')}
    <div class="subject-section-title" style="margin-top:18px;">中学老师周总人数 <span class="small">单元格 = 有效总人数 · 未点名不纳入正式总人数</span></div>
    ${renderTeacherWeekLeaderboard(records, '中学')}
    <div class="subject-section-title primary" style="margin-top:18px;">小学老师 <span class="small">按总出席降序 · 单元格 = 该月出席人次</span></div>
    ${renderTeacherLeaderboard(records, '小学')}
    <div class="subject-section-title primary" style="margin-top:18px;">小学老师周总人数 <span class="small">单元格 = 有效总人数 · 未点名不纳入正式总人数</span></div>
    ${renderTeacherWeekLeaderboard(records, '小学')}
  `;
  // Heatmap section is no longer used in the teachers view; clear it so a previous render does not linger.
  $('#teachers-heatmap-wrap').innerHTML = '';

  $$('#view-teachers table tbody tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => {
      const teacher = tr.getAttribute('data-teacher');
      const lvl = tr.getAttribute('data-level');
      openTeacherModal(teacher, lvl);
    });
  });
}

function renderTeacherLeaderboard(records, level) {
  const { stats, months } = computeTeacherStats(records, level);
  if (!stats.length) {
    return `<div class="empty-msg">没有 ${escapeHtml(level)} 老师数据</div>`;
  }
  if (!months.length) {
    return `<div class="empty-msg">没有月份数据</div>`;
  }

  const monthHeaders = months
    .map(m => `<th class="num">${escapeHtml(m.split('.')[1] || m)}</th>`)
    .join('');

  const rows = stats.map(s => {
    const monthCells = months.map((m, idx) => {
      const prev = idx > 0 ? s.months[months[idx - 1]] : null;
      return monthTrendCellHtml(s.months[m], prev);
    }).join('');
    const branchLabel = s.branches.length ? s.branches.join(', ') : '-';
    return `<tr class="clickable" data-teacher="${escapeHtml(s.teacher)}" data-level="${escapeHtml(level)}">
      <td class="col-key">${escapeHtml(s.teacherDisplay)}</td>
      <td>${escapeHtml(branchLabel)}</td>
      <td class="num">${s.slots}</td>
      <td class="num">${s.subjects.length}</td>
      ${monthCells}
      <td class="num"><b>${fmtNum(s.present)}</b></td>
      <td class="num">${pct(s.rate)}</td>
      <td class="col-trend">${formatCountTrend(s.trendDelta, s.prevP)}</td>
      <td class="col-trend">${formatCountTrend(s.overallDelta, s.overallFirstP)}</td>
    </tr>`;
  }).join('');

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>老师</th>
      <th>分行</th>
	      <th class="num">班数</th>
      <th class="num">科目</th>
      ${monthHeaders}
      <th class="num">总出席</th>
      <th class="num">出勤率</th>
      <th title="最近两个月对比">月环比</th>
      <th title="第一个月 vs 最后一个月">全期</th>
    </tr></thead>
    <tbody>${rows}</tbody>
	  </table></div>
    <div class="matrix-hint">颜色表示与上月比较：绿=变好，红=变少，灰=持平，蓝=无上月可比。</div>`;
}

function renderTeacherWeekLeaderboard(records, level) {
  const { stats, weeks } = computeTeacherStats(records, level);
  if (!stats.length) {
    return `<div class="empty-msg">没有 ${escapeHtml(level)} 老师数据</div>`;
  }
  if (!weeks.length) {
    return `<div class="empty-msg">没有周数据</div>`;
  }

  const weekHeaders = weeks
    .map(w => `<th class="num" title="${escapeHtml(weekFullLabel(w))}">${escapeHtml(weekLabel(w))}</th>`)
    .join('');

  const rows = stats.map(s => {
    const weekCells = weeks.map((w, idx) => {
      const prev = idx > 0 ? s.weeks[weeks[idx - 1]] : null;
      return weekHeadTrendCellHtml(s.weeks[w], prev);
    }).join('');
    const branchLabel = s.branches.length ? s.branches.join(', ') : '-';
    return `<tr class="clickable" data-teacher="${escapeHtml(s.teacher)}" data-level="${escapeHtml(level)}">
      <td class="col-key">${escapeHtml(s.teacherDisplay)}</td>
      <td>${escapeHtml(branchLabel)}</td>
      <td class="num">${s.slots}</td>
      <td class="num">${s.subjects.length}</td>
      ${weekCells}
      <td class="col-trend">${formatAvgTrend(s.weekTrendDelta, s.weekTrendPrev)}</td>
    </tr>`;
  }).join('');

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>老师</th>
      <th>分行</th>
      <th class="num">班数</th>
      <th class="num">科目</th>
      ${weekHeaders}
      <th title="最近两个有效周对比">周变化</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div class="matrix-hint">周总人数单元格 = 有效总人数。只统计 P+A&gt;0 的课；P+A=0 的未点名课不纳入正式总人数。颜色表示与上一周比较：绿=变好，红=变少，灰=持平，蓝=无上一周可比。</div>`;
}

function renderTeacherBreakdownTable(records, teacher, level, dimension, label) {
  const { stats, months } = computeTeacherBreakdown(records, teacher, level, dimension);
  if (!stats.length) return '<p style="color:var(--muted);font-size:12px;">没有数据</p>';
  if (!months.length) return '<p style="color:var(--muted);font-size:12px;">没有月份数据</p>';

  const monthHeaders = months
    .map(m => `<th class="num">${escapeHtml(m.split('.')[1] || m)}</th>`)
    .join('');

  const rows = stats.map(s => {
    const monthCells = months.map((m, idx) => {
      const prev = idx > 0 ? s.months[months[idx - 1]] : null;
      return monthTrendCellHtml(s.months[m], prev);
    }).join('');
    return `<tr>
      <td class="col-key">${escapeHtml(s.key)}</td>
      <td class="num">${s.slots}</td>
      ${monthCells}
      <td class="num"><b>${fmtNum(s.present)}</b></td>
      <td class="num">${pct(s.rate)}</td>
      <td class="col-trend">${formatCountTrend(s.trendDelta, s.prevP)}</td>
      <td class="col-trend">${formatCountTrend(s.overallDelta, s.overallFirstP)}</td>
    </tr>`;
  }).join('');

  const aggMonthly = {};
  for (const m of months) {
    aggMonthly[m] = { present: 0, absent: 0, none: 0 };
    for (const s of stats) {
      const md = s.months[m];
      if (md) {
        aggMonthly[m].present += md.present;
        aggMonthly[m].absent += md.absent;
        aggMonthly[m].none += md.none;
      }
    }
  }
  const aggMonthCells = months.map((m, idx) => {
    const prev = idx > 0 ? aggMonthly[months[idx - 1]] : null;
    return monthTrendCellHtml(aggMonthly[m], prev);
  }).join('');
  const aggSlots = stats.reduce((a, s) => a + s.slots, 0);
  const aggP = stats.reduce((a, s) => a + s.present, 0);
  const aggA = stats.reduce((a, s) => a + s.absent, 0);
  const aggN = stats.reduce((a, s) => a + s.none, 0);
  const aggTotal = aggP + aggA + aggN;
  const aggRate = (aggP + aggA) > 0 && aggTotal > 0 ? aggP / aggTotal : null;
  const aggMonthPMap = new Map();
  for (const m of months) aggMonthPMap.set(m, aggMonthly[m].present);
  const aggTrend = monthDeltaPair(aggMonthPMap);
  const aggOverall = monthFirstLastDelta(aggMonthPMap);

  const aggRow = `<tr class="agg-row">
    <td>合计</td>
    <td class="num">${aggSlots}</td>
    ${aggMonthCells}
    <td class="num">${fmtNum(aggP)}</td>
    <td class="num">${pct(aggRate)}</td>
    <td class="col-trend">${formatCountTrend(aggTrend.delta, aggTrend.prevP)}</td>
    <td class="col-trend">${formatCountTrend(aggOverall.delta, aggOverall.firstP)}</td>
  </tr>`;

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>${escapeHtml(label)}</th>
      <th class="num">班数</th>
      ${monthHeaders}
      <th class="num">总出席</th>
      <th class="num">出勤率</th>
      <th title="最近两个月对比">月环比</th>
      <th title="第一个月 vs 最后一个月">全期</th>
    </tr></thead>
    <tbody>${rows}${aggRow}</tbody>
	  </table></div>
    <div class="matrix-hint">颜色表示与上月比较：绿=变好，红=变少，灰=持平，蓝=无上月可比。</div>`;
}

function renderTeacherWeeklyBreakdownTable(records, teacher, level, dimension, label) {
  const { stats, weeks } = computeTeacherBreakdown(records, teacher, level, dimension);
  if (!stats.length) return '<p style="color:var(--muted);font-size:12px;">没有数据</p>';
  if (!weeks.length) return '<p style="color:var(--muted);font-size:12px;">没有周数据</p>';

  const weekHeaders = weeks
    .map(w => `<th class="num" title="${escapeHtml(weekFullLabel(w))}">${escapeHtml(weekLabel(w))}</th>`)
    .join('');

  const rows = stats.map(s => {
    const weekCells = weeks.map((w, idx) => {
      const prev = idx > 0 ? s.weeks[weeks[idx - 1]] : null;
      return weekHeadTrendCellHtml(s.weeks[w], prev);
    }).join('');
    return `<tr>
      <td class="col-key">${escapeHtml(s.key)}</td>
      <td class="num">${s.slots}</td>
      ${weekCells}
      <td class="col-trend">${formatAvgTrend(s.weekTrendDelta, s.weekTrendPrev)}</td>
    </tr>`;
  }).join('');

  const aggWeekly = {};
  for (const w of weeks) {
    aggWeekly[w] = {
      present: 0, absent: 0, none: 0, sessions: 0,
      effectiveSessions: 0, unmarkedSessions: 0, effectiveHead: 0,
      effectivePresent: 0, effectiveAbsent: 0, effectiveNone: 0,
      pendingHead: 0,
    };
    for (const s of stats) {
      const wd = s.weeks[w];
      if (!wd) continue;
      aggWeekly[w].present += wd.present;
      aggWeekly[w].absent += wd.absent;
      aggWeekly[w].none += wd.none;
      aggWeekly[w].sessions += wd.sessions;
      aggWeekly[w].effectiveSessions += wd.effectiveSessions;
      aggWeekly[w].unmarkedSessions += wd.unmarkedSessions;
      aggWeekly[w].effectiveHead += wd.effectiveHead;
      aggWeekly[w].effectivePresent += wd.effectivePresent || 0;
      aggWeekly[w].effectiveAbsent += wd.effectiveAbsent || 0;
      aggWeekly[w].effectiveNone += wd.effectiveNone || 0;
      aggWeekly[w].pendingHead += wd.pendingHead || 0;
    }
  }
  const aggWeekCells = weeks.map((w, idx) => {
    const prev = idx > 0 ? aggWeekly[weeks[idx - 1]] : null;
    return weekHeadTrendCellHtml(aggWeekly[w], prev);
  }).join('');
  const aggWeekAvgMap = new Map();
  for (const w of weeks) {
    const head = bucketEffectiveHead(aggWeekly[w]);
    if (head != null) aggWeekAvgMap.set(w, head);
  }
  const aggTrend = valueDeltaPair(aggWeekAvgMap, (a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));
  const aggSlots = stats.reduce((a, s) => a + s.slots, 0);

  const aggRow = `<tr class="agg-row">
    <td>合计</td>
    <td class="num">${aggSlots}</td>
    ${aggWeekCells}
    <td class="col-trend">${formatAvgTrend(aggTrend.delta, aggTrend.prev)}</td>
  </tr>`;

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>${escapeHtml(label)}</th>
      <th class="num">班数</th>
      ${weekHeaders}
      <th title="最近两个有效周对比">周变化</th>
    </tr></thead>
    <tbody>${rows}${aggRow}</tbody>
  </table></div>
  <div class="matrix-hint">颜色表示与上一周比较：绿=变好，红=变少，灰=持平，蓝=无上一周可比。</div>`;
}

function renderTeacherClassContributionTable(records, teacher, level, bucketBy) {
  const { slots, months, weeks } = computeTeacherClassContributions(records, teacher, level);
  const buckets = bucketBy === 'month' ? months : weeks;
  if (!slots.length) return '<p style="color:var(--muted);font-size:12px;">没有班级数据</p>';
  if (!buckets.length) return '<p style="color:var(--muted);font-size:12px;">没有课数数据</p>';

  const headers = buckets
    .map(b => {
      const label = bucketBy === 'month' ? (String(b).split('.')[1] || b) : weekLabel(b);
      return `<th class="num" title="${escapeHtml(bucketBy === 'month' ? b : weekFullLabel(b))}">${escapeHtml(label)}</th>`;
    })
    .join('');

  const rowData = slots.map(slot => {
    const bucketMap = bucketBy === 'month' ? slot.months : slot.weeks;
    let effectiveTotal = 0;
    for (const b of buckets) {
      const data = bucketMap[b];
      if (!data) continue;
      const value = data.effectiveHead || 0;
      effectiveTotal += value;
    }
    return { slot, bucketMap, effectiveTotal };
  });

  const rows = rowData.map(({ slot, bucketMap, effectiveTotal }) => {
    const cells = buckets.map((b, idx) => {
      const prev = idx > 0 ? bucketMap[buckets[idx - 1]] : null;
      return classCountCellHtml(bucketMap[b], prev);
    }).join('');
    return `<tr>
      <td>${escapeHtml(slot.day)}</td>
      <td>${escapeHtml(slot.timeRange)}</td>
      <td>${escapeHtml(slot.subject)} ${escapeHtml(slot.grade)}</td>
      <td>${escapeHtml(slot.branch || '-')}</td>
      <td class="num">${fmtNum(slot.classSize)}</td>
      ${cells}
      ${contributionTotalCellHtml(effectiveTotal)}
    </tr>`;
  }).join('');

  const label = bucketBy === 'month' ? '月科数' : '周科数';
  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>礼拜</th>
      <th>时间</th>
      <th>班级</th>
      <th>分行</th>
      <th class="num">人数</th>
      ${headers}
      <th class="num">有效${label}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div class="matrix-hint">${label} = 班级人数 × 有效课次，即每一班贡献的人次科数；未点名课不纳入正式科数。颜色表示与上一期比较：绿=变好，红=变少，灰=持平，蓝=无上一期可比。</div>`;
}

function renderTeacherAbsenceUnmarkedSection(records, teacher, level) {
  const issueRows = records
    .filter(r => {
      if (r.teacher !== teacher) return false;
      if (level && r.level !== level) return false;
      const absent = r.absent || 0;
      const none = r.none || 0;
      return absent > 0 || none > 0;
    })
    .sort((a, b) => {
      const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCmp) return dateCmp;
      return (a.dayOrder - b.dayOrder) || ((a.startMinutes || 0) - (b.startMinutes || 0));
    });

  if (!issueRows.length) {
    return `
      <div class="issue-summary">
        <div class="issue-card good"><span>等同缺席人次</span><b>0</b></div>
        <div class="issue-card good"><span>A/N 拆分</span><b>0/0</b></div>
        <div class="issue-card good"><span>涉及课次</span><b>0</b></div>
      </div>
      <p style="color:var(--muted);font-size:12px;">当前筛选范围没有等同缺席数据。</p>`;
  }

  function issueLabel(r) {
    const present = r.present || 0;
    const absent = r.absent || 0;
    const none = r.none || 0;
    if ((present + absent) === 0 && none > 0) return '全班等同缺席';
    if (absent > 0 && none > 0) return 'A+N 等同缺席';
    if (absent > 0) return '已记录缺席';
    return 'N 等同缺席';
  }

  const totalAbsent = issueRows.reduce((sum, r) => sum + (r.absent || 0), 0);
  const totalNone = issueRows.reduce((sum, r) => sum + (r.none || 0), 0);
  const totalEquivalentAbsent = totalAbsent + totalNone;
  const unmarkedSessions = issueRows.filter(r => ((r.present || 0) + (r.absent || 0)) === 0 && (r.none || 0) > 0).length;
  const partialSessions = issueRows.filter(r => ((r.present || 0) + (r.absent || 0)) > 0 && (r.none || 0) > 0).length;
  const absentSessions = issueRows.filter(r => (r.absent || 0) > 0).length;
  const issueSlotMap = new Map();
  for (const r of issueRows) {
    if (!r.day || !r.timeRange) continue;
    const key = slotKey(r);
    if (!issueSlotMap.has(key)) {
      issueSlotMap.set(key, {
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        subject: r.subject,
        grade: r.grade,
        classSize: 0,
        sessions: 0,
        absent: 0,
        none: 0,
        unmarkedSessions: 0,
        partialSessions: 0,
        latestDate: '',
        minRate: null,
      });
    }
    const slot = issueSlotMap.get(key);
    const present = r.present || 0;
    const absent = r.absent || 0;
    const none = r.none || 0;
    const total = present + absent + none;
    slot.sessions += 1;
    slot.absent += absent;
    slot.none += none;
    if ((r.classSize || 0) > slot.classSize) slot.classSize = r.classSize || 0;
    if (String(r.date || '') > String(slot.latestDate || '')) slot.latestDate = r.date || '';
    if ((present + absent) === 0 && none > 0) {
      slot.unmarkedSessions += 1;
    } else {
      slot.partialSessions += 1;
      if (total > 0) {
        const rate = present / total;
        slot.minRate = slot.minRate == null ? rate : Math.min(slot.minRate, rate);
      }
    }
  }

  const issueSlots = Array.from(issueSlotMap.values()).sort((a, b) =>
    (b.none + b.absent) - (a.none + a.absent)
    || b.unmarkedSessions - a.unmarkedSessions
    || String(b.latestDate || '').localeCompare(String(a.latestDate || ''))
    || (a.dayOrder - b.dayOrder)
    || ((a.startMinutes || 0) - (b.startMinutes || 0))
  );

  const slotRows = issueSlots.map(slot => `
    <tr>
      <td>${escapeHtml(slot.subject || '-')} ${escapeHtml(slot.grade || '')}</td>
      <td>${escapeHtml(slot.branch || '-')}</td>
      <td>${escapeHtml(slot.day || '-')}</td>
      <td>${escapeHtml(slot.timeRange || '-')}</td>
      <td class="num">${fmtNum(slot.classSize)}</td>
      <td class="num cell-low">${fmtNum(slot.absent + slot.none)}</td>
      <td class="num cell-unmarked">${fmtNum(slot.none)}</td>
      <td class="num cell-low">${fmtNum(slot.absent)}</td>
      <td class="num">${fmtNum(slot.unmarkedSessions)}</td>
      <td class="num">${fmtNum(slot.partialSessions)}</td>
      <td class="num">${slot.minRate == null ? '未点' : pct(slot.minRate)}</td>
      <td>${escapeHtml(slot.latestDate || '-')}</td>
    </tr>`).join('');

  const detailLimit = 30;
  const priorityRows = issueRows
    .slice()
    .sort((a, b) => {
      const aUnmarked = ((a.present || 0) + (a.absent || 0)) === 0 && (a.none || 0) > 0 ? 1 : 0;
      const bUnmarked = ((b.present || 0) + (b.absent || 0)) === 0 && (b.none || 0) > 0 ? 1 : 0;
      return bUnmarked - aUnmarked
        || String(b.date || '').localeCompare(String(a.date || ''))
        || (b.none || 0) - (a.none || 0)
        || (b.absent || 0) - (a.absent || 0);
    })
    .slice(0, detailLimit);

  const rows = priorityRows.map(r => {
    const present = r.present || 0;
    const absent = r.absent || 0;
    const none = r.none || 0;
    const total = present + absent + none;
    const markedSome = (present + absent) > 0;
    const status = statusForAttendance(present, absent, none);
    const rate = markedSome && total > 0 ? pct(present / total) : '未点';
    return `<tr>
      <td>${escapeHtml(r.date || '-')}</td>
      <td>${escapeHtml(r.day || '-')}</td>
      <td>${escapeHtml(r.timeRange || '-')}</td>
      <td>${escapeHtml(r.subject || '-')} ${escapeHtml(r.grade || '')}</td>
      <td>${escapeHtml(r.branch || '-')}</td>
      <td class="num">${fmtNum(present)}</td>
      <td class="num cell-low">${fmtNum(absent)}</td>
      <td class="num cell-unmarked">${fmtNum(none)}</td>
      <td class="num">${fmtNum(total)}</td>
      <td class="num cell-${status}">${escapeHtml(rate)}</td>
      <td>${escapeHtml(issueLabel(r))}</td>
    </tr>`;
  }).join('');

  return `
    <div class="issue-summary">
      <div class="issue-card low"><span>等同缺席人次</span><b>${fmtNum(totalEquivalentAbsent)}</b></div>
      <div class="issue-card unmarked"><span>A/N 拆分</span><b>${fmtNum(totalAbsent)}/${fmtNum(totalNone)}</b></div>
      <div class="issue-card"><span>已确认缺席课次</span><b>${fmtNum(absentSessions)}</b></div>
      <div class="issue-card"><span>全班等同缺席课次</span><b>${fmtNum(unmarkedSessions)}</b></div>
      <div class="issue-card"><span>部分等同缺席课次</span><b>${fmtNum(partialSessions)}</b></div>
      <div class="issue-card"><span>涉及班级</span><b>${fmtNum(issueSlots.length)}</b></div>
    </div>
    <h4 class="issue-subtitle">按班级汇总 <span>总等缺 = A + N</span></h4>
    <div class="month-matrix-wrap">
      <table class="data month-matrix issue-table">
        <thead><tr>
          <th>课程</th>
          <th>分行</th>
          <th>礼拜</th>
          <th>时间</th>
          <th class="num">人数</th>
          <th class="num">总等缺</th>
          <th class="num">N来源</th>
          <th class="num">A来源</th>
          <th class="num">全班等缺</th>
          <th class="num">部分等缺</th>
          <th class="num">最低出勤率</th>
          <th>最近日期</th>
        </tr></thead>
        <tbody>${slotRows}</tbody>
      </table>
    </div>
    <h4 class="issue-subtitle">重点明细 <span>最多显示 ${detailLimit} 条，全班等同缺席优先</span></h4>
    <div class="month-matrix-wrap">
      <table class="data month-matrix issue-table">
        <thead><tr>
          <th>日期</th>
          <th>礼拜</th>
          <th>时间</th>
          <th>课程</th>
          <th>分行</th>
          <th class="num">P</th>
          <th class="num">A来源</th>
          <th class="num">N来源</th>
          <th class="num">总</th>
          <th class="num">出勤率</th>
          <th>状态</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="matrix-hint">
      这里统计当前筛选范围内的等同缺席：<b>等同缺席 = A + N</b>。
      A 是已记录缺席来源，N 是未点名来源；两者在出勤率里都按缺席处理。
      明细限制数量是为了让 PDF 保持可读；完整资料仍可在 Lark Base 或筛选后的页面继续追查。
    </div>`;
}

function openTeacherModal(teacher, level) {
  const records = filteredRecords();
  const stat = computeTeacherStats(records, level).stats.find(s => s.teacher === teacher);
  if (!stat) return;

  const lvlPill = level === '中学'
    ? '<span class="pill secondary-level">中学</span>'
    : level === '小学'
      ? '<span class="pill primary-level">小学</span>'
      : '';
  const branchPill = stat.branches.length
    ? `<span class="pill branch">${escapeHtml(stat.branches.join(', '))}</span>`
    : '';

  const trendBadge = formatCountTrend(stat.trendDelta, stat.prevP);
  const overallBadge = formatCountTrend(stat.overallDelta, stat.overallFirstP);

  const html = `
    <h2>${escapeHtml(stat.teacherDisplay)} ${lvlPill} ${branchPill}</h2>
    <dl>
	      <dt>班数</dt><dd>${stat.slots}班</dd>
      <dt>科目</dt><dd>${stat.subjects.length ? escapeHtml(stat.subjects.join(', ')) : '-'}</dd>
      <dt>年纪</dt><dd>${stat.grades.length ? escapeHtml(stat.grades.join(', ')) : '-'}</dd>
      <dt>班级总人数</dt><dd>${fmtNum(stat.classSize)}</dd>
      <dt>预估满课数</dt><dd>${fmtNum(stat.classSize * 4)}</dd>
      <dt>本期出席</dt><dd><b style="font-size:16px;">${fmtNum(stat.present)}</b></dd>
      <dt>等同缺席</dt><dd>${fmtNum(stat.absent + stat.none)}</dd>
      <dt>A/N拆分</dt><dd>${fmtNum(stat.absent)} / ${fmtNum(stat.none)}</dd>
      <dt>出勤率</dt><dd>${pct(stat.rate)}</dd>
      <dt>月环比</dt><dd>${trendBadge}</dd>
      <dt>全期进步</dt><dd>${overallBadge}</dd>
    </dl>

    <h3>每月出席人次</h3>
    <div class="subject-trend-card">${renderSubjectTrendChart(stat.monthPMap)}</div>

    <h3>出席人数趋势分类</h3>
    ${renderTeacherAttendanceClassTrend(records, teacher, level)}

    <h3>每周实际总人数</h3>
    <div class="subject-trend-card">${renderWeekHeadChart(stat.weekHeadMap)}</div>

    <h3>等同缺席数据（N = 缺席）</h3>
    ${renderTeacherAbsenceUnmarkedSection(records, teacher, level)}

    <h3>每班科数贡献（月）</h3>
    ${renderTeacherClassContributionTable(records, teacher, level, 'month')}

    <h3>每班科数贡献（周）</h3>
    ${renderTeacherClassContributionTable(records, teacher, level, 'week')}

    <h3>按科目拆分（合计行在底部）</h3>
    ${renderTeacherBreakdownTable(records, teacher, level, 'subject', '科目')}
    ${renderTeacherWeeklyBreakdownTable(records, teacher, level, 'subject', '科目周总人数')}

    <h3>按年纪拆分</h3>
    ${renderTeacherBreakdownTable(records, teacher, level, 'grade', '年纪')}
    ${renderTeacherWeeklyBreakdownTable(records, teacher, level, 'grade', '年纪周总人数')}

    <h3>按分行拆分</h3>
    ${renderTeacherBreakdownTable(records, teacher, level, 'branch', '分行')}
    ${renderTeacherWeeklyBreakdownTable(records, teacher, level, 'branch', '分行周总人数')}

    <div class="actions">
      <button id="modal-export-pdf" type="button">📄 导出此老师 PDF</button>
      <button id="modal-close" type="button">关闭</button>
    </div>
  `;

  const modalEl = $('#modal-content');
  modalEl.classList.add('wide');
  modalEl.innerHTML = html;
  $('#modal-root').classList.add('show');
  state.modalOpen = true;
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-export-pdf').addEventListener('click', exportModalPDF);
}

// ===================================================================
// Subjects view
// ===================================================================

function computeSubjectStats(records, level) {
  const filtered = level ? records.filter(r => r.level === level) : records;
  const map = new Map();
  const monthSet = new Set();
  const weekSet = new Set();

  for (const r of filtered) {
    if (!r.subject) continue;
    if (r.month) monthSet.add(r.month);
    const wk = weekOfRecord(r);
    if (wk) weekSet.add(wk);
    const key = r.subject;
    if (!map.has(key)) {
      map.set(key, {
        subject: key,
        slotKeys: new Set(),
        teachers: new Set(),
        grades: new Set(),
        branches: new Set(),
        present: 0, absent: 0, none: 0,
        slotClassSize: new Map(),
        months: {},                    // month -> { present, absent, none }
        weeks: {},
        monthPMap: new Map(),
        weekHeadMap: new Map(),
      });
    }
    const s = map.get(key);
    if (r.day && r.timeRange) {
      const sk = slotKey(r);
      s.slotKeys.add(sk);
      const prev = s.slotClassSize.get(sk) || 0;
      if ((r.classSize || 0) > prev) s.slotClassSize.set(sk, r.classSize || 0);
    }
    if (r.teacher) s.teachers.add(r.teacher);
    if (r.grade) s.grades.add(r.grade);
    if (r.branch) s.branches.add(r.branch);
    s.present += r.present || 0;
    s.absent += r.absent || 0;
    s.none += r.none || 0;
    if (r.month) {
      if (!s.months[r.month]) s.months[r.month] = { present: 0, absent: 0, none: 0 };
      s.months[r.month].present += r.present || 0;
      s.months[r.month].absent += r.absent || 0;
      s.months[r.month].none += r.none || 0;
      s.monthPMap.set(r.month, (s.monthPMap.get(r.month) || 0) + (r.present || 0));
    }
    if (wk) addRecordToMetricBucket(ensureMetricBucket(s.weeks, wk), r);
  }

  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const weeks = Array.from(weekSet).sort((a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));

  const stats = [];
  for (const s of map.values()) {
    const total = s.present + s.absent + s.none;
    const markedSome = (s.present + s.absent) > 0;
    const rate = markedSome && total > 0 ? s.present / total : null;
    let classSizeSum = 0;
    s.slotClassSize.forEach(v => { classSizeSum += v; });
    const trend = monthDeltaPair(s.monthPMap);
    const overall = monthFirstLastDelta(s.monthPMap);
    for (const wk of weeks) {
      const avg = bucketEffectiveHead(s.weeks[wk]);
      if (avg != null) s.weekHeadMap.set(wk, avg);
    }
    const weekTrend = valueDeltaPair(s.weekHeadMap, (a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));
    stats.push({
      subject: s.subject,
      slots: s.slotKeys.size,
      teachers: Array.from(s.teachers).sort(),
      grades: Array.from(s.grades).sort((a, b) => gradeOrderOf(a) - gradeOrderOf(b)),
      branches: Array.from(s.branches).sort(),
      present: s.present,
      absent: s.absent,
      none: s.none,
      total,
      classSize: classSizeSum,
      rate,
      months: s.months,
      weeks: s.weeks,
      monthPMap: s.monthPMap,
      weekHeadMap: s.weekHeadMap,
      trendDelta: trend.delta,
      lastP: trend.lastP,
      prevP: trend.prevP,
      overallDelta: overall.delta,
      overallFirstP: overall.firstP,
      overallLastP: overall.lastP,
      weekTrendDelta: weekTrend.delta,
      weekTrendPrev: weekTrend.prev,
      weekTrendLast: weekTrend.last,
    });
  }

  stats.sort((a, b) => b.present - a.present);
  return { stats, months, weeks };
}

function computeSubjectBreakdown(records, subject, level, dimension) {
  const filtered = records.filter(r =>
    r.subject === subject && (!level || r.level === level) && r[dimension]
  );
  const map = new Map();
  const monthSet = new Set();
  const weekSet = new Set();

  for (const r of filtered) {
    const key = r[dimension];
    if (r.month) monthSet.add(r.month);
    const wk = weekOfRecord(r);
    if (wk) weekSet.add(wk);
    if (!map.has(key)) {
      map.set(key, {
        key,
        slotKeys: new Set(),
        present: 0, absent: 0, none: 0,
        slotClassSize: new Map(),
        months: {},
        weeks: {},
        monthPMap: new Map(),
        weekHeadMap: new Map(),
      });
    }
    const e = map.get(key);
    if (r.day && r.timeRange) {
      const sk = slotKey(r);
      e.slotKeys.add(sk);
      const prev = e.slotClassSize.get(sk) || 0;
      if ((r.classSize || 0) > prev) e.slotClassSize.set(sk, r.classSize || 0);
    }
    e.present += r.present || 0;
    e.absent += r.absent || 0;
    e.none += r.none || 0;
    if (r.month) {
      if (!e.months[r.month]) e.months[r.month] = { present: 0, absent: 0, none: 0 };
      e.months[r.month].present += r.present || 0;
      e.months[r.month].absent += r.absent || 0;
      e.months[r.month].none += r.none || 0;
      e.monthPMap.set(r.month, (e.monthPMap.get(r.month) || 0) + (r.present || 0));
    }
    if (wk) addRecordToMetricBucket(ensureMetricBucket(e.weeks, wk), r);
  }

  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const weeks = Array.from(weekSet).sort((a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));

  const stats = [];
  for (const e of map.values()) {
    const total = e.present + e.absent + e.none;
    const markedSome = (e.present + e.absent) > 0;
    const rate = markedSome && total > 0 ? e.present / total : null;
    let classSizeSum = 0;
    e.slotClassSize.forEach(v => { classSizeSum += v; });
    const trend = monthDeltaPair(e.monthPMap);
    const overall = monthFirstLastDelta(e.monthPMap);
    for (const wk of weeks) {
      const avg = bucketEffectiveHead(e.weeks[wk]);
      if (avg != null) e.weekHeadMap.set(wk, avg);
    }
    const weekTrend = valueDeltaPair(e.weekHeadMap, (a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));
    stats.push({
      key: e.key,
      slots: e.slotKeys.size,
      present: e.present,
      absent: e.absent,
      none: e.none,
      total,
      classSize: classSizeSum,
      rate,
      months: e.months,
      weeks: e.weeks,
      monthPMap: e.monthPMap,
      weekHeadMap: e.weekHeadMap,
      trendDelta: trend.delta,
      lastP: trend.lastP,
      prevP: trend.prevP,
      overallDelta: overall.delta,
      overallFirstP: overall.firstP,
      overallLastP: overall.lastP,
      weekTrendDelta: weekTrend.delta,
      weekTrendPrev: weekTrend.prev,
      weekTrendLast: weekTrend.last,
    });
  }

  if (dimension === 'grade') {
    stats.sort((a, b) => gradeOrderOf(a.key) - gradeOrderOf(b.key));
  } else {
    stats.sort((a, b) => b.present - a.present);
  }
  return { stats, months, weeks };
}

function computeSubjectAttendanceClassTrend(records, subject, level) {
  const filtered = records.filter(r =>
    r.subject === subject && (!level || r.level === level) && r.day && r.timeRange
  );
  const slotMap = new Map();
  const monthSet = new Set();

  for (const r of filtered) {
    if (!r.month) continue;
    const present = r.present || 0;
    const absent = r.absent || 0;
    const none = r.none || 0;
    if ((present + absent) === 0) continue;
    monthSet.add(r.month);
    const sk = slotKey(r);
    if (!slotMap.has(sk)) {
      slotMap.set(sk, {
        key: sk,
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        teacher: r.teacher,
        teacherDisplay: r.teacherDisplay || r.teacher,
        grade: r.grade,
        classSize: 0,
        months: {},
      });
    }
    const slot = slotMap.get(sk);
    if ((r.classSize || 0) > slot.classSize) slot.classSize = r.classSize || 0;
    if (!slot.months[r.month]) {
      slot.months[r.month] = { present: 0, absent: 0, none: 0, sessions: 0 };
    }
    slot.months[r.month].present += present;
    slot.months[r.month].absent += absent;
    slot.months[r.month].none += none;
    slot.months[r.month].sessions += 1;
  }

  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const groups = { improving: [], steady: [], declining: [] };
  let insufficient = 0;

  for (const slot of slotMap.values()) {
    const points = months
      .map(month => {
        const m = slot.months[month];
        if (!m || !m.sessions) return null;
        return {
          month,
          present: m.present,
          sessions: m.sessions,
          avgPresent: m.present / m.sessions,
          absent: m.absent,
          none: m.none,
        };
      })
      .filter(Boolean);
    const category = classifyAttendanceTrend(points);
    if (category === 'insufficient') {
      insufficient += 1;
      continue;
    }
    const first = points[0];
    const last = points[points.length - 1];
    groups[category].push({
      ...slot,
      points,
      firstAvg: first.avgPresent,
      lastAvg: last.avgPresent,
      delta: last.avgPresent - first.avgPresent,
      firstMonth: first.month,
      lastMonth: last.month,
    });
  }

  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta)
      || (a.dayOrder - b.dayOrder)
      || ((a.startMinutes || 0) - (b.startMinutes || 0))
      || String(a.grade || '').localeCompare(String(b.grade || ''))
    );
  }

  return { groups, insufficient };
}

function renderSubjectAttendanceClassTrend(records, subject, level) {
  const { groups, insufficient } = computeSubjectAttendanceClassTrend(records, subject, level);
  const totalClassified = groups.improving.length + groups.steady.length + groups.declining.length;
  if (!totalClassified) {
    return `
      <div class="issue-summary">
        <div class="issue-card good"><span>整体进步班</span><b>0</b></div>
        <div class="issue-card"><span>稳定保持班</span><b>0</b></div>
        <div class="issue-card low"><span>整体退步班</span><b>0</b></div>
      </div>
      <p style="color:var(--muted);font-size:12px;">目前没有足够月份可分类。每个班至少需要 3 个已点名月份。</p>`;
  }

  function sequenceLabel(slot) {
    return slot.points
      .map(p => `${String(p.month).split('.')[1] || p.month}:${p.avgPresent.toFixed(1)}`)
      .join(' → ');
  }

  function avgPresentTrend(delta, prev) {
    if (delta == null || isNaN(delta)) return '<span class="trend-flat">—</span>';
    const pctStr = prev > 0 ? ` (${delta >= 0 ? '+' : ''}${(delta / prev * 100).toFixed(1)}%)` : '';
    if (Math.abs(delta) < 0.05) return `<span class="trend-flat">→ 0${pctStr}</span>`;
    if (delta > 0) return `<span class="trend-up">↑ +${delta.toFixed(1)}人${pctStr}</span>`;
    return `<span class="trend-down">↓ ${delta.toFixed(1)}人${pctStr}</span>`;
  }

  function categoryTable(title, key, note) {
    const list = groups[key];
    if (!list.length) {
      return `
        <h4 class="issue-subtitle">${escapeHtml(title)} <span>${escapeHtml(note)}</span></h4>
        <p style="color:var(--muted);font-size:12px;">暂无班级。</p>`;
    }
    const rows = list.map(slot => `
      <tr>
        <td>${escapeHtml(slot.grade || '-')}</td>
        <td>${escapeHtml(slot.teacherDisplay || '-')}</td>
        <td>${escapeHtml(slot.branch || '-')}</td>
        <td>${escapeHtml(slot.day || '-')}</td>
        <td>${escapeHtml(slot.timeRange || '-')}</td>
        <td class="num">${fmtNum(slot.classSize)}</td>
        <td class="num">${slot.firstAvg.toFixed(1)}</td>
        <td class="num">${slot.lastAvg.toFixed(1)}</td>
        <td class="col-trend">${avgPresentTrend(slot.delta, slot.firstAvg)}</td>
        <td>${escapeHtml(sequenceLabel(slot))}</td>
      </tr>`).join('');
    return `
      <h4 class="issue-subtitle">${escapeHtml(title)} <span>${escapeHtml(note)}</span></h4>
      <div class="month-matrix-wrap">
        <table class="data month-matrix issue-table">
          <thead><tr>
            <th>年纪</th>
            <th>老师</th>
            <th>分行</th>
            <th>礼拜</th>
            <th>时间</th>
            <th class="num">人数</th>
            <th class="num">首月平均P/课</th>
            <th class="num">最近平均P/课</th>
            <th>变化</th>
            <th>月份走势</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  return `
    <div class="issue-summary">
      <div class="issue-card good"><span>整体进步班</span><b>${fmtNum(groups.improving.length)}</b></div>
      <div class="issue-card"><span>稳定保持班</span><b>${fmtNum(groups.steady.length)}</b></div>
      <div class="issue-card low"><span>整体退步班</span><b>${fmtNum(groups.declining.length)}</b></div>
      <div class="issue-card unmarked"><span>资料不足</span><b>${fmtNum(insufficient)}</b></div>
    </div>
    ${categoryTable('整体进步班', 'improving', '平均出席人数明显上升，允许中间小幅波动')}
    ${categoryTable('稳定保持班', 'steady', '没有明显上升/下降，或只属于正常小波动')}
    ${categoryTable('整体退步班', 'declining', '平均出席人数明显下降，允许中间小幅波动')}
    <div class="matrix-hint">
      分类口径：按此科目下每个班级/时段的“每月平均每课出席人数”判断，避免 4 次课月份和 5 次课月份直接比总 P 造成误判。
      只纳入 P+A&gt;0 的已点名课；完全未点名课不参与趋势。至少 3 个已点名月份才分类；
      明显变化门槛为至少 1 人或约 5%，稳定保持班包含正常波动。
    </div>`;
}

function monthCellHtml(monthData) {
  if (!monthData || (monthData.present + monthData.absent + monthData.none === 0)) {
    return `<td class="num cell-empty">—</td>`;
  }
  if ((monthData.present + monthData.absent) === 0) {
    return `<td class="num cell-unmarked" title="未点 N=${monthData.none}">未点</td>`;
  }
  const total = monthData.present + monthData.absent + monthData.none;
  const status = statusForAttendance(monthData.present, monthData.absent, monthData.none);
  const rate = monthData.present / total;
  const tooltip = `P ${monthData.present}  A ${monthData.absent}  N ${monthData.none}  rate ${(rate * 100).toFixed(1)}%`;
  return `<td class="num cell-${status}" title="${escapeHtml(tooltip)}">${fmtNum(monthData.present)}</td>`;
}

function monthTrendCellHtml(monthData, prevData) {
  if (!monthData || (monthData.present + monthData.absent + monthData.none === 0)) {
    return `<td class="num cell-empty">—</td>`;
  }
  if ((monthData.present + monthData.absent) === 0) {
    return `<td class="num cell-unmarked" title="未点 N=${monthData.none}">未点</td>`;
  }
  const prevHasData = Boolean(prevData && ((prevData.present || 0) + (prevData.absent || 0) + (prevData.none || 0)) > 0);
  const trend = periodTrend(monthData.present || 0, prevData ? (prevData.present || 0) : 0, prevHasData);
  const tooltip = [
    `P ${monthData.present || 0}`,
    `A ${monthData.absent || 0}`,
    `N ${monthData.none || 0}`,
    trend.label,
  ].join('  ');
  return `<td class="num cell-contrib ${trend.cls}" title="${escapeHtml(tooltip)}">${fmtNum(monthData.present || 0)}</td>`;
}

function weekHeadTrendCellHtml(weekData, prevData) {
  if (!weekData || weekData.sessions === 0) {
    return `<td class="num cell-empty">—</td>`;
  }
  const totalHead = bucketEffectiveHead(weekData);
  if (totalHead == null) {
    const tooltip = `未纳入：${weekData.unmarkedSessions} 课未点名`;
    return `<td class="num cell-empty" title="${escapeHtml(tooltip)}">—</td>`;
  }
  const prevHead = bucketEffectiveHead(prevData);
  const trend = periodTrend(totalHead, prevHead || 0, prevHead != null);
  const tooltip = [
    `有效总人数 ${fmtNum(totalHead)}`,
    trend.label,
    `有效课 ${weekData.effectiveSessions}`,
    `未纳入未点名课 ${weekData.unmarkedSessions}`,
  ].join('  ');
  return `<td class="num cell-contrib ${trend.cls}" title="${escapeHtml(tooltip)}">${fmtNum(totalHead)}人</td>`;
}

function renderSubjectsView() {
  const records = filteredRecords();

  // Summary cards (de-emphasize rate; lead with P count)
  const all = computeSubjectStats(records);
  const sec = computeSubjectStats(records, '中学');
  const pri = computeSubjectStats(records, '小学');
  const totalP = all.stats.reduce((a, s) => a + s.present, 0);
  const totalA = all.stats.reduce((a, s) => a + s.absent, 0);
  const totalN = all.stats.reduce((a, s) => a + s.none, 0);
  const totalAll = totalP + totalA + totalN;
  const overallRate = (totalP + totalA) > 0 && totalAll > 0 ? totalP / totalAll : null;

  const cards = [
    { label: '科目总数', value: all.stats.length },
    { label: '中学科目', value: sec.stats.length },
    { label: '小学科目', value: pri.stats.length },
    { label: '本期总出席', value: fmtNum(totalP), cls: 'high' },
    { label: '本期等同缺席', value: fmtNum(totalA + totalN), cls: 'low' },
    { label: 'A/N 拆分', value: `${fmtNum(totalA)}/${fmtNum(totalN)}`, cls: 'unmarked' },
    { label: '本期出勤率', value: pct(overallRate), cls: overallRate == null ? 'unmarked' : (overallRate >= 0.8 ? 'high' : (overallRate >= 0.5 ? 'mid' : 'low')) },
  ];
  $('#subjects-summary').innerHTML = cards.map(c => `
    <div class="card ${c.cls || ''}">
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="value">${escapeHtml(c.value)}</div>
    </div>
  `).join('');

  $('#subjects-secondary-wrap').innerHTML = `
    <div class="subject-section-title">中学科目 <span class="small">按总出席降序 · 颜色 = 跟上月比较</span></div>
    ${renderSubjectLeaderboard(records, '中学')}
    <div class="subject-section-title" style="margin-top:18px;">中学科目周总人数 <span class="small">单元格 = 有效总人数 · 未点名不纳入正式总人数</span></div>
    ${renderSubjectWeekLeaderboard(records, '中学')}
  `;
  $('#subjects-primary-wrap').innerHTML = `
    <div class="subject-section-title primary">小学科目 <span class="small">按总出席降序 · 颜色 = 跟上月比较</span></div>
    ${renderSubjectLeaderboard(records, '小学')}
    <div class="subject-section-title primary" style="margin-top:18px;">小学科目周总人数 <span class="small">单元格 = 有效总人数 · 未点名不纳入正式总人数</span></div>
    ${renderSubjectWeekLeaderboard(records, '小学')}
  `;

  $$('#view-subjects table tbody tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => {
      const subject = tr.getAttribute('data-subject');
      const level = tr.getAttribute('data-level');
      openSubjectModal(subject, level);
    });
  });
}

function renderSubjectLeaderboard(records, level) {
  const { stats, months } = computeSubjectStats(records, level);
  if (!stats.length) {
    return `<div class="empty-msg">没有 ${escapeHtml(level)} 科目数据</div>`;
  }
  if (!months.length) {
    return `<div class="empty-msg">没有月份数据</div>`;
  }

  const monthHeaders = months
    .map(m => `<th class="num">${escapeHtml(m.split('.')[1] || m)}</th>`)
    .join('');

  const rows = stats.map(s => {
    const monthCells = months.map((m, idx) => {
      const prev = idx > 0 ? s.months[months[idx - 1]] : null;
      return monthTrendCellHtml(s.months[m], prev);
    }).join('');
    return `<tr class="clickable" data-subject="${escapeHtml(s.subject)}" data-level="${escapeHtml(level)}">
      <td class="col-key">${escapeHtml(s.subject)}</td>
      <td class="num">${s.slots}</td>
      <td class="num">${s.teachers.length}</td>
      ${monthCells}
      <td class="num"><b>${fmtNum(s.present)}</b></td>
      <td class="num">${pct(s.rate)}</td>
      <td class="col-trend">${formatCountTrend(s.trendDelta, s.prevP)}</td>
      <td class="col-trend">${formatCountTrend(s.overallDelta, s.overallFirstP)}</td>
    </tr>`;
  }).join('');

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>科目</th>
      <th class="num">班数</th>
      <th class="num">老师</th>
      ${monthHeaders}
      <th class="num">总出席</th>
      <th class="num">出勤率</th>
      <th title="最近两个月对比">月环比</th>
      <th title="第一个月 vs 最后一个月">全期</th>
    </tr></thead>
    <tbody>${rows}</tbody>
	  </table></div>
    <div class="matrix-hint">颜色表示与上月比较：绿=变好，红=变少，灰=持平，蓝=无上月可比。</div>`;
}

function renderSubjectWeekLeaderboard(records, level) {
  const { stats, weeks } = computeSubjectStats(records, level);
  if (!stats.length) {
    return `<div class="empty-msg">没有 ${escapeHtml(level)} 科目数据</div>`;
  }
  if (!weeks.length) {
    return `<div class="empty-msg">没有周数据</div>`;
  }

  const weekHeaders = weeks
    .map(w => `<th class="num" title="${escapeHtml(weekFullLabel(w))}">${escapeHtml(weekLabel(w))}</th>`)
    .join('');

  const rows = stats.map(s => {
    const weekCells = weeks.map((w, idx) => {
      const prev = idx > 0 ? s.weeks[weeks[idx - 1]] : null;
      return weekHeadTrendCellHtml(s.weeks[w], prev);
    }).join('');
    return `<tr class="clickable" data-subject="${escapeHtml(s.subject)}" data-level="${escapeHtml(level)}">
      <td class="col-key">${escapeHtml(s.subject)}</td>
      <td class="num">${s.slots}</td>
      <td class="num">${s.teachers.length}</td>
      ${weekCells}
      <td class="col-trend">${formatAvgTrend(s.weekTrendDelta, s.weekTrendPrev)}</td>
    </tr>`;
  }).join('');

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>科目</th>
      <th class="num">班数</th>
      <th class="num">老师</th>
      ${weekHeaders}
      <th title="最近两个有效周对比">周变化</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div class="matrix-hint">周总人数单元格 = 有效总人数。只统计 P+A&gt;0 的课；P+A=0 的未点名课不纳入正式总人数。颜色表示与上一周比较：绿=变好，红=变少，灰=持平，蓝=无上一周可比。</div>`;
}

function renderSubjectTrendChart(monthPMap) {
  const entries = Array.from(monthPMap.entries())
    .sort((a, b) => monthOrderOf(a[0]) - monthOrderOf(b[0]));
  if (entries.length === 0) {
    return '<p style="color:var(--muted);font-size:12px;">没有月份数据</p>';
  }
  if (entries.length === 1) {
    return `<p style="color:var(--muted);font-size:12px;">只有 ${escapeHtml(entries[0][0])} 一个月的数据：${fmtNum(entries[0][1])} 人次</p>`;
  }

  const width = 600;
  const height = 160;
  const pad = { l: 44, r: 16, t: 16, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const maxP = Math.max(...entries.map(e => e[1]), 1);
  const xStep = w / (entries.length - 1);
  const x = i => pad.l + i * xStep;
  const y = v => pad.t + h - (v / maxP * h);

  let html = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`;
  for (let p = 0; p <= 1; p += 0.25) {
    const yy = pad.t + h - p * h;
    html += `<line x1="${pad.l}" y1="${yy}" x2="${pad.l + w}" y2="${yy}" stroke="#334155" stroke-dasharray="3,3"/>`;
    html += `<text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" fill="#94a3b8" font-size="10">${Math.round(maxP * p)}</text>`;
  }
  const points = entries.map((e, i) => [x(i), y(e[1])]);
  const path = points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
  html += `<path d="${path}" fill="none" stroke="#38bdf8" stroke-width="2"/>`;
  points.forEach((p, i) => {
    html += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#38bdf8"/>`;
    html += `<text x="${p[0]}" y="${p[1] - 8}" text-anchor="middle" fill="#e2e8f0" font-size="10">${fmtNum(entries[i][1])}</text>`;
  });
  entries.forEach((e, i) => {
    const lbl = (e[0].split('.')[1] || e[0]).slice(0, 4);
    html += `<text x="${x(i)}" y="${pad.t + h + 14}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(lbl)}</text>`;
  });
  html += '</svg>';
  return html;
}

function renderWeekHeadChart(weekHeadMap) {
  const entries = Array.from(weekHeadMap.entries())
    .sort((a, b) => weekOrderOf(a[0]).localeCompare(weekOrderOf(b[0])));
  if (entries.length === 0) {
    return '<p style="color:var(--muted);font-size:12px;">没有有效周数据</p>';
  }
  if (entries.length === 1) {
    return `<p style="color:var(--muted);font-size:12px;">只有 ${escapeHtml(entries[0][0])} 一个有效周：总人数 ${fmtNum(entries[0][1])} 人</p>`;
  }

  const width = 600;
  const height = 160;
  const pad = { l: 44, r: 16, t: 16, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const maxP = Math.max(...entries.map(e => e[1]), 1);
  const xStep = w / (entries.length - 1);
  const x = i => pad.l + i * xStep;
  const y = v => pad.t + h - (v / maxP * h);

  let html = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`;
  for (let p = 0; p <= 1; p += 0.25) {
    const yy = pad.t + h - p * h;
    html += `<line x1="${pad.l}" y1="${yy}" x2="${pad.l + w}" y2="${yy}" stroke="#334155" stroke-dasharray="3,3"/>`;
    html += `<text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" fill="#94a3b8" font-size="10">${(maxP * p).toFixed(0)}</text>`;
  }
  const points = entries.map((e, i) => [x(i), y(e[1])]);
  const path = points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
  html += `<path d="${path}" fill="none" stroke="#fbbf24" stroke-width="2"/>`;
  points.forEach((p, i) => {
    html += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#fbbf24"/>`;
    html += `<text x="${p[0]}" y="${p[1] - 8}" text-anchor="middle" fill="#e2e8f0" font-size="10">${fmtNum(entries[i][1])}</text>`;
  });
  entries.forEach((e, i) => {
    html += `<text x="${x(i)}" y="${pad.t + h + 14}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(weekLabel(e[0]))}</text>`;
  });
  html += '</svg>';
  return html;
}

function renderSubjectBreakdownTable(records, subject, level, dimension, label) {
  const { stats, months } = computeSubjectBreakdown(records, subject, level, dimension);
  if (!stats.length) return '<p style="color:var(--muted);font-size:12px;">没有数据</p>';
  if (!months.length) return '<p style="color:var(--muted);font-size:12px;">没有月份数据</p>';

  const monthHeaders = months
    .map(m => `<th class="num">${escapeHtml(m.split('.')[1] || m)}</th>`)
    .join('');

  const rows = stats.map(s => {
    const monthCells = months.map((m, idx) => {
      const prev = idx > 0 ? s.months[months[idx - 1]] : null;
      return monthTrendCellHtml(s.months[m], prev);
    }).join('');
    return `<tr>
      <td class="col-key">${escapeHtml(s.key)}</td>
      <td class="num">${s.slots}</td>
      ${monthCells}
      <td class="num"><b>${fmtNum(s.present)}</b></td>
      <td class="num">${pct(s.rate)}</td>
      <td class="col-trend">${formatCountTrend(s.trendDelta, s.prevP)}</td>
      <td class="col-trend">${formatCountTrend(s.overallDelta, s.overallFirstP)}</td>
    </tr>`;
  }).join('');

  // 合计 row — also broken down by month
  const aggMonthly = {};
  for (const m of months) {
    aggMonthly[m] = { present: 0, absent: 0, none: 0 };
    for (const s of stats) {
      const md = s.months[m];
      if (md) {
        aggMonthly[m].present += md.present;
        aggMonthly[m].absent += md.absent;
        aggMonthly[m].none += md.none;
      }
    }
  }
  const aggMonthCells = months.map((m, idx) => {
    const prev = idx > 0 ? aggMonthly[months[idx - 1]] : null;
    return monthTrendCellHtml(aggMonthly[m], prev);
  }).join('');
  const aggSlots = stats.reduce((a, s) => a + s.slots, 0);
  const aggP = stats.reduce((a, s) => a + s.present, 0);
  const aggA = stats.reduce((a, s) => a + s.absent, 0);
  const aggN = stats.reduce((a, s) => a + s.none, 0);
  const aggTotal = aggP + aggA + aggN;
  const aggRate = (aggP + aggA) > 0 && aggTotal > 0 ? aggP / aggTotal : null;
  const aggMonthPMap = new Map();
  for (const m of months) aggMonthPMap.set(m, aggMonthly[m].present);
  const aggTrend = monthDeltaPair(aggMonthPMap);
  const aggOverall = monthFirstLastDelta(aggMonthPMap);

  const aggRow = `<tr class="agg-row">
    <td>合计</td>
    <td class="num">${aggSlots}</td>
    ${aggMonthCells}
    <td class="num">${fmtNum(aggP)}</td>
    <td class="num">${pct(aggRate)}</td>
    <td class="col-trend">${formatCountTrend(aggTrend.delta, aggTrend.prevP)}</td>
    <td class="col-trend">${formatCountTrend(aggOverall.delta, aggOverall.firstP)}</td>
  </tr>`;

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>${escapeHtml(label)}</th>
      <th class="num">班数</th>
      ${monthHeaders}
      <th class="num">总出席</th>
      <th class="num">出勤率</th>
      <th title="最近两个月对比">月环比</th>
      <th title="第一个月 vs 最后一个月">全期</th>
    </tr></thead>
    <tbody>${rows}${aggRow}</tbody>
	  </table></div>
    <div class="matrix-hint">颜色表示与上月比较：绿=变好，红=变少，灰=持平，蓝=无上月可比。</div>`;
}

function renderSubjectWeeklyBreakdownTable(records, subject, level, dimension, label) {
  const { stats, weeks } = computeSubjectBreakdown(records, subject, level, dimension);
  if (!stats.length) return '<p style="color:var(--muted);font-size:12px;">没有数据</p>';
  if (!weeks.length) return '<p style="color:var(--muted);font-size:12px;">没有周数据</p>';

  const weekHeaders = weeks
    .map(w => `<th class="num" title="${escapeHtml(weekFullLabel(w))}">${escapeHtml(weekLabel(w))}</th>`)
    .join('');

  const rows = stats.map(s => {
    const weekCells = weeks.map((w, idx) => {
      const prev = idx > 0 ? s.weeks[weeks[idx - 1]] : null;
      return weekHeadTrendCellHtml(s.weeks[w], prev);
    }).join('');
    return `<tr>
      <td class="col-key">${escapeHtml(s.key)}</td>
      <td class="num">${s.slots}</td>
      ${weekCells}
      <td class="col-trend">${formatAvgTrend(s.weekTrendDelta, s.weekTrendPrev)}</td>
    </tr>`;
  }).join('');

  const aggWeekly = {};
  for (const w of weeks) {
    aggWeekly[w] = {
      present: 0, absent: 0, none: 0, sessions: 0,
      effectiveSessions: 0, unmarkedSessions: 0, effectiveHead: 0,
      effectivePresent: 0, effectiveAbsent: 0, effectiveNone: 0,
      pendingHead: 0,
    };
    for (const s of stats) {
      const wd = s.weeks[w];
      if (!wd) continue;
      aggWeekly[w].present += wd.present;
      aggWeekly[w].absent += wd.absent;
      aggWeekly[w].none += wd.none;
      aggWeekly[w].sessions += wd.sessions;
      aggWeekly[w].effectiveSessions += wd.effectiveSessions;
      aggWeekly[w].unmarkedSessions += wd.unmarkedSessions;
      aggWeekly[w].effectiveHead += wd.effectiveHead;
      aggWeekly[w].effectivePresent += wd.effectivePresent || 0;
      aggWeekly[w].effectiveAbsent += wd.effectiveAbsent || 0;
      aggWeekly[w].effectiveNone += wd.effectiveNone || 0;
      aggWeekly[w].pendingHead += wd.pendingHead || 0;
    }
  }
  const aggWeekCells = weeks.map((w, idx) => {
    const prev = idx > 0 ? aggWeekly[weeks[idx - 1]] : null;
    return weekHeadTrendCellHtml(aggWeekly[w], prev);
  }).join('');
  const aggWeekAvgMap = new Map();
  for (const w of weeks) {
    const head = bucketEffectiveHead(aggWeekly[w]);
    if (head != null) aggWeekAvgMap.set(w, head);
  }
  const aggTrend = valueDeltaPair(aggWeekAvgMap, (a, b) => weekOrderOf(a).localeCompare(weekOrderOf(b)));
  const aggSlots = stats.reduce((a, s) => a + s.slots, 0);

  const aggRow = `<tr class="agg-row">
    <td>合计</td>
    <td class="num">${aggSlots}</td>
    ${aggWeekCells}
    <td class="col-trend">${formatAvgTrend(aggTrend.delta, aggTrend.prev)}</td>
  </tr>`;

  return `<div class="month-matrix-wrap"><table class="data month-matrix">
    <thead><tr>
      <th>${escapeHtml(label)}</th>
      <th class="num">班数</th>
      ${weekHeaders}
      <th title="最近两个有效周对比">周变化</th>
    </tr></thead>
    <tbody>${rows}${aggRow}</tbody>
  </table></div>
  <div class="matrix-hint">颜色表示与上一周比较：绿=变好，红=变少，灰=持平，蓝=无上一周可比。</div>`;
}

function openSubjectModal(subject, level) {
  const records = filteredRecords();
  const stat = computeSubjectStats(records, level).stats.find(s => s.subject === subject);
  if (!stat) return;

  const lvlPill = level === '中学'
    ? '<span class="pill secondary-level">中学</span>'
    : level === '小学'
      ? '<span class="pill primary-level">小学</span>'
      : '';
  const branchPill = stat.branches.length
    ? `<span class="pill branch">${escapeHtml(stat.branches.join(', '))}</span>`
    : '';

  const trendBadge = formatCountTrend(stat.trendDelta, stat.prevP);
  const overallBadge = formatCountTrend(stat.overallDelta, stat.overallFirstP);

  const html = `
    <h2>科目 ${escapeHtml(stat.subject)} ${lvlPill} ${branchPill}</h2>
    <dl>
	      <dt>班数</dt><dd>${stat.slots}班</dd>
      <dt>老师数</dt><dd>${stat.teachers.length}</dd>
      <dt>年纪</dt><dd>${stat.grades.length ? escapeHtml(stat.grades.join(', ')) : '-'}</dd>
      <dt>班级总人数</dt><dd>${fmtNum(stat.classSize)}</dd>
      <dt>预估满课数</dt><dd>${fmtNum(stat.classSize * 4)}</dd>
      <dt>本期出席</dt><dd><b style="font-size:16px;">${fmtNum(stat.present)}</b></dd>
      <dt>等同缺席</dt><dd>${fmtNum(stat.absent + stat.none)}</dd>
      <dt>A/N拆分</dt><dd>${fmtNum(stat.absent)} / ${fmtNum(stat.none)}</dd>
      <dt>出勤率</dt><dd>${pct(stat.rate)}</dd>
      <dt>月环比</dt><dd>${trendBadge}</dd>
      <dt>全期进步</dt><dd>${overallBadge}</dd>
    </dl>

    <h3>每月出席人次</h3>
    <div class="subject-trend-card">${renderSubjectTrendChart(stat.monthPMap)}</div>

    <h3>出席人数趋势分类</h3>
    ${renderSubjectAttendanceClassTrend(records, subject, level)}

    <h3>每周实际总人数</h3>
    <div class="subject-trend-card">${renderWeekHeadChart(stat.weekHeadMap)}</div>

    <h3>按老师拆分（合计行在底部）</h3>
    ${renderSubjectBreakdownTable(records, subject, level, 'teacherDisplay', '老师')}
    ${renderSubjectWeeklyBreakdownTable(records, subject, level, 'teacherDisplay', '老师周总人数')}

    <h3>按年纪拆分</h3>
    ${renderSubjectBreakdownTable(records, subject, level, 'grade', '年纪')}
    ${renderSubjectWeeklyBreakdownTable(records, subject, level, 'grade', '年纪周总人数')}

    <h3>按分行拆分</h3>
    ${renderSubjectBreakdownTable(records, subject, level, 'branch', '分行')}
    ${renderSubjectWeeklyBreakdownTable(records, subject, level, 'branch', '分行周总人数')}

    <div class="actions">
      <button id="modal-export-pdf" type="button">📄 导出此科目 PDF</button>
      <button id="modal-close" type="button">关闭</button>
    </div>
  `;

  const modalEl = $('#modal-content');
  modalEl.classList.add('wide');
  modalEl.innerHTML = html;
  $('#modal-root').classList.add('show');
  state.modalOpen = true;
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-export-pdf').addEventListener('click', exportModalPDF);
}

// ===================================================================
// Attendance trend view
// ===================================================================

function renderAttendanceView() {
  const records = filteredRecords();
  const ctl = state.attendanceCtl;
  const buckets = computeAttendanceBuckets(records, ctl.axis, ctl.group);
  renderAttendanceSummary(records);
  renderAttendanceLine(buckets, ctl.group);
  renderAttendanceStack(buckets, ctl.axis);
  renderAttendanceMatrix(records, ctl.matrixDimension, ctl.matrixBucket, ctl.matrixMetric);
  renderAttendanceIssues(records);
}

function attendanceRateOf(present, absent, none) {
  const total = (present || 0) + (absent || 0) + (none || 0);
  if (((present || 0) + (absent || 0)) === 0 || total === 0) return null;
  return (present || 0) / total;
}

function renderAttendanceSummary(records) {
  const present = records.reduce((sum, r) => sum + (r.present || 0), 0);
  const absent = records.reduce((sum, r) => sum + (r.absent || 0), 0);
  const none = records.reduce((sum, r) => sum + (r.none || 0), 0);
  const total = present + absent + none;
  const rate = attendanceRateOf(present, absent, none);
  const unmarkedSessions = records.filter(r =>
    ((r.present || 0) + (r.absent || 0)) === 0 && ((r.present || 0) + (r.absent || 0) + (r.none || 0)) > 0
  ).length;
  const slots = deriveWeeklySlots(records);
  const lowSlots = slots.filter(s => s.attendanceRate != null && s.attendanceRate < 0.5).length;
  const decliningSlots = computeDecliningAttendanceSlots(records).length;
  const fullSlots = slots.filter(s => s.status === 'full').length;

  const cards = [
    { label: '本期总人次', value: fmtNum(total) },
    { label: '本期出席 P', value: fmtNum(present), cls: 'high' },
    { label: '等同缺席 A+N', value: fmtNum(absent + none), cls: 'low' },
    { label: 'A/N 拆分', value: `${fmtNum(absent)}/${fmtNum(none)}`, cls: 'unmarked' },
    { label: '本期出勤率', value: pct(rate), cls: rate == null ? 'unmarked' : (rate >= 0.8 ? 'high' : (rate >= 0.5 ? 'mid' : 'low')) },
    { label: '未点名课次', value: fmtNum(unmarkedSessions), cls: unmarkedSessions ? 'unmarked' : 'high' },
    { label: '低出勤班数', value: fmtNum(lowSlots), cls: lowSlots ? 'low' : 'high' },
    { label: '退步班数', value: fmtNum(decliningSlots), cls: decliningSlots ? 'low' : 'high' },
    { label: '真全勤班数', value: fmtNum(fullSlots), cls: 'full' },
  ];

  $('#attendance-summary').innerHTML = cards.map(c => `
    <div class="card ${c.cls || ''}">
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="value">${escapeHtml(c.value)}</div>
    </div>
  `).join('');
}

function attendanceBucketKey(r, bucketBy) {
  if (bucketBy === 'month') return r.month || '';
  if (bucketBy === 'week') return weekOfRecord(r);
  return '';
}

function attendanceBucketSort(a, b, bucketBy) {
  if (bucketBy === 'month') return monthOrderOf(a) - monthOrderOf(b);
  return weekOrderOf(a).localeCompare(weekOrderOf(b));
}

function attendanceDimensionValue(r, dimension) {
  if (dimension === 'teacher') {
    return {
      key: r.teacher || '',
      label: r.teacherDisplay || r.teacher || '',
    };
  }
  return {
    key: r[dimension] || '',
    label: r[dimension] || '',
  };
}

function attendanceDimensionLabel(dimension) {
  return {
    branch: '分行',
    level: '中小',
    subject: '科目',
    grade: '年纪',
    teacher: '老师',
  }[dimension] || '维度';
}

function computeAttendanceDimensionMatrix(records, dimension, bucketBy) {
  const rowMap = new Map();
  const bucketSet = new Set();

  for (const r of records) {
    const dim = attendanceDimensionValue(r, dimension);
    const bucket = attendanceBucketKey(r, bucketBy);
    if (!dim.key || !bucket) continue;
    bucketSet.add(bucket);
    if (!rowMap.has(dim.key)) {
      rowMap.set(dim.key, {
        key: dim.key,
        label: dim.label,
        present: 0,
        absent: 0,
        none: 0,
        sessions: 0,
        slotKeys: new Set(),
        buckets: {},
      });
    }
    const row = rowMap.get(dim.key);
    row.present += r.present || 0;
    row.absent += r.absent || 0;
    row.none += r.none || 0;
    row.sessions += 1;
    if (r.day && r.timeRange) row.slotKeys.add(slotKey(r));
    if (!row.buckets[bucket]) row.buckets[bucket] = { present: 0, absent: 0, none: 0, sessions: 0 };
    const cell = row.buckets[bucket];
    cell.present += r.present || 0;
    cell.absent += r.absent || 0;
    cell.none += r.none || 0;
    cell.sessions += 1;
  }

  const buckets = Array.from(bucketSet).sort((a, b) => attendanceBucketSort(a, b, bucketBy));
  const rows = Array.from(rowMap.values()).map(row => {
    row.total = row.present + row.absent + row.none;
    row.rate = attendanceRateOf(row.present, row.absent, row.none);
    return row;
  }).sort((a, b) =>
    (b.present + b.absent + b.none) - (a.present + a.absent + a.none)
    || String(a.label).localeCompare(String(b.label))
  );

  return { rows, buckets };
}

function attendanceMatrixCellHtml(data, metric) {
  if (!data || ((data.present || 0) + (data.absent || 0) + (data.none || 0)) === 0) {
    return '<td class="num cell-empty">—</td>';
  }
  const present = data.present || 0;
  const absent = data.absent || 0;
  const none = data.none || 0;
  const total = present + absent + none;
  if ((present + absent) === 0) {
    const display = metric === 'equivAbsent' ? fmtNum(absent + none) : '未点';
    return `<td class="num cell-unmarked" title="未点名 N=${none}">${escapeHtml(display)}</td>`;
  }
  const status = statusForAttendance(present, absent, none);
  const rate = present / total;
  let display = pct(rate);
  if (metric === 'count') display = `${fmtNum(present)}/${fmtNum(total)}`;
  if (metric === 'equivAbsent') display = fmtNum(absent + none);
  const tooltip = `P ${present}  A ${absent}  N ${none}  sessions ${data.sessions || 0}`;
  return `<td class="num cell-${status}" title="${escapeHtml(tooltip)}">${escapeHtml(display)}</td>`;
}

function attendanceRateTrendCell(row, buckets) {
  let prev = null;
  let last = null;
  for (const bucket of buckets) {
    const cell = row.buckets[bucket];
    if (!cell) continue;
    const rate = attendanceRateOf(cell.present, cell.absent, cell.none);
    if (rate == null) continue;
    if (last != null) prev = last;
    last = rate;
  }
  if (prev == null || last == null) return '<td class="num trend-flat">—</td>';
  const delta = last - prev;
  const label = `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}%`;
  if (Math.abs(delta) < 0.05) return `<td class="num trend-flat">→ ${escapeHtml(label)}</td>`;
  if (delta > 0) return `<td class="num trend-up">↑ ${escapeHtml(label)}</td>`;
  return `<td class="num trend-down">↓ ${escapeHtml(label)}</td>`;
}

function renderAttendanceMatrix(records, dimension, bucketBy, metric) {
  const root = $('#attendance-matrix-wrap');
  const { rows, buckets } = computeAttendanceDimensionMatrix(records, dimension, bucketBy);
  if (!rows.length || !buckets.length) {
    root.innerHTML = `
      <div class="subject-section-title">维度表现矩阵 <span class="small">当前筛选范围没有可显示数据</span></div>
      <div class="empty-msg">没有数据</div>`;
    return;
  }

  const headers = buckets
    .map(b => `<th class="num" title="${escapeHtml(bucketBy === 'week' ? weekFullLabel(b) : b)}">${escapeHtml(bucketLabel(b, bucketBy))}</th>`)
    .join('');
  const rowsHtml = rows.map(row => {
    const cells = buckets.map(b => attendanceMatrixCellHtml(row.buckets[b], metric)).join('');
    return `<tr>
      <td class="col-key">${escapeHtml(row.label || row.key)}</td>
      <td class="num">${fmtNum(row.slotKeys.size)}</td>
      <td class="num">${fmtNum(row.sessions)}</td>
      ${cells}
      <td class="num"><b>${fmtNum(row.present)}</b></td>
      <td class="num">${fmtNum(row.absent + row.none)}</td>
      <td class="num">${pct(row.rate)}</td>
      ${attendanceRateTrendCell(row, buckets)}
    </tr>`;
  }).join('');

  root.innerHTML = `
    <div class="subject-section-title">维度表现矩阵 <span class="small">${escapeHtml(attendanceDimensionLabel(dimension))} × ${bucketBy === 'month' ? '月份' : '周次'} · 单元格 = ${metric === 'rate' ? '出勤率' : metric === 'count' ? 'P/总' : 'A+N'}</span></div>
    <div class="month-matrix-wrap">
      <table class="data month-matrix">
        <thead><tr>
          <th>${escapeHtml(attendanceDimensionLabel(dimension))}</th>
          <th class="num">班数</th>
          <th class="num">课次</th>
          ${headers}
          <th class="num">总P</th>
          <th class="num">A+N</th>
          <th class="num">出勤率</th>
          <th class="num">趋势</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="matrix-hint">
      出勤率统一使用 P ÷ (P + A + N)。趋势比较最近两个有有效点名数据的${bucketBy === 'month' ? '月份' : '周次'}。
      切换维度可以快速看出问题集中在分行、科目、年纪或老师。
    </div>`;
}

function computeSlotIssueStats(records) {
  const map = new Map();
  for (const r of records) {
    if (!r.day || !r.timeRange) continue;
    const key = slotKey(r);
    if (!map.has(key)) {
      map.set(key, {
        key,
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        subject: r.subject,
        grade: r.grade,
        teacher: r.teacher,
        teacherDisplay: r.teacherDisplay || r.teacher,
        classSize: 0,
        present: 0,
        absent: 0,
        none: 0,
        sessions: 0,
        unmarkedSessions: 0,
        markedSessions: 0,
        latestDate: '',
      });
    }
    const slot = map.get(key);
    const present = r.present || 0;
    const absent = r.absent || 0;
    const none = r.none || 0;
    slot.present += present;
    slot.absent += absent;
    slot.none += none;
    slot.sessions += 1;
    if ((r.classSize || 0) > slot.classSize) slot.classSize = r.classSize || 0;
    if ((present + absent) === 0 && (present + absent + none) > 0) slot.unmarkedSessions += 1;
    if ((present + absent) > 0) slot.markedSessions += 1;
    if (String(r.date || '') > String(slot.latestDate || '')) slot.latestDate = r.date || '';
  }
  return Array.from(map.values()).map(slot => {
    slot.total = slot.present + slot.absent + slot.none;
    slot.equivAbsent = slot.absent + slot.none;
    slot.rate = attendanceRateOf(slot.present, slot.absent, slot.none);
    slot.status = statusForAttendance(slot.present, slot.absent, slot.none);
    return slot;
  });
}

function slotIssueRows(slots, emptyText) {
  if (!slots.length) {
    return `<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:16px;">${escapeHtml(emptyText || '没有数据')}</td></tr>`;
  }
  return slots.map(slot => `
    <tr>
      <td>${escapeHtml(slot.branch || '-')}</td>
      <td>${escapeHtml(slot.day || '-')}</td>
      <td>${escapeHtml(slot.timeRange || '-')}</td>
      <td>${escapeHtml(slot.subject || '-')} ${escapeHtml(slot.grade || '')}</td>
      <td>${escapeHtml(slot.teacherDisplay || slot.teacher || '-')}</td>
      <td class="num">${fmtNum(slot.classSize)}</td>
      <td class="num">${fmtNum(slot.present)}</td>
      <td class="num cell-low">${fmtNum(slot.absent)}</td>
      <td class="num cell-unmarked">${fmtNum(slot.none)}</td>
      <td class="num cell-${slot.status}">${slot.rate == null ? '未点' : pct(slot.rate)}</td>
      <td class="num">${fmtNum(slot.sessions)}</td>
    </tr>
  `).join('');
}

function renderIssueTable(title, note, slots, emptyText) {
  return `
    <h4 class="issue-subtitle">${escapeHtml(title)} <span>${escapeHtml(note || '')}</span></h4>
    <div class="month-matrix-wrap">
      <table class="data month-matrix issue-table">
        <thead><tr>
          <th>分行</th>
          <th>礼拜</th>
          <th>时间</th>
          <th>课程</th>
          <th>老师</th>
          <th class="num">人数</th>
          <th class="num">P</th>
          <th class="num">A</th>
          <th class="num">N</th>
          <th class="num">出勤率</th>
          <th class="num">课次</th>
        </tr></thead>
        <tbody>${slotIssueRows(slots, emptyText)}</tbody>
      </table>
    </div>`;
}

function computeDecliningAttendanceSlots(records) {
  const slotMap = new Map();
  const monthSet = new Set();
  for (const r of records) {
    if (!r.month || !r.day || !r.timeRange) continue;
    const key = slotKey(r);
    monthSet.add(r.month);
    if (!slotMap.has(key)) {
      slotMap.set(key, {
        key,
        branch: r.branch,
        day: r.day,
        dayOrder: r.dayOrder,
        timeRange: r.timeRange,
        startMinutes: r.startMinutes,
        subject: r.subject,
        grade: r.grade,
        teacher: r.teacher,
        teacherDisplay: r.teacherDisplay || r.teacher,
        classSize: 0,
        months: {},
      });
    }
    const slot = slotMap.get(key);
    if ((r.classSize || 0) > slot.classSize) slot.classSize = r.classSize || 0;
    addRecordToMetricBucket(ensureMetricBucket(slot.months, r.month), r);
  }

  const months = Array.from(monthSet).sort((a, b) => monthOrderOf(a) - monthOrderOf(b));
  const declining = [];
  for (const slot of slotMap.values()) {
    const points = months.map(month => {
      const m = slot.months[month];
      if (!m) return null;
      const rate = attendanceRateOf(m.present, m.absent, m.none);
      if (rate == null) return null;
      return { month, rate, present: m.present, absent: m.absent, none: m.none, sessions: m.sessions };
    }).filter(Boolean);
    if (points.length < 3) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const delta = last.rate - first.rate;
    const stepTolerance = 0.08;
    const deltas = points.slice(1).map((p, i) => p.rate - points[i].rate);
    const mostlyDown = deltas.filter(d => d <= stepTolerance).length >= deltas.length - 1;
    if (delta <= -0.1 && mostlyDown) {
      declining.push({
        ...slot,
        firstMonth: first.month,
        lastMonth: last.month,
        firstRate: first.rate,
        lastRate: last.rate,
        delta,
        points,
      });
    }
  }
  declining.sort((a, b) => a.delta - b.delta || (a.dayOrder - b.dayOrder) || ((a.startMinutes || 0) - (b.startMinutes || 0)));
  return declining;
}

function renderDecliningAttendanceTable(slots) {
  if (!slots.length) {
    return `
      <h4 class="issue-subtitle">明显退步班级 <span>至少 3 个已点名月份</span></h4>
      <div class="empty-msg">没有明显退步班级</div>`;
  }
  const rows = slots.slice(0, 20).map(slot => `
    <tr>
      <td>${escapeHtml(slot.branch || '-')}</td>
      <td>${escapeHtml(slot.day || '-')}</td>
      <td>${escapeHtml(slot.timeRange || '-')}</td>
      <td>${escapeHtml(slot.subject || '-')} ${escapeHtml(slot.grade || '')}</td>
      <td>${escapeHtml(slot.teacherDisplay || slot.teacher || '-')}</td>
      <td class="num">${fmtNum(slot.classSize)}</td>
      <td class="num">${escapeHtml(slot.firstMonth)}</td>
      <td class="num">${pct(slot.firstRate)}</td>
      <td class="num">${escapeHtml(slot.lastMonth)}</td>
      <td class="num">${pct(slot.lastRate)}</td>
      <td class="num trend-down">${Math.round(slot.delta * 100)}%</td>
    </tr>`).join('');
  return `
    <h4 class="issue-subtitle">明显退步班级 <span>至少 3 个已点名月份 · 首月到最近月份下降超过 10%</span></h4>
    <div class="month-matrix-wrap">
      <table class="data month-matrix issue-table">
        <thead><tr>
          <th>分行</th>
          <th>礼拜</th>
          <th>时间</th>
          <th>课程</th>
          <th>老师</th>
          <th class="num">人数</th>
          <th class="num">首月</th>
          <th class="num">首月率</th>
          <th class="num">最近月</th>
          <th class="num">最近率</th>
          <th class="num">变化</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderAttendanceIssues(records) {
  const root = $('#attendance-issues-wrap');
  const slots = computeSlotIssueStats(records);
  const lowAll = slots.filter(s => s.rate != null && s.rate < 0.5);
  const unmarkedAll = slots.filter(s => s.unmarkedSessions > 0);
  const equivAbsentAll = slots.filter(s => s.equivAbsent > 0);
  const low = lowAll
    .sort((a, b) => a.rate - b.rate || b.equivAbsent - a.equivAbsent)
    .slice(0, 20);
  const unmarked = unmarkedAll
    .sort((a, b) => b.none - a.none || b.unmarkedSessions - a.unmarkedSessions || String(b.latestDate).localeCompare(String(a.latestDate)))
    .slice(0, 20);
  const equivAbsent = equivAbsentAll
    .sort((a, b) => b.equivAbsent - a.equivAbsent || (a.rate == null ? 1 : a.rate) - (b.rate == null ? 1 : b.rate))
    .slice(0, 20);
  const declining = computeDecliningAttendanceSlots(records);

  const issueCards = [
    { label: '低出勤时段', value: lowAll.length, cls: 'low' },
    { label: '未点名时段', value: unmarkedAll.length, cls: 'unmarked' },
    { label: '有等同缺席时段', value: equivAbsentAll.length, cls: 'low' },
    { label: '明显退步班级', value: declining.length, cls: 'low' },
  ];

  root.innerHTML = `
    <div class="subject-section-title">问题排行 <span class="small">优先处理低出勤、未点名、A+N 最高和明显退步班级</span></div>
    <div class="issue-summary">
      ${issueCards.map(c => `
        <div class="issue-card ${c.cls || ''}">
          <span>${escapeHtml(c.label)}</span>
          <b>${fmtNum(c.value)}</b>
        </div>`).join('')}
    </div>
    ${renderIssueTable('低出勤时段 Top 20', '按出勤率由低到高', low, '没有已点名出勤数据')}
    ${renderIssueTable('未点名最多 Top 20', '按 N 人次和未点名课次排序', unmarked, '没有未点名课次')}
    ${renderIssueTable('等同缺席最多 Top 20', 'A + N 最高', equivAbsent, '没有等同缺席数据')}
    ${renderDecliningAttendanceTable(declining)}
    <div class="matrix-hint">
      问题榜使用当前筛选范围。A 是已确认缺席，N 是未点名；两者在主口径中都计入等同缺席。
      “明显退步班级”按每个 weekly slot 的月出勤率判断，只纳入已有点名资料的月份。
    </div>`;
}

function computeAttendanceBuckets(records, axis, groupBy) {
  // Build a map: bucket -> { group -> {present, absent, none} }
  const map = new Map();

  function bucketKey(r) {
    if (axis === 'month') return r.month || '';
    if (axis === 'week') return weekOfRecord(r);
    if (axis === 'day') return r.day || '';
    if (axis === 'date') return r.date || '';
    return '';
  }
  function bucketOrder(label) {
    if (axis === 'month') return monthOrderOf(label);
    if (axis === 'week') return weekOrderOf(label);
    if (axis === 'day') return dayOrderOf(label);
    return label || '';
  }

  for (const r of records) {
    const bk = bucketKey(r);
    if (!bk) continue;
    if (!map.has(bk)) map.set(bk, { _key: bk, _order: bucketOrder(bk), groups: new Map() });
    const slot = map.get(bk);
    const gk = groupBy ? (r[groupBy] || '(空)') : '(全部)';
    if (!slot.groups.has(gk)) slot.groups.set(gk, { present: 0, absent: 0, none: 0, sessions: 0 });
    const g = slot.groups.get(gk);
    g.present += r.present || 0;
    g.absent += r.absent || 0;
    g.none += r.none || 0;
    g.sessions += 1;
  }

  const buckets = Array.from(map.values()).sort((a, b) => {
    if (typeof a._order === 'number' && typeof b._order === 'number') return a._order - b._order;
    return String(a._order).localeCompare(String(b._order));
  });

  // Collect all group keys (sorted)
  const groupSet = new Set();
  for (const b of buckets) for (const g of b.groups.keys()) groupSet.add(g);
  const groups = Array.from(groupSet).sort();

  return { buckets, groups };
}

function renderAttendanceLine({ buckets, groups }, groupBy) {
  const svg = $('#att-line-svg');
  const legend = $('#att-line-legend');
  if (!buckets.length) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="13">没有数据</text>';
    legend.innerHTML = '';
    return;
  }
  const width = svg.clientWidth || 600;
  const height = 240;
  const pad = { l: 40, r: 16, t: 16, b: 36 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const colors = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#f87171', '#f472b6', '#60a5fa', '#84cc16'];
  const colorOf = (idx) => colors[idx % colors.length];

  const xStep = buckets.length > 1 ? w / (buckets.length - 1) : 0;
  const x = (i) => pad.l + xStep * i;
  const y = (rate) => pad.t + h - (rate * h);

  // grid + axis
  let html = '';
  for (let p = 0; p <= 1; p += 0.25) {
    const yy = y(p);
    html += `<line x1="${pad.l}" y1="${yy}" x2="${pad.l + w}" y2="${yy}" stroke="#334155" stroke-dasharray="3,3"/>`;
    html += `<text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" fill="#94a3b8" font-size="10">${Math.round(p * 100)}%</text>`;
  }
  buckets.forEach((b, i) => {
    const xx = x(i);
    html += `<text x="${xx}" y="${pad.t + h + 14}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(b._key)}</text>`;
  });

  // lines per group
  const legendItems = [];
  groups.forEach((gk, gi) => {
    const color = colorOf(gi);
    const points = [];
    buckets.forEach((b, i) => {
      const g = b.groups.get(gk);
      if (!g) return;
      const markedSome = (g.present + g.absent) > 0;
      const total = g.present + g.absent + (g.none || 0);
      if (!markedSome || total === 0) return;
      const rate = g.present / total;
      points.push([x(i), y(rate)]);
    });
    if (points.length < 1) return;
    if (points.length === 1) {
      const [px, py] = points[0];
      html += `<circle cx="${px}" cy="${py}" r="3" fill="${color}"/>`;
    } else {
      const d = points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
      html += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
      points.forEach(p => {
        html += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${color}"/>`;
      });
    }
    legendItems.push(`<span><span class="dot" style="background:${color}"></span>${escapeHtml(gk)}</span>`);
  });

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = html;
  legend.innerHTML = groupBy ? legendItems.join('') : '';
}

function renderAttendanceStack({ buckets }, axis) {
  const svg = $('#att-stack-svg');
  if (!buckets.length) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="13">没有数据</text>';
    return;
  }
  const width = svg.clientWidth || 600;
  const height = 240;
  const pad = { l: 40, r: 16, t: 16, b: 36 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  // Aggregate per bucket (across groups)
  const agg = buckets.map(b => {
    let p = 0, a = 0, n = 0;
    for (const g of b.groups.values()) {
      p += g.present; a += g.absent; n += g.none;
    }
    return { key: b._key, present: p, absent: a, none: n, total: p + a + n };
  });

  const maxTotal = Math.max(...agg.map(b => b.total), 1);
  const barW = w / agg.length * 0.7;
  const gap = w / agg.length * 0.3;

  let html = '';
  // y axis ticks
  for (let p = 0; p <= 1; p += 0.25) {
    const yy = pad.t + h - p * h;
    const label = Math.round(maxTotal * p);
    html += `<line x1="${pad.l}" y1="${yy}" x2="${pad.l + w}" y2="${yy}" stroke="#334155" stroke-dasharray="3,3"/>`;
    html += `<text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" fill="#94a3b8" font-size="10">${label}</text>`;
  }

  agg.forEach((b, i) => {
    const x = pad.l + i * (barW + gap) + gap / 2;
    let yCursor = pad.t + h;
    function drawSeg(value, color) {
      if (value <= 0) return;
      const segH = (value / maxTotal) * h;
      yCursor -= segH;
      html += `<rect x="${x}" y="${yCursor}" width="${barW}" height="${segH}" fill="${color}"/>`;
    }
    drawSeg(b.present, '#10b981');
    drawSeg(b.absent, '#ef4444');
    drawSeg(b.none, '#94a3b8');
    html += `<text x="${x + barW / 2}" y="${pad.t + h + 14}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(b.key)}</text>`;
  });

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = html;
}

function renderUnderperformingSlots(records) {
  const slots = deriveWeeklySlots(records).filter(s => s.attendanceRate != null);
  const sortDir = state.underperfSort.dir === 'desc' ? -1 : 1;
  slots.sort((a, b) => (a.attendanceRate - b.attendanceRate) * sortDir);
  const top = slots.slice(0, 20);
  const tbody = $('#underperf-table tbody');
  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;">没有数据</td></tr>';
    return;
  }
  tbody.innerHTML = top.map(s => `
    <tr>
      <td>${escapeHtml(s.branch || '-')}</td>
      <td>${escapeHtml(s.day || '-')}</td>
      <td>${escapeHtml(s.timeRange || '-')}</td>
      <td>${escapeHtml(s.subject || '-')}</td>
      <td>${escapeHtml(s.grade || '-')}</td>
      <td>${escapeHtml(s.teacherDisplay || s.teacher || '-')}</td>
      <td class="num">${pct(s.attendanceRate)}</td>
      <td class="num">${s.sessionCount}</td>
    </tr>
  `).join('');
}

// ===================================================================
// View switching
// ===================================================================

function switchView(view) {
  state.view = view;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === view));
  $('#view-gantt').style.display = view === 'gantt' ? '' : 'none';
  $('#view-teachers').style.display = view === 'teachers' ? '' : 'none';
  $('#view-subjects').style.display = view === 'subjects' ? '' : 'none';
  $('#view-attendance').style.display = view === 'attendance' ? '' : 'none';
  $$('[data-view-only]').forEach(node => {
    const v = node.getAttribute('data-view-only');
    node.style.display = v === view ? '' : 'none';
  });
  // Status filter visible only in gantt
  $$('label[data-view-only="gantt"]').forEach(n => n.style.display = view === 'gantt' ? '' : 'none');

  renderAll();
}

// ===================================================================
// Wiring
// ===================================================================

function bindFilters() {
  const filterMap = {
    '#f-branch': 'branch',
    '#f-level': 'level',
    '#f-day': 'day',
    '#f-subject': 'subject',
    '#f-grade': 'grade',
    '#f-teacher': 'teacher',
    '#f-month': 'month',
    '#f-status': 'status',
  };
  for (const [sel, key] of Object.entries(filterMap)) {
    const node = $(sel);
    if (!node) continue;
    node.addEventListener('change', () => {
      state.filters[key] = node.value;
      renderAll();
    });
  }
  $('#reset-filters').addEventListener('click', () => {
    for (const k of Object.keys(state.filters)) state.filters[k] = '';
    rebuildFilters();
    $$('#filters select').forEach(s => s.value = '');
    renderAll();
  });

  $('#att-axis').addEventListener('change', (e) => {
    state.attendanceCtl.axis = e.target.value;
    if (state.view === 'attendance') renderAttendanceView();
  });
  $('#att-group').addEventListener('change', (e) => {
    state.attendanceCtl.group = e.target.value;
    if (state.view === 'attendance') renderAttendanceView();
  });
  $('#att-matrix-dim').addEventListener('change', (e) => {
    state.attendanceCtl.matrixDimension = e.target.value;
    if (state.view === 'attendance') renderAttendanceView();
  });
  $('#att-matrix-bucket').addEventListener('change', (e) => {
    state.attendanceCtl.matrixBucket = e.target.value;
    if (state.view === 'attendance') renderAttendanceView();
  });
  $('#att-matrix-metric').addEventListener('change', (e) => {
    state.attendanceCtl.matrixMetric = e.target.value;
    if (state.view === 'attendance') renderAttendanceView();
  });
}

function bindTabs() {
  $$('#tabs button').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.getAttribute('data-view')));
  });
}

function bindModalDismiss() {
  $('#modal-root').addEventListener('click', (e) => {
    if (e.target === $('#modal-root')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.modalOpen) closeModal();
  });
}

function nowDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function nowTimestampStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

function viewLabel(view) {
  if (view === 'gantt') return '周课表 Gantt';
  if (view === 'teachers') return '老师科数表现';
  if (view === 'subjects') return '全体科目表现';
  if (view === 'attendance') return '出勤表现';
  return view || '';
}

function makePrintHeader(title, subtitle) {
  const node = document.createElement('div');
  node.className = 'print-header';
  node.innerHTML = `
    <div class="h-title">${escapeHtml(title)}</div>
    <div class="h-sub">${escapeHtml(subtitle)}</div>
  `;
  return node;
}

function sanitizeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function setPrintTitle(parts) {
  const clean = parts.map(sanitizeFilenamePart).filter(Boolean);
  const title = clean.length ? clean.join('_') : '周补习时间表_Dashboard';
  const previous = document.title;
  document.title = title;
  return previous;
}

function bindExportPDF() {
  const btn = $('#export-pdf-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (state.modalOpen) closeModal();
    $$('.view').forEach(node => node.classList.remove('print-active'));
    const activeId = `view-${state.view}`;
    const active = document.getElementById(activeId);
    if (active) active.classList.add('print-active');

    const viewsWithOwnSummary = ['teachers', 'subjects'];
    document.body.classList.toggle('print-hide-top-summary', viewsWithOwnSummary.includes(state.view));

    // Inject a print-only header into the active view so the PDF has a title.
    let header = null;
    if (active) {
      header = makePrintHeader(
        `周补习时间表 Dashboard · ${viewLabel(state.view)}`,
        `导出于 ${nowDateStr()}  ·  数据更新 ${state.updatedAt || '-'}`
      );
      active.insertBefore(header, active.firstChild);
    }

    setTimeout(() => {
      const previousTitle = setPrintTitle([
        '周补习时间表',
        viewLabel(state.view),
        nowTimestampStr(),
      ]);
      window.print();
      setTimeout(() => {
        document.title = previousTitle;
        $$('.view').forEach(node => node.classList.remove('print-active'));
        document.body.classList.remove('print-hide-top-summary');
        if (header && header.parentNode) header.parentNode.removeChild(header);
      }, 200);
    }, 50);
  });
}

function isPwaStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function bindInstallPrompt() {
  const btn = $('#install-pwa-btn');
  if (!btn) return;

  function hideButton() {
    btn.style.display = 'none';
  }

  function showButton() {
    if (!isPwaStandalone()) btn.style.display = 'inline-flex';
  }

  hideButton();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    showButton();
  });

  window.addEventListener('appinstalled', () => {
    state.installPromptEvent = null;
    hideButton();
  });

  btn.addEventListener('click', async () => {
    const promptEvent = state.installPromptEvent;
    if (!promptEvent) {
      hideButton();
      return;
    }
    promptEvent.prompt();
    try {
      await promptEvent.userChoice;
    } catch (e) {
      // Some browsers reject when the prompt is dismissed. The button can
      // safely disappear until the browser offers another install prompt.
    }
    state.installPromptEvent = null;
    hideButton();
  });

  if (isPwaStandalone()) hideButton();
}

function exportModalPDF() {
  // Inject a print-only header so the PDF identifies the entity (teacher
  // or subject). The modal H2 already has the name; we just add a project
  // line above it.
  const modalContent = $('#modal-content');
  if (!modalContent) {
    document.body.classList.add('print-modal-only');
    setTimeout(() => window.print(), 50);
    return;
  }
  const h2 = modalContent.querySelector('h2');
  const entityTitle = h2 ? h2.textContent.trim() : '';
  const title = `周补习时间表 Dashboard`;
  const subtitle = (entityTitle ? `${entityTitle}  ·  ` : '')
    + `导出于 ${nowDateStr()}  ·  数据更新 ${state.updatedAt || '-'}`;
  const header = makePrintHeader(title, subtitle);
  modalContent.insertBefore(header, modalContent.firstChild);

  document.body.classList.add('print-modal-only');
  setTimeout(() => {
    const previousTitle = setPrintTitle([
      '周补习时间表',
      viewLabel(state.view),
      entityTitle,
      nowTimestampStr(),
    ]);
    window.print();
    setTimeout(() => {
      document.title = previousTitle;
      document.body.classList.remove('print-modal-only');
      if (header && header.parentNode) header.parentNode.removeChild(header);
    }, 200);
  }, 50);
}

function startAutoRefresh() {
  setInterval(() => {
    if (document.hidden) return;
    if (state.modalOpen) return;
    loadSchedule();
  }, REFRESH_MS);
}

// ===================================================================
// Entrypoint
// ===================================================================

async function init() {
  bindTabs();
  bindFilters();
  bindModalDismiss();
  bindExportPDF();
  bindInstallPrompt();
  const canLoadDashboard = await loadAuthState({ redirectIfNeeded: true });
  if (!canLoadDashboard) return;
  loadSchedule({ useCache: true });
  startAutoRefresh();
}

document.addEventListener('DOMContentLoaded', init);
