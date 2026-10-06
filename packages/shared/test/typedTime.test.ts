import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { findTypedDay, findTypedTime, parseTypedTime, typedInstant, zoneFromWord } from '../src/typedTime';

const NY = 'America/New_York';
const time = (text: string, own = NY) => {
  const r = parseTypedTime(text, own);
  return r?.ok ? r.time : r;
};

describe('parseTypedTime', () => {
  it.each([
    ['3pm', 15, 0],
    ['3 PM', 15, 0],
    ['3p', 15, 0],
    ['3 p.m.', 15, 0],
    ['3:30pm', 15, 30],
    ['3.30 am', 3, 30],
    ['930am', 9, 30],
    ['12am', 0, 0],
    ['12pm', 12, 0],
    ['12:15', 12, 15],
    ['15:30', 15, 30],
    ['1530', 15, 30],
    ['09:00', 9, 0],
    ['0:30', 0, 30],
    ['noon', 12, 0],
    ['Midnight', 0, 0],
  ])('reads %s on the writer’s clock', (text, hour, minute) => {
    expect(time(text)).toEqual({ hour, minute, zone: NY, zoned: false });
  });

  it.each([
    ['3pm ET', 'America/New_York'],
    ['3pmET', 'America/New_York'],
    ['3 pm est', 'America/New_York'],
    ['3pm PT', 'America/Los_Angeles'],
    ['10am KST', 'Asia/Seoul'],
    ['15:30 UTC', 'UTC'],
    ['3pm (CET)', 'Europe/Paris'],
    ['9am Asia/Tokyo', 'Asia/Tokyo'],
    ['noon GMT', 'UTC'],
    ['10am UTC+9', 'UTC+9'],
    ['10am GMT-5', 'UTC-5'],
    ['10:30am UTC+5:30', 'UTC+5:30'],
  ])('reads the zone in %s', (text, zone) => {
    expect(time(text, 'Asia/Seoul')).toMatchObject({ zone, zoned: true });
  });

  it.each([
    ['3', 'Add AM or PM'],
    ['9:30', 'Add AM or PM'],
    ['13pm', 'the hour is 1 to 12'],
    ['25:00', 'The hour is 0 to 23'],
    ['3:75pm', 'Minutes go up to 59'],
    ['3pm XYZ', 'Unknown time zone “XYZ”'],
    ['3pmxyz', 'Unknown time zone “xyz”'],
    ['soon', 'Type a time'],
    ['call me 555-0100', 'Type a time'],
  ])('refuses %s', (text, error) => {
    const r = parseTypedTime(text, NY);
    expect(r?.ok).toBe(false);
    expect(r && !r.ok && r.error).toContain(error);
  });

  it('is nothing until something is typed', () => {
    expect(parseTypedTime('   ', NY)).toBeNull();
  });
});

describe('typedInstant', () => {
  it('puts the time on the day in its own zone, daylight saving included', () => {
    expect(typedInstant('2026-10-07', { hour: 15, minute: 0, zone: NY, zoned: true })).toBe('2026-10-07T19:00:00.000Z');
    expect(typedInstant('2026-12-07', { hour: 15, minute: 0, zone: NY, zoned: true })).toBe('2026-12-07T20:00:00.000Z');
    expect(typedInstant('2026-10-07', { hour: 10, minute: 0, zone: 'Asia/Seoul', zoned: true })).toBe('2026-10-07T01:00:00.000Z');
    expect(typedInstant('2026-10-07', { hour: 10, minute: 0, zone: zoneFromWord('UTC+5:30')!, zoned: true })).toBe('2026-10-07T04:30:00.000Z');
  });
});

describe('findTypedTime', () => {
  it.each([
    ['can we do 3pm ET tomorrow?', '3pm ET'],
    ['reschedule to 3 pm', '3 pm'],
    ['how about 10:30am KST', '10:30am KST'],
    ['at 15:30 then', '15:30'],
    ['around noon', 'noon'],
    ['3pm tomorrow', '3pm'],
    ['5pm (PT) works', '5pm PT'],
  ])('finds the time in %j', (text, found) => {
    expect(findTypedTime(text)).toBe(found);
  });

  it.each([['reschedule'], ['3 people'], ['call 555-0100'], ['I am late']])('finds none in %j', (text) => {
    expect(findTypedTime(text)).toBeNull();
  });
});

describe('findTypedDay', () => {
  // Monday, October 5, 2026, in New York.
  const now = DateTime.fromISO('2026-10-05T12:00:00', { zone: NY });

  it.each([
    ['today at 3', '2026-10-05'],
    ['tomorrow 3pm', '2026-10-06'],
    ['wed?', '2026-10-07'],
    ['Thursday works', '2026-10-08'],
    ['monday', '2026-10-05'],
    ['sun', '2026-10-11'],
  ])('reads %j', (text, day) => {
    expect(findTypedDay(text, NY, now)).toBe(day);
  });

  it('finds none where no day is named', () => {
    expect(findTypedDay('the research is ready', NY, now)).toBeNull();
  });
});
