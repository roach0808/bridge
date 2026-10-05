import FilterListRounded from '@mui/icons-material/FilterListRounded';
import { Badge, Box, Button, Checkbox, Chip, IconButton, Popover, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';

/** A table column's values, with how many rows have each. */
export type ColumnFilterOption = { value: string; count: number };

/** Excel-like options: each column offers the values the other columns' filters leave (and keeps its own ticks). */
export function columnOptions<T>(
  rows: T[],
  value: (row: T) => string,
  passesOthers: (row: T) => boolean,
  selected: string[] = [],
  sort?: (row: T) => number | string,
  empty = '—',
): ColumnFilterOption[] {
  const counts = new Map<string, { count: number; sort: number | string }>();
  for (const r of rows) {
    if (!passesOthers(r)) continue;
    const v = value(r);
    const entry = counts.get(v) ?? { count: 0, sort: sort?.(r) ?? v };
    entry.count++;
    counts.set(v, entry);
  }
  for (const v of selected) if (!counts.has(v)) counts.set(v, { count: 0, sort: v });
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => (a === empty ? 1 : b === empty ? -1 : x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0))
    .map(([v, { count }]) => ({ value: v, count }));
}

export /** A column's filter: tick any number of its values. Nothing ticked shows everything. */
function ColumnFilter({
  label,
  options,
  selected,
  onChange,
  chip,
}: {
  label: string;
  options: Array<{ value: string; count: number }>;
  selected: string[];
  onChange: (values: string[]) => void;
  /** Phones: a chip in the row above the cards, since there are no headers. */
  chip?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const active = selected.length > 0;
  const visible = options.filter((o) => o.value.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  return (
    <>
      {chip ? (
        <Chip
          size="small"
          clickable
          icon={<FilterListRounded />}
          label={active ? `${label} (${selected.length})` : label}
          color={active ? 'primary' : 'default'}
          variant={active ? 'filled' : 'outlined'}
          onClick={(e) => setAnchor(e.currentTarget)}
        />
      ) : (
        <IconButton
          size="small"
          aria-label={`Filter ${label}`}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ p: 0.25, color: active ? 'primary.main' : 'text.disabled', '&:hover': { color: active ? 'primary.main' : 'text.secondary' } }}
        >
          <Badge badgeContent={selected.length} color="primary" invisible={!active} sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 14, minWidth: 14, px: 0.4 } }}>
            <FilterListRounded sx={{ fontSize: 17 }} />
          </Badge>
        </IconButton>
      )}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
          setSearch('');
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 260, p: 1.25 } } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {label}
        </Typography>
        {options.length > 6 && (
          <TextField size="small" fullWidth autoFocus placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 0.75 }} />
        )}
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
          <Button size="small" onClick={() => onChange([...new Set([...selected, ...visible.map((o) => o.value)])])}>
            Select all
          </Button>
          <Button size="small" color="inherit" disabled={!active} onClick={() => onChange([])}>
            Clear
          </Button>
        </Stack>
        <Box sx={{ maxHeight: 300, overflowY: 'auto', mx: -0.5 }}>
          {visible.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
              Nothing matches.
            </Typography>
          )}
          {visible.map((o) => (
            <Stack
              key={o.value}
              component="label"
              direction="row"
              alignItems="center"
              sx={{ px: 0.5, borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            >
              <Checkbox size="small" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} sx={{ p: 0.5 }} />
              <Typography variant="body2" noWrap sx={{ flex: 1, ml: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                {o.value}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1, fontVariantNumeric: 'tabular-nums' }}>
                {o.count}
              </Typography>
            </Stack>
          ))}
        </Box>
      </Popover>
    </>
  );
}

