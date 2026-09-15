import AddRounded from '@mui/icons-material/AddRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import HubRounded from '@mui/icons-material/HubRounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import {
  Box,
  Button,
  Card,
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { isApiError } from '@/lib/errors';
import { platformSchema, type PlatformDTO } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatDate } from '@/lib/time';
import {
  FormDialog,
  SearchField,
  TableSurface,
  countryName,
  flagEmoji,
  issuesToErrors,
  splitServerError,
  useIsPhone,
  SR_ONLY,
  type FieldErrors,
} from './adminShared';

/** Priority as a quiet rank number. */
function RankBadge({ priority }: { priority: number }) {
  return (
    <Tooltip title={`Priority ${priority} — lower numbers are offered first`}>
      <Box
        component="span"
        sx={{
          minWidth: 34,
          display: 'inline-block',
          fontSize: 13,
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          color: 'text.secondary',
        }}
      >
        #{priority}
      </Box>
    </Tooltip>
  );
}

function Country({ code }: { code: string }) {
  const name = countryName(code);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box component="span" aria-hidden sx={{ fontSize: 18, lineHeight: 1 }}>
        {flagEmoji(code)}
      </Box>
      <Typography variant="body2" noWrap>
        {name ?? code}
      </Typography>
    </Stack>
  );
}

/** Platform links are not shown to anyone; the URL is only kept in the edit form. */
function PlatformLink({ platform }: { platform: PlatformDTO }) {
  return (
    <Typography variant="body2" fontWeight={550} noWrap>
      {platform.name}
    </Typography>
  );
}

