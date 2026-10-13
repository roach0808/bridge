import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import PersonOffRounded from '@mui/icons-material/PersonOffRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, Collapse, InputAdornment, List, ListItemButton, ListSubheader, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { ROLE_LABELS, isActiveTodo, type TodoPanel, type UserRef } from '@god/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { RoleDot, UserAvatar } from '@/components/identity';

/**
 * The people on the task board as the company is built: the viewer, each
 * Manager's team (the Manager, then their Associates), the Experts, and anyone
 * deactivated out of the way at the bottom. A team or a group is something you
 * can pick as a whole; so is each person in it.
 *
 * What is picked is a `Scope`, kept in the address bar so a reload or a shared
 * link opens the same view.
 */

export type Scope = 'all' | 'experts' | 'founders' | 'no-team' | 'inactive' | `person:${string}` | `team:${string}`;

interface Team {
  manager: UserRef;
  /** The Manager's own panel, when the board has one (a Manager's board has only theirs). */
  managerPanel: TodoPanel | null;
  members: TodoPanel[];
}

export interface TeamTreeModel {
  me: TodoPanel | null;
  teams: Team[];
  noTeam: TodoPanel[];
  experts: TodoPanel[];
  founders: TodoPanel[];
  inactive: TodoPanel[];
}

const byName = (a: TodoPanel, b: TodoPanel) => a.person.nickname.localeCompare(b.person.nickname);

export function buildTree(panels: TodoPanel[]): TeamTreeModel {
  const me = panels.find((p) => p.isMe) ?? null;
  const teams = new Map<string, Team>();
  const team = (manager: UserRef) => {
    let t = teams.get(manager.id);
    if (!t) teams.set(manager.id, (t = { manager, managerPanel: null, members: [] }));
    return t;
  };
  const model: TeamTreeModel = { me, teams: [], noTeam: [], experts: [], founders: [], inactive: [] };

  for (const p of panels) {
    // The viewer is always at the top, and also in their own team when they lead one.
    if (!p.person.isActive && !p.isMe) model.inactive.push(p);
    else if (p.person.role === 'manager') team(p.person).managerPanel = p;
    else if (p.isMe) continue;
    else if (p.person.role === 'associate') {
      if (p.person.manager) team(p.person.manager).members.push(p);
      else model.noTeam.push(p);
    } else if (p.person.role === 'expert') model.experts.push(p);
    else model.founders.push(p);
  }
  model.teams = [...teams.values()]
    .map((t) => ({ ...t, members: t.members.sort(byName) }))
    // Your own team first, then by Manager.
    .sort((a, b) => Number(b.manager.id === me?.person.id) - Number(a.manager.id === me?.person.id) || a.manager.nickname.localeCompare(b.manager.nickname));
  for (const list of [model.noTeam, model.experts, model.founders, model.inactive]) list.sort(byName);
  return model;
}

const teamPanels = (t: Team) => [...(t.managerPanel ? [t.managerPanel] : []), ...t.members];

/** The panels a scope covers. Anything it no longer finds (someone left the board) covers nobody. */
export function panelsIn(scope: Scope, panels: TodoPanel[], tree: TeamTreeModel): TodoPanel[] {
  if (scope === 'all') return panels;
  if (scope === 'experts') return tree.experts;
  if (scope === 'founders') return tree.founders;
  if (scope === 'no-team') return tree.noTeam;
  if (scope === 'inactive') return tree.inactive;
  if (scope.startsWith('team:')) {
    const t = tree.teams.find((x) => x.manager.id === scope.slice(5));
    return t ? teamPanels(t) : [];
  }
  return panels.filter((p) => p.person.id === scope.slice(7));
}

/** Whether a scope still points at something on the board. */
export function scopeExists(scope: Scope, panels: TodoPanel[], tree: TeamTreeModel): boolean {
  return scope === 'all' || panelsIn(scope, panels, tree).length > 0;
}

