/**
 * The expert networks the company works with, as one list, put into `platforms`.
 *
 * A network already in the database is left exactly as it is — its name, its
 * address, its country and above all its priority are the Founder's to set on
 * the Platforms page, and running this again must never undo that. Only the
 * networks that are missing are added. So: add a network to the list here, run
 * it, and only that one appears.
 *
 * It prints a plan and changes nothing unless APPLY=1 is set:
 *   pnpm --filter @god/api platforms:import              # plan only
 *   APPLY=1 pnpm --filter @god/api platforms:import      # do it
 * Against a database other than the one in .env, put DATABASE_URL in front.
 *
 * `XX` is a country we could not confirm, and an `example.com/needs-verification`
 * address is a network whose website we could not confirm: both are meant to be
 * corrected on the Platforms page, and the plan names the ones still carrying
 * either, wherever they came from.
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.env.APPLY === '1';
const prisma = new PrismaClient();

/** Stands in for an address we could not confirm; obvious on sight, and a valid URL. */
const placeholder = (name: string) =>
  `https://example.com/needs-verification/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

interface Network {
  name: string;
  /** Null where the network's website could not be confirmed. */
  url: string | null;
  /** `XX` where the home country could not be confirmed, rather than a guess. */
  country: string;
  /** 1 the ones we work with most, 4 the consultant marketplaces. */
  priority: 1 | 2 | 3 | 4;
  /** Names this network has also gone by, so it is recognised rather than added twice. */
  also?: string[];
}

const NETWORKS: Network[] = [
  // 1 — the networks most of the work comes through.
  { name: 'GLG', url: 'https://glg.com/', country: 'US', priority: 1 },
  { name: 'AlphaSights', url: 'https://www.alphasights.com/', country: 'GB', priority: 1, also: ['Alphasights'] },
  { name: 'Guidepoint', url: 'https://www.guidepoint.com/', country: 'US', priority: 1 },
  { name: 'Third Bridge', url: 'https://www.thirdbridge.com/', country: 'GB', priority: 1, also: ['Thirdbridge'] },
  { name: 'AlphaSense / Tegus', url: 'https://www.alpha-sense.com/', country: 'US', priority: 1 },
  { name: 'Dialectica', url: 'https://dialecticanet.com/', country: 'GR', priority: 1 },
  { name: 'VISASQ / Coleman Research', url: 'https://www.colemanrg.com/', country: 'JP', priority: 1, also: ['Coleman'] },
  { name: 'proSapient', url: 'https://www.prosapient.com/', country: 'GB', priority: 1 },
  { name: 'Inex One', url: 'https://inex.one/', country: 'SE', priority: 1 },

  // 2
  { name: 'Atheneum', url: 'https://www.atheneum.ai/', country: 'DE', priority: 2 },
  { name: 'NewtonX', url: 'https://www.newtonx.com/', country: 'US', priority: 2 },
  { name: 'Lynk', url: 'https://lynk.global/', country: 'HK', priority: 2 },
  { name: 'Infollion', url: 'https://www.infollion.com/', country: 'IN', priority: 2 },
  { name: 'Arches', url: 'https://arches-global.com/', country: 'JP', priority: 2, also: ['Arches Global'] },
  { name: 'Focal Fact', url: 'https://focalfact.com/', country: 'XX', priority: 2 },
  { name: 'Nextyn', url: 'https://www.nextyn.com/', country: 'IN', priority: 2 },
  { name: 'Gaoyi Consulting', url: null, country: 'CN', priority: 2 },
  { name: 'Ridgetop Research', url: 'https://www.ridgetopresearch.com/', country: 'US', priority: 2 },
  { name: 'Six Degrees Intelligence', url: null, country: 'XX', priority: 2 },

  // 3
  { name: 'Capvision', url: 'https://www.capvision.com/', country: 'CN', priority: 3 },
  { name: 'Arbolus', url: 'https://www.arbolus.com/', country: 'GB', priority: 3 },
  { name: 'Techspert', url: 'https://techspert.com/', country: 'GB', priority: 3 },
  { name: 'Office Hours', url: 'https://officehours.com/', country: 'US', priority: 3 },
  { name: 'Knowledge Ridge', url: 'https://www.knowledgeridge.com/', country: 'XX', priority: 3 },
  { name: 'Right Angle Global', url: 'https://rightangleglobal.com/', country: 'XX', priority: 3 },
  { name: 'True North Insights', url: null, country: 'XX', priority: 3 },
  { name: 'In Practise', url: 'https://inpractise.com/', country: 'GB', priority: 3 },
  { name: 'OnFrontiers', url: 'https://onfrontiers.com/', country: 'US', priority: 3 },
  { name: 'Enquire', url: 'https://www.enquire.ai/', country: 'US', priority: 3 },
  { name: 'Meritco Services', url: null, country: 'XX', priority: 3 },
  { name: 'Zintro', url: 'https://www.zintro.com/', country: 'US', priority: 3 },
  { name: 'Gadoci', url: null, country: 'XX', priority: 3 },
  { name: 'Prolific', url: 'https://www.prolific.com/', country: 'GB', priority: 3 },
  { name: 'Expert360', url: 'https://expert360.com/', country: 'AU', priority: 3 },

  // 4 — the consultant marketplaces, and the smallest panels.
  { name: 'Silverlight Research', url: 'https://www.silverlightresearch.com/', country: 'GB', priority: 4 },
  { name: 'Maven Research', url: 'https://www.maven.co/', country: 'US', priority: 4 },
  { name: 'Primary Insight', url: 'https://www.primaryinsight.com/', country: 'US', priority: 4 },
  { name: 'Sealed Network', url: 'https://sealed.network/', country: 'XX', priority: 4 },
  { name: 'Rise Up Consulting', url: null, country: 'XX', priority: 4 },
  { name: 'ProPanel Insights Group Ltd', url: null, country: 'XX', priority: 4 },
  { name: 'High5', url: null, country: 'XX', priority: 4 },
  { name: 'Business Talent Group', url: 'https://businesstalentgroup.com/', country: 'US', priority: 4 },
  { name: 'Catalant', url: 'https://catalant.com/', country: 'US', priority: 4 },
  { name: 'Graphite', url: 'https://graphite.work/', country: 'US', priority: 4 },
  { name: 'Umbrex', url: 'https://umbrex.com/', country: 'US', priority: 4 },
  { name: 'A.Team', url: 'https://www.a.team/', country: 'US', priority: 4 },
  { name: 'Consultport', url: 'https://consultport.com/', country: 'DE', priority: 4 },
];

/** "Third Bridge", "thirdbridge" and "Third  Bridge" are the same network. */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

async function main() {
  const existing = await prisma.platform.findMany({
    select: { id: true, name: true, url: true, priority: true, country: true, _count: { select: { calls: true, profileStatuses: true } } },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  });
  const byKey = new Map(existing.map((p) => [key(p.name), p]));
  const found = (n: Network) => [n.name, ...(n.also ?? [])].map(key).map((k) => byKey.get(k)).find(Boolean);

  const there = NETWORKS.filter((n) => found(n));
  const missing = NETWORKS.filter((n) => !found(n));
  const urlOf = (n: Network) => n.url ?? placeholder(n.name);

  console.log(`In the database now: ${existing.length} platform(s); on the list: ${NETWORKS.length}\n`);
  console.log(`Already there, left untouched: ${there.length}`);
  for (const n of there) {
    const row = found(n)!;
    const renamed = row.name !== n.name ? `  (on the list as "${n.name}")` : '';
    console.log(`  ${String(row.priority)}  ${row.name.padEnd(28)}${renamed}`);
  }

  console.log(`\nAdding ${missing.length}:`);
  for (const n of missing) {
    const mark = [n.url ? null : 'URL to verify', n.country === 'XX' ? 'country to verify' : null].filter(Boolean).join(', ');
    console.log(`  ${n.priority}  ${n.name.padEnd(28)} ${n.country}  ${urlOf(n)}${mark ? `   ← ${mark}` : ''}`);
  }

  const extra = existing.filter((p) => !NETWORKS.some((n) => found(n)?.id === p.id));
  if (extra.length) console.log(`\nIn the database but not on the list, left alone: ${extra.map((p) => p.name).join(', ')}`);

  // Whatever the row says now, not what the list once said: a website corrected
  // on the Platforms page drops off this straight away.
  const unconfirmed = existing.filter((p) => p.country === 'XX' || p.url.includes('needs-verification'));
  console.log(
    `\nStill to confirm in the database: ${unconfirmed.length}${unconfirmed.length ? ` — ${unconfirmed.map((p) => p.name).join(', ')}` : ''}`,
  );

  if (!missing.length) {
    console.log('\nEvery network on the list is already there. Nothing to do.');
    return;
  }
  if (!APPLY) {
    console.log('\nPlan only. Re-run with APPLY=1 to add them.');
    return;
  }

  await prisma.$transaction(
    missing.map((n) => prisma.platform.create({ data: { name: n.name, url: urlOf(n), priority: n.priority, country: n.country } })),
  );
  console.log(`\nDone. ${missing.length} added — ${await prisma.platform.count()} platforms in all.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
