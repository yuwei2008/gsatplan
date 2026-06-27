const stateKey = "gsat-review-state-v1";
const today = new Date();
let payload = null;
let selectedRange = "today";
let selectedSubject = "全部";
let timerSeconds = 50 * 60;
let timerRemaining = timerSeconds;
let timerId = null;
let currentUser = null;
let cloudReady = false;

const config = window.GSAT_SUPABASE || {};
const hasSupabaseConfig =
  window.supabase &&
  config.url &&
  config.anonKey &&
  !config.url.includes("YOUR_PROJECT_REF") &&
  !config.anonKey.includes("YOUR_SUPABASE_ANON_KEY");
const supabaseClient = hasSupabaseConfig ? window.supabase.createClient(config.url, config.anonKey) : null;

const saved = JSON.parse(localStorage.getItem(stateKey) || "{}");
const appState = {
  completed: saved.completed || {},
  reflections: saved.reflections || {},
  sessions: saved.sessions || [],
};

const els = {
  countDays: document.querySelector("#countDays"),
  todayProgress: document.querySelector("#todayProgress"),
  todayBar: document.querySelector("#todayBar"),
  overallProgress: document.querySelector("#overallProgress"),
  overallBar: document.querySelector("#overallBar"),
  timerMode: document.querySelector("#timerMode"),
  timerDisplay: document.querySelector("#timerDisplay"),
  startTimer: document.querySelector("#startTimer"),
  pauseTimer: document.querySelector("#pauseTimer"),
  resetTimer: document.querySelector("#resetTimer"),
  rangeFilters: document.querySelector("#rangeFilters"),
  subjectFilters: document.querySelector("#subjectFilters"),
  searchBox: document.querySelector("#searchBox"),
  subjectStats: document.querySelector("#subjectStats"),
  sessionLog: document.querySelector("#sessionLog"),
  taskHeading: document.querySelector("#taskHeading"),
  taskCount: document.querySelector("#taskCount"),
  taskList: document.querySelector("#taskList"),
  template: document.querySelector("#taskTemplate"),
  authTitle: document.querySelector("#authTitle"),
  syncStatus: document.querySelector("#syncStatus"),
  authForm: document.querySelector("#authForm"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  signInButton: document.querySelector("#signInButton"),
  signUpButton: document.querySelector("#signUpButton"),
  signOutButton: document.querySelector("#signOutButton"),
};

function saveState() {
  localStorage.setItem(stateKey, JSON.stringify(appState));
}

function parseDate(value) {
  return new Date(`${value}T00:00:00+08:00`);
}

function formatDateRange(task) {
  const start = parseDate(task.start_date);
  const end = parseDate(task.end_date);
  const fmt = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" });
  return `${fmt.format(start)}-${fmt.format(end)} W${task.week}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isCurrentWeek(task) {
  const start = parseDate(task.start_date);
  const end = parseDate(task.end_date);
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return day >= start && day <= end;
}

function isTodayTask(task) {
  return isCurrentWeek(task) || isSameDay(parseDate(task.start_date), today);
}

function percent(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function subjects() {
  return ["全部", ...new Set(payload.tasks.map((task) => task.subject))];
}

function taskDone(task) {
  return Boolean(appState.completed[task.task_id]);
}

function filteredTasks() {
  const query = els.searchBox.value.trim().toLowerCase();
  return payload.tasks.filter((task) => {
    const rangeMatch =
      selectedRange === "all" ||
      (selectedRange === "week" && isCurrentWeek(task)) ||
      (selectedRange === "today" && isTodayTask(task));
    const subjectMatch = selectedSubject === "全部" || task.subject === selectedSubject;
    const searchable = `${task.subject} ${task.category} ${task.task_title} ${task.page_range} ${task.details} ${task.note_url}`.toLowerCase();
    return rangeMatch && subjectMatch && (!query || searchable.includes(query));
  });
}

function setSyncStatus(message) {
  els.syncStatus.textContent = message;
}

function renderAuth() {
  if (!hasSupabaseConfig) {
    els.authTitle.textContent = "尚未連接 Supabase";
    setSyncStatus("填入 supabase-config.js 的 url 和 anonKey 後，登入與跨裝置同步就會啟用。");
    return;
  }

  if (currentUser) {
    els.authTitle.textContent = currentUser.email;
    setSyncStatus(cloudReady ? "已連線到雲端資料庫，變更會自動同步。" : "正在同步雲端資料...");
    els.authForm.classList.add("hidden");
    els.signOutButton.classList.remove("hidden");
    return;
  }

  els.authTitle.textContent = "登入後跨裝置同步";
  setSyncStatus("目前使用本機儲存。登入後會同步完成狀態、反思和讀書紀錄。");
  els.authForm.classList.remove("hidden");
  els.signOutButton.classList.add("hidden");
}

async function loadCloudState() {
  if (!supabaseClient || !currentUser) return;
  cloudReady = false;
  renderAuth();

  const [{ data: progress, error: progressError }, { data: sessions, error: sessionsError }] = await Promise.all([
    supabaseClient.from("task_progress").select("task_id, completed, reflection").eq("user_id", currentUser.id),
    supabaseClient
      .from("study_sessions")
      .select("id, logged_at, minutes")
      .eq("user_id", currentUser.id)
      .order("logged_at", { ascending: false })
      .limit(20),
  ]);

  if (progressError || sessionsError) {
    setSyncStatus(progressError?.message || sessionsError?.message || "雲端同步失敗。");
    return;
  }

  appState.completed = {};
  appState.reflections = {};
  progress.forEach((item) => {
    if (item.completed) appState.completed[item.task_id] = true;
    if (item.reflection) appState.reflections[item.task_id] = item.reflection;
  });
  appState.sessions = sessions.map((item) => ({
    id: item.id,
    date: new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.logged_at)),
    minutes: item.minutes,
  }));

  cloudReady = true;
  saveState();
  render();
}

async function syncLocalStateToCloud() {
  if (!supabaseClient || !currentUser) return;
  const rows = new Map();
  Object.entries(appState.completed).forEach(([taskId, completed]) => {
    rows.set(Number(taskId), { user_id: currentUser.id, task_id: Number(taskId), completed: Boolean(completed), reflection: "" });
  });
  Object.entries(appState.reflections).forEach(([taskId, reflection]) => {
    const row = rows.get(Number(taskId)) || { user_id: currentUser.id, task_id: Number(taskId), completed: false };
    row.reflection = reflection;
    rows.set(Number(taskId), row);
  });

  if (rows.size) {
    await supabaseClient.from("task_progress").upsert([...rows.values()], { onConflict: "user_id,task_id" });
  }
}

async function saveTaskProgress(taskId) {
  saveState();
  if (!supabaseClient || !currentUser || !cloudReady) return;
  const reflection = appState.reflections[taskId] || "";
  const completed = Boolean(appState.completed[taskId]);
  const { error } = await supabaseClient.from("task_progress").upsert(
    {
      user_id: currentUser.id,
      task_id: Number(taskId),
      completed,
      reflection,
    },
    { onConflict: "user_id,task_id" }
  );
  if (error) setSyncStatus(error.message);
}

async function saveStudySession(minutes) {
  if (!supabaseClient || !currentUser || !cloudReady) return;
  const { error } = await supabaseClient.from("study_sessions").insert({
    user_id: currentUser.id,
    minutes,
  });
  if (error) setSyncStatus(error.message);
}

function renderCountdown() {
  const exam = parseDate(payload.meta.exam_start);
  const now = new Date();
  const diff = exam - now;
  els.countDays.textContent = Math.max(0, Math.ceil(diff / 86400000));
}

function renderFilters() {
  els.subjectFilters.innerHTML = subjects()
    .map((subject) => `<button type="button" class="${subject === selectedSubject ? "active" : ""}" data-subject="${subject}">${subject}</button>`)
    .join("");
}

function renderStats() {
  const all = payload.tasks;
  const done = all.filter(taskDone).length;
  const overall = percent(done, all.length);
  els.overallProgress.textContent = `${overall}%`;
  els.overallBar.style.width = `${overall}%`;

  const todays = all.filter(isTodayTask);
  const todaysDone = todays.filter(taskDone).length;
  const todayPct = percent(todaysDone, todays.length);
  els.todayProgress.textContent = `${todaysDone}/${todays.length}`;
  els.todayBar.style.width = `${todayPct}%`;

  els.subjectStats.innerHTML = subjects()
    .filter((subject) => subject !== "全部")
    .map((subject) => {
      const tasks = all.filter((task) => task.subject === subject);
      const count = tasks.filter(taskDone).length;
      const pct = percent(count, tasks.length);
      return `<div class="stat-row"><b>${subject}</b><div class="mini-bar"><i style="width:${pct}%"></i></div><span>${pct}%</span></div>`;
    })
    .join("");
}

function renderSessions() {
  const sessions = appState.sessions.slice(0, 5);
  if (!sessions.length) {
    els.sessionLog.innerHTML = `<div class="empty">尚無紀錄</div>`;
    return;
  }
  els.sessionLog.innerHTML = sessions
    .map((session) => `<div class="session"><span>${session.date}</span><b>${session.minutes} 分</b></div>`)
    .join("");
}

function renderTasks() {
  const tasks = filteredTasks();
  const labels = { today: "今日任務", week: "本週任務", all: "全部任務" };
  els.taskHeading.textContent = labels[selectedRange];
  els.taskCount.textContent = `${tasks.length} 筆`;
  els.taskList.innerHTML = "";

  if (!tasks.length) {
    els.taskList.innerHTML = `<div class="empty glass">沒有符合條件的任務</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  tasks.forEach((task) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const checkbox = node.querySelector("input[type='checkbox']");
    const subject = node.querySelector(".subject");
    const category = node.querySelector(".category");
    const date = node.querySelector(".date");
    const title = node.querySelector("h3");
    const pages = node.querySelector(".pages");
    const dl = node.querySelector("dl");
    const note = node.querySelector(".note");
    const reflection = node.querySelector(".reflection");
    const details = JSON.parse(task.details || "{}");

    checkbox.checked = taskDone(task);
    node.classList.toggle("done", checkbox.checked);
    subject.textContent = task.subject;
    category.textContent = task.category;
    date.textContent = formatDateRange(task);
    title.textContent = task.task_title;
    pages.textContent = task.page_range || " ";
    dl.innerHTML = Object.entries(details).map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join("");
    reflection.value = appState.reflections[task.task_id] || "";

    if (task.note_url) {
      note.href = task.note_url;
    } else {
      note.classList.add("hidden");
    }

    checkbox.addEventListener("change", () => {
      appState.completed[task.task_id] = checkbox.checked;
      if (!checkbox.checked) delete appState.completed[task.task_id];
      saveTaskProgress(task.task_id);
      render();
    });

    reflection.addEventListener("change", () => {
      appState.reflections[task.task_id] = reflection.value;
      if (!reflection.value.trim()) delete appState.reflections[task.task_id];
      saveTaskProgress(task.task_id);
    });

    fragment.appendChild(node);
  });
  els.taskList.appendChild(fragment);
}

