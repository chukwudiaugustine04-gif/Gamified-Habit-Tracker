const STORE_KEY = 'daywell-data-v1';
const REMINDER_GRACE_MS = 60_000;
const milestones = [
  { points: 20, name: 'Bronze', symbol: 'B' },
  { points: 50, name: 'Silver', symbol: 'S' },
  { points: 100, name: 'Gold', symbol: 'G' },
  { points: 200, name: 'Diamond', symbol: 'D' },
];
const icons = {
  goals: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="m8 12 2.3 2.3L16 9"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H20v14H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M4 8h16M16 12h4"/></svg>',
  badges: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="5"/><path d="m8.8 13-1 7 4.2-2.3 4.2 2.3-1-7"/></svg>',
};

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function blankData() {
  return {
    tasks: [], balance: 0, badges: [], theme: 'light', notificationsEnabled: false,
    avatar: { type: 'builtin', value: 'leaf' },
    today: { date: localDayKey(), statuses: {}, earned: 0, missed: 0, remindersSent: [] },
  };
}
function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved || !Array.isArray(saved.tasks)) return blankData();
    const defaults = blankData();
    return {
      ...defaults, ...saved,
      balance: Math.max(0, Number(saved.balance) || 0),
      notificationsEnabled: Boolean(saved.notificationsEnabled),
      tasks: saved.tasks.map((task, index) => ({ ...task, id: task.id || `task-${index}-${Date.now()}` })),
      badges: Array.isArray(saved.badges) ? saved.badges : [],
      avatar: saved.avatar || defaults.avatar,
      today: saved.today && saved.today.date === localDayKey()
        ? {
          statuses: {}, earned: 0, missed: 0, remindersSent: [], ...saved.today,
          remindersSent: Array.isArray(saved.today.remindersSent) ? saved.today.remindersSent : [],
        }
        : { date: localDayKey(), statuses: {}, earned: 0, missed: 0, remindersSent: [] },
    };
  } catch {
    return blankData();
  }
}
let data = loadData();
let activeView = 'goals';
let toastTimer;
let deferredInstallPrompt = null;

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch { showToast('Storage is full. Try a smaller avatar image.'); }
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}
function taskDate(time, date = new Date()) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}
function timeLabel(value) {
  const [hour, minute] = value.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}
