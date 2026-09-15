import AutorenewRounded from '@mui/icons-material/AutorenewRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  type Breakpoint,
  type TextFieldProps,
} from '@mui/material';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, fieldErrors } from '@/lib/errors';

// --- Hooks ------------------------------------------------------------------

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** True below the `sm` breakpoint — tables switch to stacked cards. */
export function useIsPhone(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'));
}

/** Re-renders every `intervalMs` so "local time" previews stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// --- Validation helpers -----------------------------------------------------

export type FieldErrors = Record<string, string>;

interface SafeParseLike {
  success: boolean;
  error?: { issues: Array<{ path: Array<string | number>; message: string }> };
}

/** First message per field path from a zod `safeParse` result. */
export function issuesToErrors(result: SafeParseLike): FieldErrors {
  if (result.success || !result.error) return {};
  const out: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * Server errors split into per-field messages and a general message for
 * whatever could not be attached to a field.
 */
export function splitServerError(err: unknown, knownFields: string[]): { fields: FieldErrors; general: string | null } {
  const fields = fieldErrors(err);
  const attached = Object.keys(fields).some((k) => knownFields.includes(k));
  return { fields, general: attached ? null : errorMessage(err) };
}

/** Translucent theme colour that follows the active colour scheme. */
export const tint = (channel: string, opacity: number) => `rgba(${channel} / ${opacity})`;

// --- Misc -------------------------------------------------------------------

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_SYMBOLS = '!@#$%*?';

/** A 16-character password with letters, digits and a symbol, from `crypto`. */
export function generatePassword(length = 16): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]!);
  const extra = new Uint32Array(3);
  crypto.getRandomValues(extra);
  // Guarantee at least one digit and one symbol at random positions.
  chars[extra[0]! % length] = String(2 + (extra[1]! % 8));
  chars[(extra[0]! + 1 + (extra[2]! % (length - 1))) % length] = PASSWORD_SYMBOLS[extra[1]! % PASSWORD_SYMBOLS.length]!;
  return chars.join('');
}

/** "US" → 🇺🇸 via regional indicator symbols. */
export function flagEmoji(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '🏳️';
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

let regionNames: Intl.DisplayNames | null | undefined;
export function countryName(code: string): string | null {
  if (!/^[A-Z]{2}$/i.test(code)) return null;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    const name = regionNames?.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i]!) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/** Visually hidden but announced; not absolutely positioned, so it never escapes scroll containers. */
export const SR_ONLY = {
  display: 'inline-block',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

// --- Components -------------------------------------------------------------

export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  sx,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  sx?: TextFieldProps['sx'];
}) {
  return (
    <TextField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type="search"
      sx={{ maxWidth: { sm: 320 }, ...sx }}
      slotProps={{
        htmlInput: { 'aria-label': placeholder },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchRounded fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" aria-label="Clear search" onClick={() => onChange('')} edge="end">
                <CloseRounded fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}

/** Quiet segmented filter with counts; keyboard accessible (they are buttons). */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string; count?: number; color?: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Chip
            key={o.value}
            clickable
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            label={
              <Stack direction="row" spacing={0.75} alignItems="center">
                {o.color && <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: o.color, flexShrink: 0 }} />}
                <span>{o.label}</span>
                {o.count !== undefined && (
                  <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                    {o.count}
                  </Box>
                )}
              </Stack>
            }
            sx={{
              height: 30,
              px: 0.25,
              bgcolor: selected ? 'action.selected' : 'transparent',
              color: selected ? 'text.primary' : 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' },
              ...(selected ? { '&&:hover': { bgcolor: 'action.selected' } } : {}),
            }}
          />
        );
      })}
    </Stack>
  );
}

