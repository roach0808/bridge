import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import { Box, Button, Skeleton, Stack } from '@mui/material';
import type { TodoDTO } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserNotificationsPrompt } from '@/components/BrowserNotifications';
import { ErrorState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { TaskDialog } from './TaskDialog';
import { TaskTable } from './taskViews';

/**
 * Tasks: one table. Owner, start, end date, description and status, with a
 * filter under each heading and a sort on each heading. A row opens the task,
 * where everything else about it lives.
 */

export default function TodosPage() {
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [editing, setEditing] = useState<TodoDTO | null>(null);

  const query = useQuery({ queryKey: qk.todos.board('all'), queryFn: () => api.todos.board({ status: 'all' }) });
  const panels = query.data ?? [];
  // The dialog is opened with a task, so it must follow that task as it changes.
  const open = editing ? (panels.flatMap((p) => p.tasks).find((t) => t.id === editing.id) ?? editing) : null;

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
        <TaskTable panels={panels} onOpen={setEditing} />
      )}

      <TaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
      <TaskDialog open={Boolean(open)} todo={open} onClose={() => setEditing(null)} />
    </Box>
  );
}
