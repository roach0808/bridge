import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import { Box, TextField, Typography } from '@mui/material';
import type { TodoDTO, TodoSummary } from '@god/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { FormDialog } from '../admin/adminShared';

export const TODO_COLORS = { open: '#e0913a', done: '#3fb68b' } as const;

/** Small status pill for a to-do. */
export function TodoPill({ todo, compact }: { todo: Pick<TodoSummary, 'status'>; compact?: boolean }) {
  const color = TODO_COLORS[todo.status];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        height: compact ? 20 : 22,
        px: 0.9,
        borderRadius: 99,
        fontSize: '0.7rem',
        fontWeight: 600,
        color,
        bgcolor: `${color}1f`,
        whiteSpace: 'nowrap',
      }}
    >
      {todo.status === 'done' && <TaskAltRounded sx={{ fontSize: 13 }} />}
      {todo.status === 'open' ? 'To-do' : 'Done'}
    </Box>
  );
}

/** The assignee marks a to-do done, optionally with a note that becomes the chat reply. */
export function TodoDoneDialog({
  todo,
  onClose,
}: {
  todo: (Pick<TodoDTO, 'id' | 'conversationId'> & { instruction: string }) | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (todo) setNote('');
  }, [todo]);

  const mutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.todos.done(id, note.trim() || undefined),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.todos.all });
      void queryClient.invalidateQueries({ queryKey: qk.chat.messages(saved.conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
      toast.success('Marked done — your reply was posted in the chat');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <FormDialog
      open={Boolean(todo)}
      onClose={onClose}
      title="Mark to-do as done"
      icon={<TaskAltRounded />}
      submitLabel="Mark done"
      pending={mutation.isPending}
      onSubmit={() => todo && mutation.mutate({ id: todo.id, note })}
      maxWidth="xs"
    >
      {todo && (
        <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'background.subtle', borderLeft: 3, borderColor: TODO_COLORS.open }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {todo.instruction}
          </Typography>
        </Box>
      )}
      <TextField
        label="Note (optional)"
        placeholder="e.g. Sent the report to your email."
        helperText="Posted in the chat as your reply to this to-do."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        multiline
        minRows={2}
        autoFocus
        slotProps={{ htmlInput: { maxLength: 2000 } }}
      />
    </FormDialog>
  );
}
