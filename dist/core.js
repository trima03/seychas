export const STORAGE_KEY = 'seychas.v1';
const LIMIT = 500;

export function freshState() {
  return {version: 1, focus: {title: '', step: ''}, later: [], history: [],
    timer: {mode: 'focus', status: 'idle', duration: 600000, remaining: 600000, deadline: null}};
}

export function remaining(timer, now = Date.now()) {
  return timer.status === 'running' ? Math.max(0, timer.deadline - now) : timer.remaining;
}

export function startTimer(timer, now = Date.now()) {
  const left = remaining(timer, now);
  if (left === 0) return {...timer, remaining: 0, deadline: null, status: 'finished'};
  return {...timer, remaining: left, deadline: now + left, status: 'running'};
}

export function pauseTimer(timer, now = Date.now()) {
  const left = remaining(timer, now);
  return {...timer, remaining: left, deadline: null, status: left === 0 ? 'finished' : 'paused'};
}

export function newTimer(minutes, mode = 'focus') {
  if (![5, 10, 25, 45].includes(minutes) || !['focus', 'break'].includes(mode)) throw new Error('Некорректное время');
  return {mode, status: 'idle', duration: minutes * 60000, remaining: minutes * 60000, deadline: null};
}

function validText(value, max, allowEmpty = true) {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
}

export function validateState(data) {
  const t = data?.timer;
  if (data?.version !== 1 || !validText(data.focus?.title, 500) || !validText(data.focus?.step, 500)
    || !Array.isArray(data.later) || data.later.length > LIMIT
    || !Array.isArray(data.history) || data.history.length > LIMIT
    || !t || !['focus', 'break'].includes(t.mode) || !['idle', 'running', 'paused', 'finished'].includes(t.status)
    || !Number.isFinite(t.duration) || t.duration < 60000 || t.duration > 2700000
    || !Number.isFinite(t.remaining) || t.remaining < 0 || t.remaining > t.duration
    || (t.status === 'running' ? !Number.isSafeInteger(t.deadline) || t.deadline < 0 : t.deadline !== null)) {
    throw new Error('Файл не похож на резервную копию «Сейчас» версии 1.');
  }
  const ids = new Set();
  for (const item of data.later) {
    if (!validText(item?.id, 80, false) || ids.has(item.id) || !validText(item.text, 500, false)
      || !validText(item.step, 500) || !Number.isFinite(item.createdAt)) throw new Error('Повреждён список мыслей.');
    ids.add(item.id);
  }
  for (const item of data.history) {
    if (!validText(item?.title, 500, false) || !validText(item.step, 500)
      || !Number.isFinite(item.completedAt) || !Number.isFinite(item.elapsed)
      || item.elapsed < 0 || item.elapsed > 2700000) throw new Error('Повреждена история.');
  }
  // Keep only known fields; imported objects never become executable markup or settings.
  return {version: 1, focus: {title: data.focus.title, step: data.focus.step},
    timer: {mode: t.mode, status: t.status, duration: t.duration, remaining: t.remaining, deadline: t.deadline},
    later: data.later.map(({id, text, step, createdAt}) => ({id, text, step, createdAt})),
    history: data.history.map(({title, step, completedAt, elapsed}) => ({title, step, completedAt, elapsed}))};
}

export function addThought(state, text, now = Date.now(), id = crypto.randomUUID()) {
  const value = text.trim();
  if (!value || value.length > 500) throw new Error('Запишите мысль длиной до 500 символов.');
  if (state.later.length >= LIMIT) throw new Error('В списке уже 500 мыслей. Сохраните копию и разберите несколько записей.');
  return {...state, later: [...state.later, {id, text: value, step: '', createdAt: now}]};
}

export function completeFocus(state, now = Date.now()) {
  if (!state.focus.title.trim()) throw new Error('Сначала назовите задачу.');
  const elapsed = state.timer.mode === 'focus' ? state.timer.duration - remaining(state.timer, now) : 0;
  const entry = {...state.focus, completedAt: now, elapsed};
  return {...state, focus: {title: '', step: ''}, timer: newTimer(10),
    history: [...state.history, entry].slice(-LIMIT)};
}

export function chooseThought(state, id, now = Date.now(), replacementId = crypto.randomUUID()) {
  const chosen = state.later.find(item => item.id === id);
  if (!chosen) throw new Error('Этой мысли уже нет в списке.');
  let later = state.later.filter(item => item.id !== id);
  if (state.focus.title.trim()) {
    later.push({id: replacementId, text: state.focus.title, step: state.focus.step, createdAt: now});
  }
  return {...state, focus: {title: chosen.text, step: chosen.step},
    later, timer: newTimer(10)};
}

export function formatTime(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function markdown(state) {
  const line = text => text.replace(/[\r\n]+/g, ' ');
  const lines = ['# Сейчас', '', '## Текущая задача', '',
    state.focus.title ? `- [ ] ${line(state.focus.title)}` : 'Текущая задача пока не выбрана.'];
  if (state.focus.step) lines.push(`  Следующий шаг: ${line(state.focus.step)}`);
  lines.push('', '## На потом', '');
  for (const item of state.later) {
    lines.push(`- [ ] ${line(item.text)}`);
    if (item.step) lines.push(`  Следующий шаг: ${line(item.step)}`);
  }
  lines.push('', '## Сделано', '');
  for (const item of state.history) {
    lines.push(`- [x] ${line(item.title)} (${new Date(item.completedAt).toLocaleDateString('ru-RU')})`);
    if (item.step) lines.push(`  ${line(item.step)}`);
  }
  return lines.join('\n') + '\n';
}
