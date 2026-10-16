import KeyRounded from '@mui/icons-material/KeyRounded';
import { Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { CredentialList } from '@/components/Credentials';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * A team's password manager (§6.17): the logins the team shares — accessory
 * platforms, shared inboxes and the like. A Profile's own logins are on the
 * Profile's page. Managers and Associates see their own team's; a Founder
 * picks a team (`?team=`).
 */
export default function PasswordsPage() {
  const me = useMe();
  const isFounder = me.role === 'founder';
  const [params, setParams] = useSearchParams();

  const managers = useQuery({
    queryKey: qk.users.list({ role: 'manager', active: 'true' }),
    queryFn: () => api.users.list({ role: 'manager', active: 'true' }),
    enabled: isFounder,
  });
  const ownTeam = me.role === 'manager' ? me.id : me.role === 'associate' ? me.managerId : null;
  const teamId = isFounder ? params.get('team') : ownTeam;

  // A Founder lands on the first team.
  useEffect(() => {
    const first = managers.data?.[0];
    if (isFounder && !teamId && first) setParams({ team: first.id }, { replace: true });
  }, [isFounder, teamId, managers.data, setParams]);

  const teamName = isFounder
    ? managers.data?.find((m) => m.id === teamId)?.nickname
    : me.role === 'manager'
      ? me.nickname
      : me.manager?.nickname;

  return (
    <>
      <PageHeader
        title="Passwords"
        subtitle={
          isFounder
            ? 'Each team’s shared logins. A profile’s own logins are on the profile’s page.'
            : 'Your team’s shared logins. A profile’s own logins are on the profile’s page.'
        }
      />
      {isFounder && (
        <TextField
          select
          size="small"
          label="Team"
          value={teamId ?? ''}
          onChange={(e) => setParams({ team: e.target.value }, { replace: true })}
          sx={{ mb: 2, minWidth: 240 }}
          disabled={!managers.data?.length}
        >
          {(managers.data ?? []).map((m) => (
            <MenuItem key={m.id} value={m.id}>
              {m.nickname}’s team
            </MenuItem>
          ))}
        </TextField>
      )}

      {managers.error ? (
        <ErrorState error={managers.error} onRetry={() => void managers.refetch()} />
      ) : !teamId ? (
        <EmptyState
          icon={<KeyRounded />}
          title={isFounder ? (managers.isLoading ? 'Loading teams…' : 'No teams yet') : 'You are not in a team yet'}
          description={isFounder ? 'Add a Manager to start a team.' : 'Ask the Founder to put you in a Manager’s team.'}
        />
      ) : (
        <Card>
          <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={0.25} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {teamName ? `${teamName}’s team` : 'Team'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Only Founders and this team see these logins. Every password shown or copied is recorded in the audit trail.
              </Typography>
            </Stack>
            <CredentialList key={teamId} owner={{ kind: 'team', id: teamId }} emptyText="No shared login yet." />
          </CardContent>
        </Card>
      )}
    </>
  );
}
