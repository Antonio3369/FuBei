const FLAG_META = {
  silent: { label: "本月零交易", tone: "danger" },
  new_silent: { label: "新开户无交易", tone: "info" },
  week_drop: { label: "上周掉量", tone: "warn" },
  quota_pending: { label: "额度包待配置", tone: "warn" },
  no_alipay_bank: { label: "支付宝 0 笔数", tone: "warn" },
  no_alipay: { label: "有交易无支付宝", tone: "info" },
  low: { label: "低活跃", tone: "muted" },
  large_ticket: { label: "大额少笔", tone: "info" },
  incomplete: { label: "资料不全", tone: "muted" },
  undeployed: { label: "未铺设", tone: "muted" },
};

const QUEUE = [
  { id: "both", label: "两项都有", note: "本月 0 笔，额度包也还没配上", tone: "danger" },
  { id: "silent_only", label: "零交易", note: "本月 0 笔，额度包不在待配置", tone: "danger" },
  { id: "quota_only", label: "待配置", note: "额度包还没配上，本月已经有交易", tone: "warn" },
  { id: "week_drop", label: "上周掉量", note: "后一个自然周的金额低于前一周，跨月的周也算", tone: "warn" },
];

const MERCHANT_FILTERS = [
  { id: "opened", label: "已开户" },
  { id: "both", label: "两项都有" },
  { id: "silent_only", label: "零交易" },
  { id: "quota_only", label: "待配置" },
  { id: "week_drop", label: "上周掉量" },
  { id: "no_alipay_bank", label: "支付宝 0 笔数" },
  { id: "undeployed", label: "未铺设" },
];

const PRIMARY_FLAGS = ["silent", "new_silent", "quota_pending", "week_drop", "no_alipay_bank", "undeployed", "incomplete"];

const VIEWS = [
  { id: "workbench", label: "工作台" },
  { id: "team", label: "团队" },
  { id: "merchants", label: "商户" },
  { id: "alerts", label: "预警" },
];

const ACTION = new Set(["silent", "quota_pending", "week_drop", "no_alipay_bank"]);
const PAGE_SIZE = 40;

const state = {
  view: "workbench",
  insight: "opened",
  q: "",
  company: "",
  manager: "",
  sales: "",
  sort: "priority",
  dir: "desc",
  page: 1,
  insightScope: { company: "", manager: "", sales: "" },
};

let DATA = { meta: {}, rows: [], diff: null, history: [] };
let ACCOUNT = null;
let DIRECTORY = { managers: [], sales: [] };
const trail = [];
let restoring = false;
const $ = (id) => document.getElementById(id);

function isOrg() {
  return !ACCOUNT || ACCOUNT.role === "org";
}

function isManagerAccount() {
  return ACCOUNT && ACCOUNT.role === "manager";
}

function isSalesAccount() {
  return ACCOUNT && ACCOUNT.role === "sales";
}

function applyAccountScope() {
  if (isManagerAccount()) state.manager = ACCOUNT.name;
  if (isSalesAccount()) {
    if (ACCOUNT.manager) state.manager = ACCOUNT.manager;
    state.sales = ACCOUNT.name;
  }
}

function visibleViews() {
  if (isOrg()) return VIEWS;
  return VIEWS.filter((item) => item.id !== "team");
}

function place() {
  return {
    view: state.view,
    insight: state.insight,
    q: state.q,
    company: state.company,
    manager: state.manager,
    sales: state.sales,
    sort: state.sort,
    dir: state.dir,
    page: state.page,
  };
}

function samePlace(left, right) {
  return left.view === right.view
    && left.insight === right.insight
    && left.company === right.company
    && left.manager === right.manager
    && left.sales === right.sales
    && left.q === right.q;
}

function remember() {
  if (restoring) return;
  const current = place();
  const last = trail[trail.length - 1];
  if (last && samePlace(last, current)) return;
  trail.push(current);
  if (trail.length > 30) trail.shift();
}

function atRoot() {
  if (state.view !== "workbench" || state.q) return false;
  if (isSalesAccount()) return true;
  if (isManagerAccount()) return !state.sales;
  return !state.company && !state.manager && !state.sales;
}

function captureInsightScope() {
  state.insightScope = { company: state.company, manager: state.manager, sales: state.sales };
}

function insightRollup(id) {
  return id === "both" || id === "silent_only" || id === "quota_only";
}

function insightDrilled() {
  const base = state.insightScope || { company: "", manager: "", sales: "" };
  return state.company !== base.company || state.manager !== base.manager || state.sales !== base.sales;
}

