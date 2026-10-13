import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded';
import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import KeyboardDoubleArrowLeftRounded from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import { Box, Button, Card, Drawer, IconButton, Skeleton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { ROLE_LABELS, type TodoDTO, type TodoPanel } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { BrowserNotificationsPrompt } from '@/components/BrowserNotifications';
import { ErrorState, PageHeader } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { TaskDetailDrawer } from './TaskDetail';
import { TaskDialog } from './TaskDialog';
import { TeamTree, buildTree, panelsIn, scopeExists, scopeLabel, tally, type Scope } from './TeamTree';
import { TaskTable } from './taskViews';

/**
 * Tasks: one table, and — for a Founder or a Manager, who see other people's
 * work — the people beside it as the company is built (teams under their
 * Managers, the Experts, …). Picking a person or a whole team narrows the
 * table to them. A row opens the task in a panel at the side, with its notes.
 *
 * The people list sits on the left on a wide screen and can be put away; on a
 * narrower one it opens from a button above the table, so the table keeps its
 * width.
 */

const HIDE_KEY = 'tasks.peopleHidden';
const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};
const writeHidden = (hidden: boolean) => {
  try {
    localStorage.setItem(HIDE_KEY, hidden ? '1' : '0');
  } catch {
    // Not remembered; it still works for this visit.
  }
};

export default function TodosPage() {
  const me = useMe();
  const theme = useTheme();
  // Beside the app's own sidebar, the list and the table only both fit on a wide screen.
  const wide = useMediaQuery(theme.breakpoints.up('lg'));
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TodoDTO | null>(null);
  const [hidden, setHidden] = useState(readHidden);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  const query = useQuery({ queryKey: qk.todos.board('all'), queryFn: () => api.todos.board({ status: 'all' }) });
  const panels = useMemo(() => query.data ?? [], [query.data]);
  const tree = useMemo(() => buildTree(panels), [panels]);
  const withPeople = me.role === 'founder' || me.role === 'manager';

  // Who is picked lives in the address, so a reload or a shared link shows the same.
  const asked = (params.get('who') ?? 'all') as Scope;
  const scope: Scope = query.data && !scopeExists(asked, panels, tree) ? 'all' : asked;
  const setScope = (next: Scope) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'all') p.delete('who');
        else p.set('who', next);
        return p;
      },
      { replace: true },
    );
    setPickerOpen(false);
  };
  const shown = useMemo(() => (withPeople ? panelsIn(scope, panels, tree) : panels), [withPeople, scope, panels, tree]);

  // The panel follows the task as it changes, and closes when it is gone.
  const all = panels.flatMap((p) => p.tasks);
  const opened = openId ? (all.find((t) => t.id === openId) ?? null) : null;
  const edited = editing ? (all.find((t) => t.id === editing.id) ?? editing) : null;

  // A new task goes to the person being looked at, when they can be given one.
  const picked = scope.startsWith('person:') ? panels.find((p) => p.person.id === scope.slice(7)) : undefined;
  const newFor = picked?.canGive ? picked.person.id : undefined;

  const inline = withPeople && wide && !hidden;
  const peopleList = <TeamTree panels={panels} tree={tree} value={scope} onChange={setScope} />;

  return (
    <Box>
      <PageHeader
        title="Tasks"
        actions={
          <Button variant="contained" startIcon={<AddTaskRounded />} onClick={() => setNewTaskOpen(true)}>
            New task
          </Button>
        }
      />

      <BrowserNotificationsPrompt />

      {query.isLoading ? (
        <Stack spacing={2}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={64} />
          ))}
        </Stack>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start' }}>
          {inline && (
            <Card
              variant="outlined"
              component="aside"
              sx={{ width: 268, flexShrink: 0, p: 1.25, position: 'sticky', top: 88, maxHeight: 'calc(100vh - 112px)', overflowY: 'auto' }}
            >
              <Stack direction="row" alignItems="center" sx={{ mb: 1, pl: 0.5 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  People
                </Typography>
                <Tooltip title="Put the people list away">
                  <IconButton
                    size="small"
                    aria-label="Hide the people list"
                    onClick={() => {
                      setHidden(true);
                      writeHidden(true);
                    }}
                  >
                    <KeyboardDoubleArrowLeftRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {peopleList}
            </Card>
          )}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {withPeople && (
              <ScopeBar
                scope={scope}
                label={scopeLabel(scope, panels, tree)}
                panels={shown}
                person={picked}
                // Without the list beside it, the heading is what opens it.
                onOpenPeople={
                  inline ? undefined : () => {
                    if (wide) {
                      setHidden(false);
                      writeHidden(false);
                    } else setPickerOpen(true);
                  }
                }
              />
            )}
            {/* Beside the people list, the description column gives up the room. */}
            <TaskTable panels={shown} onOpen={(t) => setOpenId(t.id)} minWidth={inline ? 860 : 1020} showOwner={!withPeople || !picked} />
          </Box>
        </Box>
      )}

      {withPeople && !wide && (
        <Drawer anchor="left" open={pickerOpen} onClose={() => setPickerOpen(false)} slotProps={{ paper: { sx: { width: 300, maxWidth: '85vw', p: 1.5 } } }}>
          <Typography variant="subtitle2" sx={{ mb: 1, pl: 0.5 }}>
            People
          </Typography>
          {peopleList}
        </Drawer>
      )}

      <TaskDetailDrawer todo={opened} onClose={() => setOpenId(null)} onEdit={setEditing} />
      <TaskDialog open={newTaskOpen} initialAssigneeId={newFor} onClose={() => setNewTaskOpen(false)} />
      <TaskDialog open={Boolean(edited)} todo={edited} onClose={() => setEditing(null)} />
    </Box>
  );
}

