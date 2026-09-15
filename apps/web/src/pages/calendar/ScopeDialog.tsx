import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
} from '@mui/material';
import type { EditScope } from '@god/shared';
import { useEffect, useState } from 'react';

const LABELS: Record<EditScope, string> = {
  this: 'This event',
  following: 'This and following events',
  all: 'All events',
};

/** "Edit/Delete recurring event" chooser, like a desktop calendar. */
export function ScopeDialog({
  open,
  action,
  allowThis = true,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  action: 'edit' | 'delete';
  allowThis?: boolean;
  busy?: boolean;
  onConfirm: (scope: EditScope) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<EditScope>('this');
  useEffect(() => {
    if (open) setScope(allowThis ? 'this' : 'following');
  }, [open, allowThis]);

  const options: EditScope[] = allowThis ? ['this', 'following', 'all'] : ['following', 'all'];
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{action === 'edit' ? 'Edit recurring time off' : 'Delete recurring time off'}</DialogTitle>
      <DialogContent>
        <RadioGroup value={scope} onChange={(_, v) => setScope(v as EditScope)}>
          {options.map((s) => (
            <FormControlLabel key={s} value={s} control={<Radio />} label={LABELS[s]} />
          ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={action === 'delete' ? 'error' : 'primary'}
          onClick={() => onConfirm(scope)}
          disabled={busy}
        >
          {busy ? <CircularProgress size={18} color="inherit" /> : action === 'delete' ? 'Delete' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
