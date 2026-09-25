import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import TableRowsRounded from '@mui/icons-material/TableRowsRounded';
import { Box, Button, Skeleton, Stack, Tooltip } from '@mui/material';
import type { TodoDTO, UserRef } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { BrowserNotificationsPrompt } from '@/components/BrowserNotifications';
import { ErrorState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { TaskBoard } from './TaskBoard';
import { TaskDialog } from './TaskDialog';
import { TaskTable } from './taskViews';
import { TodoReopenDialog } from './todoShared';

/**
 * Tasks: one table. Owner, start, end date, description and status, with a
 * filter under each heading and a sort on each heading. A row opens the task,
 * where everything else about it lives.
 *
 * The four quadrants are still here, one button away, for anyone who plans that
 * way — but the table is the page.
 */

/** The filters do the choosing now, so the page asks the API for everything. */
type Filter = 'all';

export default function TodosPage() {
  const [params, setParams] = useSearchParams();
  const board = params.get('view') === 'board';
  const [newTaskFor, setNewTaskFor] = useState<UserRef | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [editing, setEditing] = useState<TodoDTO | null>(null);
  const [reopenFor, setReopenFor] = useState<TodoDTO | null>(null);

  const query = useQuery({ queryKey: qk.todos.board('all'), queryFn: () => api.todos.board({ status: 'all' }) });
  const panels = query.data ?? [];
  // The dialog is opened with a task, so it must follow that task as it changes.
  const open = editing ? (panels.flatMap((p) => p.tasks).find((t) => t.id === editing.id) ?? editing) : null;

  return (
    <Box>
      <PageHeader
        title="Tasks"
        actions={
          <Stack direction="row" spacing={1}>
            <Tooltip title={board ? 'Back to the table' : 'The four quadrants'}>
              <Button
                color="inherit"
                startIcon={board ? <TableRowsRounded /> : <GridViewRounded />}
                onClick={() => setParams(board ? {} : { view: 'board' }, { replace: true })}
              >
                {board ? 'Table' : 'Board'}
              </Button>
            </Tooltip>
            <Button variant="contained" startIcon={<AddTaskRounded />} onClick={() => setNewTaskOpen(true)}>
              New task
            </Button>
          </Stack>
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
      ) : board ? (
        <TaskBoard filter="all" panels={panels} onNewTask={setNewTaskFor} onReopen={setReopenFor} onOpen={setEditing} />
      ) : (
        <TaskTable panels={panels} onOpen={setEditing} />
      )}

      <TodoReopenDialog todo={reopenFor} onClose={() => setReopenFor(null)} />
      <TaskDialog open={Boolean(newTaskFor)} assignee={newTaskFor ?? undefined} onClose={() => setNewTaskFor(null)} />
      <TaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
      <TaskDialog open={Boolean(open)} todo={open} onClose={() => setEditing(null)} />
    </Box>
  );
}

export type { Filter };
