import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { ROLE_LABELS, type TodoDTO, type TodoSummary, type UserRef } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { FormDialog } from '../admin/adminShared';

export const TODO_COLORS = { open: '#e0913a', done: '#3f8fd6', completed: '#3fb68b' } as const;

const TODO_LABELS = { open: 'Task', done: 'Done · to confirm', completed: 'Completed' } as const;

/** What a task asks for: the chat message it was made from, or its title. */
export const todoText = (t: Pick<TodoDTO, 'message' | 'title'>) => t.message?.body ?? t.title ?? '';

/** Small status pill for a task. */
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
      {todo.status === 'completed' && <VerifiedRounded sx={{ fontSize: 13 }} />}
      {TODO_LABELS[todo.status]}
    </Box>
  );
}

/** Refreshes everything a task change can show up in. */
export function useRefreshTodos() {
  const queryClient = useQueryClient();
  return (t: Pick<TodoDTO, 'conversationId'> | null) => {
    void queryClient.invalidateQueries({ queryKey: qk.todos.all });
    if (t?.conversationId) {
      void queryClient.invalidateQueries({ queryKey: qk.chat.messages(t.conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
    }
  };
}

function Instruction({ text, color }: { text: string; color: string }) {
  return (
    <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'background.subtle', borderLeft: 3, borderColor: color }}>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </Typography>
    </Box>
  );
}

/** The taker marks a task done, optionally with a note (for a chat task it becomes the chat reply). */
export function TodoDoneDialog({
  todo,
  onClose,
}: {
  todo: (Pick<TodoDTO, 'id' | 'conversationId'> & { instruction: string }) | null;
  onClose: () => void;
}) {
  const refresh = useRefreshTodos();
  const toast = useToast();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (todo) setNote('');
  }, [todo]);

  const mutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.todos.done(id, note.trim() || undefined),
    onSuccess: (saved) => {
      refresh(saved);
      toast.success(saved.conversationId ? 'Marked done — your reply was posted in the chat' : 'Marked done — waiting for confirmation');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <FormDialog
      open={Boolean(todo)}
      onClose={onClose}
      title="Mark task as done"
      icon={<TaskAltRounded />}
      submitLabel="Mark done"
      pending={mutation.isPending}
      onSubmit={() => todo && mutation.mutate({ id: todo.id, note })}
      maxWidth="xs"
    >
      {todo && <Instruction text={todo.instruction} color={TODO_COLORS.open} />}
      <TextField
        label="Note (optional)"
        placeholder="e.g. Sent the report to your email."
        helperText={
          todo?.conversationId
            ? 'Posted in the chat as your reply to this task.'
            : 'Shown to the person who gave you the task.'
        }
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

/** The giver sends a task back to the taker, optionally saying why. */
export function TodoReopenDialog({ todo, onClose }: { todo: TodoDTO | null; onClose: () => void }) {
  const refresh = useRefreshTodos();
  const toast = useToast();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (todo) setNote('');
  }, [todo]);

  const mutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.todos.reopen(id, note.trim() || undefined),
    onSuccess: (saved) => {
      refresh(saved);
      toast.success(`Reopened — ${saved.assignee.nickname} was notified`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <FormDialog
      open={Boolean(todo)}
      onClose={onClose}
      title="Reopen task"
      icon={<ReplayRounded />}
      submitLabel="Reopen"
      pending={mutation.isPending}
      onSubmit={() => todo && mutation.mutate({ id: todo.id, note })}
      maxWidth="xs"
    >
      {todo && <Instruction text={todoText(todo)} color={TODO_COLORS[todo.status]} />}
      <TextField
        label="What is still missing? (optional)"
        helperText="Sent to them with the notification."
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

/** A task that doesn't come from a chat message. With `assignee` it is already decided who it is for. */
export function NewTaskDialog({ open, assignee, onClose }: { open: boolean; assignee?: UserRef; onClose: () => void }) {
  const refresh = useRefreshTodos();
  const toast = useToast();
  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const assignees = useQuery({ queryKey: [...qk.todos.all, 'assignees'], queryFn: api.todos.assignees, enabled: open && !assignee });
  useEffect(() => {
    if (open) {
      setAssigneeId(assignee?.id ?? '');
      setTitle('');
      setDetails('');
    }
  }, [open, assignee?.id]);

  const mutation = useMutation({
    mutationFn: () => api.todos.create({ assigneeId, title: title.trim(), details: details.trim() || null }),
    onSuccess: (saved) => {
      refresh(saved);
      toast.success(`Task given to ${saved.assignee.nickname}`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={assignee ? `New task for ${assignee.nickname}` : 'New task'}
      icon={<AddTaskRounded />}
      submitLabel="Give task"
      pending={mutation.isPending}
      submitDisabled={!assigneeId || !title.trim()}
      onSubmit={() => mutation.mutate()}
    >
      {!assignee && (
        <TextField
          select
          required
          label="For"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          helperText={assignees.data?.length === 0 ? 'There is nobody you can give tasks to yet.' : undefined}
        >
          {(assignees.data ?? []).map((u) => (
            <MenuItem key={u.id} value={u.id}>
              {u.nickname}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {ROLE_LABELS[u.role]}
              </Typography>
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        required
        label="Task"
        placeholder="e.g. Send the weekly report"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <TextField
        label="Details (optional)"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        multiline
        minRows={3}
        slotProps={{ htmlInput: { maxLength: 5000 } }}
      />
    </FormDialog>
  );
}
