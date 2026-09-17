import { describe, expect, it } from 'vitest';
import { chatMessageSchema, chatReactionSchema } from '../src/schemas';

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
