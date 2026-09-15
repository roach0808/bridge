import { Box, ButtonBase, Skeleton, Tooltip } from '@mui/material';
import type { AvatarAudience } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { api, avatarUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/** Grid of the illustrated avatars for an audience. */
export function AvatarPicker({
  audience,
  value,
  onChange,
  size = 56,
}: {
  audience: AvatarAudience;
  value: string | null | undefined;
  onChange: (avatarId: string) => void;
  size?: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: qk.avatars(audience),
    queryFn: () => api.avatars.list(audience),
    staleTime: Infinity,
  });

  return (
    <Box
      role="radiogroup"
      aria-label="Choose an avatar"
      sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${size + 8}px, 1fr))`, gap: 1 }}
    >
      {isLoading
        ? Array.from({ length: 12 }, (_, i) => <Skeleton key={i} variant="circular" width={size} height={size} />)
        : data?.map((a) => {
            const selected = a.id === value;
            return (
              <Tooltip key={a.id} title={a.label}>
                <ButtonBase
                  role="radio"
                  aria-checked={selected}
                  aria-label={a.label}
                  onClick={() => onChange(a.id)}
                  sx={{
                    position: 'relative',
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    justifySelf: 'center',
                    outline: '2px solid',
                    outlineColor: selected ? 'primary.main' : 'transparent',
                    outlineOffset: 2,
                    transition: 'transform .12s ease, outline-color .12s ease',
                    '&:hover': { transform: 'scale(1.04)' },
                    '&:focus-visible': { outlineColor: 'primary.light' },
                  }}
                >
                  <Box
                    component="img"
                    src={avatarUrl(a.id)}
                    alt=""
                    loading="lazy"
                    sx={{ width: '100%', height: '100%', borderRadius: '50%', display: 'block' }}
                  />
                </ButtonBase>
              </Tooltip>
            );
          })}
    </Box>
  );
}