function displayDate(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}
function rollDateIfNeeded() {
  const today = localDayKey();
  if (data.today.date !== today) data.today = { date: today, statuses: {}, earned: 0, missed: 0, remindersSent: [] };
}
function checkExpiredTasks() {
  const before = data.balance;
  rollDateIfNeeded();
  const now = new Date();
  data.tasks.forEach((task) => {
    if (data.today.statuses[task.id]) return;
    if (now >= taskDate(task.end, now)) {
      data.today.statuses[task.id] = 'missed';
      data.today.missed += 5;
      data.balance = Math.max(0, data.balance - 5);
    }
  });
  unlockBadges();
  if (data.balance !== before) showToast('A goal window passed. 5 points were deducted.');
  persist();
}
function unlockBadges() {
  const newlyEarned = [];
  milestones.forEach((badge) => {
    if (data.balance >= badge.points && !data.badges.includes(badge.name)) {
      data.badges.push(badge.name);
      newlyEarned.push(badge.name);
    }
  });
  if (newlyEarned.length) {
    persist();
    window.setTimeout(() => showToast(`${newlyEarned.join(' and ')} badge${newlyEarned.length > 1 ? 's' : ''} unlocked.`), 300);
  }
}
function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2900);
}
function renderNotificationSetup() {
  const title = document.querySelector('#notification-title');
  const copy = document.querySelector('#notification-copy');
  const button = document.querySelector('#notification-permission');
  if (!title || !copy || !button) return;

  if (!('Notification' in window)) {
    title.textContent = 'Reminders are not available here';
    copy.textContent = 'This browser does not support task notifications. Your scheduled goals will still appear in Daywell.';
    button.hidden = true;
    return;
  }
  if (Notification.permission === 'denied') {
    title.textContent = 'Notifications are blocked';
    copy.textContent = 'Allow notifications for this site in your browser settings to turn on task reminders.';
    button.hidden = true;
    return;
  }

  button.hidden = false;
  const enabled = data.notificationsEnabled && Notification.permission === 'granted';
  title.textContent = enabled ? 'Task reminders are on' : 'A gentle reminder, right on time';
  copy.textContent = enabled
    ? 'Start and end reminders appear while Daywell is open. Your browser may pause them if the app or device is asleep.'
    : 'Allow browser notifications for task start and end times. You can turn reminders off here anytime.';
  button.textContent = enabled ? 'Turn off reminders' : 'Enable reminders';
  button.dataset.enabled = String(enabled);
}
async function requestTaskNotifications() {
  if (!('Notification' in window)) {
    showToast('This browser does not support notifications.');
    return;
  }
  if (data.notificationsEnabled && Notification.permission === 'granted') {
    data.notificationsEnabled = false;
    persist();
    render();
    showToast('Task reminders are off.');
    return;
  }
  try {
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== 'granted') {
      render();
      showToast(permission === 'denied'
        ? 'Allow notifications in your browser settings to enable reminders.'
        : 'Notification permission was not granted.');
      return;
    }
    data.notificationsEnabled = true;
    persist();
    render();
    showToast('Task reminders are on.');
    checkScheduledNotifications();
  } catch {
    showToast('Your browser could not enable notifications. Check its site settings.');
  }
}
async function deliverTaskNotification(task, phase, key) {
  const isStart = phase === 'start';
  const title = isStart ? `Time to start: ${task.name}!` : `Time's up for ${task.name}!`;
  const body = isStart ? 'Your scheduled goal is ready.' : 'Mark it complete to earn points.';
  const options = {
    body,
    icon: '/daywell-192.png',
    badge: '/daywell-192.png',
    tag: `daywell-${key}`,
    renotify: false,
    data: { url: '/' },
  };
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch {
    showToast('A task reminder could not be shown. Check your browser notification settings.');
  }
}
function checkScheduledNotifications() {
  rollDateIfNeeded();
  if (!data.notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!Array.isArray(data.today.remindersSent)) data.today.remindersSent = [];
  const now = Date.now();
  const today = localDayKey();
  const sent = new Set(data.today.remindersSent);
  let changed = false;
  for (const task of data.tasks) {
    const status = data.today.statuses[task.id];
    for (const phase of ['start', 'end']) {
      const key = `${today}:${task.id}:${phase}`;
      if (sent.has(key)) continue;
      const scheduledAt = taskDate(task[phase]).getTime();
      if (now < scheduledAt) continue;
      sent.add(key);
      data.today.remindersSent.push(key);
      changed = true;
      if (!status && now - scheduledAt <= REMINDER_GRACE_MS) {
        deliverTaskNotification(task, phase, key);
      }
    }
  }
  if (changed) persist();
}
function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function updateInstallButton() {
  const button = document.querySelector('#install-app');
  if (!button) return;
  const installed = isStandaloneApp();
  button.disabled = installed;
  button.textContent = installed ? 'App Installed' : 'Install App';
  button.setAttribute('aria-label', installed ? 'Daywell is installed' : 'Install Daywell as an app');
}
function registerAppShell() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
    showToast('Offline app support is unavailable in this browser.');
  });
}
async function installApp() {
  if (isStandaloneApp()) {
    showToast('Daywell is already installed.');
    return;
  }
  if (!deferredInstallPrompt) {
    showToast('Use your browser menu and choose “Install app” or “Add to Home Screen”.');
    return;
  }
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    showToast(choice.outcome === 'accepted'
      ? 'Daywell is ready on your device.'
      : 'You can install Daywell anytime from this button.');
  } catch {
    showToast('Your browser could not open the install prompt. Try its menu instead.');
  } finally {
    updateInstallButton();
  }
}
function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  return new Promise((resolve, reject) => {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.className = 'copy-buffer';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    copied ? resolve() : reject(new Error('Clipboard access is unavailable.'));
  });
}
function openFontModal() {
  document.querySelector('#font-modal-backdrop').hidden = false;
  document.querySelector('#close-font-modal').focus();
}
function closeFontModal() {
  document.querySelector('#font-modal-backdrop').hidden = true;
  document.querySelector('#font-button').focus();
}
function getTier(balance = data.balance) {
  if (balance >= 200) return { name: 'Valuables / Platinum', min: 200, next: null };
  if (balance >= 100) return { name: 'Gold', min: 100, next: 200 };
  if (balance >= 50) return { name: 'Silver', min: 50, next: 100 };
  return { name: 'Bronze', min: 0, next: 50 };
}
function getProgress(balance, min, next) {
  if (next === null) return 100;
  return Math.max(0, Math.min(100, ((balance - min) / (next - min)) * 100));
}
function avatarMarkup(extraClass = '') {
  const avatar = data.avatar || { type: 'builtin', value: 'leaf' };
  if (avatar.type === 'image' && avatar.value) return `<span class="avatar-face ${extraClass}"><img src="${avatar.value}" alt="Your profile avatar"></span>`;
  const values = { leaf: 'L', sun: 'S', sky: 'A', plum: 'M', rose: 'R' };
  return `<span class="avatar-face ${extraClass}" data-avatar="${escapeHTML(avatar.value)}" aria-label="Profile avatar">${values[avatar.value] || 'Y'}</span>`;
}
function navMarkup() {
  const links = [
    ['goals', 'Daily Goals', 'Your rhythm'],
    ['wallet', 'Wallet & Balance', 'Points & progress'],
    ['badges', 'Badges & Rewards', 'Small wins, kept'],
  ];
  return links.map(([id, title, caption]) => `
    <button type="button" class="nav-card ${activeView === id ? 'active' : ''}" data-view="${id}" aria-current="${activeView === id ? 'page' : 'false'}">
      <span class="nav-icon">${icons[id]}</span><span class="nav-copy"><strong>${title}</strong><small>${caption}</small></span>
    </button>`).join('');
}
function taskPresentation(task, index, firstOpenId, now) {
  const status = data.today.statuses[task.id];
  if (status === 'completed') return { state: 'completed', label: 'Completed' };
  if (status === 'missed') return { state: 'missed', label: 'Missed' };
  if (task.id !== firstOpenId) return { state: 'locked', label: 'Locked' };
  const start = taskDate(task.start, now);
  const end = taskDate(task.end, now);
  if (now < start) return { state: 'upcoming', label: 'Upcoming' };
  if (now < end) return { state: 'in-progress', label: 'In progress' };
  return { state: 'missed', label: 'Missed' };
}
function firstUnresolvedTask() {
  return data.tasks.find((task) => !data.today.statuses[task.id]);
}
function renderTasks() {
  const host = document.querySelector('#task-content');
  const list = data.tasks;
  if (!list.length) {
    host.innerHTML = `<div class="empty-state">
      <div class="empty-mark" aria-hidden="true">+</div>
      <h3>Start with one small thing.</h3>
      <p>Your day is yours to shape. Add a goal with a time window, then show up when the moment arrives.</p>
      <button type="button" class="btn" data-action="add-task">Add your first goal</button>
      <button type="button" class="btn ghost small" data-action="sample-plan" style="margin-left:6px">Try a sample plan</button>
    </div>`;
    return;
  }
  const now = new Date();
  const first = firstUnresolvedTask();
  const firstId = first?.id;
  const rows = list.map((task, index) => {
    const view = taskPresentation(task, index, firstId, now);
    const reward = (index + 1) * 10;
    const actionable = view.state === 'in-progress';
    return `<li class="task-item state-${view.state}" data-task-id="${escapeHTML(task.id)}">
      <span class="task-step">${String(index + 1).padStart(2, '0')}</span>
      <div class="task-copy"><strong>${escapeHTML(task.name)}</strong><div class="task-meta"><span>${timeLabel(task.start)} – ${timeLabel(task.end)}</span><span class="task-reward">+${reward} pts</span></div></div>
      <span class="status-pill">${view.label}</span>
      ${actionable ? `<div class="task-action"><button class="btn small" type="button" data-action="complete-task" data-task="${escapeHTML(task.id)}">Mark complete · +${reward}</button></div>` : ''}
    </li>`;
  }).join('');
  const completeCount = list.filter((task) => data.today.statuses[task.id] === 'completed').length;
  host.innerHTML = `<ol class="task-list">${rows}</ol>
    <div class="add-row"><span class="subtle-copy">${completeCount} of ${list.length} goals completed today</span><button type="button" class="btn secondary small" data-action="add-task">Add a goal</button></div>`;
}
function renderTierCard() {
  const tier = getTier();
  const percent = getProgress(data.balance, tier.min, tier.next);
  const tierDisplay = tier.name === 'Valuables / Platinum' ? 'Valuables' : tier.name;
  const nextLabel = tier.next ? `${data.balance} / ${tier.next} pts` : 'Top tier reached';
  const spanLabel = tier.next ? `${tier.next - data.balance} to ${tier.next} pts` : 'Every point counts';
  return `<article class="panel tier-card">
    <div class="tier-row"><span class="tier-name"><i class="tier-dot"></i>${tierDisplay} tier</span><span class="tier-score">${nextLabel}</span></div>
    <div class="progress-track" role="progressbar" aria-label="Tier progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"><div class="progress-fill" style="width:${percent}%"></div></div>
    <div class="progress-caption"><span>${tier.min} pts</span><span>${spanLabel}</span></div>
  </article>`;
}
function renderBadges() {
  const next = milestones.find((badge) => !data.badges.includes(badge.name));
  const percent = next ? Math.min(100, (data.balance / next.points) * 100) : 100;
  const progressCopy = next ? `${Math.max(0, next.points - data.balance)} points to ${next.name}` : 'Every milestone collected';
  const cards = milestones.map((badge) => {
    const earned = data.badges.includes(badge.name);
    return `<article class="panel badge-card ${earned ? 'unlocked' : ''}">
      <div class="badge-symbol" aria-hidden="true">${badge.symbol}</div><h3>${badge.name}</h3>
      <p>${badge.points} POINTS</p><span class="unlock-state">${earned ? 'Earned · kept forever' : 'Waiting to be found'}</span>
    </article>`;
  }).join('');
  return `<div class="badges-top">
    <article class="panel badge-progress"><span class="eyebrow">Next milestone</span>
      <div class="badge-next"><div class="badge-medal ${next ? '' : 'unlocked'}">${next ? next.symbol : 'D'}</div>
        <div class="badge-next-copy"><strong>${next ? next.name : 'A full set'}</strong><span>${progressCopy}</span></div></div>
      <div class="progress-track" role="progressbar" aria-label="Progress to next badge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"><div class="progress-fill" style="width:${percent}%"></div></div>
    </article>
    <article class="panel badge-progress"><span class="eyebrow">How badges work</span><p class="section-sub" style="margin-top:10px">Your milestones stay yours. As your wallet balance reaches 20, 50, 100, and 200 points, each badge unlocks automatically and remains in your collection.</p></article>
  </div><div class="badge-grid">${cards}</div>`;
}
function renderWallet() {
  const tier = getTier();
  const tierLabel = tier.name === 'Valuables / Platinum' ? 'Valuables / Platinum' : `${tier.name} tier`;
  const tiers = [
    ['Bronze', '0–49 points', data.balance >= 0 && data.balance < 50],
    ['Silver', '50–99 points', data.balance >= 50 && data.balance < 100],
    ['Gold', '100–199 points', data.balance >= 100 && data.balance < 200],
    ['Valuables / Platinum', '200+ points', data.balance >= 200],
  ];
  const next = tier.next;
  const progressCopy = next ? `${next - data.balance} points to ${next}` : 'You have reached the highest tier';
  document.querySelector('#wallet-content').innerHTML = `
    <div class="wallet-layout">
      <div><article class="wallet-large"><div class="balance-top"><span>AVAILABLE BALANCE</span><span>DAYWELL WALLET</span></div>
        <div class="balance-value" data-testid="wallet-balance">${data.balance}</div><div class="balance-caption">points collected, one day at a time</div>
        <div class="wallet-stat-row"><div class="wallet-stat"><strong>+${data.today.earned}</strong><small>EARNED TODAY</small></div><div class="wallet-stat"><strong>−${data.today.missed}</strong><small>MISSED TODAY</small></div></div>
      </article><article class="panel wallet-foot"><div class="ledger-head"><h3 class="panel-title">Today at a glance</h3><span class="tiny-tag">${displayDate()}</span></div>
        <div class="ledger-row"><span>Goals completed</span><span>${data.tasks.filter((task) => data.today.statuses[task.id] === 'completed').length}</span></div>
        <div class="ledger-row"><span>Points earned</span><span>+${data.today.earned}</span></div>
        <div class="ledger-row"><span>Missed goal penalties</span><span>−${data.today.missed}</span></div>
      </article></div>
      <div><article class="panel tier-card" style="margin-bottom:13px"><div class="tier-row"><span class="tier-name"><i class="tier-dot"></i>${tierLabel}</span><span class="tier-score">${next ? `${data.balance} / ${next}` : `${data.balance} pts`}</span></div>
        <div class="progress-track" role="progressbar" aria-label="Tier progression" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(getProgress(data.balance, tier.min, next))}"><div class="progress-fill" style="width:${getProgress(data.balance, tier.min, next)}%"></div></div>
        <div class="progress-caption"><span>${tier.min} points</span><span>${progressCopy}</span></div></article>
        <div class="tier-list">${tiers.map(([name, range, current]) => `<div class="tier-line ${current ? 'current' : ''}"><strong>${name}</strong><small>${range}</small></div>`).join('')}</div>
      </div>
    </div>
    <p class="rule-note"><strong>Keep your rhythm:</strong> the next goal pays 10 points more than the one before it. A missed time window costs 5 points (your balance never drops below zero).</p>`;
}
function render() {
  rollDateIfNeeded();
  document.body.dataset.theme = data.theme;
  document.querySelector('#date-kicker').textContent = displayDate();
  document.querySelectorAll('[data-view]').forEach((button) => {
    const current = button.dataset.view === activeView;
    button.classList.toggle('active', current);
    button.setAttribute('aria-current', current ? 'page' : 'false');
  });
  document.querySelectorAll('.page-section').forEach((section) => section.classList.toggle('active', section.id === `view-${activeView}`));
  document.querySelector('#profile-avatar').innerHTML = avatarMarkup();
  document.querySelector('#profile-panel-avatar').innerHTML = avatarMarkup();
  document.querySelector('#profile-name').textContent = 'Your space';
  document.querySelector('#profile-points').textContent = `${data.balance} points`;
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.themeChoice === data.theme ? 'true' : 'false'));
  renderNotificationSetup();
  updateInstallButton();
  document.querySelectorAll('[data-avatar-choice]').forEach((button) => {
    const selected = data.avatar.type === 'builtin' && button.dataset.avatarChoice === data.avatar.value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelector('#today-date').textContent = displayDate();
  document.querySelector('#balance-mini').textContent = data.balance;
  document.querySelector('#earned-mini').textContent = `+${data.today.earned}`;
  document.querySelector('#missed-mini').textContent = `−${data.today.missed}`;
  document.querySelector('#tier-summary').innerHTML = renderTierCard();
  renderTasks();
  renderWallet();
  document.querySelector('#badges-content').innerHTML = renderBadges();
}

document.querySelector('#app').innerHTML = `
  <div class="app-shell">
    <aside class="sidebar" aria-label="Main navigation">
      <div class="brand"><div class="brand-mark">d</div><div class="brand-name">day<span>well</span></div></div>
      <div class="nav-label">Your little dashboard</div><nav class="side-nav">${navMarkup()}</nav>
      <div class="sidebar-bottom"><div class="theme-box"><h3>A little atmosphere</h3>
        <div class="theme-options" role="group" aria-label="Choose a color theme">
          <button class="theme-choice" data-theme-choice="light" type="button" aria-label="Light theme" title="Light" aria-pressed="false"></button>
          <button class="theme-choice" data-theme-choice="dark" type="button" aria-label="Dark theme" title="Dark" aria-pressed="false"></button>
          <button class="theme-choice" data-theme-choice="neon" type="button" aria-label="Colorful neon theme" title="Neon" aria-pressed="false"></button>
        </div><p class="theme-note">Choose the mood that feels like you.</p>
      </div></div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div><div class="date-kicker" id="date-kicker"></div><h1 class="welcome">A gentler way to get<br class="mobile-break"> <em>things done.</em></h1></div>
        <div class="header-controls">
          <button type="button" class="btn secondary small font-button" id="font-button" data-action="open-fonts">Fonts</button>
          <button type="button" class="btn install-btn small" id="install-app">Install App</button>
          <div class="profile"><div class="profile-label"><strong id="profile-name"></strong><small id="profile-points"></small></div>
          <button type="button" class="avatar-trigger" id="profile-avatar" aria-label="Customize profile avatar" aria-expanded="false"></button>
          <section class="panel profile-panel" id="profile-panel" aria-label="Avatar settings" hidden>
            <h3>Your little portrait</h3><span class="eyebrow">Pick a color</span>
            <div class="avatar-options" role="group" aria-label="Built-in avatars">
              <button class="avatar-option" data-avatar-choice="leaf" type="button" aria-label="Leaf avatar"></button>
              <button class="avatar-option" data-avatar-choice="sun" type="button" aria-label="Sun avatar"></button>
              <button class="avatar-option" data-avatar-choice="sky" type="button" aria-label="Sky avatar"></button>
              <button class="avatar-option" data-avatar-choice="plum" type="button" aria-label="Plum avatar"></button>
              <button class="avatar-option" data-avatar-choice="rose" type="button" aria-label="Rose avatar"></button>
            </div><div id="profile-panel-avatar"></div>
            <label class="upload-label" for="avatar-upload">Or use a photo
              <input class="upload-input" id="avatar-upload" type="file" accept="image/*">
            </label>
          </section>
          </div>
        </div>
      </header>
      <section class="page-section" id="view-goals" aria-labelledby="goals-title">
        <div class="hero-row"><div><div class="eyebrow">One day, at your pace</div><h2 class="section-heading" id="goals-title">Today's rhythm</h2><p class="section-sub">A few small promises to yourself. Do the next one when its time arrives.</p></div><div class="date-stamp" id="today-date"></div></div>
        <section class="notification-setup panel" id="notification-setup" aria-labelledby="notification-title">
          <div class="notification-copy-block"><strong id="notification-title">A gentle reminder, right on time</strong><p id="notification-copy">Allow browser notifications for task start and end times.</p></div>
          <button class="btn secondary small" id="notification-permission" type="button" data-action="toggle-notifications">Enable reminders</button>
        </section>
        <div class="dashboard-grid">
          <article class="panel goals-panel"><div class="panel-head"><h3 class="panel-title">Your daily goals</h3><span class="tiny-tag"><i class="live-dot"></i> Follows your local time</span></div>
            <div id="task-content"></div><p class="rule-note"><strong>Gentle accountability:</strong> only your next goal can be completed. Complete it within its time window to earn its points. A missed window takes 5 points off, once only.</p>
          </article>
          <aside class="side-stack" aria-label="Daily summary">
            <article class="balance-card"><div class="balance-top"><span>YOUR BALANCE</span><span>●</span></div><div class="balance-value" id="balance-mini">0</div><div class="balance-caption">points, saved as you go</div></article>
            <article class="panel wallet-mini"><div class="mini-metric"><strong id="earned-mini">+0</strong><small>EARNED TODAY</small></div><div class="mini-metric"><strong id="missed-mini">−0</strong><small>POINTS MISSED</small></div></article>
            <div id="tier-summary"></div>
          </aside>
        </div>
      </section>
      <section class="page-section" id="view-wallet" aria-labelledby="wallet-title">
        <div class="hero-row"><div><div class="eyebrow">A little progress adds up</div><h2 class="section-heading" id="wallet-title">Wallet & balance</h2><p class="section-sub">Your points are a record of showing up, not a scorecard.</p></div><div class="date-stamp">${displayDate()}</div></div>
        <div id="wallet-content"></div>
      </section>
      <section class="page-section" id="view-badges" aria-labelledby="badges-title">
        <div class="hero-row"><div><div class="eyebrow">Good things, remembered</div><h2 class="section-heading" id="badges-title">Badges & rewards</h2><p class="section-sub">Little markers of momentum. Keep the ones you've earned.</p></div><div class="date-stamp">4 milestones</div></div>
        <div id="badges-content"></div>
      </section>
    </main>
  </div>
  <nav class="mobile-nav" aria-label="Mobile navigation">${navMarkup()}</nav>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <div class="modal-backdrop" id="task-modal-backdrop" hidden>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
      <h2 id="task-modal-title">Make a little space</h2><p>Add a daily goal and give it a time window. Your new goal comes after the last one in your rhythm.</p>
      <form id="task-form">
        <div class="field"><label for="task-name">What would you like to do?</label><input id="task-name" name="name" type="text" maxlength="60" placeholder="A short walk, a quiet read…" required></div>
        <div class="form-grid">
          <div class="field"><label for="task-start">Start time</label><input id="task-start" name="start" type="time" required></div>
          <div class="field"><label for="task-end">End time</label><input id="task-end" name="end" type="time" required></div>
        </div><p class="form-error" id="form-error" aria-live="polite"></p>
        <div class="modal-actions"><button class="btn ghost" type="button" data-action="close-modal">Not now</button><button class="btn" type="submit">Add to my day</button></div>
      </form>
    </section>
  </div>
  <div class="modal-backdrop font-modal-backdrop" id="font-modal-backdrop" hidden>
    <section class="modal font-modal" role="dialog" aria-modal="true" aria-labelledby="font-modal-title">
      <div class="font-modal-heading"><div><div class="eyebrow">A closer look</div><h2 id="font-modal-title">Fonts in Daywell</h2></div><button class="btn ghost small" type="button" id="close-font-modal" data-action="close-fonts" aria-label="Close font preview">Close</button></div>
      <p>Three typefaces give the dashboard its personality. Copy a complete CSS font declaration for use in your own project.</p>
      <div class="font-list">
        <article class="font-option"><div><span class="eyebrow">Headings</span><h3 class="font-sample-heading">Newsreader</h3><code>‘A little progress adds up.’</code><small>Fallbacks: Georgia, serif</small></div><button type="button" class="btn secondary small copy-font" data-copy-font="font-family: 'Newsreader', Georgia, serif;">Copy Font Family CSS</button></article>
        <article class="font-option"><div><span class="eyebrow">Body text</span><h3 class="font-sample-body">Manrope</h3><code>A clear, friendly everyday rhythm.</code><small>Fallback: sans-serif</small></div><button type="button" class="btn secondary small copy-font" data-copy-font="font-family: 'Manrope', sans-serif;">Copy Font Family CSS</button></article>
        <article class="font-option"><div><span class="eyebrow">UI labels</span><h3 class="font-sample-label">DM Mono</h3><code>08:00 AM · 10 POINTS</code><small>Fallback: monospace</small></div><button type="button" class="btn secondary small copy-font" data-copy-font="font-family: 'DM Mono', monospace;">Copy Font Family CSS</button></article>
      </div>
    </section>
  </div>`;

document.querySelectorAll('[data-avatar-choice]').forEach((button) => {
  button.innerHTML = avatarMarkup().replace('avatar-face', `avatar-face`).replace(/<span class="avatar-face[^"]*"[^>]*>.*?<\/span>/, `<span class="avatar-face" data-avatar="${button.dataset.avatarChoice}">${({ leaf: 'L', sun: 'S', sky: 'A', plum: 'M', rose: 'R' })[button.dataset.avatarChoice]}</span>`);
});
document.querySelector('#profile-panel-avatar').innerHTML = avatarMarkup();
document.querySelector('#profile-panel').hidden = true;
render();

function setView(view) {
  activeView = view;
  render();
}
function openTaskModal() {
  const backdrop = document.querySelector('#task-modal-backdrop');
  const last = data.tasks[data.tasks.length - 1];
  const start = last?.end || '';
  document.querySelector('#task-start').value = start;
  document.querySelector('#task-end').value = '';
  document.querySelector('#task-name').value = '';
  document.querySelector('#form-error').textContent = '';
  backdrop.hidden = false;
  requestAnimationFrame(() => document.querySelector('#task-name').focus());
}
function closeTaskModal() {
  document.querySelector('#task-modal-backdrop').hidden = true;
}
function completeTask(id) {
  checkExpiredTasks();
  const task = firstUnresolvedTask();
  if (!task || task.id !== id) { render(); return; }
  const now = new Date();
  if (now < taskDate(task.start, now) || now >= taskDate(task.end, now)) {
    showToast('This goal can only be completed in its time window.');
    render();
    return;
  }
  const index = data.tasks.findIndex((item) => item.id === id);
  const reward = (index + 1) * 10;
  data.today.statuses[id] = 'completed';
  data.today.earned += reward;
  data.balance += reward;
  unlockBadges();
  persist();
  showToast(`Lovely work. ${reward} points added to your balance.`);
  render();
}
function samplePlan() {
  if (data.tasks.length) return;
  const now = new Date();
  const rounded = new Date(now);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 30) * 30);
  if (localDayKey(rounded) !== localDayKey(now)) {
    showToast('There is not enough time left today for the sample plan. Add a goal instead.');
    return;
  }
  const tasks = [
    { name: 'Step outside for a little air', duration: 30 },
    { name: 'Take a proper water break', duration: 30 },
    { name: 'Read a few quiet pages', duration: 30 },
  ];
  if (rounded.getHours() * 60 + rounded.getMinutes() + 90 > 23 * 60 + 59) {
    showToast('There is not enough time left today for the sample plan. Add tomorrow’s first goal instead.');
    return;
  }
  data.tasks = tasks.map((task, index) => {
    const start = new Date(rounded.getTime() + index * task.duration * 60000);
    const end = new Date(start.getTime() + task.duration * 60000);
    return {
      id: `task-${Date.now()}-${index}`,
      name: task.name,
      start: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
      end: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
    };
  });
  persist();
  render();
  showToast('A sample rhythm is ready. Adjust it to make it yours.');
}

