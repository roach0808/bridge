/**
 * Seed data (§12.3): one Founder, two Managers, four Associates, three Experts,
 * five Platforms, ten Profiles and a handful of Calls in mixed statuses.
 * Re-running wipes everything except the avatar catalog.
 */
import { PrismaClient, type CallStatus } from '@prisma/client';
import argon2 from 'argon2';
import { DateTime } from 'luxon';
import { TRANSITIONS, TEAM_TIME_ZONE, edgeOwner, type Role } from '@god/shared';

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123!';
const FOUNDER_EMAIL = process.env.SEED_FOUNDER_EMAIL ?? 'founder@god.local';

/** Shortest path through the workflow from on_scheduling to a status. */
function pathTo(target: CallStatus): CallStatus[] {
  const queue: CallStatus[][] = [['on_scheduling']];
  while (queue.length) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    if (last === target) return path;
    for (const t of TRANSITIONS.filter((t) => t.from === last)) {
      if (!path.includes(t.to)) queue.push([...path, t.to]);
    }
  }
  throw new Error(`No path to ${target}`);
}

async function main() {
  console.log('Seeding God System…');
  await prisma.$executeRawUnsafe(`
    TRUNCATE notifications, messages, call_status_history, calls, schedule_blocks,
             device_tokens, refresh_tokens, profiles, platforms, users CASCADE
  `);

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  // Stagger join dates so Expert slots (colours) are deterministic.
  let joined = DateTime.utc().minus({ days: 90 });
  const mkUser = async (
    nickname: string,
    role: Role,
    avatarNo: number,
    extra: { managerId?: string; timeZone?: string; email?: string } = {},
  ) => {
    joined = joined.plus({ hours: 1 });
    return prisma.user.create({
      data: {
        nickname,
        role,
        email: extra.email ?? `${nickname}@god.local`,
        passwordHash,
        avatarId: `${role}-${String(avatarNo).padStart(2, '0')}`,
        managerId: extra.managerId,
        timeZone: extra.timeZone ?? TEAM_TIME_ZONE,
        createdAt: joined.toJSDate(),
      },
    });
  };

  const founder = await mkUser('founder', 'founder', 1, { email: FOUNDER_EMAIL });
  const atlas = await mkUser('atlas', 'manager', 3);
  const beacon = await mkUser('beacon', 'manager', 8);
  const pixel = await mkUser('pixel', 'associate', 2, { managerId: atlas.id });
  const sprout = await mkUser('sprout', 'associate', 5, { managerId: atlas.id });
  const mango = await mkUser('mango', 'associate', 9, { managerId: beacon.id });
  const comet = await mkUser('comet', 'associate', 14, { managerId: beacon.id });
  const ember = await mkUser('ember', 'expert', 4, { timeZone: 'Asia/Seoul' });
  const flint = await mkUser('flint', 'expert', 7, { timeZone: 'Europe/London' });
  const quill = await mkUser('quill', 'expert', 12, { timeZone: 'America/New_York' });

  const platformRows = [
    { name: 'Northwind Insights', url: 'https://northwind.example.com', priority: 1, country: 'US' },
    { name: 'Meridian Expert Network', url: 'https://meridian.example.com', priority: 2, country: 'GB' },
    { name: 'Hanbit Research', url: 'https://hanbit.example.kr', priority: 3, country: 'KR' },
    { name: 'Kestrel Panels', url: 'https://kestrel.example.de', priority: 4, country: 'DE' },
    { name: 'Harbor Advisory', url: 'https://harbor.example.sg', priority: 5, country: 'SG' },
  ];
  const platforms = [];
  for (const p of platformRows) platforms.push(await prisma.platform.create({ data: p }));

  const profileRows: Array<[string, string, string | null]> = [
    ['Dana Whitfield', 'Former VP Supply Chain at a global consumer electronics maker; 18 years in APAC sourcing.', 'https://www.linkedin.com/in/example-dana'],
    ['Marcus Oyelaran', 'Ex-Director of Payments Strategy at a top-5 US bank. Card networks and real-time rails.', 'https://www.linkedin.com/in/example-marcus'],
    ['Hye-jin Park', 'Semiconductor packaging engineer, 12 years at a memory manufacturer. HBM and advanced packaging.', null],
    ['Tomás Ferreira', 'Former head of procurement for a LATAM grocery chain. Private label and cold chain.', 'https://www.linkedin.com/in/example-tomas'],
    ['Priya Raghunathan', 'Clinical operations lead for oncology trials; CRO selection and site activation.', 'https://www.linkedin.com/in/example-priya'],
    ['Lukas Brenner', 'Automotive powertrain program manager; EV battery pack supplier landscape in the EU.', null],
    ['Aiko Tanaka', 'Former product lead at a Japanese e-commerce marketplace; seller tools and ads.', 'https://www.linkedin.com/in/example-aiko'],
    ['Samuel Greene', 'Hospital CFO (retired). Revenue cycle management and payer negotiations.', null],
    ['Fatima Al-Sayed', 'Renewables developer; utility-scale solar PPAs in the Gulf region.', 'https://www.linkedin.com/in/example-fatima'],
    ['Ethan Caldwell', 'Cloud infrastructure buyer at a Fortune 500 retailer; multi-cloud cost optimisation.', 'https://www.linkedin.com/in/example-ethan'],
  ];
  // [date of birth, gender, nationality, location, education, career history]
  const personal: Array<[string, string, string, string, string, string]> = [
    ['1971-04-12', 'Female', 'American', 'Singapore', 'MBA, Wharton', 'VP Supply Chain, consumer electronics OEM (2012–2024)\nDirector of Sourcing APAC (2006–2012)'],
    ['1968-09-30', 'Male', 'Nigerian-American', 'Charlotte, US', 'BSc Economics, University of Lagos', 'Director of Payments Strategy, top-5 US bank (2015–2025)\nCard network partnerships lead (2008–2015)'],
    ['1982-02-18', 'Female', 'Korean', 'Suwon, South Korea', 'MSc Materials Engineering, KAIST', 'Senior packaging engineer, memory manufacturer (2013–2025)'],
    ['1975-07-03', 'Male', 'Brazilian', 'São Paulo, Brazil', 'BA Business, FGV', 'Head of Procurement, LATAM grocery chain (2014–2024)'],
    ['1979-11-21', 'Female', 'Indian', 'Boston, US', 'PharmD, University of Mumbai', 'Clinical operations lead, oncology trials (2011–2025)'],
    ['1977-05-09', 'Male', 'German', 'Munich, Germany', 'Dipl.-Ing. Mechanical Engineering, TU München', 'Powertrain program manager, automotive OEM (2009–2025)'],
    ['1985-01-27', 'Female', 'Japanese', 'Tokyo, Japan', 'BA Economics, Keio University', 'Product lead, e-commerce marketplace (2016–2025)'],
    ['1958-08-14', 'Male', 'American', 'Chicago, US', 'MBA, Kellogg', 'Hospital CFO (2004–2022, retired)'],
    ['1981-03-05', 'Female', 'Emirati', 'Dubai, UAE', 'MSc Energy Policy, Imperial College London', 'Renewables developer, utility-scale solar (2012–2025)'],
    ['1983-12-11', 'Male', 'British', 'London, UK', 'BSc Computer Science, University of Manchester', 'Cloud infrastructure buyer, Fortune 500 retailer (2015–2025)'],
  ];
  const now = new Date();
  const profiles = [];
  for (const [i, [name, briefExperience, linkedinUrl]] of profileRows.entries()) {
    const [dob, gender, nationality, location, education, careerHistory] = personal[i]!;
    profiles.push(
      await prisma.profile.create({
        data: {
          name,
          briefExperience,
          linkedinUrl,
          dateOfBirth: new Date(`${dob}T00:00:00Z`),
          gender,
          nationality,
          location,
          education,
          careerHistory,
          avatarId: `profile-${String(i + 1).padStart(2, '0')}`,
          status: 'approved',
          createdById: founder.id,
          reviewedById: founder.id,
          reviewedAt: now,
        },
      }),
    );
  }
  // Platform registrations: most profiles are on a couple of networks; one is banned somewhere.
  for (const [i, profile] of profiles.entries()) {
    for (const [j, platform] of platforms.entries()) {
      if ((i + j) % 3 === 0) continue; // not registered
      await prisma.profilePlatformStatus.create({
        data: { profileId: profile.id, platformId: platform.id, status: i === 7 && j === 1 ? 'banned' : 'registered' },
      });
    }
  }

  // Associate submissions: one waiting for review, one rejected.
  await prisma.profile.create({
    data: {
      name: 'Grace Lindqvist',
      briefExperience: 'Nordic telecom spectrum policy advisor.',
      avatarId: 'profile-11',
      status: 'pending',
      createdById: pixel.id,
    },
  });
  await prisma.profile.create({
    data: {
      name: 'Victor Hale',
      briefExperience: 'Claims to be a former airline CEO.',
      avatarId: 'profile-12',
      status: 'rejected',
      createdById: mango.id,
      reviewedById: founder.id,
      reviewedAt: now,
      rejectionReason: 'Could not verify the employment history.',
    },
  });

  // --- Calls ------------------------------------------------------------------
  const today = DateTime.now().setZone(TEAM_TIME_ZONE).startOf('day');
  const at = (dayOffset: number, hour: number, minute = 0) =>
    today.plus({ days: dayOffset }).set({ hour, minute }).toJSDate();

  const actorFor = (status: CallStatus, from: CallStatus, associateId: string, expertId: string | null) => {
    const owner = edgeOwner(from, status);
    if (owner === 'associate') return associateId;
    if (owner === 'expert') return expertId ?? founder.id;
    return founder.id;
  };

  interface SeedCall {
    status: CallStatus;
    associate: typeof pixel;
    expert: typeof ember | null;
    when: Date;
    duration: 15 | 30 | 45 | 60;
    platform: number;
    profile: number;
    details: string;
    contact: string;
    notes?: string;
    invoice?: [number, string];
    /** [actual minutes, rating, feedback] for finished and later calls. */
    report?: [number, number, string | null];
    messages?: Array<[typeof pixel, string]>;
  }

  const calls: SeedCall[] = [
    { status: 'on_scheduling', associate: pixel, expert: null, when: at(2, 10), duration: 60, platform: 0, profile: 0, details: 'Consumer electronics OEM evaluating second-source suppliers in Vietnam.', contact: 'Rachel (Northwind)' },
    { status: 'on_scheduling', associate: sprout, expert: ember, when: at(3, 20), duration: 30, platform: 2, profile: 2, details: 'HBM capacity outlook for 2027 and packaging bottlenecks.', contact: 'Min-seo (Hanbit)', notes: 'Client prefers Korean-speaking expert.' },
    { status: 'scheduled', associate: pixel, expert: quill, when: at(1, 11), duration: 45, platform: 0, profile: 1, details: 'Real-time payments adoption among mid-size US banks.', contact: 'Rachel (Northwind)', messages: [[pixel, 'Client confirmed. Dial-in link is in the platform portal.'], [quill, 'Thanks — I will join 5 minutes early.']] },
    { status: 'scheduled', associate: mango, expert: flint, when: at(1, 9), duration: 60, platform: 1, profile: 5, details: 'EU EV battery pack supplier landscape, focus on Poland and Hungary.', contact: 'Oliver (Meridian)' },
    { status: 'scheduled', associate: comet, expert: ember, when: at(0, 21), duration: 30, platform: 4, profile: 6, details: 'Seller advertising tools in Japanese marketplaces.', contact: 'Wei Ling (Harbor)' },
    { status: 'on_rescheduling', associate: sprout, expert: quill, when: at(4, 14), duration: 30, platform: 3, profile: 7, details: 'Hospital revenue cycle outsourcing trends.', contact: 'Jonas (Kestrel)', messages: [[sprout, 'Client asked to move this by a couple of days — working on a new slot.']] },
    { status: 'ongoing', associate: mango, expert: quill, when: at(0, DateTime.now().setZone(TEAM_TIME_ZONE).hour), duration: 60, platform: 1, profile: 9, details: 'Multi-cloud cost optimisation at large retailers.', contact: 'Oliver (Meridian)' },
    { status: 'finished', associate: pixel, expert: flint, when: at(-1, 8), duration: 60, platform: 0, profile: 3, details: 'Private label strategy in LATAM grocery.', contact: 'Rachel (Northwind)', report: [55, 5, 'Call went well. The client wants a follow-up next month.'] },
    { status: 'finished', associate: comet, expert: ember, when: at(-2, 19), duration: 45, platform: 2, profile: 2, details: 'Advanced packaging equipment vendors.', contact: 'Min-seo (Hanbit)', report: [45, 4, null] },
    { status: 'invoice_submit', associate: sprout, expert: flint, when: at(-5, 10), duration: 60, platform: 1, profile: 4, details: 'Oncology CRO selection criteria.', contact: 'Oliver (Meridian)', invoice: [450, 'USD'], report: [60, 4, 'Good call; client asked detailed questions on site activation.'] },
    { status: 'invoice_approve', associate: mango, expert: quill, when: at(-8, 13), duration: 30, platform: 3, profile: 8, details: 'Gulf solar PPA pricing.', contact: 'Jonas (Kestrel)', invoice: [300, 'EUR'], report: [35, 3, 'Ran a little over; audio was patchy.'] },
    { status: 'process_to_bank', associate: pixel, expert: ember, when: at(-12, 20), duration: 60, platform: 4, profile: 0, details: 'APAC sourcing risk after tariff changes.', contact: 'Wei Ling (Harbor)', invoice: [520, 'USD'], report: [60, 5, null] },
  ];

  for (const c of calls) {
    const path = pathTo(c.status);
    const created = await prisma.call.create({
      data: {
        status: c.status,
        platformId: platforms[c.platform]!.id,
        profileId: profiles[c.profile]!.id,
        associateId: c.associate.id,
        expertId: c.expert?.id ?? null,
        scheduledAt: c.when,
        durationMinutes: c.duration,
        projectDetails: c.details,
        platformAssociateName: c.contact,
        notes: c.notes ?? null,
        invoiceAmount: c.invoice?.[0],
        invoiceCurrency: c.invoice?.[1],
        ninjaLink: ['on_scheduling', 'scheduled', 'on_rescheduling'].includes(c.status)
          ? null
          : `https://vdo.ninja/?room=god-${Math.random().toString(36).slice(2, 10)}`,
        actualDurationMinutes: c.report?.[0],
        rating: c.report?.[1],
        feedback: c.report?.[2],
        createdById: c.associate.id,
        createdAt: DateTime.fromJSDate(c.when).minus({ days: 4 }).toJSDate(),
      },
    });
    let stamp = DateTime.fromJSDate(c.when).minus({ days: 4 });
    for (let i = 0; i < path.length; i++) {
      const to = path[i]!;
      const from = i === 0 ? null : path[i - 1]!;
      const actorId = from ? actorFor(to, from, c.associate.id, c.expert?.id ?? null) : c.associate.id;
      await prisma.callStatusHistory.create({
        data: { callId: created.id, fromStatus: from, toStatus: to, actorId, isOverride: false, createdAt: stamp.toJSDate() },
      });
      stamp = stamp.plus({ hours: 6 });
    }
    for (const [sender, body] of c.messages ?? []) {
      stamp = stamp.plus({ minutes: 20 });
      await prisma.message.create({ data: { callId: created.id, senderId: sender.id, body, createdAt: stamp.toJSDate() } });
    }
  }

  // --- Schedule blocks ----------------------------------------------------------
  const blocksFor = async (expert: typeof ember) => {
    const zoneToday = DateTime.now().setZone(expert.timeZone).startOf('day');
    const monday = zoneToday.minus({ days: zoneToday.weekday - 1 });
    const startDate = new Date(`${monday.toISODate()}T00:00:00Z`);
    const untilDate = new Date(`${monday.plus({ months: 6 }).toISODate()}T00:00:00Z`);
    await prisma.scheduleBlock.create({
      data: {
        expertId: expert.id, kind: 'available', timeZone: expert.timeZone, startDate, allDay: false,
        startMinute: 9 * 60, durationMinutes: 8 * 60, frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5],
        untilDate, note: 'Working hours', createdById: expert.id,
      },
    });
    return monday;
  };

  const emberMonday = await blocksFor(ember);
  const flintMonday = await blocksFor(flint);
  const quillMonday = await blocksFor(quill);
  const d = (dt: DateTime) => new Date(`${dt.toISODate()}T00:00:00Z`);

  await prisma.scheduleBlock.create({
    data: {
      expertId: ember.id, kind: 'unavailable', timeZone: ember.timeZone, startDate: d(emberMonday.plus({ days: 11 })),
      allDay: true, startMinute: 0, durationMinutes: 1440, note: 'Family event', createdById: ember.id,
    },
  });
  await prisma.scheduleBlock.create({
    data: {
      expertId: flint.id, kind: 'unavailable', timeZone: flint.timeZone, startDate: d(flintMonday.plus({ days: 8 })),
      allDay: true, startMinute: 0, durationMinutes: 1440, frequency: 'daily', interval: 1,
      untilDate: d(flintMonday.plus({ days: 10 })), note: 'Short holiday', createdById: flint.id,
    },
  });
  await prisma.scheduleBlock.create({
    data: {
      expertId: quill.id, kind: 'unavailable', timeZone: quill.timeZone, startDate: d(quillMonday),
      allDay: false, startMinute: 12 * 60, durationMinutes: 60, frequency: 'weekly', interval: 1, weekdays: [3],
      untilDate: d(quillMonday.plus({ months: 3 })), note: 'Weekly lunch with mentor', createdById: quill.id,
    },
  });

  // --- A few notifications --------------------------------------------------------
  const scheduled = await prisma.call.findFirst({ where: { status: 'scheduled', expertId: quill.id }, include: { profile: true } });
  if (scheduled) {
    await prisma.notification.createMany({
      data: [quill.id, atlas.id].map((userId) => ({
        userId,
        type: 'call.status_changed',
        payload: {
          callId: scheduled.id,
          from: 'on_scheduling',
          to: 'scheduled',
          actor: { nickname: 'pixel', role: 'associate' },
          summary: `${scheduled.profile.name}: On scheduling → Scheduled`,
        },
      })),
    });
  }

  console.log(`Done. Sign in as ${FOUNDER_EMAIL} (or atlas@, pixel@, ember@ … @god.local) with password ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
