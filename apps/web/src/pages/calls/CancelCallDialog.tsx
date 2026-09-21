import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import type { CallDTO } from '@god/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage, isApiError } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { patchCallInCache } from '@/realtime/RealtimeProvider';

/**
 * Calls a call off from its panel in the list (§4.2): whoever runs it, any
 * Manager or the Founder, while it has not started. Final, so it asks first.
 */
export function CancelCallDialog({ call, onClose }: { call: CallDTO | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (call) setReason('');
  }, [call]);

  const cancel = useMutation({
    mutationFn: (c: CallDTO) => api.calls.transition(c.id, 'cancelled', { comment: reason.trim() || undefined }),
    onSuccess: (updated) => {
      patchCallInCache(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      void queryClient.invalidateQueries({ queryKey: qk.calendar.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(`The call with ${updated.profile.name} was cancelled`);
      onClose();
    },
    onError: (err) => {
      if (isApiError(err) && err.status === 409) void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog open={Boolean(call)} onClose={() => !cancel.isPending && onClose()} maxWidth="xs" fullWidth>
      {call && (
        <>
          <DialogTitle>Cancel the call with {call.profile.name}?</DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>This cannot be undone.</strong> The call is called off for good
              {call.expert ? `, ${call.expert.nickname}’s time is freed` : ''} and it earns nothing. Everyone on the call is
              told. To keep it and find another time, open it and use “Needs rescheduling” instead.
            </Alert>
            <TextField
              label="Why is it cancelled? (optional)"
              placeholder="e.g. The client called it off."
              multiline
              minRows={2}
              fullWidth
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button color="inherit" onClick={onClose} disabled={cancel.isPending}>
              Keep the call
            </Button>
            <Button variant="contained" color="error" disabled={cancel.isPending} onClick={() => cancel.mutate(call)}>
              {cancel.isPending ? <CircularProgress size={18} color="inherit" /> : 'Cancel call'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