/**
 * Whose tasks the table shows, and how much of that is owed and late. When the
 * people list is away, this is also the button that brings it back.
 */
function ScopeBar({
  scope,
  label,
  panels,
  person,
  onOpenPeople,
}: {
  scope: Scope;
  label: string;
  panels: TodoPanel[];
  person: TodoPanel | undefined;
  onOpenPeople?: () => void;
}) {
  const { active, overdue } = tally(panels);
  const caption =
    person && !person.isMe
      ? [ROLE_LABELS[person.person.role], person.person.manager ? `${person.person.manager.nickname}’s team` : null, person.person.isActive ? null : 'deactivated']
          .filter(Boolean)
          .join(' · ')
      : scope === 'all' || scope.startsWith('team:') || scope === 'experts'
        ? `${panels.length} ${panels.length === 1 ? 'person' : 'people'}`
        : null;

  const title = (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      {person ? (
        <UserAvatar avatarId={person.person.avatarId} photoId={person.person.photoId} size={30} label={person.person.nickname} userId={person.person.id} />
      ) : (
        <AccountTreeRounded sx={{ color: 'text.secondary' }} />
      )}
      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
        <Typography variant="subtitle1" fontWeight={650} noWrap sx={{ lineHeight: 1.25 }}>
          {label}
        </Typography>
        {caption && (
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {caption}
          </Typography>
        )}
      </Box>
    </Stack>
  );

  return (
    <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap columnGap={2} rowGap={0.5} sx={{ mb: 1.5, minHeight: 40 }}>
      {onOpenPeople ? (
        <Button
          color="inherit"
          onClick={onOpenPeople}
          endIcon={<ExpandMoreRounded />}
          aria-label={`Showing ${label}. Choose whose tasks to show`}
          sx={{ textTransform: 'none', px: 1, ml: -1, minWidth: 0, borderRadius: 2 }}
        >
          {title}
        </Button>
      ) : (
        title
      )}
      <Box sx={{ flex: 1 }} />
      <Typography variant="body2" color="text.secondary">
        {active} not completed
        {overdue > 0 && (
          <Box component="span" sx={{ color: 'error.main', fontWeight: 700 }}>
            {' '}
            · {overdue} overdue
          </Box>
        )}
      </Typography>
    </Stack>
  );
}