export default function PlatformsPage() {
  const { zone } = useAuth();
  const phone = useIsPhone();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PlatformDTO | 'new' | null>(null);

  const query = useQuery({ queryKey: qk.platforms, queryFn: api.platforms.list });

  const platforms = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...(query.data ?? [])]
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          p.country.toLowerCase() === term ||
          (countryName(p.country)?.toLowerCase().includes(term) ?? false),
      );
  }, [query.data, search]);

  const nextPriority = useMemo(
    () => (query.data?.length ? Math.min(1000, Math.max(...query.data.map((p) => p.priority)) + 1) : 1),
    [query.data],
  );

  return (
    <Box>
      <PageHeader
        title="Platforms"
        subtitle="Expert networks, in priority order."
        actions={
          <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing('new')}>
            Add platform
          </Button>
        }
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Search name, URL or country" />
        {query.data && (
          <Typography variant="body2" color="text.secondary">
            {query.data.length} platform{query.data.length === 1 ? '' : 's'}
          </Typography>
        )}
      </Stack>

      {query.isLoading ? (
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2 }}>
          <Stack spacing={1.5}>
            {Array.from({ length: 5 }, (_, i) => (
              <Stack key={i} direction="row" spacing={2} alignItems="center">
                <Skeleton variant="rounded" width={34} height={26} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton width="40%" />
                  <Skeleton width="25%" height={16} />
                </Box>
                <Skeleton width={80} />
              </Stack>
            ))}
          </Stack>
        </Paper>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : platforms.length === 0 ? (
        <Card>
          {search ? (
            <EmptyState
              icon={<SearchOffRounded />}
              title="No platforms match your search"
              action={
                <Button size="small" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<HubRounded />}
              title="No platforms yet"
              description="Add the expert networks your team books calls through."
              action={
                <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing('new')}>
                  Add platform
                </Button>
              }
            />
          )}
        </Card>
      ) : phone ? (
        <Stack spacing={1.25}>
          {platforms.map((p) => (
            <Paper key={p.id} variant="outlined" sx={{ p: 2, borderRadius: '14px' }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <RankBadge priority={p.priority} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <PlatformLink platform={p} />
                </Box>
                <IconButton aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                  <EditRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                </IconButton>
              </Stack>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1, pl: '46px' }}>
                <Country code={p.country} />
                <Typography variant="caption" color="text.secondary">
                  Added {formatDate(p.createdAt, zone)}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : (
        <TableSurface minWidth={680}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell width={90}>Priority</TableCell>
                <TableCell>Platform</TableCell>
                <TableCell>Country</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right" width={72}>
                  <Box component="span" sx={SR_ONLY}>
                    Actions
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {platforms.map((p) => (
                <TableRow key={p.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                  <TableCell>
                    <RankBadge priority={p.priority} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>
                    <PlatformLink platform={p} />
                  </TableCell>
                  <TableCell>
                    <Country code={p.country} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {formatDate(p.createdAt, zone)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                        <EditRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableSurface>
      )}

      <PlatformDialog
        open={editing !== null}
        platform={editing === 'new' ? null : editing}
        defaultPriority={nextPriority}
        onClose={() => setEditing(null)}
      />
    </Box>
  );
}

interface PlatformForm {
  name: string;
  url: string;
  priority: string;
  country: string;
}

const PLATFORM_FIELDS = ['name', 'url', 'priority', 'country'];

function PlatformDialog({
  open,
  platform,
  defaultPriority,
  onClose,
}: {
  open: boolean;
  platform: PlatformDTO | null;
  defaultPriority: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<PlatformForm>({ name: '', url: 'https://', priority: '1', country: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      platform
        ? { name: platform.name, url: platform.url, priority: String(platform.priority), country: platform.country }
        : { name: '', url: 'https://', priority: String(defaultPriority), country: '' },
    );
    setErrors({});
    setGeneral(null);
    // Only reset when the dialog opens or switches target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, platform]);

  const mutation = useMutation({
    mutationFn: (body: { name: string; url: string; priority: number; country: string }) =>
      platform ? api.platforms.update(platform.id, body) : api.platforms.create(body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.platforms });
      toast.success(platform ? `Saved ${saved.name}` : `Added ${saved.name}`);
      onClose();
    },
    onError: (err) => {
      if (isApiError(err) && err.status === 409) {
        setErrors({ name: 'A platform with this name already exists' });
        setGeneral(null);
        return;
      }
      const { fields, general } = splitServerError(err, PLATFORM_FIELDS);
      setErrors(fields);
      setGeneral(general);
    },
  });

  const set = (key: keyof PlatformForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const submit = () => {
    const result = platformSchema.safeParse(form);
    const errs = issuesToErrors(result);
    if (errs.priority) errs.priority = 'Use a whole number from 0 to 1000';
    setErrors(errs);
    setGeneral(null);
    if (result.success) mutation.mutate(result.data);
  };

  const flag = /^[A-Z]{2}$/.test(form.country) ? flagEmoji(form.country) : null;
  const name = countryName(form.country);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={platform ? 'Edit platform' : 'Add platform'}
      subtitle={platform?.name}
      submitLabel={platform ? 'Save changes' : 'Add platform'}
      pending={mutation.isPending}
      onSubmit={submit}
      error={general}
      maxWidth="xs"
    >
      <TextField
        label="Name"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        error={Boolean(errors.name)}
        helperText={errors.name}
        required
        autoFocus
        autoComplete="off"
      />
      <TextField
        label="URL"
        type="url"
        value={form.url}
        onChange={(e) => set('url', e.target.value)}
        error={Boolean(errors.url)}
        helperText={errors.url}
        required
        autoComplete="off"
      />
      <Stack direction="row" spacing={2}>
        <TextField
          label="Priority"
          type="number"
          value={form.priority}
          onChange={(e) => set('priority', e.target.value)}
          error={Boolean(errors.priority)}
          helperText={errors.priority ?? 'Lower = higher priority'}
          required
          slotProps={{ htmlInput: { min: 0, max: 1000, step: 1, inputMode: 'numeric' } }}
        />
        <TextField
          label="Country"
          value={form.country}
          onChange={(e) => set('country', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))}
          error={Boolean(errors.country)}
          helperText={errors.country ?? name ?? '2-letter code, e.g. US'}
          required
          autoComplete="off"
          slotProps={{
            htmlInput: { maxLength: 2, style: { textTransform: 'uppercase', letterSpacing: '0.1em' } },
            input: {
              startAdornment: flag ? (
                <InputAdornment position="start">
                  <span aria-hidden style={{ fontSize: 18 }}>
                    {flag}
                  </span>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
      </Stack>
    </FormDialog>
  );
}
