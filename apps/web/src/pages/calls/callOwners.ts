import type { UserDTO } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * People the caller may give a call to (its "Associate", who runs scheduling):
 * the Founder picks any active Associate or Manager; a Manager picks themselves or their team.
 */
export function useCallOwners(enabled: boolean) {
  const me = useMe();
  const query = useQuery<UserDTO[]>({
    queryKey: me.role === 'manager' ? qk.users.team : qk.users.list({ active: 'true', scope: 'call-owners' }),
    queryFn: () => (me.role === 'manager' ? api.users.team() : api.users.list({ active: 'true' })),
    enabled: enabled && (me.role === 'founder' || me.role === 'manager'),
  });
  const data =
    me.role === 'manager'
      ? [me, ...(query.data ?? []).filter((u) => u.isActive)]
      : (query.data ?? []).filter((u) => u.isActive && (u.role === 'associate' || u.role === 'manager'));
  return { data, isLoading: query.isLoading };
}
