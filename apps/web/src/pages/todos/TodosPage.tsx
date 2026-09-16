import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import { Box, Button, Card, CardContent, Skeleton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import type { TodoDTO } from '@god/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { BrowserNotificationsPrompt } from '@/components/BrowserNotifications';
import { useToast } from '@/components/ToastProvider';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { UserChip } from '@/components/identity';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, relativeTime } from '@/lib/time';
import { FilterChips } from '../admin/adminShared';
import { NewTaskDialog, TODO_COLORS, TodoDoneDialog, TodoPill, TodoReopenDialog, todoText, useRefreshTodos } from './todoShared';

type Scope = 'assigned' | 'created';
/** `active` = not completed yet, the default view. */
type Filter = 'active' | 'open' | 'done' | 'completed' | 'all';

const FILTER_LABELS: Record<Filter, string> = {
  active: 'Active',
  open: 'Open',
  done: 'Waiting for confirmation',
  completed: 'Completed',
  all: 'All',
};

const matches = (t: TodoDTO, f: Filter) => (f === 'all' ? true : f === 'active' ? t.status !== 'completed' : t.status === f);

export default function TodosPage() {
  const me = useMe();
  const gives = me.role === 'founder' || me.role === 'manager';
  const [params, setParams] = useSearchParams();
  const scope: Scope = gives && (params.get('scope') ?? (me.role === 'founder' ? 'created' : 'assigned')) === 'created' ? 'created' : 'assigned';
  const setScope = (s: Scope) => setParams((p) => ({ ...Object.fromEntries(p), scope: s }), { replace: true });
  const [filter, setFilter] = useState<Filter>('active');
  const [doneFor, setDoneFor] = useState<TodoDTO | null>(null);
  const [reopenFor, setReopenFor] = useState<TodoDTO | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: qk.todos.list({ scope, status: 'all' }),
    queryFn: () => api.todos.list({ scope, status: 'all' }),
  });
  const all = query.data ?? [];
  const visible = all.filter((t) => matches(t, filter));

  return (
    <Box>
      <PageHeader
        title="Tasks"
        subtitle={
          scope === 'created'
            ? 'Tasks you gave. Confirm the ones marked done to complete them.'
            : 'Tasks given to you. Mark them done when finished; the person who gave them confirms.'
        }
        actions={
          gives && (
            <Button variant="contained" startIcon={<AddTaskRounded />} onClick={() => setCreating(true)}>
              New task
            </Button>
          )
        }
      />

      <BrowserNotificationsPrompt />

      {gives && (
        <Tabs value={scope} onChange={(_, v: Scope) => setScope(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="created" label="Given by me" />
          <Tab value="assigned" label="Assigned to me" />
        </Tabs>
      )}

      <Box sx={{ mb: 2 }}>
        <FilterChips
          ariaLabel="Filter by status"
          value={filter}
          onChange={setFilter}
          options={(['active', 'open', 'done', 'completed', 'all'] as const).map((f) => ({
            value: f,
            label: FILTER_LABELS[f],
            count: query.data ? all.filter((t) => matches(t, f)).length : undefined,
          }))}
        />
      </Box>

      {query.isLoading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={96} />
          ))}
        </Stack>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={filter === 'completed' ? <VerifiedRounded /> : <ChecklistRounded />}
            title={filter === 'active' || filter === 'open' ? (scope === 'created' ? 'Nothing waiting' : 'You’re all caught up') : 'No tasks here'}
            description={
              scope === 'created'
                ? 'Use “New task”, or in a chat open a message’s menu and choose “Give as task”.'
                : 'When someone gives you a task, it shows up here.'
            }
          />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {visible.map((t) => (
            <TodoCard key={t.id} todo={t} scope={scope} onDone={() => setDoneFor(t)} onReopen={() => setReopenFor(t)} />
          ))}
        </Stack>
      )}

      <TodoDoneDialog
        todo={doneFor ? { id: doneFor.id, conversationId: doneFor.conversationId, instruction: todoText(doneFor) } : null}
        onClose={() => setDoneFor(null)}
      />
      <TodoReopenDialog todo={reopenFor} onClose={() => setReopenFor(null)} />
      <NewTaskDialog open={creating} onClose={() => setCreating(false)} />
    </Box>
  );
}

function TodoCard({ todo: t, scope, onDone, onReopen }: { todo: TodoDTO; scope: Scope; onDone: () => void; onReopen: () => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const toast = useToast();
  const refresh = useRefreshTodos();
  const navigate = useNavigate();
  const person = scope === 'created' ? t.assignee : t.createdBy;
  const iGave = t.createdBy.id === me.id;
  const finished = t.status !== 'open';

  const confirm = useMutation({
    mutationFn: () => api.todos.confirm(t.id),
    onSuccess: (saved) => {
      refresh(saved);
      toast.success('Completed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.todos.remove(t.id),
    onSuccess: () => {
      refresh(t);
      toast.success('Task removed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card sx={{ borderLeft: 4, borderLeftColor: TODO_COLORS[t.status], opacity: t.status === 'completed' ? 0.8 : 1 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'flex-start' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <TodoPill todo={t} />
              <Tooltip title={formatDateTime(t.createdAt, zone)}>
                <Typography variant="caption" color="text.secondary">
                  {relativeTime(t.createdAt)}
                </Typography>
              </Tooltip>
            </Stack>
            <Typography
              variant="body1"
              sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontWeight: t.title ? 600 : 400,
                textDecoration: t.status === 'completed' ? 'line-through' : 'none',
                color: finished ? 'text.secondary' : 'text.primary',
              }}
            >
              {todoText(t)}
            </Typography>
            {t.details && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {t.details}
              </Typography>
            )}
            {finished && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                Done {t.doneAt ? relativeTime(t.doneAt) : ''}
                {t.doneNote ? ` — “${t.doneNote}”` : ''}
                {t.confirmedAt ? ` · confirmed ${relativeTime(t.confirmedAt)}` : ''}
              </Typography>
            )}
            <Box sx={{ mt: 1.25 }}>
              <UserChip user={person} size={22} subtitle={scope === 'created' ? 'Assigned to' : 'From'} />
            </Box>
          </Box>
          <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1} alignItems={{ sm: 'flex-end' }} sx={{ flexShrink: 0, flexWrap: 'wrap' }} useFlexGap>
            {t.status === 'open' && t.assignee.id === me.id && (
              <Button variant="contained" color="success" startIcon={<TaskAltRounded />} onClick={onDone}>
                Mark done
              </Button>
            )}
            {t.status === 'done' && iGave && (
              <Button variant="contained" color="success" startIcon={<VerifiedRounded />} onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                Confirm
              </Button>
            )}
            {finished && iGave && (
              <Button color="inherit" startIcon={<ReplayRounded />} onClick={onReopen} sx={{ color: 'text.secondary' }}>
                Reopen
              </Button>
            )}
            {t.status === 'open' && iGave && (
              <Button color="inherit" startIcon={<DeleteOutlineRounded />} onClick={() => remove.mutate()} disabled={remove.isPending} sx={{ color: 'text.secondary' }}>
                Remove
              </Button>
            )}
            {t.conversationId && (
              <Button color="inherit" startIcon={<ChatBubbleOutlineRounded />} onClick={() => navigate(`/chat/${t.conversationId}`)} sx={{ color: 'text.secondary' }}>
                Open chat
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