/** What a scope is called, for the heading over the table and the button that opens the tree. */
export function scopeLabel(scope: Scope, panels: TodoPanel[], tree: TeamTreeModel): string {
  if (scope === 'all') return 'Everyone';
  if (scope === 'experts') return 'Experts';
  if (scope === 'founders') return 'Founders';
  if (scope === 'no-team') return 'Associates with no team';
  if (scope === 'inactive') return 'Deactivated';
  if (scope.startsWith('team:')) {
    const t = tree.teams.find((x) => x.manager.id === scope.slice(5));
    return !t ? 'Team' : t.manager.id === tree.me?.person.id ? 'Your team' : `${t.manager.nickname}’s team`;
  }
  const p = panels.find((x) => x.person.id === scope.slice(7));
  return !p ? 'Someone' : p.isMe ? 'You' : p.person.nickname;
}

/** Work still owed, and how much of it is past its end date. */
export function tally(panels: TodoPanel[], now = Date.now()): { active: number; overdue: number } {
  let active = 0;
  let overdue = 0;
  for (const t of panels.flatMap((p) => p.tasks)) {
    if (t.status === 'completed') continue;
    active += 1;
    if (isActiveTodo(t.status) && t.completeByAt && new Date(t.completeByAt).getTime() < now) overdue += 1;
  }
  return { active, overdue };
}

/** The numbers at the end of a row: work owed, with anything overdue in red before it. */
function Count({ panels }: { panels: TodoPanel[] }) {
  const { active, overdue } = tally(panels);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 'auto', pl: 1, flexShrink: 0 }}>
      {overdue > 0 && (
        <Tooltip title={`${overdue} past ${overdue === 1 ? 'its' : 'their'} end date`}>
          <Box
            component="span"
            sx={{ px: 0.6, minWidth: 18, height: 18, borderRadius: 9, fontSize: '0.68rem', fontWeight: 700, lineHeight: '18px', textAlign: 'center', color: 'error.contrastText', bgcolor: 'error.main' }}
          >
            {overdue}
          </Box>
        </Tooltip>
      )}
      <Tooltip title={`${active} not completed`}>
        <Typography component="span" variant="caption" sx={{ minWidth: 16, textAlign: 'right', color: active ? 'text.secondary' : 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
          {active}
        </Typography>
      </Tooltip>
    </Stack>
  );
}

