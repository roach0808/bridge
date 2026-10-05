import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DoNotDisturbOnOutlined from '@mui/icons-material/DoNotDisturbOnOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import FilterListRounded from '@mui/icons-material/FilterListRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
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
import { bankLabel, type BankListItem } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { BankCard, BankForm, DeleteBankDialog, PasswordReveal, refreshBanks } from '@/components/BanksDialog';
import { ColumnFilter, columnOptions } from '@/components/ColumnFilter';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { SearchField, TableSurface, useIsPhone } from './adminShared';

const NONE = '—';
const status = (b: BankListItem) => (b.isActive ? 'Active' : 'Deactivated');

interface Column {
  key: string;
  label: string;
  value: (b: BankListItem) => string;
}

/** The columns that filter by ticking values; the rest are found with the search. */
const FILTERS: Column[] = [
  { key: 'profile', label: 'Profile', value: (b) => b.profile.name },
  { key: 'type', label: 'Type', value: (b) => b.bankType },
  { key: 'bank', label: 'Bank name', value: (b) => b.bankName },
  { key: 'status', label: 'Status', value: status },
];

/**
 * The Founder's bank management (§9.1): every bank of every Profile, every
 * field. The password shows only on request, and each reveal is audited.
 */
export default function BanksPage() {
  const phone = useIsPhone();
  const query = useQuery({ queryKey: qk.allBanks, queryFn: api.banks.all });
  const [filters, setFilters] = useState<Record<string, string[]>>({ status: ['Active'] });
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BankListItem | null>(null);
  const [deleting, setDeleting] = useState<BankListItem | null>(null);

  const all = query.data ?? [];
  const term = search.trim().toLowerCase();
  const passes = (b: BankListItem, except?: string) =>
    FILTERS.every((f) => f.key === except || !filters[f.key]?.length || filters[f.key]!.includes(f.value(b))) &&
    (!term ||
      [b.nickname, b.profile.name, b.bankType, b.bankName, b.bankAddress, b.routingNumber, b.accountNumber, b.swiftCode, b.email, b.signInLocation].some((v) =>
        v?.toLowerCase().includes(term),
      ));
  const rows = all.filter((b) => passes(b));
  const filtering = term !== '' || Object.values(filters).some((v) => v.length);

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <Box>
      <PageHeader
        title="Banks"
        subtitle="Every Profile’s bank accounts. Invoices are submitted to a bank by its nickname."
        actions={
          <Button variant="contained" startIcon={<AddRounded />} onClick={() => setAdding(true)}>
            Add bank
          </Button>
        }
      />

      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Search nickname, numbers, email…" />
        {phone &&
          FILTERS.map((f) => (
            <ColumnFilter
              key={f.key}
              chip
              label={f.label}
              options={columnOptions(all, f.value, (b) => passes(b, f.key), filters[f.key])}
              selected={filters[f.key] ?? []}
              onChange={(v) => setFilters((x) => ({ ...x, [f.key]: v }))}
            />
          ))}
        <Typography variant="body2" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
          {filtering ? `${rows.length} of ${all.length} banks` : `${all.length} bank${all.length === 1 ? '' : 's'}`}
        </Typography>
        {filtering && (
          <Button size="small" color="inherit" onClick={() => { setFilters({}); setSearch(''); }}>
            Clear filters
          </Button>
        )}
      </Stack>

      {query.isLoading ? (
        <LoadingRows rows={6} />
      ) : all.length === 0 ? (
        <Card>
          <EmptyState icon={<AccountBalanceOutlined />} title="No banks yet" description="Add the bank accounts each Profile is paid into." />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<FilterListRounded />} title="No banks match" description="Clear a filter to see more." />
        </Card>
      ) : phone ? (
        <Stack spacing={1.25}>
          {rows.map((b) => (
            <Card key={b.id} variant="outlined" sx={{ px: 1.5 }}>
              <Link component={RouterLink} to={`/profiles/${b.profile.id}`} variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1.25 }}>
                {b.profile.name}
              </Link>
              <BankCard bank={b} onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} />
            </Card>
          ))}
        </Stack>
      ) : (
        <TableSurface minWidth={1080}>
          <Table size="small" sx={{ '& th, & td': { px: 1.25, verticalAlign: 'top' }, '& td': { py: 1.25 } }}>
            <TableHead>
              <TableRow>
                {(
                  [
                    ['Nickname'],
                    ['Profile', 'profile'],
                    ['Type', 'type'],
                    ['Bank name', 'bank'],
                    ['Numbers'],
                    ['Login'],
                    ['Status', 'status'],
                  ] as Array<[string, string?]>
                ).map(([label, key]) => {
                  const f = FILTERS.find((x) => x.key === key);
                  return (
                    <TableCell key={label} sx={{ whiteSpace: 'nowrap' }}>
                      <Stack direction="row" alignItems="center" spacing={0.25}>
                        <span>{label}</span>
                        {f && (
                          <ColumnFilter
                            label={f.label}
                            options={columnOptions(all, f.value, (b) => passes(b, f.key), filters[f.key])}
                            selected={filters[f.key] ?? []}
                            onChange={(v) => setFilters((x) => ({ ...x, [f.key]: v }))}
                          />
                        )}
                      </Stack>
                    </TableCell>
                  );
                })}
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((b) => (
                <BankRow key={b.id} bank={b} onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} />
              ))}
            </TableBody>
          </Table>
        </TableSurface>
      )}

      <AddBankDialog open={adding} onClose={() => setAdding(false)} />
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        {editing && (
          <DialogContent sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pb: 1 }}>
              {editing.profile.name}
            </Typography>
            <BankForm profileId={editing.profile.id} bank={editing} onDone={() => setEditing(null)} />
          </DialogContent>
        )}
      </Dialog>
      <DeleteBankDialog bank={deleting} onClose={() => setDeleting(null)} />
    </Box>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

