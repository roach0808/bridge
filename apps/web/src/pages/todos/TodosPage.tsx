import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import { Box, Button, Card, Skeleton, Stack, Tab, Tabs } from '@mui/material';
import type { TodoDTO, UserRef } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { BrowserNotificationsPrompt } from '@/components/BrowserNotifications';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { FilterChips } from '../admin/adminShared';
import { TaskBoard } from './TaskBoard';
import { TaskDialog } from './TaskDialog';
import { TaskList, TodayView, type TaskView } from './taskViews';
import { TodoReopenDialog } from './todoShared';

/**
 * Tasks, four ways of looking at the same list.
 *
 * **Execution** is the default, because the question a team asks each morning
 * is what to work on now, and that is answered by Start By — not by the
 * deadline. **Deadline** answers the other question, what must be finished
 * soon. **Today** is everyone's started work in one place, with the counts a
 * manager needs. **Board** is the four quadrants.
 */

/** `active` = not completed yet, the default view. */
type Filter = 'active' | 'open' | 'done' | 'completed' | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Not started' },
  { value: 'done', label: 'Ready for review' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

const VIEWS: Array<{ value: TaskView; label: string }> = [
  { value: 'execution', label: 'Execution' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'today', label: 'Today' },
  { value: 'board', label: 'Board' },
];

const SUBTITLES: Record<TaskView, string> = {
  execution: 'What to work on now, by when it should be started. Start By is when to begin; Complete By is when it must already be finished.',
  deadline: 'What must be finished soonest. The same tasks in a different order — a deadline is not a start date.',
  today: 'What everyone should be working on today: tasks that have started and are not finished.',
  board: 'Four quadrants: what needs action and what can wait, strategic and not. Drag a task between them, or onto someone else’s board.',
};

export default function TodosPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f.value === params.get('filter'))?.value ?? 'active') as Filter;
  const view = (VIEWS.find((v) => v.value === params.get('view'))?.value ?? 'execution') as TaskView;
  const [newTaskFor, setNewTaskFor] = useState<UserRef | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [editing, setEditing] = useState<TodoDTO | null>(null);
  const [reopenFor, setReopenFor] = useState<TodoDTO | null>(null);

  const query = useQuery({ queryKey: qk.todos.board(filter), queryFn: () => api.todos.board({ status: filter }) });
  const panels = query.data ?? [];
  const set = (key: string, value: string) => setParams((p) => ({ ...Object.fromEntries(p), [key]: value }), { replace: true });
  // The dialog is opened with a task, so it must follow that task as it changes.
  const open = editing ? (panels.flatMap((p) => p.tasks).find((t) => t.id === editing.id) ?? editing) : null;

  return (
    <Box>
      <PageHeader
        title="Tasks"
        subtitle={SUBTITLES[view]}
        actions={
          <Button variant="contained" startIcon={<AddTaskRounded />} onClick={() => setNewTaskOpen(true)}>
            New task
          </Button>
        }
      />

      <BrowserNotificationsPrompt />

      <Tabs value={view} onChange={(_, v: TaskView) => set('view', v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        {VIEWS.map((v) => (
          <Tab key={v.value} value={v.value} label={v.label} />
        ))}
      </Tabs>

      <Box sx={{ mb: 2 }}>
        <FilterChips ariaLabel="Filter by status" value={filter} onChange={(v) => set('filter', v)} options={FILTERS} />
      </Box>

      {query.isLoading ? (
        <Stack spacing={2}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={140} />
          ))}
        </Stack>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : view === 'board' ? (
        <TaskBoard filter={filter} panels={panels} onNewTask={setNewTaskFor} onReopen={setReopenFor} onOpen={setEditing} />
      ) : view === 'today' ? (
        <TodayView panels={panels} onOpen={setEditing} />
      ) : (
        <TaskList panels={panels} view={view} onOpen={setEditing} />
      )}

      <TodoReopenDialog todo={reopenFor} onClose={() => setReopenFor(null)} />
      <TaskDialog open={Boolean(newTaskFor)} assignee={newTaskFor ?? undefined} onClose={() => setNewTaskFor(null)} />
      <TaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
      <TaskDialog open={Boolean(open)} todo={open} onClose={() => setEditing(null)} />
      {me.role !== 'expert' && panels.length === 0 && !query.isLoading && !query.isError && (
        <Card>
          <EmptyState icon={<ChecklistRounded />} title="Nothing here yet" />
        </Card>
      )}
    </Box>
  );
}

export type { Filter };
