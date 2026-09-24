/**
 * The expert networks the company works with, as one list, put into `platforms`.
 *
 * A network already in the database — under an older spelling, or with a
 * placeholder address from the demo data — is corrected in place, so the calls
 * and profile registrations pointing at it are kept. The rest are added. Run it
 * again after editing the list and it will only make up the difference.
 *
 * It prints a plan and changes nothing unless APPLY=1 is set:
 *   pnpm --filter @god/api platforms:import              # plan only
 *   APPLY=1 pnpm --filter @god/api platforms:import      # do it
 * Against a database other than the one in .env, put DATABASE_URL in front.
 *
 * `XX` is a country we could not confirm, and an `example.com/needs-verification`
 * address is a network whose website we could not confirm: both are meant to be
 * corrected on the Platforms page, and the plan lists them every run.
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.env.APPLY === '1';
const prisma = new PrismaClient();

/** Stands in for an address we could not confirm; obvious on sight, and a valid URL. */
const placeholder = (name: string) =>
  `https://example.com/needs-verification/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/** `XX` marks a country we could not confirm, rather than guessing one. */
interface Network {
  name: string;
  url: string | null;
  country: string;
}

/** In the order given: the position in this list becomes the platform's priority. */
const NETWORKS: Network[] = [
  { name: 'GLG', url: 'https://glg.com/', country: 'US' },
  { name: 'AlphaSights', url: 'https://www.alphasights.com/', country: 'GB' },
  { name: 'Guidepoint', url: 'https://www.guidepoint.com/', country: 'US' },
  { name: 'Third Bridge', url: 'https://www.thirdbridge.com/', country: 'GB' },
  { name: 'AlphaSense / Tegus', url: 'https://www.alpha-sense.com/', country: 'US' },
  { name: 'Capvision', url: 'https://www.capvision.com/', country: 'CN' },
  { name: 'Dialectica', url: 'https://dialecticanet.com/', country: 'GR' },
  { name: 'VISASQ / Coleman Research', url: 'https://www.colemanrg.com/', country: 'JP' },
  { name: 'Atheneum', url: 'https://www.atheneum.ai/', country: 'DE' },
  { name: 'Arbolus', url: 'https://www.arbolus.com/', country: 'GB' },
  { name: 'proSapient', url: 'https://www.prosapient.com/', country: 'GB' },
  { name: 'NewtonX', url: 'https://www.newtonx.com/', country: 'US' },
  { name: 'Lynk', url: 'https://lynk.global/', country: 'HK' },
  { name: 'Techspert', url: 'https://techspert.com/', country: 'GB' },
  { name: 'Infollion', url: 'https://www.infollion.com/', country: 'IN' },
  { name: 'Arches Global', url: 'https://arches-global.com/', country: 'JP' },
  { name: 'Office Hours', url: 'https://officehours.com/', country: 'US' },
  { name: 'Focal Fact', url: 'https://focalfact.com/', country: 'XX' },
  { name: 'Silverlight Research', url: 'https://www.silverlightresearch.com/', country: 'GB' },
  { name: 'Maven Research', url: 'https://www.maven.co/', country: 'US' },
  { name: 'Primary Insight', url: 'https://www.primaryinsight.com/', country: 'US' },
  { name: 'Knowledge Ridge', url: 'https://www.knowledgeridge.com/', country: 'XX' },
  { name: 'Right Angle Global', url: 'https://rightangleglobal.com/', country: 'XX' },
  { name: 'Nextyn', url: 'https://www.nextyn.com/', country: 'IN' },
  { name: 'Gaoyi Consulting', url: null, country: 'CN' },
  { name: 'Ridgetop Research', url: 'https://www.ridgetopresearch.com/', country: 'US' },
  { name: 'True North Insights', url: null, country: 'XX' },
  { name: 'In Practise', url: 'https://inpractise.com/', country: 'GB' },
  { name: 'OnFrontiers', url: 'https://onfrontiers.com/', country: 'US' },
  { name: 'Enquire', url: 'https://www.enquire.ai/', country: 'US' },
  { name: 'Six Degrees Intelligence', url: null, country: 'XX' },
  { name: 'Sealed Network', url: 'https://sealed.network/', country: 'XX' },
  { name: 'Meritco Services', url: null, country: 'XX' },
  { name: 'Rise Up Consulting', url: null, country: 'XX' },
  { name: 'Zintro', url: 'https://www.zintro.com/', country: 'US' },
  { name: 'ProPanel Insights Group Ltd', url: null, country: 'XX' },
  { name: 'High5', url: null, country: 'XX' },
  { name: 'Gadoci', url: null, country: 'XX' },
  { name: 'Prolific', url: 'https://www.prolific.com/', country: 'GB' },
  { name: 'Inex One', url: 'https://inex.one/', country: 'SE' },
  { name: 'Business Talent Group', url: 'https://businesstalentgroup.com/', country: 'US' },
  { name: 'Catalant', url: 'https://catalant.com/', country: 'US' },
  { name: 'Graphite', url: 'https://graphite.work/', country: 'US' },
  { name: 'Umbrex', url: 'https://umbrex.com/', country: 'US' },
  { name: 'A.Team', url: 'https://www.a.team/', country: 'US' },
  { name: 'Expert360', url: 'https://expert360.com/', country: 'AU' },
  { name: 'Consultport', url: 'https://consultport.com/', country: 'DE' },
];

/**
 * Rows already in the database, under the name they have now. Matching by name
 * alone would add a second GLG beside "Alphasights", so the pairs are spelled out.
 */
const ALREADY_THERE: Record<string, string> = {
  GLG: 'GLG',
  Alphasights: 'AlphaSights',
  Guidepoint: 'Guidepoint',
  Thirdbridge: 'Third Bridge',
  Dialectica: 'Dialectica',
  Coleman: 'VISASQ / Coleman Research',
};

async function main() {
  const existing = await prisma.platform.findMany({
    select: { id: true, name: true, url: true, priority: true, country: true, _count: { select: { calls: true, profileStatuses: true } } },
    orderBy: { name: 'asc' },
  });
  const byName = new Map(existing.map((p) => [p.name, p]));
  const claimed = new Set<string>();

  const updates: Array<{ id: string; from: (typeof existing)[number]; to: Network; priority: number }> = [];
  const inserts: Array<{ to: Network; priority: number }> = [];

  for (const [i, network] of NETWORKS.entries()) {
    const priority = i + 1;
    // Its old name if it has one, otherwise its new name.
    const oldName = Object.keys(ALREADY_THERE).find((k) => ALREADY_THERE[k] === network.name);
    const row = (oldName && byName.get(oldName)) || byName.get(network.name);
    if (row) {
      claimed.add(row.name);
      updates.push({ id: row.id, from: row, to: network, priority });
    } else {
      inserts.push({ to: network, priority });
    }
  }

  const untouched = existing.filter((p) => !claimed.has(p.name));
  const urlOf = (n: Network) => n.url ?? placeholder(n.name);

  console.log(`In the database now: ${existing.length} platform(s)\n`);
  console.log(`Correcting ${updates.length}:`);
  for (const u of updates) {
    const changes = [
      u.from.name !== u.to.name ? `name "${u.from.name}" → "${u.to.name}"` : null,
      u.from.url !== urlOf(u.to) ? `url ${u.from.url} → ${urlOf(u.to)}` : null,
      u.from.priority !== u.priority ? `priority ${u.from.priority} → ${u.priority}` : null,
      u.from.country !== u.to.country ? `country ${u.from.country} → ${u.to.country}` : null,
    ].filter(Boolean);
    console.log(`  ${u.to.name.padEnd(28)} ${changes.join(' · ') || 'no change'}`);
    if (u.from._count.calls || u.from._count.profileStatuses) {
      console.log(`    (in use: ${u.from._count.calls} call(s), ${u.from._count.profileStatuses} profile registration(s) — kept)`);
    }
  }

  console.log(`\nAdding ${inserts.length}:`);
  for (const a of inserts) {
    const mark = [a.to.url ? null : 'URL to verify', a.to.country === 'XX' ? 'country to verify' : null].filter(Boolean).join(', ');
    console.log(`  ${String(a.priority).padStart(3)}  ${a.to.name.padEnd(28)} ${a.to.country}  ${urlOf(a.to)}${mark ? `   ← ${mark}` : ''}`);
  }

  if (untouched.length) {
    console.log(`\nLeft alone (not in the list): ${untouched.map((p) => p.name).join(', ')}`);
  }
  const toVerify = NETWORKS.filter((n) => !n.url || n.country === 'XX');
  console.log(`\nTo check afterwards: ${toVerify.length} of ${NETWORKS.length} — ${toVerify.map((n) => n.name).join(', ')}`);

  if (!APPLY) {
    console.log('\nPlan only. Re-run with APPLY=1 to make these changes.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.platform.update({
        where: { id: u.id },
        data: { name: u.to.name, url: urlOf(u.to), priority: u.priority, country: u.to.country },
      });
    }
    for (const a of inserts) {
      await tx.platform.create({
        data: { name: a.to.name, url: urlOf(a.to), priority: a.priority, country: a.to.country },
      });
    }
  });
  const total = await prisma.platform.count();
  console.log(`\nDone. ${updates.length} corrected, ${inserts.length} added — ${total} platforms in all.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