function goBack() {
  if (atRoot()) return;
  state.page = 1;
  state.q = "";
  if (state.view === "alerts" && insightRollup(state.insight) && insightDrilled()) {
    const base = state.insightScope;
    if (state.sales !== base.sales) state.sales = base.sales;
    else if (state.manager !== base.manager) state.manager = base.manager;
    else state.company = base.company;
    $("scope").classList.remove("open");
    $("scope-summary").setAttribute("aria-expanded", "false");
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (state.view !== "workbench") {
    state.view = "workbench";
    state.insight = "opened";
  } else if (state.sales && !isSalesAccount()) {
    state.sales = "";
  } else if (state.manager && isOrg()) {
    state.manager = "";
  } else if (state.company && isOrg()) {
    state.company = "";
  }
  $("scope").classList.remove("open");
  $("scope-summary").setAttribute("aria-expanded", "false");
  render();
  window.scrollTo(0, 0);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function money(value) {
  const number = Number(value) || 0;
  const sign = number < 0 ? "-" : "";
  return sign + Math.abs(number).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function integer(value) {
  return Math.round(Number(value) || 0).toLocaleString("zh-CN");
}

function wan(value) {
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  if (abs >= 10000) {
    const body = (abs / 10000).toLocaleString("zh-CN", { maximumFractionDigits: abs >= 100000 ? 1 : 2 });
    return `${number < 0 ? "-" : ""}${body} 万`;
  }
  return `${money(number)} 元`;
}

function signed(value, asMoney) {
  const number = Number(value) || 0;
  const body = asMoney ? money(Math.abs(number)) : integer(Math.abs(number));
  if (number > 0) return `+${body}`;
  if (number < 0) return `-${body}`;
  return body;
}

function priority(row) {
  let score = 0;
  if (row.flags.includes("silent")) score += 50;
  if (row.flags.includes("quota_pending")) score += 40;
  if (row.flags.includes("no_alipay_bank")) score += 30;
  if (weekDropCache.drops.has(row.sn)) score += 20;
  if (row.flags.includes("new_silent")) score += 10;
  if (row.flags.includes("large_ticket")) score += 8;
  if (row.flags.includes("low")) score += 5;
  return score;
}

function matchesPerson(value, selected) {
  if (!selected) return true;
  if (selected === "未填写") return !value;
  return value === selected;
}

function matchesInsight(row) {
  if (state.insight.startsWith("diff:")) {
    const kind = state.insight.slice(5);
    return Boolean(changeCache && changeCache.lists[kind] && changeCache.lists[kind].has(row.sn));
  }
  if (state.insight === "all") return true;
  if (state.insight === "opened") return row.activated;
  if (state.insight === "action") return row.flags.some((flag) => ACTION.has(flag)) || weekDropCache.drops.has(row.sn);
  if (state.insight === "week_drop") return weekDropCache.drops.has(row.sn);
  if (state.insight === "both") return row.flags.includes("silent") && row.flags.includes("quota_pending");
  if (state.insight === "silent_only") return row.flags.includes("silent") && !row.flags.includes("quota_pending");
  if (state.insight === "quota_only") return row.flags.includes("quota_pending") && !row.flags.includes("silent");
  return row.flags.includes(state.insight);
}

function scopedRows() {
  const query = state.q.trim().toLowerCase();
  return DATA.rows.filter((row) => {
    if (state.company && row.company !== state.company) return false;
    if (!matchesPerson(row.manager, state.manager)) return false;
    if (!matchesPerson(row.sales, state.sales)) return false;
    if (!query) return true;
    const blob = [row.sn, row.store_name, row.account, row.merchant_id, row.manager, row.sales, row.company, row.bank, row.store_id]
      .join(" ").toLowerCase();
    return blob.includes(query);
  });
}

function orgRows() {
  return DATA.rows.filter((row) => {
    if (state.company && row.company !== state.company) return false;
    if (!matchesPerson(row.manager, state.manager)) return false;
    if (!matchesPerson(row.sales, state.sales)) return false;
    return true;
  });
}

function countFlag(rows, flag) {
  if (flag === "all") return rows.length;
  if (flag === "opened") return rows.filter((row) => row.activated).length;
  if (flag === "action") return rows.filter((row) => row.flags.some((item) => ACTION.has(item)) || weekDropCache.drops.has(row.sn)).length;
  if (flag === "week_drop") return rows.filter((row) => weekDropCache.drops.has(row.sn)).length;
  if (flag === "both") return rows.filter((row) => row.flags.includes("silent") && row.flags.includes("quota_pending")).length;
  if (flag === "silent_only") return rows.filter((row) => row.flags.includes("silent") && !row.flags.includes("quota_pending")).length;
  if (flag === "quota_only") return rows.filter((row) => row.flags.includes("quota_pending") && !row.flags.includes("silent")).length;
  return rows.filter((row) => row.flags.includes(flag)).length;
}

function scopeLabel() {
  if (state.sales === "未填写") return `没有${salesLabel()}`;
  if (state.sales) return state.sales;
  if (state.manager === "未填写") return `没有${managerLabel()}`;
  if (state.manager) return state.manager;
  if (state.company) return state.company;
  return "机构";
}

function hasCompany() {
  return Boolean(DATA.meta && DATA.meta.has_company);
}

function managerLabel() {
  return (DATA.meta && DATA.meta.manager_label) || "经理";
}

function salesLabel() {
  return (DATA.meta && DATA.meta.sales_label) || "业务员";
}

const DIFF_FILTERS = [
  { id: "diff:newly_silent", label: "新转入零交易" },
  { id: "diff:resolved_silent", label: "恢复交易" },
  { id: "diff:new_quota_pending", label: "新增待配置" },
  { id: "diff:new_activated", label: "新开户" },
];

let changeCache = null;

function inOrg(row) {
  if (state.company && row.company !== state.company) return false;
  if (!matchesPerson(row.manager, state.manager)) return false;
  if (!matchesPerson(row.sales, state.sales)) return false;
  return true;
}

function signedPercent(value) {
  if (value === null || Number.isNaN(value)) return "";
  const rounded = Math.round(value * 10) / 10;
  const body = Math.abs(rounded).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  if (rounded > 0) return `+${body}%`;
  if (rounded < 0) return `-${body}%`;
  return "0%";
}

let ratioCache = { weekSnap: null, monthSnap: null, bySn: new Map() };
let weekDropCache = { ready: false, drops: new Map(), reason: "", current: null, previous: null };

function parseISODate(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatISODate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function zhDate(iso) {
  const [, month, day] = iso.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function zhRange(week) {
  if (!week) return "";
  return `${zhDate(week.start)}–${zhDate(week.end)}`;
}

function naturalWeekOf(asOf) {
  const date = parseISODate(asOf);
  if (!date) return null;
  const end = new Date(date);
  const weekday = end.getDay();
  if (weekday !== 0) end.setDate(end.getDate() - weekday);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { start: formatISODate(start), end: formatISODate(end) };
}

function previousNaturalWeek(week) {
  const end = parseISODate(week.start);
  end.setDate(end.getDate() - 1);
  return naturalWeekOf(formatISODate(end));
}

function computeWeekDrops() {
  const empty = { ready: false, drops: new Map(), reason: "", current: null, previous: null };
  const current = naturalWeekOf(DATA.meta.as_of);
  if (!current) return empty;
  const previous = previousNaturalWeek(current);
  const snap = (DATA.history || []).filter((item) => item && item.as_of && naturalWeekOf(item.as_of)?.end === previous.end).pop();
  if (!snap) {
    return {
      ...empty,
      current,
      previous,
      reason: `掉量要比 ${zhRange(current)} 和 ${zhRange(previous)}。还没有 ${zhRange(previous)} 的总表。`,
    };
  }
  const prevBySn = new Map((snap.rows || []).filter((row) => row.activated).map((row) => [row.sn, row]));
  const drops = new Map();
  DATA.rows.forEach((row) => {
    if (!row.activated) return;
    const old = prevBySn.get(row.sn);
    if (!old) return;
    const prev = Number(old.week_amount) || 0;
    const curr = Number(row.week_amount) || 0;
    if (prev > 0 && curr < prev) drops.set(row.sn, { prev, curr, delta: curr - prev });
  });
  return {
    ready: true,
    drops,
    current,
    previous,
    prevAsOf: snap.as_of,
    reason: `${zhRange(current)} 对比 ${zhRange(previous)}，后一周金额更低。`,
  };
}

function pairRatio(curr, prev) {
  const current = Number(curr) || 0;
  const previous = Number(prev) || 0;
  if (previous > 0) return ((current - previous) / previous) * 100;
  return current === 0 ? 0 : null;
}

function computeRatios() {
  const history = DATA.history || [];
  const asOf = DATA.meta.as_of || "";
  const monthKey = asOf.slice(0, 7);
  const currentWeek = naturalWeekOf(asOf);
  const previousWeek = currentWeek ? previousNaturalWeek(currentWeek) : null;
  let weekSnap = null;
  let monthSnap = null;
  history.forEach((snap) => {
    if (!snap || !snap.as_of || snap.as_of >= asOf) return;
    if (previousWeek && naturalWeekOf(snap.as_of)?.end === previousWeek.end) weekSnap = snap;
    if (snap.as_of.slice(0, 7) < monthKey) monthSnap = snap;
  });
  const index = (snap) => {
    const map = new Map();
    (snap?.rows || []).forEach((row) => {
      if (row.activated) map.set(row.sn, row);
    });
    return map;
  };
  const weekMap = index(weekSnap);
  const monthMap = index(monthSnap);
  const bySn = new Map();
  DATA.rows.forEach((row) => {
    if (!row.activated) return;
    const entry = {};
    const oldWeek = weekMap.get(row.sn);
    if (oldWeek) entry.week = { prev: Number(oldWeek.week_amount) || 0, curr: Number(row.week_amount) || 0, percent: pairRatio(row.week_amount, oldWeek.week_amount) };
    const oldMonth = monthMap.get(row.sn);
    if (oldMonth) entry.month = { prev: Number(oldMonth.month_amount) || 0, curr: Number(row.month_amount) || 0, percent: pairRatio(row.month_amount, oldMonth.month_amount) };
    if (entry.week || entry.month) bySn.set(row.sn, entry);
  });
  return { weekSnap, monthSnap, bySn };
}

function rollupRatio(kind) {
  const snap = kind === "week" ? ratioCache.weekSnap : ratioCache.monthSnap;
  if (!snap) return null;
  let prev = 0;
  let curr = 0;
  let base = 0;
  orgRows().forEach((row) => {
    if (!row.activated) return;
    const part = ratioCache.bySn.get(row.sn)?.[kind];
    if (!part || part.prev <= 0) return;
    prev += part.prev;
    curr += part.curr;
    base += 1;
  });
  return { prevAsOf: snap.as_of, base, percent: prev > 0 ? ((curr - prev) / prev) * 100 : null };
}

function ratioPlain(sn, kind) {
  const part = ratioCache.bySn.get(sn)?.[kind];
  if (!part) return "—";
  if (part.percent === null) return "新增";
  return signedPercent(part.percent);
}

function ratioHtml(sn, kind) {
  const part = ratioCache.bySn.get(sn)?.[kind];
  if (!part) return "—";
  if (part.percent === null) return "新增";
  const tone = part.percent > 0 ? "up" : part.percent < 0 ? "down" : "";
  return `<span class="delta ${tone}">${esc(signedPercent(part.percent))}</span>`;
}

function ratioBox(label, stat, pending) {
  if (!stat || stat.percent === null) {
    return `<div class="ratio"><span>${label}</span><b class="muted">${pending}</b></div>`;
  }
  const tone = stat.percent > 0 ? "up" : stat.percent < 0 ? "down" : "";
  const arrow = stat.percent > 0 ? "↑ " : stat.percent < 0 ? "↓ " : "";
  return `<div class="ratio"><span>${label}</span><b class="delta ${tone}">${arrow}${esc(signedPercent(stat.percent))}</b><em>对比 ${esc(stat.prevAsOf)} · ${integer(stat.base)} 台</em></div>`;
}

function computeChange() {
  const prev = DATA.previous;
  if (!prev || !prev.rows) return null;
  const curr = DATA.rows.filter((row) => inOrg(row) && row.activated);
  const prevRows = prev.rows.filter((row) => inOrg(row) && row.activated);
  const prevMap = new Map(prevRows.map((row) => [row.sn, row]));
  const lists = {
    newly_silent: [],
    resolved_silent: [],
    new_quota_pending: [],
    new_activated: [],
  };
  let prevAmount = 0;
  let prevCount = 0;
  let currAmount = 0;
  let currCount = 0;
  prevRows.forEach((row) => {
    prevAmount += Number(row.month_amount) || 0;
    prevCount += Number(row.month_count) || 0;
  });
  curr.forEach((row) => {
    currAmount += row.month_amount;
    currCount += row.month_count;
    const old = prevMap.get(row.sn);
    if (!old) {
      lists.new_activated.push(row.sn);
      return;
    }
    const oldFlags = old.flags || [];
    if (row.flags.includes("silent") && !oldFlags.includes("silent")) lists.newly_silent.push(row.sn);
    if (!row.flags.includes("silent") && oldFlags.includes("silent")) lists.resolved_silent.push(row.sn);
    if (row.flags.includes("quota_pending") && !oldFlags.includes("quota_pending")) lists.new_quota_pending.push(row.sn);
  });
  return {
    prevAsOf: prev.as_of,
    amountDelta: currAmount - prevAmount,
    countDelta: currCount - prevCount,
    percent: prevAmount ? ((currAmount - prevAmount) / prevAmount) * 100 : null,
    lists: {
      newly_silent: new Set(lists.newly_silent),
      resolved_silent: new Set(lists.resolved_silent),
      new_quota_pending: new Set(lists.new_quota_pending),
      new_activated: new Set(lists.new_activated),
    },
  };
}

function amountSubject() {
  if (state.sales) return `${state.sales}名下本月交易额`;
  if (state.manager) return `${state.manager}团队本月交易额`;
  if (state.company) return `${state.company}本月交易额`;
  return "全机构本月交易额";
}

function concentration(rows) {
  const key = !state.company ? "company" : !state.manager ? "manager" : !state.sales ? "sales" : "";
  if (!key) return "";
  const role = key === "company" ? "公司" : key === "manager" ? "经理" : "业务员";
  const ranked = aggregate(rows, key).filter((item) => item.name !== "未填写" && item.devices >= 5 && item.silent > 0);
  if (!ranked.length) return "";
  const top = ranked[0];
  const rate = Math.round((top.silent / top.devices) * 100);
  return `${role}里零交易最多的是 <button type="button" class="linkish" data-filter="${key}" data-value="${esc(top.name)}">${esc(top.name)}</button>，${integer(top.silent)} 台，占其已开户 ${rate}%。`;
}

function scopeHint() {
  if (state.sales) return `${salesLabel()}视角，只看本人门店`;
  if (state.manager) return `${managerLabel()}视角，看本人团队`;
  if (state.company) return "公司视角";
  if (!hasCompany()) {
    const count = new Set(DATA.rows.map((row) => row.manager).filter(Boolean)).size;
    return `${count} 位${managerLabel()}一起看`;
  }
  const count = new Set(DATA.rows.map((row) => row.company).filter(Boolean)).size;
  return `${count} 家公司一起看`;
}

function tags(row) {
  const shown = PRIMARY_FLAGS.filter((flag) => {
    if (flag === "silent" && row.flags.includes("new_silent")) return false;
    return flag === "week_drop" ? weekDropCache.drops.has(row.sn) : row.flags.includes(flag);
  });
  if (!shown.length) return '<span class="tag ok">在交易</span>';
  return `<span class="tags">${shown.map((flag) => {
    const meta = FLAG_META[flag];
    return `<span class="tag ${meta.tone}">${meta.label}</span>`;
  }).join("")}</span>`;
}

function fillSelect(id, values, current, placeholder) {
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  $(id).innerHTML = [`<option value="">${placeholder}</option>`].concat(unique.map((value) => (
    `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(value)}</option>`
  ))).join("");
}

function renderChrome() {
  $("nav").innerHTML = visibleViews().map((item) => `
    <button type="button" class="nav-btn ${state.view === item.id ? "active" : ""}" data-view="${item.id}">
      ${item.label}
    </button>
  `).join("");
  const titles = { workbench: "工作台", team: "团队", merchants: "商户", alerts: "预警" };
  const queueItem = QUEUE.find((item) => item.id === state.insight);
  const diffItem = DIFF_FILTERS.find((item) => item.id === state.insight);
  $("title").textContent = state.view === "alerts" && (diffItem || queueItem)
    ? (diffItem || queueItem).label
    : titles[state.view];
  $("back").hidden = atRoot();
  const meta = DATA.meta || {};
  $("crumb").textContent = DATA.rows.length
    ? `${meta.as_of || "-"} · ${scopeLabel()}`
    : "还没有总表";
  const summary = $("scope-summary");
  if (summary) summary.textContent = state.company || state.manager || state.sales ? `范围 · ${scopeLabel()}` : "筛选范围";
  const pool = DATA.rows.filter((row) => !state.company || row.company === state.company);
  const salesPool = pool.filter((row) => matchesPerson(row.manager, state.manager));
  const companySelect = $("company");
  companySelect.hidden = !hasCompany();
  fillSelect("company", DATA.rows.map((row) => row.company), state.company, "全部公司");
  fillSelect("manager", pool.map((row) => row.manager), state.manager, `全部${managerLabel()}`);
  fillSelect("sales", salesPool.map((row) => row.sales), state.sales, `全部${salesLabel()}`);
  const brandLine = document.querySelector(".brand-text p");
  if (brandLine) brandLine.textContent = (DATA.meta && DATA.meta.product) || "付呗设备";
  $("diff").hidden = true;
  document.body.classList.toggle("role-org", isOrg());
  document.body.classList.toggle("role-manager", isManagerAccount());
  document.body.classList.toggle("role-sales", isSalesAccount());
}

function queueRows(rows, id) {
  if (id === "week_drop") {
    return rows
      .filter((row) => weekDropCache.drops.has(row.sn))
      .sort((a, b) => weekDropCache.drops.get(a.sn).delta - weekDropCache.drops.get(b.sn).delta);
  }
  let matched;
  if (id === "both") matched = rows.filter((row) => row.flags.includes("silent") && row.flags.includes("quota_pending"));
  else if (id === "silent_only") matched = rows.filter((row) => row.flags.includes("silent") && !row.flags.includes("quota_pending"));
  else if (id === "quota_only") matched = rows.filter((row) => row.flags.includes("quota_pending") && !row.flags.includes("silent"));
  else matched = rows.filter((row) => row.flags.includes(id));
  if (id === "silent" || id === "silent_only" || id === "both") {
    return matched.sort((a, b) => (a.opened_date || "").localeCompare(b.opened_date || ""));
  }
  return matched.sort((a, b) => b.month_amount - a.month_amount || b.month_count - a.month_count);
}

function personLine(row) {
  const parts = [];
  if (!state.company) parts.push(row.company);
  if (!state.manager && row.manager) parts.push(row.manager);
  if (!state.sales && row.sales) parts.push(row.sales);
  return parts.filter(Boolean).join(" · ");
}

function renderWorkbench() {
  const rows = orgRows();
  const opened = rows.filter((row) => row.activated);
  const amount = opened.reduce((sum, row) => sum + row.month_amount, 0);
  const weekAmount = opened.reduce((sum, row) => sum + row.week_amount, 0);
  const weekCount = opened.reduce((sum, row) => sum + row.week_count, 0);
  const tapCount = opened.reduce((sum, row) => sum + (row.month_tap || 0), 0);
  const asOf = DATA.meta.as_of || "当前";
  const change = changeCache;
  const weekStat = rollupRatio("week");
  const monthStat = rollupRatio("month");
  const drop = queueRows(rows, "week_drop").length;
  const drilled = Boolean(state.manager || state.sales);
  const dropNote = weekDropCache.ready
    ? `<button type="button" class="linkish" data-insight="week_drop">上周掉量 ${integer(drop)} 台</button> ${esc(weekDropCache.reason)}`
    : esc(weekDropCache.reason);
  let opening = `${asOf}，已开户 ${integer(opened.length)} 台。`;
  if (weekStat && weekStat.percent !== null) opening += `周环比 ${signedPercent(weekStat.percent)}。`;
  if (monthStat && monthStat.percent !== null) opening += `月环比 ${signedPercent(monthStat.percent)}。`;
  const level = focusLevel();
  const changeButtons = change
    ? (() => {
        const buttons = DIFF_FILTERS.map((item) => {
          const count = change.lists[item.id.slice(5)].size;
          if (!count) return "";
          return `<button type="button" data-insight="${item.id}">${item.label} ${integer(count)}</button>`;
        }).join("");
        return buttons ? `<div class="changes">${buttons}</div>` : "";
      })()
    : "";
  const focus = drilled
    ? (level ? shareBoard(rows, level) : "")
    : focusSummaries(rows);
  $("view").innerHTML = `
    <section class="board">
      <div class="board-figures">
        <p class="who">本月交易额</p>
        <p class="hero-amount">${esc(wan(amount))}</p>
        <p class="hero-meta">${esc(weekDropCache.current ? zhRange(weekDropCache.current) : "上周")} ${esc(wan(weekAmount))}，${integer(weekCount)} 笔。${DATA.meta.has_tap ? `本月碰一下 ${integer(tapCount)} 笔。` : ""}</p>
        <div class="ratios">${ratioBox("周环比", weekStat, "待上一周")}${ratioBox("月环比", monthStat, "待上一个月")}</div>
        <div class="hero-actions"><button type="button" data-view="merchants">看已开户 ${integer(opened.length)} 台</button></div>
        ${changeButtons}
      </div>
      <div class="board-mix">
        <section class="narrative" aria-label="工作台摘要">
          <p class="who">${esc(scopeHint())}</p>
          <p class="open">${esc(opening)}</p>
        </section>
        ${scopePicture(rows)}
      </div>
    </section>
    ${focus}
    <p class="side-note">${dropNote}</p>
  `;
}

function scopeMix(rows) {
  const opened = rows.filter((row) => row.activated);
  const mix = { trading: 0, silent: 0, configured: 0, quota: 0, none: 0 };
  opened.forEach((row) => {
    if (row.flags.includes("silent")) mix.silent += 1;
    else mix.trading += 1;
    if (row.flags.includes("quota_pending")) mix.quota += 1;
    else if (row.quota_status === "configured") mix.configured += 1;
    else mix.none += 1;
  });
  return mix;
}

function scopePicture(rows) {
  const mix = scopeMix(rows);
  const trade = composition([
    { label: "有交易", value: mix.trading, tone: "trading" },
    { label: "0交易", value: mix.silent, tone: "silent" },
  ], { ratio: true });
  const quota = composition([
    { label: "已配置", value: mix.configured, tone: "configured" },
    { label: "待配置", value: mix.quota, tone: "pending" },
    { label: "未参加", value: mix.none, tone: "none" },
  ], { ratio: true });
  return `<section class="card scope-picture">
    <div class="compose-block"><p>交易</p>${trade}</div>
    <div class="compose-block"><p>额度包配置情况</p>${quota}</div>
  </section>`;
}

function shareBoard(rows, level, sortKey) {
  const people = aggregate(rows, level.key)
    .filter((item) => item.devices > 0 && item.name !== "未填写")
    .sort((a, b) => {
      if (sortKey) {
        const delta = b[sortKey] - a[sortKey];
        if (delta) return delta;
      }
      return b.devices - a.devices || b.amount - a.amount;
    });
  const lines = people.map((item) => {
    const company = level.key === "manager" && !state.company ? mode(item.companies) : "";
    const trade = composition([
      { label: "有交易", value: item.trading, tone: "trading" },
      { label: "0交易", value: item.silent, tone: "silent" },
    ], { ratio: true });
    const quota = composition([
      { label: "已配置", value: item.configured, tone: "configured" },
      { label: "待配置", value: item.quota, tone: "pending" },
      { label: "未参加", value: item.quotaNone, tone: "none" },
    ], { ratio: true });
    return `<button type="button" class="share-row" data-team-key="${level.key}" data-team-name="${esc(item.name)}" data-team-company="${esc(company || state.company)}">
      <span class="share-head"><span class="share-name">${esc(item.name)}</span><b>${integer(item.devices)} 台</b></span>
      <span class="share-mix">${trade}${quota}</span>
    </button>`;
  }).join("");
  const caption = sortKey === "both"
    ? "每人下面两行相加，都等于这个人的台数。0 交易、额度也没配的多，排在前面。"
    : "每人下面两行相加，都等于这个人的台数。点名字进入。";
  return `<section class="card share-card">
    <div class="card-head"><h2>${esc(level.label)}</h2><p>${caption}</p></div>
    <div class="share-list">${lines || '<p class="empty">这个范围里没有。</p>'}</div>
  </section>`;
}

function focusLevel() {
  if (state.sales) return null;
  if (state.manager) return { key: "sales", label: salesLabel() };
  return { key: "manager", label: hasCompany() ? "经理团队" : managerLabel() };
}

function focusSummaries(rows) {
  const level = focusLevel();
  const both = queueRows(rows, "both").length;
  const silentOnly = queueRows(rows, "silent_only").length;
  const quotaOnly = queueRows(rows, "quota_only").length;
  const assigned = level
    ? aggregate(rows, level.key).filter((item) => item.name !== "未填写").reduce((sum, item) => sum + item.silentOnly, 0)
    : silentOnly;
  const leftover = silentOnly - assigned;
  const cards = [
    { flag: "both", tone: "danger", extra: "lead", count: both, title: `本月 0 交易、未配置额度共有 ${integer(both)} 台`, note: "" },
    { flag: "silent_only", tone: "danger", extra: "", count: silentOnly, title: `0 交易 ${integer(silentOnly)} 台`, note: leftover > 0 ? `另有 ${integer(leftover)} 台没有${level.label}。` : "" },
    { flag: "quota_only", tone: "warn", extra: "", count: quotaOnly, title: `额度包未配置 ${integer(quotaOnly)} 台`, note: "有交易但未配置额度包" },
  ];
  return `<section class="focus-grid">${cards.map((card) => `
    <article class="card queue-card ${card.extra}">
      <div class="queue-head">
        <div>
          <h2 class="${card.tone}">${card.title}</h2>
          ${card.note ? `<p>${card.note}</p>` : ""}
        </div>
        <button type="button" data-insight="${card.flag}" ${card.count ? "" : "disabled"}>按${esc(level.label)}看这 ${integer(card.count)} 台</button>
      </div>
    </article>
  `).join("")}</section>`;
}

function aggregate(rows, key) {
  const map = new Map();
  rows.filter((row) => row.activated).forEach((row) => {
    const name = row[key] || "未填写";
    const item = map.get(name) || { name, companies: [], devices: 0, amount: 0, silent: 0, silentOnly: 0, trading: 0, both: 0, week: 0, quota: 0, quotaOnly: 0, configured: 0, quotaNone: 0, noali: 0 };
    item.companies.push(row.company);
    item.devices += 1;
    item.amount += row.month_amount;
    const both = row.flags.includes("silent") && row.flags.includes("quota_pending");
    if (both) item.both += 1;
    if (row.flags.includes("silent")) {
      item.silent += 1;
      if (!both) item.silentOnly += 1;
    } else {
      item.trading += 1;
    }
    if (weekDropCache.drops.has(row.sn)) item.week += 1;
    if (row.flags.includes("quota_pending")) {
      item.quota += 1;
      if (!both) item.quotaOnly += 1;
    } else if (row.quota_status === "configured") {
      item.configured += 1;
    } else {
      item.quotaNone += 1;
    }
    if (row.flags.includes("no_alipay_bank")) item.noali += 1;
    map.set(name, item);
  });
  return [...map.values()].sort((a, b) => b.silent - a.silent || b.amount - a.amount);
}

function mode(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function sharePercents(parts) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return parts.map(() => 0);
  const exact = parts.map((part) => part.value / total * 100);
  const floors = exact.map((value) => Math.floor(value));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  exact
    .map((value, index) => ({ index, frac: value - floors[index], count: parts[index].value }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.frac - a.frac || b.count - a.count)
    .forEach((item) => {
      if (left <= 0) return;
      floors[item.index] += 1;
      left -= 1;
    });
  return floors;
}

function composition(parts, options = {}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const rates = options.ratio ? sharePercents(parts) : null;
  const bar = parts.map((part, index) => ({ part, rate: rates ? rates[index] : 0 }))
    .filter(({ part }) => part.value > 0)
    .map(({ part, rate }) => {
      const width = total ? part.value / total * 100 : 0;
      const label = rates && width >= 10 ? `${rate}%` : "";
      return `<i class="${part.tone}" style="width:${width}%">${label}</i>`;
    }).join("");
  const legend = parts.map((part) => {
    const body = `<b>${integer(part.value)}</b> ${esc(part.label)}`;
    if (part.insight && part.value) return `<button type="button" class="linkish ${part.tone}" data-insight="${part.insight}">${body}</button>`;
    return `<span class="${part.tone}">${body}</span>`;
  }).join('<span class="plus">/</span>');
  return `<div class="stack" aria-hidden="true">${bar}</div><p class="stack-legend">${legend}</p>`;
}

function teamBoard(title, people, filterKey) {
  const lines = people.filter((item) => item.name !== "未填写" && item.devices > 0).map((item) => {
    const trade = composition([
      { label: "有交易", value: item.trading, tone: "trading" },
      { label: "0交易", value: item.silent, tone: "silent" },
    ], { ratio: true });
    const quota = composition([
      { label: "已配置", value: item.configured, tone: "configured" },
      { label: "待配置", value: item.quota, tone: "pending" },
      { label: "未参加", value: item.quotaNone, tone: "none" },
    ], { ratio: true });
    const company = hasCompany() ? mode(item.companies) : "";
    const drop = weekDropCache.ready ? `<span>掉量 <b>${integer(item.week)} 台</b></span>` : "";
    return `<button type="button" class="share-row" data-filter="${filterKey}" data-value="${esc(item.name)}">
      <span class="share-head"><span class="share-name">${esc(item.name)}${company ? `<em>${esc(company)}</em>` : ""}</span><b>${integer(item.devices)} 台</b></span>
      <span class="share-mix">${trade}${quota}</span>
      <span class="share-meta"><span>本月 <b>${esc(wan(item.amount))}</b></span>${drop}</span>
    </button>`;
  }).join("");
  return `<section class="card share-card">
    <div class="card-head"><h2>${esc(title)}</h2><p>每人下面两行相加，都等于这个人的台数。0 交易、额度也没配的多，排在前面。点名字进入。</p></div>
    <div class="share-list">${lines || '<p class="empty">这个范围里没有。</p>'}</div>
  </section>`;
}

function renderTeam() {
  const rows = orgRows();
  const byBoth = (list) => list.sort((a, b) => b.both - a.both || b.silent - a.silent || b.amount - a.amount);
  $("view").innerHTML = `<div class="team-grid">${teamBoard(managerLabel(), byBoth(aggregate(rows, "manager")), "manager")}${teamBoard(salesLabel(), byBoth(aggregate(rows, "sales")), "sales")}</div>`;
}

function sortRows(rows) {
  const dir = state.dir === "asc" ? 1 : -1;
  const key = state.sort;
  return rows.slice().sort((a, b) => {
    if (key === "priority") {
      const delta = (priority(a) - priority(b)) * dir;
      return delta || b.month_amount - a.month_amount;
    }
    if (key === "week_ratio" || key === "month_ratio") {
      const kind = key === "week_ratio" ? "week" : "month";
      const value = (row) => {
        const part = ratioCache.bySn.get(row.sn)?.[kind];
        return part && part.percent !== null ? part.percent : null;
      };
      const left = value(a);
      const right = value(b);
      if (left === right) return b.month_amount - a.month_amount;
      if (left === null) return 1;
      if (right === null) return -1;
      return (left - right) * dir;
    }
    if (key === "store") return (a.store_name || "").localeCompare(b.store_name || "", "zh-CN") * dir;
    const left = a[key];
    const right = b[key];
    if (left === right) return b.month_amount - a.month_amount;
    if (typeof left === "string") return left.localeCompare(right, "zh-CN") * dir;
    return (left - right) * dir;
  });
}

function header(label, key, numeric) {
  const mark = state.sort === key ? (state.dir === "asc" ? " ↑" : " ↓") : "";
  return `<th class="${numeric ? "num" : ""}"><button type="button" data-sort="${key}">${label}${mark}</button></th>`;
}

function merchantColumns(detail) {
  const columns = [
    {
      label: "门店",
      key: "store",
      className: "store",
      cell: (row) => `<b>${esc(row.store_name || "—")}</b>${personLine(row) ? `<span class="sub">${esc(personLine(row))}</span>` : ""}${row.sn ? `<span class="sub sn">${esc(row.sn)}</span>` : ""}`,
    },
    { label: "设备SN", key: "sn", className: "sn", phone: "hide", cell: (row) => esc(row.sn || "—") },
    { label: "本月金额", key: "month_amount", num: true, cell: (row) => money(row.month_amount) },
    { label: "月环比", key: "month_ratio", num: true, phone: "hide", cell: (row) => ratioHtml(row.sn, "month") },
    { label: "本月笔数", key: "month_count", num: true, cell: (row) => integer(row.month_count) },
    ...(DATA.meta.has_tap ? [{ label: "碰一下", key: "month_tap", num: true, cell: (row) => integer(row.month_tap || 0) }] : []),
    { label: "周环比", key: "week_ratio", num: true, phone: "hide", cell: (row) => ratioHtml(row.sn, "week") },
    { label: "状态", key: "priority", cell: (row) => tags(row) },
    { label: "开户日", key: "opened_date", cell: (row) => esc(row.opened_date || "—") },
    { label: "上周笔数", key: "week_count", num: true, phone: "hide", cell: (row) => integer(row.week_count) },
    { label: "额度包", key: "quota", phone: (row) => (row.quota ? "" : "hide"), cell: (row) => esc(row.quota || "—") },
  ];
  if (detail) {
    columns.push(
      { label: "支付宝", key: "month_alipay", num: true, phone: "hide", cell: (row) => integer(row.month_alipay) },
      { label: "银行政策", key: "bank", phone: "hide", cell: (row) => esc(row.bank) },
      { label: "商户账号", key: "account", phone: "hide", cell: (row) => esc(row.account || "—") },
    );
  }
  return columns;
}

function insightRollKey() {
  if (state.view !== "alerts" || !insightRollup(state.insight)) return "";
  if (hasCompany() && !state.company) return "company";
  if (!state.manager) return "manager";
  if (!state.sales) return "sales";
  return "";
}

function insightPeople(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const name = row[key] || "";
    const item = map.get(name) || { name, count: 0 };
    item.count += 1;
    map.set(name, item);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function rollLabel(key, name) {
  if (name) return name;
  if (key === "manager") return `没有${managerLabel()}`;
  if (key === "sales") return `没有${salesLabel()}`;
  return "未填写";
}

function filterChips() {
  const counts = orgRows();
  const filters = (state.insight.startsWith("diff:") ? DIFF_FILTERS : state.view === "alerts" ? QUEUE : MERCHANT_FILTERS)
    .filter((item) => item.id !== "undeployed" || state.insight === "undeployed" || countFlag(DATA.rows, "undeployed") > 0);
  return filters.map((item) => {
    const count = item.id.startsWith("diff:")
      ? (changeCache ? changeCache.lists[item.id.slice(5)].size : 0)
      : countFlag(counts, item.id);
    const countLabel = item.id === "week_drop" && !weekDropCache.ready ? "待比" : integer(count);
    return `
    <button type="button" class="chip ${state.insight === item.id ? "active" : ""}" data-insight="${item.id}">
      ${item.label}<i>${countLabel}</i>
    </button>`;
  }).join("");
}

function renderInsightRoll(key, people) {
  const role = key === "company" ? "公司" : key === "manager" ? managerLabel() : salesLabel();
  const next = key === "company" ? managerLabel() : key === "manager" ? salesLabel() : "门店";
  const note = (QUEUE.find((item) => item.id === state.insight) || {}).note || "";
  const named = people.filter((item) => item.name);
  const blank = people.find((item) => !item.name);
  const who = blank
    ? `${named.length} 位${role}，另有 ${integer(blank.count)} 台没有${role}`
    : `${people.length} 位${role}`;
  const lines = people.map((item) => `
    <button type="button" class="share-row" data-roll-key="${key}" data-roll-name="${esc(item.name)}">
      <span class="share-head"><span class="share-name">${esc(rollLabel(key, item.name))}</span><b>${integer(item.count)} 台</b></span>
    </button>`).join("");
  $("view").innerHTML = `
    <div class="chips">${filterChips()}</div>
    <section class="card share-card">
      <div class="card-head"><p>${who}。${note ? `${esc(note)}。` : ""}点名字看${esc(next)}。</p></div>
      <div class="share-list">${lines}</div>
    </section>
  `;
}

function renderTable(rows, columns) {
  const chips = filterChips();
  if (!rows.length) {
    const empty = state.insight === "week_drop" && !weekDropCache.ready
      ? weekDropCache.reason
      : state.insight === "week_drop"
        ? "这两个自然周里，没有金额下降的门店。"
        : "这个范围里没有设备。";
    $("view").innerHTML = `<div class="toolbar"><input id="q" type="search" placeholder="搜门店、SN、账号、${esc(salesLabel())}" value="${esc(state.q)}"></div><div class="chips">${chips}</div><p class="empty">${esc(empty)}</p>`;
    bindSearch();
    return;
  }
  const sorted = sortRows(rows);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * PAGE_SIZE;
  const slice = sorted.slice(start, start + PAGE_SIZE);
  $("view").innerHTML = `
    <div class="toolbar"><input id="q" type="search" placeholder="搜门店、SN、账号、${esc(salesLabel())}" value="${esc(state.q)}"></div>
    <div class="chips">${chips}</div>
    <div class="table-wrap"><table>
      <thead><tr>${columns.map((column) => header(column.label, column.key, column.num)).join("")}</tr></thead>
      <tbody>${slice.map((row) => `<tr>${columns.map((column) => {
        const phone = typeof column.phone === "function" ? column.phone(row) : column.phone;
        const cls = [column.num ? "num" : "", column.className || "", phone === "hide" ? "phone-hide" : ""].filter(Boolean).join(" ");
        return `<td class="${cls}" data-label="${esc(column.label)}">${column.cell(row)}</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <div class="pager">
      <span>第 ${state.page} / ${pages} 页，共 ${integer(sorted.length)} 条</span>
      <div>
        <button type="button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" data-page="${state.page + 1}" ${state.page >= pages ? "disabled" : ""}>下一页</button>
      </div>
    </div>
  `;
  bindSearch();
}

function bindSearch() {
  const input = $("q");
  if (!input) return;
  input.addEventListener("input", (event) => {
    state.q = event.target.value;
    state.page = 1;
    renderView();
    const next = $("q");
    if (next) {
      next.focus();
      const end = next.value.length;
      next.setSelectionRange(end, end);
    }
  });
}

function renderView() {
  changeCache = computeChange();
  ratioCache = computeRatios();
  weekDropCache = computeWeekDrops();
  renderChrome();
  if (!DATA.rows.length) {
    $("view").innerHTML = '<p class="empty">把付呗导出的总表拖进页面，或从左侧导入。</p>';
    return;
  }
  if (state.view === "workbench") {
    renderWorkbench();
    return;
  }
  if (state.view === "team") {
    renderTeam();
    return;
  }
  const rows = scopedRows().filter(matchesInsight);
  const rollKey = insightRollKey();
  if (rollKey) {
    const people = insightPeople(rows, rollKey);
    if (people.some((item) => item.name)) {
      renderInsightRoll(rollKey, people);
      return;
    }
  }
  renderTable(rows, merchantColumns(state.view === "merchants"));
}

function openInsight(id) {
  captureInsightScope();
  state.insight = id;
  state.q = "";
  state.view = "alerts";
  state.page = 1;
  const byDate = id === "silent" || id === "silent_only" || id === "both";
  state.sort = byDate ? "opened_date" : "month_amount";
  state.dir = byDate ? "asc" : "desc";
  render();
  window.scrollTo(0, 0);
}

function setScopeFromRank(name) {
  if (!state.company) state.company = name;
  else if (!state.manager) state.manager = name === "未填写" ? "" : name;
  else if (!state.sales) state.sales = name === "未填写" ? "" : name;
  else {
    state.q = name;
    state.view = "merchants";
    state.insight = "opened";
  }
  state.page = 1;
  render();
}

function currentExportRows() {
  if (state.view === "workbench" || state.view === "team") return orgRows().filter((row) => row.activated);
  return sortRows(scopedRows().filter(matchesInsight));
}

function exportCsv() {
  const rows = currentExportRows();
  const headers = ["设备SN", "公司", managerLabel(), salesLabel(), "门店", "开户时间", "本月笔数", "本月金额", "月环比", "碰一下", "上周笔数", "上周金额", "上周碰一下", "周环比", "银行政策", "额度包", "状态", "商户账号", "商户ID"];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    const values = [
      row.sn, row.company, row.manager, row.sales, row.store_name, row.opened_at,
      row.month_count, row.month_amount, ratioPlain(row.sn, "month"), row.month_tap || 0, row.week_count, row.week_amount, row.week_tap || 0, ratioPlain(row.sn, "week"),
      row.bank, row.quota, PRIMARY_FLAGS.filter((flag) => (flag === "week_drop" ? weekDropCache.drops.has(row.sn) : row.flags.includes(flag))).map((flag) => FLAG_META[flag].label).join("|"),
      row.account, row.merchant_id,
    ];
    lines.push(values.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `付呗交易看板-${DATA.meta.as_of || "导出"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function upload(file) {
  const error = $("error");
  error.hidden = true;
  if (!file) return;
  const body = new FormData();
  body.append("file", file, file.name);
  const response = await fetch("/api/upload", { method: "POST", body });
  const payload = await response.json();
  if (!response.ok) {
    error.hidden = false;
    error.textContent = payload.error || "导入失败";
    return;
  }
  DATA = payload;
  state.page = 1;
  render();
}

function render() {
  applyAccountScope();
  if (!isOrg() && state.view === "team") state.view = "workbench";
  remember();
  renderView();
}

document.addEventListener("click", (event) => {
  const view = event.target.closest("[data-view]");
  if (view) {
    if (view.dataset.view === "team" && !isOrg()) return;
    const enteringAlerts = view.dataset.view === "alerts" && state.view !== "alerts";
    if (enteringAlerts) captureInsightScope();
    state.view = view.dataset.view;
    state.page = 1;
    if (state.view === "alerts") {
      if (!QUEUE.some((item) => item.id === state.insight)) state.insight = "both";
      const byDate = state.insight === "silent" || state.insight === "silent_only" || state.insight === "both";
      state.sort = byDate ? "opened_date" : "month_amount";
      state.dir = byDate ? "asc" : "desc";
      state.q = "";
    }
    if (state.view === "merchants") {
      state.insight = "opened";
      state.sort = "month_amount";
      state.dir = "desc";
      state.q = "";
    }
    $("scope").classList.remove("open");
    $("scope-summary").setAttribute("aria-expanded", "false");
    render();
    window.scrollTo(0, 0);
    return;
  }
  const insight = event.target.closest("[data-insight]");
  if (insight) {
    if (state.view === "workbench") openInsight(insight.dataset.insight);
    else {
      state.insight = insight.dataset.insight;
      state.page = 1;
      render();
    }
    return;
  }
  const rank = event.target.closest("[data-rank]");
  if (rank) {
    setScopeFromRank(rank.dataset.rank);
    return;
  }
  const roll = event.target.closest("[data-roll-key]");
  if (roll) {
    if (isSalesAccount()) return;
    const key = roll.dataset.rollKey;
    if (isManagerAccount() && key === "manager") return;
    state[key] = roll.dataset.rollName || "未填写";
    if (key === "company") {
      state.manager = "";
      state.sales = "";
    }
    if (key === "manager") state.sales = "";
    state.q = "";
    state.page = 1;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    if (isSalesAccount()) return;
    if (isManagerAccount() && filter.dataset.filter !== "sales") return;
    state[filter.dataset.filter] = filter.dataset.value;
    if (filter.dataset.filter === "manager") state.sales = "";
    if (filter.dataset.filter === "company") {
      state.manager = "";
      state.sales = "";
    }
    state.view = "workbench";
    state.page = 1;
    render();
    return;
  }
  const team = event.target.closest("[data-team-key]");
  if (team) {
    if (isSalesAccount()) return;
    const key = team.dataset.teamKey;
    if (isManagerAccount() && key !== "sales") return;
    const name = team.dataset.teamName === "未填写" ? "" : team.dataset.teamName;
    if (key === "company") {
      state.company = name;
      state.manager = "";
      state.sales = "";
    } else if (key === "manager") {
      if (team.dataset.teamCompany) state.company = team.dataset.teamCompany;
      state.manager = name;
      state.sales = "";
    } else {
      state.sales = name;
    }
    state.view = "workbench";
    state.q = "";
    state.page = 1;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const store = event.target.closest("[data-open-store]");
  if (store) {
    state.q = store.dataset.openStore;
    state.insight = store.dataset.queue || "opened";
    state.view = "merchants";
    state.sort = "month_amount";
    state.dir = "desc";
    state.page = 1;
    render();
    return;
  }
  const sort = event.target.closest("[data-sort]");
  if (sort) {
    const key = sort.dataset.sort;
    if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
    else {
      state.sort = key;
      state.dir = ["store", "opened_date", "company", "manager", "sales", "bank"].includes(key) ? "asc" : "desc";
    }
    state.page = 1;
    renderView();
    return;
  }
  const page = event.target.closest("[data-page]");
  if (page && !page.disabled) {
    state.page = Number(page.dataset.page);
    renderView();
  }
});

["company", "manager", "sales"].forEach((id) => {
  $(id).addEventListener("change", (event) => {
    if (!isOrg()) return;
    state[id] = event.target.value;
    if (id === "company") {
      state.manager = "";
      state.sales = "";
    }
    if (id === "manager") state.sales = "";
    state.page = 1;
    if (state.view === "alerts") captureInsightScope();
    render();
  });
});

$("clear").addEventListener("click", () => {
  if (!isOrg()) return;
  state.company = "";
  state.manager = "";
  state.sales = "";
  state.q = "";
  state.page = 1;
  state.view = "workbench";
  render();
});

$("back").addEventListener("click", goBack);
$("export").addEventListener("click", exportCsv);
$("export-proxy").addEventListener("click", exportCsv);
$("import-proxy").addEventListener("click", () => {
  if (!isOrg()) return;
  $("file").click();
});
$("scope-summary").addEventListener("click", () => {
  const open = $("scope").classList.toggle("open");
  $("scope-summary").setAttribute("aria-expanded", open ? "true" : "false");
});
$("file").addEventListener("change", (event) => {
  upload(event.target.files[0]);
  event.target.value = "";
});

const drop = $("drop");
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!isOrg()) return;
  drop.hidden = false;
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) drop.hidden = true;
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.hidden = true;
  if (!isOrg()) return;
  const file = event.dataTransfer.files[0];
  if (file) upload(file);
});

function showLogin(message) {
  ACCOUNT = null;
  document.body.classList.add("login-open");
  $("login").hidden = false;
  if (message) {
    $("login-error").hidden = false;
    $("login-error").textContent = message;
  } else {
    $("login-error").hidden = true;
  }
  fillLoginNames();
}

function hideLogin() {
  document.body.classList.remove("login-open");
  $("login").hidden = true;
  $("login-error").hidden = true;
}

function fillLoginNames() {
  const role = document.querySelector("input[name=role]:checked")?.value || "org";
  $("login-name-wrap").hidden = false;
  $("login-name-label").textContent = role === "org" ? "账号" : "姓名";
}

async function loadBoard() {
  const response = await fetch("/api/data");
  if (response.status === 401) {
    showLogin();
    return;
  }
  if (!response.ok) throw new Error("data");
  DATA = await response.json();
  ACCOUNT = DATA.meta && DATA.meta.account ? DATA.meta.account : { role: "org", name: "机构", manager: "" };
  applyAccountScope();
  hideLogin();
  render();
}

async function boot() {
  try {
    const directory = await fetch("/api/directory").then((item) => item.json());
    DIRECTORY = directory;
    fillLoginNames();
    const session = await fetch("/api/session").then((item) => item.json());
    if (!session.account) {
      showLogin();
      return;
    }
    await loadBoard();
  } catch (error) {
    $("error").hidden = false;
    $("error").textContent = "没有连上本地服务。在项目目录运行 python3 server.py";
  }
}

document.querySelectorAll("input[name=role]").forEach((input) => {
  input.addEventListener("change", fillLoginNames);
});

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const role = document.querySelector("input[name=role]:checked")?.value;
  const body = {
    role,
    name: $("login-name").value.trim(),
    manager: "",
    pin: $("login-pin").value,
  };
  $("login-error").hidden = true;
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    $("login-error").hidden = false;
    $("login-error").textContent = payload.error || "进不去。";
    return;
  }
  $("login-pin").value = "";
  await loadBoard();
});

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  DATA = { meta: {}, rows: [], diff: null, history: [] };
  ACCOUNT = null;
  state.view = "workbench";
  state.insight = "opened";
  state.q = "";
  state.company = "";
  state.manager = "";
  state.sales = "";
  showLogin();
}

$("logout").addEventListener("click", logout);
$("logout-proxy").addEventListener("click", logout);

boot();