document.addEventListener('click', (event) => {
  const fontCopyButton = event.target.closest('[data-copy-font]');
  if (fontCopyButton) {
    copyText(fontCopyButton.dataset.copyFont).then(
      () => showToast('Font CSS copied.'),
      () => showToast('Could not copy the font declaration.'),
    );
    return;
  }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { setView(viewButton.dataset.view); return; }
  const themeButton = event.target.closest('[data-theme-choice]');
  if (themeButton) { data.theme = themeButton.dataset.themeChoice; persist(); render(); return; }
  const avatarButton = event.target.closest('[data-avatar-choice]');
  if (avatarButton) {
    data.avatar = { type: 'builtin', value: avatarButton.dataset.avatarChoice };
    persist(); render(); document.querySelector('#profile-panel').hidden = false; return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const { action } = actionButton.dataset;
    if (action === 'add-task') openTaskModal();
    if (action === 'close-modal') closeTaskModal();
    if (action === 'complete-task') completeTask(actionButton.dataset.task);
    if (action === 'sample-plan') samplePlan();
    if (action === 'toggle-notifications') requestTaskNotifications();
    if (action === 'open-fonts') openFontModal();
    if (action === 'close-fonts') closeFontModal();
  }
  if (!event.target.closest('#profile-panel') && !event.target.closest('#profile-avatar')) {
    document.querySelector('#profile-panel').hidden = true;
    document.querySelector('#profile-avatar').setAttribute('aria-expanded', 'false');
  }
  if (event.target.id === 'task-modal-backdrop') closeTaskModal();
  if (event.target.id === 'font-modal-backdrop') closeFontModal();
});