function render() {
  if (!payload) return;
  renderAuth();
  renderCountdown();
  renderFilters();
  renderStats();
  renderSessions();
  renderTasks();
}

function setTimer(minutes) {
  timerSeconds = Number(minutes) * 60;
  timerRemaining = timerSeconds;
  renderTimer();
}

function renderTimer() {
  const minutes = Math.floor(timerRemaining / 60).toString().padStart(2, "0");
  const seconds = (timerRemaining % 60).toString().padStart(2, "0");
  els.timerDisplay.textContent = `${minutes}:${seconds}`;
}

async function finishTimer() {
  clearInterval(timerId);
  timerId = null;
  const minutes = Math.round(timerSeconds / 60);
  appState.sessions.unshift({
    date: new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()),
    minutes,
  });
  appState.sessions = appState.sessions.slice(0, 20);
  saveState();
  await saveStudySession(minutes);
  setTimer(els.timerMode.value);
  renderSessions();
}

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    setSyncStatus(error.message);
    return;
  }
  currentUser = data.user;
  await syncLocalStateToCloud();
  await loadCloudState();
});

els.signUpButton.addEventListener("click", async () => {
  if (!supabaseClient) return;
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    setSyncStatus(error.message);
    return;
  }
  currentUser = data.user;
  setSyncStatus(data.session ? "註冊完成，已登入。" : "註冊完成，請到信箱點確認信後再登入。");
  if (data.session) {
    await syncLocalStateToCloud();
    await loadCloudState();
  }
});