const dash = (
  <Typography component="span" variant="body2" color="text.disabled">
    {NONE}
  </Typography>
);
const unknown = (v: string) => (v === 'Unknown' ? <Typography component="span" variant="body2" color="warning.main">Not entered</Typography> : v);

/** Small labelled lines inside one cell. */
function Pairs({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.25, rowGap: 0.25, alignItems: 'center' }}>
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Box sx={{ typography: 'body2', minWidth: 0, wordBreak: 'break-word', minHeight: 26, display: 'flex', alignItems: 'center' }}>{value}</Box>
        </Box>
      ))}
    </Box>
  );
}

function BankRow({ bank: b, onEdit, onDelete }: { bank: BankListItem; onEdit: () => void; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const setActive = useMutation({
    mutationFn: (isActive: boolean) => api.banks.update(b.id, { isActive }),
    onSuccess: (saved) => {
      refreshBanks(queryClient, b.profileId);
      toast.success(saved.isActive ? 'Bank activated' : 'Bank deactivated');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <TableRow hover sx={{ opacity: b.isActive ? 1 : 0.6 }}>
      <TableCell>
        <Typography variant="body2" fontWeight={600}>
          {bankLabel(b)}
        </Typography>
      </TableCell>
      <TableCell>
        <Link component={RouterLink} to={`/profiles/${b.profile.id}`} underline="hover" color="inherit" variant="body2">
          {b.profile.name}
        </Link>
      </TableCell>
      <TableCell>{unknown(b.bankType)}</TableCell>
      <TableCell>
        <Typography variant="body2">{b.bankName}</Typography>
        {b.bankAddress && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ maxWidth: 220, whiteSpace: 'pre-wrap' }}>
            {b.bankAddress}
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <Pairs
          rows={[
            ['Routing', b.routingNumber === 'Unknown' ? unknown(b.routingNumber) : <Mono>{b.routingNumber}</Mono>],
            ['Account', <Mono key="a">{b.accountNumber}</Mono>],
            ['SWIFT', b.swiftCode ? <Mono>{b.swiftCode}</Mono> : dash],
          ]}
        />
      </TableCell>
      <TableCell sx={{ maxWidth: 280 }}>
        <Pairs
          rows={[
            ['Email', b.email ?? dash],
            ['Password', <PasswordReveal key="p" bank={b} />],
            ['Signed in', b.signInLocation ?? dash],
          ]}
        />
      </TableCell>
      <TableCell>
        <Typography variant="body2" color={b.isActive ? 'success.main' : 'text.secondary'} fontWeight={550}>
          {status(b)}
        </Typography>
      </TableCell>
      <TableCell padding="checkbox" sx={{ whiteSpace: 'nowrap' }}>
        <Stack direction="row">
          <Tooltip title={b.isActive ? 'Deactivate' : 'Activate'}>
            <span>
              <IconButton size="small" disabled={setActive.isPending} onClick={() => setActive.mutate(!b.isActive)} aria-label={b.isActive ? 'Deactivate bank' : 'Activate bank'}>
                {b.isActive ? <DoNotDisturbOnOutlined fontSize="small" /> : <RestartAltRounded fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={onEdit} aria-label="Edit bank">
              <EditOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={onDelete} aria-label="Delete bank">
              <DeleteOutlineRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </TableCell>
    </TableRow>
  );
}

/** Adding a bank from this page starts with whose bank it is. */
function AddBankDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profiles = useQuery({ queryKey: qk.profiles.list({}), queryFn: () => api.profiles.list(), enabled: open });
  const [profileId, setProfileId] = useState<string | null>(null);
  const options = useMemo(() => (profiles.data ?? []).filter((p) => p.isActive), [profiles.data]);
  const close = () => {
    setProfileId(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Add bank</DialogTitle>
      <DialogContent>
        <Autocomplete
          options={options}
          loading={profiles.isLoading}
          getOptionLabel={(p) => p.name}
          value={options.find((p) => p.id === profileId) ?? null}
          onChange={(_, p) => setProfileId(p?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Profile" required autoFocus sx={{ mt: 1 }} />}
          sx={{ mb: 2 }}
        />
        {profileId && <BankForm key={profileId} profileId={profileId} bank={null} onDone={close} />}
      </DialogContent>
    </Dialog>
  );
}
