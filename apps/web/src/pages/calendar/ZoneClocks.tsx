import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import { Box, Button, IconButton, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { TimeZoneSelect } from '@/components/TimeZoneSelect';
import { useNow } from './useNow';

export interface Clock {
  zone: string;
  label: string;
  primary?: boolean;
  color?: string;
}

const city = (zone: string) => zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;

export function ZoneClocks({
  clocks,
  clientZone,
  onClientZoneChange,
}: {
  clocks: Clock[];
  clientZone: string | null;
  onClientZoneChange: (zone: string | null) => void;
}) {
  const now = useNow();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const primary = clocks.find((c) => c.primary);

  const card = (c: Clock, extra?: ReactNode) => {
    const local = now.setZone(c.zone);
    const diffHours = primary && !c.primary ? (local.offset - now.setZone(primary.zone).offset) / 60 : 0;
    const otherDay = Boolean(primary && !c.primary && local.toISODate() !== now.setZone(primary.zone).toISODate());
    return (
      <Stack
        key={`${c.label}-${c.zone}`}
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          pl: 0.5,
          pr: extra ? 0 : 1,
          py: 0.25,
          minWidth: 0,
        }}
      >
        {c.color && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: c.color, flexShrink: 0 }} />}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ lineHeight: 1.2 }}>
            {c.label}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="baseline">
            <Typography sx={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums', lineHeight: 1.4 }}>
              {local.toFormat('h:mm a')}
            </Typography>
            <Tooltip title={c.zone}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {local.toFormat('ZZZZ')} · {city(c.zone)}
                {diffHours !== 0 && ` · ${diffHours > 0 ? '+' : ''}${Number.isInteger(diffHours) ? diffHours : diffHours.toFixed(1)}h`}
                {otherDay && ` · ${local.toFormat('ccc')}`}
              </Typography>
            </Tooltip>
          </Stack>
        </Box>
        {extra}
      </Stack>
    );
  };

  return (
    <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center">
      {clocks.map((c) => card(c))}
      {clientZone ? (
        card(
          { zone: clientZone, label: 'Client time' },
          <Stack>
            <Tooltip title="Change client time zone">
              <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Change client time zone">
                <PublicRounded sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Remove client clock">
              <IconButton size="small" onClick={() => onClientZoneChange(null)} aria-label="Remove client clock">
                <CloseRounded sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Stack>,
        )
      ) : (
        <Button
          color="inherit"
          size="small"
          startIcon={<AddRounded />}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ color: 'text.secondary' }}
        >
          Client time zone
        </Button>
      )}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, width: 360, maxWidth: 'calc(100vw - 24px)' } } }}
      >
        <TimeZoneSelect
          label="Client time zone"
          value={clientZone}
          helperText="Saved in this browser only"
          onChange={(z) => {
            onClientZoneChange(z);
            if (z) setAnchor(null);
          }}
        />
      </Popover>
    </Stack>
  );
}
