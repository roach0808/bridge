import { Autocomplete, Box, Checkbox, TextField, Typography } from '@mui/material';
import { useRef, type ReactNode } from 'react';

export interface FilterOption {
  id: string;
  label: string;
  /** A second, quieter line: a time zone, how many calls in view. */
  detail?: string;
  /** A colour dot (an Expert's column colour). */
  color?: string;
}

/** The pseudo-option that ticks every value at once. */
const ALL = '__all';

/**
 * A calendar filter: tick any number of values. Nothing ticked means no
 * filter, and the field shows `emptyText`. With `allLabel`, the first row
 * ticks or unticks every value.
 */
export function CalendarFilter({
  label,
  options,
  selected,
  onChange,
  emptyText,
  allLabel,
  loading,
  width = 210,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyText: string;
  allLabel?: string;
  loading?: boolean;
  width?: number;
}) {
  // The URL catches up a moment after a tick; a second quick tick builds on the first, not on the old URL.
  const key = selected.join(',');
  const latest = useRef({ selected, sent: key });
  if (key !== latest.current.sent) latest.current = { selected, sent: key };
  const change = (ids: string[]) => {
    latest.current.selected = ids;
    onChange(ids);
  };
  const current = latest.current.selected;

  const byId = new Map(options.map((o) => [o.id, o]));
  const value = selected.map((id) => byId.get(id) ?? { id, label: 'Not in this range' });
  const everything = options.length > 0 && options.every((o) => selected.includes(o.id));
  const list = allLabel ? [{ id: ALL, label: allLabel }, ...options] : options;

  return (
    <Autocomplete<FilterOption, true, false, false>
      multiple
      size="small"
      disableCloseOnSelect
      options={list}
      value={value}
      loading={loading}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(o) => o.label}
      onChange={(_, _next, reason, details) => {
        const id = details?.option.id;
        if (reason === 'clear') change([]);
        else if (id === ALL) change(everything ? [] : options.map((o) => o.id));
        else if (id) change(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
      }}
      renderOption={({ key, ...props }, o, { selected: ticked }) => (
        <Box component="li" key={key} {...props} sx={{ gap: 0.75, py: '2px !important' }}>
          <Checkbox size="small" checked={o.id === ALL ? everything : ticked} sx={{ p: 0.5, ml: -0.5 }} />
          {o.color && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: o.color, flexShrink: 0 }} />}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={o.id === ALL ? 600 : 400} noWrap>
              {o.label}
            </Typography>
            {o.detail && (
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {o.detail}
              </Typography>
            )}
          </Box>
        </Box>
      )}
      // One line whatever is ticked: the first value, then how many more.
      renderValue={(items): ReactNode =>
        items.length === 0 ? null : (
          <Typography variant="body2" noWrap sx={{ pl: 0.75, maxWidth: width - 70 }}>
            {everything && allLabel ? allLabel : items[0]!.label}
            {!(everything && allLabel) && items.length > 1 && (
              <Typography component="span" variant="body2" color="text.secondary">
                {' '}+{items.length - 1}
              </Typography>
            )}
          </Typography>
        )
      }
      renderInput={(p) => <TextField {...p} label={label} placeholder={selected.length ? undefined : emptyText} slotProps={{ inputLabel: { shrink: true } }} />}
      slotProps={{ listbox: { sx: { maxHeight: 360 } } }}
      sx={{ width: { xs: '100%', sm: width }, '& .MuiAutocomplete-inputRoot': { flexWrap: 'nowrap' } }}
    />
  );
}
