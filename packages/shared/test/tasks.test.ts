import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TODO_STATUSES,
  DEFAULT_TODO_IMPORTANCE,
  DEFAULT_TODO_PRIORITY,
  DEFAULT_TODO_URGENCY,
  TODO_STATUSES,
  TODO_STATUS_LABELS,
  byDeadline,
  byExecution,
  isActiveTodo,
  needsStartDate,
  priorityOf,
  taskRisk,
  type SortableTask,
  type TodoStatus,
} from '../src';

const at = (day: number, hour = 0) => `2027-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

/** A task, with only what the sorting and risk rules look at. */
const task = (t: Partial<SortableTask> & { name: string }): SortableTask & { name: string } => ({
  startByAt: null,
  startByHasTime: false,
  completeByAt: null,
  urgency: DEFAULT_TODO_URGENCY,
  importance: DEFAULT_TODO_IMPORTANCE,
  createdAt: at(1),
  ...t,
});

const order = (tasks: Array<SortableTask & { name: string }>, by: (a: SortableTask, b: SortableTask) => number) =>
  [...tasks].sort(by).map((t) => t.name);

describe('priority follows the quadrant', () => {
  it('is P1 only for work that needs action and is strategic', () => {
    expect(priorityOf({ urgency: 'need_action', importance: 'strategic' })).toBe('p1');
    expect(priorityOf({ urgency: 'need_action', importance: 'non_strategic' })).toBe('p2');
    expect(priorityOf({ urgency: 'can_wait', importance: 'strategic' })).toBe('p2');
    expect(priorityOf({ urgency: 'can_wait', importance: 'non_strategic' })).toBe('p3');
  });

  it('makes a new task P1, because a new task needs action and is strategic', () => {
    expect(DEFAULT_TODO_PRIORITY).toBe('p1');
  });
});

describe('the execution view: what to work on now', () => {
  it('sorts by Start By, then its time, then priority, then Complete By', () => {
    // The spec's own table: two tasks starting Thursday, then Friday, then Saturday.
    const tasks = [
      task({ name: 'Prepare Hushed number', startByAt: at(6), completeByAt: at(7) }),
      task({ name: 'Complete 5 profiles', startByAt: at(5), completeByAt: at(6) }),
      task({ name: 'Send 20 SME invitations', startByAt: at(4), completeByAt: at(5) }),
      task({ name: 'Prepare LinkedIn post', startByAt: at(4), completeByAt: at(5), urgency: 'need_action', importance: 'strategic' }),
    ];
    expect(order(tasks, byExecution)).toEqual([
      'Send 20 SME invitations',
      'Prepare LinkedIn post',
      'Complete 5 profiles',
      'Prepare Hushed number',
    ]);
  });

  it('puts a day before the same day with a time on it', () => {
    const tasks = [
      task({ name: 'at 10:30', startByAt: at(4, 10), startByHasTime: true }),
      task({ name: 'Thursday', startByAt: at(4), startByHasTime: false }),
    ];
    expect(order(tasks, byExecution)).toEqual(['Thursday', 'at 10:30']);
  });

  it('breaks a tie on priority, and then on the deadline', () => {
    const tasks = [
      task({ name: 'p3 due first', startByAt: at(4), completeByAt: at(5), urgency: 'can_wait', importance: 'non_strategic' }),
      task({ name: 'p1 due later', startByAt: at(4), completeByAt: at(9), urgency: 'need_action', importance: 'strategic' }),
      task({ name: 'p2 due last', startByAt: at(4), completeByAt: at(10), urgency: 'can_wait', importance: 'strategic' }),
    ];
    expect(order(tasks, byExecution)).toEqual(['p1 due later', 'p2 due last', 'p3 due first']);
  });

  it('leaves a task with no start date at the bottom, never the top', () => {
    const tasks = [
      task({ name: 'no dates' }),
      task({ name: 'starts Saturday', startByAt: at(6) }),
      task({ name: 'starts Thursday', startByAt: at(4) }),
    ];
    expect(order(tasks, byExecution)).toEqual(['starts Thursday', 'starts Saturday', 'no dates']);
  });
});

describe('the deadline view: what must be finished soon', () => {
  it('sorts by Complete By, then priority', () => {
    const tasks = [
      task({ name: 'due Sunday', startByAt: at(4), completeByAt: at(7) }),
      task({ name: 'due Friday, p2', startByAt: at(4), completeByAt: at(5), urgency: 'can_wait', importance: 'strategic' }),
      task({ name: 'due Friday, p1', startByAt: at(6), completeByAt: at(5) }),
    ];
    expect(order(tasks, byDeadline)).toEqual(['due Friday, p1', 'due Friday, p2', 'due Sunday']);
  });

  it('is a different order from the execution view, which is the point', () => {
    const tasks = [
      task({ name: 'starts today, due next week', startByAt: at(4), completeByAt: at(20) }),
      task({ name: 'starts Friday, due Friday', startByAt: at(5), completeByAt: at(5) }),
    ];
    expect(order(tasks, byExecution)).toEqual(['starts today, due next week', 'starts Friday, due Friday']);
    expect(order(tasks, byDeadline)).toEqual(['starts Friday, due Friday', 'starts today, due next week']);
  });

  it('leaves a task with no deadline at the bottom', () => {
    const tasks = [task({ name: 'no deadline', startByAt: at(4) }), task({ name: 'due Friday', completeByAt: at(5) })];
    expect(order(tasks, byDeadline)).toEqual(['due Friday', 'no deadline']);
  });
});

describe('how a deadline is going', () => {
  const now = new Date(at(5, 9));
  const risk = (t: { status: TodoStatus; completeByAt: string | null; daysUntilDue: number | null }) => taskRisk(t, now);

  it('is overdue once the moment has passed, whatever the status', () => {
    expect(risk({ status: 'open', completeByAt: at(4), daysUntilDue: -1 })).toBe('overdue');
    expect(risk({ status: 'in_progress', completeByAt: at(4), daysUntilDue: -1 })).toBe('overdue');
    expect(risk({ status: 'blocked', completeByAt: at(4), daysUntilDue: -1 })).toBe('overdue');
  });

  it('is high risk due today and not started, at risk due tomorrow and not started', () => {
    expect(risk({ status: 'open', completeByAt: at(5, 18), daysUntilDue: 0 })).toBe('high_risk');
    expect(risk({ status: 'open', completeByAt: at(6, 18), daysUntilDue: 1 })).toBe('at_risk');
    expect(risk({ status: 'open', completeByAt: at(9, 18), daysUntilDue: 4 })).toBe('on_track');
  });

  it('is on track once someone has picked it up', () => {
    expect(risk({ status: 'in_progress', completeByAt: at(5, 18), daysUntilDue: 0 })).toBe('on_track');
    expect(risk({ status: 'blocked', completeByAt: at(6, 18), daysUntilDue: 1 })).toBe('on_track');
  });

  it('says nothing about a task with no deadline, or one already finished', () => {
    expect(risk({ status: 'open', completeByAt: null, daysUntilDue: null })).toBeNull();
    expect(risk({ status: 'done', completeByAt: at(4), daysUntilDue: -1 })).toBeNull();
    expect(risk({ status: 'completed', completeByAt: at(4), daysUntilDue: -1 })).toBeNull();
  });
});

describe('a deadline with no start date', () => {
  it('is the one case worth warning about', () => {
    expect(needsStartDate({ startByAt: null, completeByAt: at(5) })).toBe(true);
    expect(needsStartDate({ startByAt: at(4), completeByAt: at(5) })).toBe(false);
    // A task with neither is not a promise anyone has made yet.
    expect(needsStartDate({ startByAt: null, completeByAt: null })).toBe(false);
  });
});

describe('the five statuses', () => {
  it('names every stored status, and counts the three unfinished ones as work', () => {
    for (const status of TODO_STATUSES) expect(TODO_STATUS_LABELS[status]).toBeTruthy();
    expect(TODO_STATUSES.filter(isActiveTodo)).toEqual([...ACTIVE_TODO_STATUSES]);
    // The names on screen, whatever the database calls them.
    expect(TODO_STATUS_LABELS.open).toBe('Not Started');
    expect(TODO_STATUS_LABELS.done).toBe('Ready for Review');
  });
});
