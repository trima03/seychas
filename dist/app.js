import {STORAGE_KEY, freshState, validateState, remaining, startTimer, pauseTimer, newTimer,
  addThought, chooseThought, completeFocus, formatTime, markdown} from './core.js';

const $ = id => document.getElementById(id);
const setText = (id, value) => {if ($(id).textContent !== value) $(id).textContent = value;};
let state = freshState();
let readOnly = false;
let storageFailure = false;
let rawBackup = null;
let corruptStorage = false;
let noticeTimeout;
let undoThought = null;
let installPrompt = null;
let lastSaved = null;

try {
  lastSaved = localStorage.getItem(STORAGE_KEY);
  if (lastSaved !== null) state = validateState(JSON.parse(lastSaved));
} catch {
  rawBackup = lastSaved;
  corruptStorage = rawBackup !== null;
  storageFailure = true;
  $('storage-warning').textContent = corruptStorage
    ? 'Не удалось прочитать сохранённые записи. Мы не будем их перезаписывать. Откройте «Мои данные» и сохраните исходную копию, затем восстановите исправный файл.'
    : 'Браузер не разрешает сохранять записи. Они доступны до закрытия страницы, а копию можно скачать через «Мои данные».';
  $('storage-warning').hidden = false;
}

function notify(message, undo = null) {
  clearTimeout(noticeTimeout);
  const box = $('notice');
  box.replaceChildren(document.createTextNode(message));
  if (undo) {
    const button = document.createElement('button');
    button.textContent = 'Вернуть';
    button.onclick = () => {undo(); box.hidden = true;};
    box.append(button);
  }
  box.hidden = false;
  noticeTimeout = setTimeout(() => {box.hidden = true;}, undo ? 12000 : 5000);
}

function save() {
  if (readOnly) return false;
  if (storageFailure) {$('save-status').textContent = 'Не сохранено, скачайте копию'; return false;}
  try {
    // Check for a newer saved revision before allowing a background tab to write.
    if (localStorage.getItem(STORAGE_KEY) !== lastSaved) {lockTab(); return false;}
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialized);
    lastSaved = serialized;
    $('save-status').textContent = 'Хранится на устройстве';
    return true;
  } catch {
    storageFailure = true;
    $('save-status').textContent = 'Не сохранено, скачайте копию';
    $('storage-warning').textContent = 'Не удалось сохранить изменения в браузере. Скачайте резервную копию через «Мои данные» перед закрытием страницы.';
    $('storage-warning').hidden = false;
    return false;
  }
}

function lockTab() {
  readOnly = true;
  if (!$('tab-dialog').open) $('tab-dialog').showModal();
}

function confirmAction(message) {
  const dialog = $('confirm-dialog');
  $('confirm-message').textContent = message;
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), {once: true});
    dialog.showModal();
  });
}

function updateFields() {
  $('task-title').value = state.focus.title;
  $('task-step').value = state.focus.step;
}

function renderLists() {
  $('later-count').textContent = state.later.length;
  $('later-empty').hidden = state.later.length > 0;
  $('thought-list').replaceChildren();
  for (const item of state.later) {
    const row = document.createElement('article');
    row.className = 'thought';
    const text = document.createElement('p');
    text.textContent = item.text;
    const actions = document.createElement('div');
    actions.className = 'thought-actions';
    const choose = document.createElement('button');
    choose.type = 'button'; choose.textContent = 'Взять в фокус ↗';
    choose.setAttribute('aria-label', `Взять в фокус: ${item.text}`);
    choose.onclick = async () => {
      if (readOnly) return;
      if (state.focus.title.trim() && !await confirmAction('Переключить задачу? Текущая задача и её следующий шаг сохранятся в «На потом». Таймер начнётся заново.')) return;
      if (readOnly) return;
      state = chooseThought(state, item.id);
      save(); updateFields(); render(); $('task-title').focus();
    };
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'Убрать';
    remove.setAttribute('aria-label', `Убрать мысль: ${item.text}`);
    remove.onclick = () => {
      if (readOnly) return;
      const index = state.later.findIndex(thought => thought.id === item.id);
      undoThought = {item, index};
      state.later = state.later.filter(thought => thought.id !== item.id);
      save(); renderLists();
      notify('Мысль убрана.', () => {
        if (readOnly || !undoThought || state.later.length >= 500) return;
        state.later.splice(undoThought.index, 0, undoThought.item);
        undoThought = null; save(); renderLists();
      });
    };
    actions.append(choose, remove); row.append(text, actions); $('thought-list').append(row);
  }
  const today = new Date().toDateString();
  const entries = state.history.filter(item => new Date(item.completedAt).toDateString() === today);
  $('day-total').textContent = entries.length
    ? `Завершено задач: ${entries.length}. Они сохранились в вашей истории.`
    : 'Каждый небольшой шаг считается.';
  $('history-list').replaceChildren();
  const history = state.history.slice().reverse().slice(0, 50);
  if (!history.length) {
    const empty = document.createElement('p'); empty.className = 'history-empty';
    empty.textContent = 'Здесь появятся задачи, которые вы отметите как готовые.';
    $('history-list').append(empty);
  }
  for (const item of history) {
    const row = document.createElement('div'); row.className = 'history-item';
    const date = document.createElement('span');
    date.textContent = new Date(item.completedAt).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
    row.append(date, document.createTextNode(`✓ ${item.title}`)); $('history-list').append(row);
  }
}

