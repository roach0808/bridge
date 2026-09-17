import type { UserDTO } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * People the caller may give a call to (its "Associate", who runs scheduling):
 * the Founder picks any active Associate or Manager; a Manager themselves or any Associate.
 */
export function useCallOwners(enabled: boolean) {
  const me = useMe();
  const query = useQuery<UserDTO[]>({
    queryKey: qk.users.list({ active: 'true', scope: 'call-owners' }),
    queryFn: () => api.users.list({ active: 'true' }),
    enabled: enabled && (me.role === 'founder' || me.role === 'manager'),
  });
  const others = (query.data ?? []).filter((u) => u.isActive && u.id !== me.id);
  const data =
    me.role === 'manager'
      ? [me, ...others.filter((u) => u.role === 'associate')]
      : others.filter((u) => u.role === 'associate' || u.role === 'manager');
  return { data, isLoading: query.isLoading };
}