/** A modal form: Enter submits, fullscreen on phones, locked while pending. */
export function FormDialog({
  open,
  onClose,
  title,
  subtitle,
  submitLabel = 'Save',
  pending,
  onSubmit,
  error,
  children,
  maxWidth = 'sm',
  submitDisabled,
  secondaryAction,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  submitLabel?: ReactNode;
  pending?: boolean;
  onSubmit: () => void;
  error?: string | null;
  children: ReactNode;
  maxWidth?: Breakpoint;
  submitDisabled?: boolean;
  secondaryAction?: ReactNode;
}) {
  const phone = useIsPhone();
  const formRef = useRef<HTMLFormElement>(null);
  // `autoFocus` fires while the Fade is still `visibility: hidden`, so the focus
  // trap falls back to the paper. Move focus to the first field once visible.
  const focusFirstField = () => {
    const form = formRef.current;
    if (!form || (document.activeElement instanceof HTMLElement && form.contains(document.activeElement) && document.activeElement.matches('input, textarea'))) return;
    form.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]):not([aria-hidden=true]), textarea:not([disabled]):not([aria-hidden=true])')?.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending && !submitDisabled) onSubmit();
  };
  return (
    <Dialog
      open={open}
      onClose={pending ? undefined : onClose}
      maxWidth={maxWidth}
      fullWidth
      fullScreen={phone}
      slotProps={{ transition: { onEntered: focusFirstField } }}
    >
      <Box
        component="form"
        ref={formRef}
        noValidate
        onSubmit={submit}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'hidden' }}
      >
        <DialogTitle component="div" sx={{ pr: 7, pt: 2.5, pb: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h2">
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton
            aria-label="Close"
            size="small"
            onClick={onClose}
            disabled={pending}
            sx={{ position: 'absolute', right: 14, top: 16, color: 'text.secondary' }}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          {children}
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pt: 1, pb: 2.5, gap: 1 }}>
          {secondaryAction}
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose} disabled={pending} color="inherit">
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={pending || submitDisabled} sx={{ minWidth: 96 }}>
            {pending ? <CircularProgress size={18} color="inherit" /> : submitLabel}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Password input with show/hide, and optionally generate + copy. */
export function PasswordField({
  value,
  onChange,
  label = 'Password',
  error,
  helperText,
  generate,
  autoComplete = 'new-password',
  autoFocus,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  helperText?: string;
  generate?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  name?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <TextField
      label={label}
      name={name}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      type={visible ? 'text' : 'password'}
      error={Boolean(error)}
      helperText={error ?? helperText}
      autoComplete={autoComplete}
      required
      slotProps={{
        htmlInput: { spellCheck: false, style: visible ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : undefined },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Stack direction="row" spacing={0.25}>
                {generate && value && (
                  <Tooltip title={copied ? 'Copied' : 'Copy'}>
                    <IconButton
                      size="small"
                      aria-label="Copy password"
                      onClick={async () => setCopied(await copyToClipboard(value))}
                    >
                      {copied ? <CheckRounded fontSize="small" color="success" /> : <ContentCopyRounded fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                )}
                {generate && (
                  <Tooltip title="Generate a strong password">
                    <IconButton
                      size="small"
                      aria-label="Generate password"
                      onClick={() => {
                        onChange(generatePassword());
                        setVisible(true);
                      }}
                    >
                      <AutorenewRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={visible ? 'Hide' : 'Show'}>
                  <IconButton size="small" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((v) => !v)} edge="end">
                    {visible ? <VisibilityOffRounded fontSize="small" /> : <VisibilityRounded fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Stack>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** Label above an arbitrary control (e.g. the avatar picker). */
export function FormSection({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" component="div">
          {label}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Stack>
      {children}
      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 0.75, display: 'block' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

/** Rounded outlined surface for tables; scrolls horizontally when narrow. */
export function TableSurface({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)' }}>
      <Box sx={{ overflowX: 'auto', '& table': { minWidth } }}>{children}</Box>
    </Paper>
  );
}

/** Small metric tile: quiet label (with an optional colour dot), big number. */
export function StatTile({
  label,
  value,
  color,
  footer,
  selected,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Accepted for compatibility; tiles no longer show icons. */
  icon?: ReactNode;
  color?: string;
  footer?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <Paper
      variant="outlined"
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      aria-pressed={onClick ? Boolean(selected) : undefined}
      sx={(t) => ({
        p: 2,
        width: '100%',
        height: '100%',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        borderRadius: '14px',
        cursor: onClick ? 'pointer' : 'default',
        borderColor: selected ? `rgba(${t.vars!.palette.primary.mainChannel} / 0.55)` : 'divider',
        bgcolor: 'background.paper',
        boxShadow: selected ? `0 0 0 1px rgba(${t.vars!.palette.primary.mainChannel} / 0.55)` : '0 1px 2px rgba(0, 0, 0, 0.03)',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        '&:hover': onClick && !selected ? { borderColor: `rgba(${t.vars!.palette.text.primaryChannel} / 0.18)` } : undefined,
        '&:focus-visible': { outline: `2px solid ${t.vars!.palette.primary.main}`, outlineOffset: 2 },
      })}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
        {color && <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />}
        <Typography variant="body2" color="text.secondary" fontWeight={500}>
          {label}
        </Typography>
      </Stack>
      <Typography variant="h5" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {footer && <Box sx={{ mt: 0.5 }}>{footer}</Box>}
    </Paper>
  );
}

/** Subtle one-line hint with an icon. */
export function Hint({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary' }}>
      {icon}
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Stack>
  );
}