export function TeamTree({
  panels,
  tree,
  value,
  onChange,
}: {
  panels: TodoPanel[];
  tree: TeamTreeModel;
  value: Scope;
  onChange: (scope: Scope) => void;
}) {
  const [query, setQuery] = useState('');
  // Groups start open, except the deactivated, which are history.
  const [closed, setClosed] = useState<Set<string>>(() => new Set(['inactive']));
  const toggle = (key: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const q = query.trim().toLowerCase();
  const hit = (p: TodoPanel) => !q || p.person.nickname.toLowerCase().includes(q);
  const searching = q.length > 0;

  const personRow = (p: TodoPanel, depth: number, note?: ReactNode) => {
    const scope: Scope = `person:${p.person.id}`;
    return (
      <ListItemButton
        key={scope}
        selected={value === scope}
        onClick={() => onChange(scope)}
        sx={{ pl: 1 + depth * 2, py: 0.4, borderRadius: 1.5, opacity: p.person.isActive ? 1 : 0.6 }}
      >
        <UserAvatar avatarId={p.person.avatarId} photoId={p.person.photoId} size={22} label={p.person.nickname} userId={p.person.id} dotSize={7} />
        <Typography variant="body2" noWrap sx={{ ml: 1, minWidth: 0 }}>
          {p.isMe ? 'You' : p.person.nickname}
        </Typography>
        {note}
        <Count panels={[p]} />
      </ListItemButton>
    );
  };

  /** A group that can be picked as a whole and opened to show who is in it. */
  const group = (key: string, scope: Scope, label: ReactNode, icon: ReactNode, members: TodoPanel[], children: TodoPanel[], childNote?: (p: TodoPanel) => ReactNode) => {
    const shown = searching ? children.filter(hit) : children;
    if (searching && shown.length === 0) return null;
    const open = searching || !closed.has(key);
    return (
      <Box key={key}>
        <ListItemButton selected={value === scope} onClick={() => onChange(scope)} sx={{ pl: 0.25, py: 0.4, borderRadius: 1.5 }}>
          <Box
            component="span"
            role="button"
            aria-label={open ? 'Close' : 'Open'}
            aria-expanded={open}
            onClick={(e) => {
              // The chevron opens and closes; the rest of the row picks the group.
              e.stopPropagation();
              toggle(key);
            }}
            sx={{ display: 'inline-flex', p: 0.25, mr: 0.25, borderRadius: 1, color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <ExpandMoreRounded sx={{ fontSize: 18, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
          </Box>
          {icon}
          <Box sx={{ ml: 1, minWidth: 0 }}>{label}</Box>
          <Count panels={members} />
        </ListItemButton>
        <Collapse in={open} unmountOnExit>
          <List disablePadding dense>
            {shown.map((p) => personRow(p, 1, childNote?.(p)))}
          </List>
        </Collapse>
      </Box>
    );
  };

  const groupIcon = (icon: ReactNode) => (
    <Box sx={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'action.selected', color: 'text.secondary', flexShrink: 0, '& svg': { fontSize: 15 } }}>
      {icon}
    </Box>
  );
  const groupLabel = (text: string, caption?: string) => (
    <>
      <Typography variant="body2" fontWeight={600} noWrap>
        {text}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ lineHeight: 1.2 }}>
          {caption}
        </Typography>
      )}
    </>
  );
  const subheader = (text: string) => (
    <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '28px', mt: 1, px: 1, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      {text}
    </ListSubheader>
  );

  const teams = tree.teams
    .map((t) => {
      const children = teamPanels(t);
      const mine = t.manager.id === tree.me?.person.id;
      return group(
        `team:${t.manager.id}`,
        `team:${t.manager.id}`,
        groupLabel(mine ? 'Your team' : t.manager.nickname, `Team of ${children.length}`),
        <UserAvatar avatarId={t.manager.avatarId} photoId={t.manager.photoId} size={22} label={t.manager.nickname} />,
        // Without a Manager panel (another Manager's team, on a Manager's board) the team is its Associates.
        children,
        children,
        (p) =>
          p.person.role === 'manager' ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75, flexShrink: 0 }}>
              {ROLE_LABELS.manager}
            </Typography>
          ) : null,
      );
    })
    .filter(Boolean);

  const others: Array<[string, Scope, string, ReactNode, TodoPanel[]]> = [
    ['no-team', 'no-team', 'No team', groupIcon(<GroupsRounded />), tree.noTeam],
    ['experts', 'experts', 'Experts', groupIcon(<RoleDot role="expert" size={9} />), tree.experts],
    ['founders', 'founders', 'Founders', groupIcon(<RoleDot role="founder" size={9} />), tree.founders],
    ['inactive', 'inactive', 'Deactivated', groupIcon(<PersonOffRounded />), tree.inactive],
  ];
  const otherGroups = others.filter(([, , , , list]) => list.length).map(([key, scope, label, icon, list]) => group(key, scope, groupLabel(label), icon, list, list)).filter(Boolean);
  const meShown = tree.me && hit(tree.me);

  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        type="search"
        placeholder="Find a person"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        slotProps={{
          htmlInput: { 'aria-label': 'Find a person' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ mb: 1 }}
      />
      <List
        dense
        disablePadding
        aria-label="People"
        sx={(t) => ({
          // What the table shows has to be obvious at a glance.
          '& .MuiListItemButton-root.Mui-selected, & .MuiListItemButton-root.Mui-selected:hover': {
            bgcolor: `rgba(${t.vars!.palette.primary.mainChannel} / 0.12)`,
          },
          '& .MuiListItemButton-root.Mui-selected .MuiTypography-body2': { color: 'primary.main', fontWeight: 650 },
        })}
      >
        {!searching && (
          <ListItemButton selected={value === 'all'} onClick={() => onChange('all')} sx={{ pl: 1, py: 0.5, borderRadius: 1.5 }}>
            {groupIcon(<PublicRounded />)}
            <Typography variant="body2" fontWeight={600} sx={{ ml: 1 }}>
              Everyone
            </Typography>
            <Count panels={panels} />
          </ListItemButton>
        )}
        {meShown && personRow(tree.me!, 0)}
        {teams.length > 0 && subheader('Teams')}
        {teams}
        {otherGroups.length > 0 && subheader('Others')}
        {otherGroups}
        {searching && !meShown && teams.length === 0 && otherGroups.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>
            Nobody called “{query.trim()}”.
          </Typography>
        )}
      </List>
    </Box>
  );
}
