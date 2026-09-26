import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LinkedIn from '@mui/icons-material/LinkedIn';
import { Alert, Box, Button, Card, CardContent, IconButton, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import type { ProfileDTO } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { DeactivatedPill, ProfileActiveToggle, ProfileDetailsBody, ProfileStatusChip } from '@/components/ProfileDetails';
import { ConfirmDialog, ErrorState } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { RejectProfileDialog, useProfileForm } from '../admin/ProfileDialogs';
import { pendingItems } from './profileShared';
import { ManagerShareField, ProfileAssociateField } from './ProfileTeam';

/** One profile on its own page: details, review, banks, and the edit form in place. */
export default function ProfileDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  const setEditing = (on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (on) next.set('edit', '1');
        else next.delete('edit');
        return next;
      },
      { replace: true },
    );
  const [rejecting, setRejecting] = useState<ProfileDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({ queryKey: qk.profiles.detail(id), queryFn: () => api.profiles.get(id), enabled: Boolean(id) });
  const p = query.data;
  const isFounder = me.role === 'founder';
  const mayEdit = p?.canEdit ?? false;

  return (
    <Box>
      <Button
        size="small"
        startIcon={<ArrowBackRounded />}
        color="inherit"
        onClick={() => navigate('/profiles')}
        sx={{ mb: 1.5, ml: -1, color: 'text.secondary' }}
      >
        Back to profiles
      </Button>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !p ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={320} />
        </Stack>
      ) : (
        <Stack spacing={2.5}>
          <Card>
            <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.name} size={56} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="h5" component="h1" noWrap>
                      {p.name}
                    </Typography>
                    <ProfileStatusChip status={p.status} />
                    {!p.isActive && <DeactivatedPill />}
                    {p.linkedinUrl && (
                      <Tooltip title="Open LinkedIn">
                        <IconButton size="small" component="a" href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                          <LinkedIn sx={{ fontSize: 18, color: 'text.secondary' }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {p.briefExperience || 'No summary yet.'}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }} flexWrap="wrap" useFlexGap>
                  {isFounder && <ProfileActiveToggle profile={p} />}
                  {isFounder && (
                    <Button size="small" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => setDeleting(true)}>
                      Delete
                    </Button>
                  )}
                  {mayEdit && !editing && (
                    <Button variant="outlined" size="small" startIcon={<EditOutlined />} onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  )}
                </Stack>
              </Stack>

              {me.role !== 'expert' && (
                <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                  <ProfileAssociateField profile={p} />
                  <ManagerShareField profile={p} />
                </Stack>
              )}

              <PendingList profile={p} />

              {isFounder && p.status === 'pending' && <ReviewBar profile={p} onReject={() => setRejecting(p)} />}
              {p.status === 'rejected' && p.rejectionReason && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Rejected: {p.rejectionReason}
                </Alert>
              )}
            </CardContent>
          </Card>

          {editing ? (
            <EditCard profile={p} onDone={() => setEditing(false)} />
          ) : (
            <Card>
              <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
                <ProfileDetailsBody profile={p} />
              </CardContent>
            </Card>
          )}
        </Stack>
      )}

      <RejectProfileDialog profile={rejecting} onClose={() => setRejecting(null)} />
      <ConfirmDialog
        open={deleting}
        title={`Delete ${p?.name ?? 'this profile'}?`}
        description="If it has no calls, it is removed completely. If it had calls, its personal details, bank accounts and addresses are erased and it disappears from every list, but its past calls and income stay, shown as “Removed profile”. This cannot be undone."
        confirmLabel="Delete profile"
        destructive
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await api.profiles.remove(id);
          void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
          void queryClient.invalidateQueries({ queryKey: qk.dashboard });
          toast.success('Profile deleted');
          navigate('/profiles');
        }}
      />
    </Box>
  );
}

/** What is still missing on this profile, if anything. */
function PendingList({ profile }: { profile: ProfileDTO }) {
  const items = pendingItems(profile);
  if (!items.length) return null;
  return (
    <Alert severity="info" variant="outlined" icon={false} sx={{ mt: 2, bgcolor: 'background.paper', borderColor: 'divider', color: 'text.primary' }}>
      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
        Still to do
      </Typography>
      <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2.5 }}>
        {items.map((item) => (
          <Typography component="li" variant="body2" key={item}>
            {item}
          </Typography>
        ))}
      </Stack>
    </Alert>
  );
}

function ReviewBar({ profile, onReject }: { profile: ProfileDTO; onReject: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const approve = useMutation({
    mutationFn: () => api.profiles.approve(profile.id),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.profiles.detail(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
      toast.success(`Approved “${saved.name}”`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
      <Button variant="contained" size="small" startIcon={<CheckCircleOutlined />} onClick={() => approve.mutate()} disabled={approve.isPending}>
        Approve
      </Button>
      <Button color="inherit" size="small" onClick={onReject} sx={{ color: 'text.secondary' }}>
        Reject
      </Button>
    </Stack>
  );
}

/** The profile form, in place on the page rather than in a popup. */
function EditCard({ profile, onDone }: { profile: ProfileDTO; onDone: () => void }) {
  const me = useMe();
  // Only a Profile still to be reviewed goes back in the queue when it changes.
  const form = useProfileForm({ profile, resubmit: me.role !== 'founder' && profile.status !== 'approved', onClose: onDone });
  return (
    <Card component="form" onSubmit={(e) => { e.preventDefault(); form.submit(); }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          Edit profile
        </Typography>
        {form.general && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {form.general}
          </Alert>
        )}
        <Stack spacing={2}>{form.fields}</Stack>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2.5 }}>
          <Button color="inherit" onClick={onDone} disabled={form.pending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={form.pending}>
            {form.submitLabel}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
