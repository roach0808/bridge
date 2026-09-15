import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import { Box, Button, Card, CardContent, Skeleton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import type { TodoDTO, TodoStatus } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { UserChip } from '@/components/identity';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, relativeTime } from '@/lib/time';
import { FilterChips } from '../admin/adminShared';
import { TODO_COLORS, TodoDoneDialog, TodoPill } from './todoShared';

type Scope = 'assigned' | 'created';
type Filter = 'all' | TodoStatus;

export default function TodosPage() {
  const me = useMe();
  const isFounder = me.role === 'founder';
  const [scope, setScope] = useState<Scope>(isFounder ? 'created' : 'assigned');
  const [filter, setFilter] = useState<Filter>('open');
  const [doneFor, setDoneFor] = useState<TodoDTO | null>(null);

  const query = useQuery({
    queryKey: qk.todos.list({ scope }),
    queryFn: () => api.todos.list({ scope }),
  });
  const all = query.data ?? [];
  const counts = { all: all.length, open: all.filter((t) => t.status === 'open').length, done: all.filter((t) => t.status === 'done').length };
  const visible = all.filter((t) => filter === 'all' || t.status === filter);

  return (
    <Box>
      <PageHeader
        title="To-dos"
        subtitle={
          scope === 'created'
            ? 'Instructions you turned into to-dos in chat, and whether they are done.'
            : 'Instructions from the Founder. Marking one done replies to it in the chat.'
        }
      />

      {isFounder && (
        <Tabs value={scope} onChange={(_, v: Scope) => setScope(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="created" label="Assigned by me" />
          <Tab value="assigned" label="Assigned to me" />
        </Tabs>
      )}

      <Box sx={{ mb: 2 }}>
        <FilterChips
          ariaLabel="Filter by status"
          value={filter}
          onChange={setFilter}
          options={(['open', 'done', 'all'] as const).map((f) => ({
            value: f,
            label: f === 'open' ? 'Open' : f === 'done' ? 'Done' : 'All',
            count: query.data ? counts[f] : undefined,
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
            icon={filter === 'done' ? <TaskAltRounded /> : <ChecklistRounded />}
            title={filter === 'open' ? (scope === 'created' ? 'Nothing waiting' : 'You’re all caught up') : 'No to-dos here'}
            description={
              scope === 'created'
                ? 'In a chat, open a message’s menu and choose “Mark as to-do”.'
                : 'When the Founder marks a chat message as a to-do for you, it shows up here.'
            }
          />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {visible.map((t) => (
            <TodoCard key={t.id} todo={t} scope={scope} onDone={() => setDoneFor(t)} />
          ))}
        </Stack>
      )}

      <TodoDoneDialog
        todo={doneFor ? { id: doneFor.id, conversationId: doneFor.conversationId, instruction: doneFor.message.body } : null}
        onClose={() => setDoneFor(null)}
      />
    </Box>
  );
}

function TodoCard({ todo: t, scope, onDone }: { todo: TodoDTO; scope: Scope; onDone: () => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const navigate = useNavigate();
  const person = scope === 'created' ? t.assignee : t.createdBy;

  return (
    <Card sx={{ borderLeft: 4, borderLeftColor: TODO_COLORS[t.status] }}>
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
              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'text.secondary' : 'text.primary' }}
            >
              {t.message.body}
            </Typography>
            {t.status === 'done' && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                Done {t.doneAt ? relativeTime(t.doneAt) : ''}
                {t.doneNote ? ` — “${t.doneNote}”` : ''}
              </Typography>
            )}
            <Box sx={{ mt: 1.25 }}>
              <UserChip user={person} size={22} subtitle={scope === 'created' ? 'Assigned to' : 'From'} />
            </Box>
          </Box>
          <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1} alignItems={{ sm: 'flex-end' }} sx={{ flexShrink: 0 }}>
            {t.status === 'open' && t.assignee.id === me.id && (
              <Button variant="contained" color="success" startIcon={<TaskAltRounded />} onClick={onDone}>
                Mark done
              </Button>
            )}
            <Button color="inherit" startIcon={<ChatBubbleOutlineRounded />} onClick={() => navigate(`/chat/${t.conversationId}`)} sx={{ color: 'text.secondary' }}>
              Open chat
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
