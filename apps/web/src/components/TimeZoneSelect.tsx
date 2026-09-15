import { Autocomplete, TextField } from '@mui/material';
import { COMMON_TIME_ZONES } from '@god/shared';
import { DateTime } from 'luxon';
import { useMemo } from 'react';

function allZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.('timeZone') ?? [...COMMON_TIME_ZONES];
  return [...new Set([...COMMON_TIME_ZONES, ...zones])];
}

export const zoneOptionLabel = (zone: string) => {
  const now = DateTime.now().setZone(zone);
  return `${zone.replace(/_/g, ' ')} (${now.toFormat('ZZZZ')}, UTC${now.toFormat('ZZ')})`;
};

export function TimeZoneSelect({
  value,
  onChange,
  label = 'Time zone',
  helperText,
  disabled,
}: {
  value: string | null;
  onChange: (zone: string | null) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
}) {
  const options = useMemo(allZones, []);
  return (
    <Autocomplete
      options={options}
      value={value}
      disabled={disabled}
      onChange={(_, v) => onChange(v)}
      getOptionLabel={zoneOptionLabel}
      renderInput={(params) => <TextField {...params} label={label} helperText={helperText} />}
      autoHighlight
    />
  );
}