function renderTimer() {
  let left = remaining(state.timer);
  if (state.timer.status === 'running' && left === 0) {
    state.timer = pauseTimer(state.timer); save();
    notify(state.timer.mode === 'break' ? 'Перерыв закончился, можно вернуться к задаче.' : 'Подход закончился. Можно сделать перерыв или продолжить.');
  }
  const t = state.timer;
  const running = t.status === 'running';
  const finished = t.status === 'finished';
  document.body.classList.toggle('running', running);
  setText('clock', formatTime(left));
  $('clock').setAttribute('aria-label', `Осталось ${formatTime(left)}`);
  document.title = running ? `${formatTime(left)} · ${t.mode === 'break' ? 'Перерыв' : 'Сейчас'}` : 'Сейчас · место для одной задачи';
  setText('timer-toggle', running ? 'Поставить на паузу  Ⅱ' : finished ? 'Начать ещё раз ↗' : t.status === 'paused' ? 'Продолжить подход ↗' : t.mode === 'break' ? 'Начать перерыв ↗' : 'Начать подход ↗');
  setText('timer-status', t.mode === 'break' ? 'Небольшой перерыв' : running ? 'Вы в фокусе' : finished ? 'Подход закончился' : t.status === 'paused' ? 'Можно продолжить' : 'В своём темпе');
  setText('timer-hint', t.mode === 'break' ? 'Дайте себе немного передохнуть.' : running ? 'Остальное может немного подождать.' : finished ? 'Как прошёл этот небольшой шаг?' : 'Можно начать с небольшого шага.');
  $('break-actions').hidden = !finished;
  $('start-break').hidden = t.mode === 'break';
  $('duration-options').hidden = t.mode === 'break';
  for (const button of document.querySelectorAll('[data-minutes]')) {
    button.setAttribute('aria-pressed', Number(button.dataset.minutes) * 60000 === t.duration ? 'true' : 'false');
    button.disabled = running;
  }
  $('timer-toggle').disabled = readOnly || corruptStorage || (!state.focus.title.trim() && t.mode === 'focus');
  $('complete').disabled = readOnly || corruptStorage || !state.focus.title.trim();
  $('return-button').disabled = !state.focus.title.trim();
}

function render() {renderTimer(); renderLists();}

for (const [id, key] of [['task-title', 'title'], ['task-step', 'step']]) {
  $(id).addEventListener('input', () => {
    if (readOnly) return;
    state.focus[key] = $(id).value;
    save(); renderTimer();
  });
}

