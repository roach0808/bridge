import { describe, expect, it } from 'vitest';
import { DEFAULT_TODO_IMPORTANCE, DEFAULT_TODO_URGENCY, TODO_QUADRANTS, sameQuadrant } from '../src/chat';
import { chatMessageSchema, chatReactionSchema, createTodoSchema, moveTodoSchema, reorderTodosSchema } from '../src/schemas';

describe('chatReactionSchema', () => {
  it.each(['👍', '❤️', '👍🏽', '👨‍👩‍👧', '🇺🇸', '1️⃣'])('accepts %s', (emoji) => {
    expect(chatReactionSchema.safeParse({ emoji }).success).toBe(true);
  });
  it.each(['', 'a', '1', '👍a', 'hi', '<b>', '👍'.repeat(9)])('refuses %j', (emoji) => {
    expect(chatReactionSchema.safeParse({ emoji }).success).toBe(false);
  });
});

describe('chatMessageSchema', () => {
  const image = { dataUrl: 'data:image/webp;base64,UklGRg==', width: 800, height: 600 };
  it('needs text or a picture', () => {
    expect(chatMessageSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(chatMessageSchema.safeParse({}).success).toBe(false);
    expect(chatMessageSchema.parse({ image })).toMatchObject({ body: '', image });
    expect(chatMessageSchema.parse({ body: ' caption ', image }).body).toBe('caption');
  });
  it('refuses other image types and oversized pictures', () => {
    expect(chatMessageSchema.safeParse({ image: { ...image, dataUrl: 'data:image/gif;base64,R0lG' } }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ image: { ...image, width: 4000 } }).success).toBe(false);
  });
});

describe('the four quadrants of the task board', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('lists the quadrants once each, the most pressing first', () => {
    expect(TODO_QUADRANTS).toHaveLength(4);
    expect(new Set(TODO_QUADRANTS.map((q) => `${q.urgency}:${q.importance}`)).size).toBe(4);
    expect(TODO_QUADRANTS[0]).toEqual({ urgency: DEFAULT_TODO_URGENCY, importance: DEFAULT_TODO_IMPORTANCE });
    expect(TODO_QUADRANTS[0]).toEqual({ urgency: 'need_action', importance: 'strategic' });
  });

  it('compares two quadrants by both halves', () => {
    expect(sameQuadrant({ urgency: 'can_wait', importance: 'strategic' }, { urgency: 'can_wait', importance: 'strategic' })).toBe(true);
    expect(sameQuadrant({ urgency: 'can_wait', importance: 'strategic' }, { urgency: 'need_action', importance: 'strategic' })).toBe(false);
    expect(sameQuadrant({ urgency: 'can_wait', importance: 'strategic' }, { urgency: 'can_wait', importance: 'non_strategic' })).toBe(false);
  });

  it('leaves the quadrant out of a new task, and refuses one that is not a quadrant', () => {
    const plain = createTodoSchema.parse({ assigneeId: id, title: 'Write the brief' });
    expect(plain.urgency).toBeUndefined();
    expect(plain.importance).toBeUndefined();
    expect(createTodoSchema.parse({ assigneeId: id, title: 'Later', urgency: 'can_wait' }).urgency).toBe('can_wait');
    expect(createTodoSchema.safeParse({ assigneeId: id, title: 'Later', urgency: 'whenever' }).success).toBe(false);
  });

  it('carries the quadrant on a move and on a reorder', () => {
    expect(moveTodoSchema.parse({ assigneeId: id, urgency: 'can_wait', importance: 'non_strategic' })).toEqual({
      assigneeId: id,
      urgency: 'can_wait',
      importance: 'non_strategic',
    });
    expect(reorderTodosSchema.parse({ assigneeId: id, ids: [id], importance: 'non_strategic' }).importance).toBe('non_strategic');
    expect(reorderTodosSchema.safeParse({ assigneeId: id, ids: [], importance: 'non_strategic' }).success).toBe(false);
  });
});