document.querySelector('#task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const name = String(formData.get('name') || '').trim();
  const start = String(formData.get('start') || '');
  const end = String(formData.get('end') || '');
  const error = document.querySelector('#form-error');
  const last = data.tasks[data.tasks.length - 1];
  if (!name) { error.textContent = 'Give your goal a name first.'; return; }
  if (!start || !end || end <= start) { error.textContent = 'Choose an end time that comes after the start time.'; return; }
  if (last && start < last.end) { error.textContent = `This goal needs to start at or after ${timeLabel(last.end)}.`; return; }
  data.tasks.push({ id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, start, end });
  persist();
  closeTaskModal();
  render();
  showToast('Your new goal is in the rhythm.');
});

document.querySelector('#profile-avatar').addEventListener('click', () => {
  const panel = document.querySelector('#profile-panel');
  panel.hidden = !panel.hidden;
  document.querySelector('#profile-avatar').setAttribute('aria-expanded', String(!panel.hidden));
});
document.querySelector('#avatar-upload').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Choose an image file for your avatar.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext('2d');
      const size = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256);
      data.avatar = { type: 'image', value: canvas.toDataURL('image/jpeg', 0.82) };
      persist(); render(); showToast('Your portrait is ready.');
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeTaskModal();
    if (!document.querySelector('#font-modal-backdrop').hidden) closeFontModal();
    document.querySelector('#profile-panel').hidden = true;
    document.querySelector('#profile-avatar').setAttribute('aria-expanded', 'false');
  }
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  showToast('Daywell was installed on your device.');
});
document.querySelector('#install-app').addEventListener('click', installApp);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkScheduledNotifications();
    checkExpiredTasks();
    render();
  }
});
window.addEventListener('focus', () => {
  checkScheduledNotifications();
  checkExpiredTasks();
  render();
});
window.setInterval(() => {
  checkScheduledNotifications();
  checkExpiredTasks();
  render();
}, 15000);
registerAppShell();
checkScheduledNotifications();
checkExpiredTasks();
render();