$('thought-form').onsubmit = event => {
  event.preventDefault();
  if (readOnly) return;
  try {state = addThought(state, $('thought').value); save(); $('thought').value = ''; renderLists(); notify('Мысль сохранена. Можно продолжить.');}
  catch (error) {notify(error.message);}
};
$('timer-toggle').onclick = () => {
  if (readOnly || (!state.focus.title.trim() && state.timer.mode === 'focus')) return;
  if (state.timer.status === 'running') state.timer = pauseTimer(state.timer);
  else {
    if (remaining(state.timer) === 0) state.timer = newTimer(state.timer.duration / 60000, state.timer.mode);
    state.timer = startTimer(state.timer);
  }
  save(); renderTimer();
};
$('timer-reset').onclick = async () => {
  if (readOnly) return;
  if (remaining(state.timer) < state.timer.duration && !await confirmAction('Начать отсчёт заново? Задача и запись следующего шага сохранятся.')) return;
  if (readOnly) return;
  state.timer = newTimer(state.timer.duration / 60000, state.timer.mode); save(); renderTimer();
};
for (const button of document.querySelectorAll('[data-minutes]')) {
  button.onclick = async () => {
    if (readOnly || state.timer.status === 'running') return;
    if (remaining(state.timer) < state.timer.duration && !await confirmAction('Изменить длительность и начать отсчёт заново?')) return;
    if (readOnly) return;
    state.timer = newTimer(Number(button.dataset.minutes)); save(); renderTimer();
  };
}
$('return-button').onclick = () => {
  $('return-note').classList.add('highlight');
  $('task-step').focus();
  notify(state.focus.step ? `Следующий шаг: ${state.focus.step}` : `Сейчас вы делаете: ${state.focus.title}`);
  setTimeout(() => $('return-note').classList.remove('highlight'), 2500);
};
$('complete').onclick = () => {
  if (readOnly || !state.focus.title.trim()) return;
  const previous = structuredClone(state);
  state = completeFocus(state); save(); updateFields(); render();
  notify('Задача завершена. Можно выдохнуть.', () => {
    if (readOnly || state.focus.title || state.timer.status !== 'idle') {notify('Задача уже в истории, а текущий подход продолжается.'); return;}
    state.focus = previous.focus;
    state.timer = previous.timer.status === 'running' ? pauseTimer(previous.timer) : previous.timer;
    state.history = previous.history; save(); updateFields(); render();
  });
};
$('start-break').onclick = () => {if (!readOnly) {state.timer = startTimer(newTimer(5, 'break')); save(); renderTimer();}};
$('next-round').onclick = () => {if (!readOnly) {state.timer = newTimer(10); save(); renderTimer();}};
$('history-toggle').onclick = () => {
  const open = $('history-list').hidden;
  $('history-list').hidden = !open; $('history-toggle').setAttribute('aria-expanded', String(open));
};
$('data-open').onclick = () => $('data-dialog').showModal();
$('reload').onclick = () => location.reload();
$('tab-dialog').addEventListener('cancel', event => event.preventDefault());

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const dateStamp = () => new Date().toISOString().slice(0, 10);
$('export-markdown').onclick = () => download(markdown(state), `Сейчас-${dateStamp()}.md`, 'text/markdown;charset=utf-8');
$('export-json').onclick = () => {
  download(rawBackup ?? JSON.stringify(state, null, 2), `seychas-${dateStamp()}${rawBackup ? '-original' : ''}.json`, 'application/json');
  $('data-message').textContent = rawBackup ? 'Скачан исходный файл, который не удалось прочитать. Сохраните его, чтобы не потерять записи.' : 'Резервная копия скачана.';
};
$('import-json').onchange = async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file || readOnly) return;
  try {
    if (file.size > 2000000) throw new Error('Файл слишком большой. Максимальный размер копии: 2 МБ.');
    const restored = validateState(JSON.parse(await file.text()));
    if (rawBackup) {download(rawBackup, `seychas-original-${dateStamp()}.json`, 'application/json');}
    if (!await confirmAction('Заменить текущие записи данными из копии? Сначала сохраните свою копию, если хотите оставить текущие записи.')) return;
    if (readOnly) return;
    // Imported running timers become paused so an old deadline cannot silently consume a new session.
    if (restored.timer.status === 'running') restored.timer = pauseTimer(restored.timer);
    state = restored;
    corruptStorage = false;
    storageFailure = false;
    save(); rawBackup = null;
    $('storage-warning').hidden = !storageFailure;
    for (const control of document.querySelectorAll('main button, main textarea')) control.disabled = false;
    updateFields(); render();
    $('data-message').textContent = storageFailure ? 'Копия открыта, но браузер не разрешил её сохранить. Скачайте записи перед закрытием.' : 'Записи восстановлены.';
  } catch (error) {$('data-message').textContent = `Не удалось восстановить записи. ${error.message}`;}
  finally {input.value = '';}
};

window.addEventListener('storage', event => {if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== lastSaved) lockTab();});
document.addEventListener('visibilitychange', () => {if (!document.hidden && !readOnly && !corruptStorage) {renderTimer(); renderLists();}});
document.addEventListener('keydown', event => {if (event.altKey && event.code === 'KeyN') {event.preventDefault(); $('thought').focus();}});
window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); installPrompt = event; $('install').hidden = false;});
$('install').onclick = async () => {if (installPrompt) {await installPrompt.prompt(); installPrompt = null; $('install').hidden = true;}};
window.addEventListener('appinstalled', () => {$('install').hidden = true;});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {
  $('data-message').textContent = 'Офлайн-режим пока не подключился. При следующем открытии понадобится интернет.';
});
$('date-label').textContent = new Date().toLocaleDateString('ru-RU', {weekday: 'long', day: 'numeric', month: 'long'}).toUpperCase();
updateFields(); render();
if (corruptStorage) {for (const control of document.querySelectorAll('main button, main textarea')) control.disabled = true;}
if (storageFailure) $('save-status').textContent = 'Не сохранено, скачайте копию';
setInterval(() => {if (!readOnly && !corruptStorage) renderTimer();}, 250);
