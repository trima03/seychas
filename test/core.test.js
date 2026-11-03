import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState, remaining, startTimer, pauseTimer, newTimer, validateState,
  addThought, chooseThought, completeFocus, formatTime, markdown} from '../dist/core.js';

test('timer uses the deadline across tab suspension and a serialized reload', () => {
  const timer = startTimer(newTimer(10), 1000);
  assert.equal(remaining(timer, 61000), 540000);
  const loaded = validateState(JSON.parse(JSON.stringify({...freshState(), timer})));
  assert.equal(remaining(loaded.timer, 301000), 300000);
  assert.equal(remaining(loaded.timer, 901000), 0);
});

test('pausing excludes paused time and resuming retains the remainder', () => {
  const paused = pauseTimer(startTimer(newTimer(10), 1000), 61000);
  assert.equal(remaining(paused, 9999999), 540000);
  const resumed = startTimer(paused, 1000000);
  assert.equal(remaining(resumed, 1030000), 510000);
  assert.equal(pauseTimer(resumed, 2000000).status, 'finished');
});

test('expired timer cannot accidentally resume a whole session', () => {
  const timer = startTimer(newTimer(10), 0);
  assert.equal(startTimer(timer, 900000).status, 'finished');
  assert.equal(startTimer(timer, 900000).remaining, 0);
});

test('switching tasks preserves current task and return note', () => {
  const base = {...freshState(), focus: {title: 'Текущая задача', step: 'Открыл файл'}};
  const state = addThought(base, 'Другая мысль', 100, 'thought-1');
  const chosen = chooseThought(state, 'thought-1', 200, 'thought-2');
  assert.equal(chosen.focus.title, 'Другая мысль');
  assert.deepEqual(chosen.later, [{id: 'thought-2', text: 'Текущая задача', step: 'Открыл файл', createdAt: 200}]);
  assert.deepEqual(chooseThought(chosen, 'thought-2', 300, 'thought-3').focus, base.focus);
});

test('long and multilingual thoughts survive choosing, backup and export', () => {
  const text = '想法 и мысль '.repeat(40);
  let state = addThought(freshState(), text, 100, 'long');
  state = chooseThought(state, 'long');
  assert.equal(state.focus.title, text.trim());
  const loaded = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.focus.title, text.trim());
  assert.ok(markdown(loaded).includes(text.trim()));
});

test('completion records a task once and resets the next approach', () => {
  const state = {...freshState(), focus: {title: 'Написать тест', step: 'Проверить паузу'}, timer: startTimer(newTimer(10), 1000)};
  const completed = completeFocus(state, 61000);
  assert.equal(completed.history.length, 1);
  assert.equal(completed.history[0].elapsed, 60000);
  assert.equal(completed.focus.title, '');
  assert.throws(() => completeFocus(completed));
});

test('backup validation rejects malformed data without mutating the original', () => {
  const base = freshState();
  for (const patch of [{version: 2}, {later: 'oops'}, {focus: {title: 5, step: ''}}, {history: [{title: 'x', step: '', elapsed: -1, completedAt: 1}]}]) {
    assert.throws(() => validateState({...base, ...patch}));
  }
  assert.throws(() => validateState({...base, timer: {...base.timer, status: 'running', deadline: null}}));
  assert.throws(() => validateState({...base, timer: {...base.timer, remaining: NaN}}));
  assert.throws(() => validateState({...base, timer: {...base.timer, duration: 99999999}}));
  assert.deepEqual(base, freshState());
});

test('backup validates duplicate IDs and capacity limits', () => {
  const state = addThought(freshState(), 'Заметка', 1, 'one');
  assert.throws(() => validateState({...state, later: [state.later[0], state.later[0]]}));
  const full = {...freshState(), later: Array.from({length: 500}, (_, i) => ({id: String(i), text: 'idea', step: '', createdAt: 1}))};
  assert.throws(() => addThought(full, 'ещё'));
  assert.throws(() => addThought(freshState(), ' '.repeat(10)));
  assert.throws(() => addThought(freshState(), 'a'.repeat(501)));
  assert.equal(validateState(full).later.length, 500);
});

test('history retention is bounded, with newest entries intact', () => {
  const state = freshState();
  state.focus.title = 'Последняя';
  state.history = Array.from({length: 500}, (_, i) => ({title: String(i), step: '', completedAt: i, elapsed: 0}));
  const next = completeFocus(state, 1000);
  assert.equal(next.history.length, 500);
  assert.equal(next.history[0].title, '1');
  assert.equal(next.history.at(-1).title, 'Последняя');
});

test('markdown includes task, checkpoint, queued and completed entries', () => {
  const state = freshState();
  state.focus = {title: 'Один\nшаг', step: 'Открыть редактор'};
  state.later = [{id: '1', text: 'Позже', step: '', createdAt: 1}];
  state.history = [{title: 'Сделано', step: '', completedAt: 1000, elapsed: 60000}];
  const md = markdown(state);
  assert.ok(md.includes('- [ ] Один шаг'));
  assert.ok(md.includes('Следующий шаг: Открыть редактор'));
  assert.ok(md.includes('- [ ] Позже'));
  assert.ok(md.includes('- [x] Сделано'));
});

test('display rounds seconds up and never goes negative', () => {
  assert.equal(formatTime(600000), '10:00');
  assert.equal(formatTime(999), '00:01');
  assert.equal(formatTime(-10), '00:00');
});

test('text that resembles HTML stays data in backup and markdown', () => {
  const text = '<img src=x onerror=alert(1)>';
  const state = addThought(freshState(), text, 1, 'html');
  assert.equal(validateState(state).later[0].text, text);
});