els.signOutButton.addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  cloudReady = false;
  render();
});

els.rangeFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-range]");
  if (!button) return;
  selectedRange = button.dataset.range;
  els.rangeFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  renderTasks();
});

els.subjectFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-subject]");
  if (!button) return;
  selectedSubject = button.dataset.subject;
  render();
});

els.searchBox.addEventListener("input", renderTasks);

els.timerMode.addEventListener("change", () => {
  clearInterval(timerId);
  timerId = null;
  setTimer(els.timerMode.value);
});

els.startTimer.addEventListener("click", () => {
  if (timerId) return;
  timerId = setInterval(() => {
    timerRemaining -= 1;
    renderTimer();
    if (timerRemaining <= 0) finishTimer();
  }, 1000);
});

els.pauseTimer.addEventListener("click", () => {
  clearInterval(timerId);
  timerId = null;
});

els.resetTimer.addEventListener("click", () => {
  clearInterval(timerId);
  timerId = null;
  setTimer(els.timerMode.value);
});

async function initAuth() {
  if (!supabaseClient) {
    renderAuth();
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  if (currentUser) await loadCloudState();
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    cloudReady = false;
    if (currentUser) {
      await loadCloudState();
    } else {
      render();
    }
  });
}

fetch("data/plan.json")
  .then((response) => response.json())
  .then(async (data) => {
    payload = data;
    setTimer(els.timerMode.value);
    render();
    await initAuth();
    setInterval(renderCountdown, 60000);
  });
