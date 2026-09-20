import { createTheme } from '@mui/material/styles';
import type { Role, Stage } from '@god/shared';

declare module '@mui/material/styles' {
  interface Palette {
    role: Record<Role, string>;
    stage: Record<Stage, string>;
  }
  interface PaletteOptions {
    role?: Record<Role, string>;
    stage?: Record<Stage, string>;
  }
  interface TypeBackground {
    subtle: string;
  }
}

/**
 * A calm, neutral base with one accent. Colour is reserved for meaning:
 * status dots, role dots and Expert columns.
 */
export const ROLE_COLORS: Record<Role, string> = {
  founder: '#e0913a',
  manager: '#4a8cf0',
  associate: '#3fb68b',
  expert: '#8d6cf0',
};

export const STAGE_COLORS: Record<Stage, string> = {
  scheduling: '#4a8cf0',
  execution: '#e0913a',
  invoicing: '#3fb68b',
  cancelled: '#9aa0a6',
};

/** Distinct, soft hues for per-Expert calendar columns. */
export const EXPERT_SLOT_COLORS = [
  '#6d6af0', '#2ea3b8', '#e0679a', '#6aa84f', '#e0913a', '#9b6cf0', '#35a38a', '#c9a43a', '#e06a5f', '#4a8cf0',
];
export const expertColor = (slot: number) => EXPERT_SLOT_COLORS[slot % EXPERT_SLOT_COLORS.length]!;

const fontFamily = '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#5b5bd6', light: '#8b8bf0', dark: '#4343b8', contrastText: '#fff' },
        secondary: { main: '#71717a' },
        success: { main: '#2f9e6e' },
        warning: { main: '#d9822b' },
        error: { main: '#dc4a4a' },
        info: { main: '#4a8cf0' },
        background: { default: '#f7f7f8', paper: '#ffffff', subtle: '#f2f2f4' },
        text: { primary: '#18181b', secondary: '#71717a', disabled: '#a1a1aa' },
        divider: 'rgba(24, 24, 27, 0.07)',
        action: { hover: 'rgba(24, 24, 27, 0.04)', selected: 'rgba(24, 24, 27, 0.06)' },
        role: ROLE_COLORS,
        stage: STAGE_COLORS,
      },
    },
    dark: {
      palette: {
        primary: { main: '#8b8bf5', light: '#a9a9f8', dark: '#6d6af0', contrastText: '#0f0f11' },
        secondary: { main: '#a1a1aa' },
        success: { main: '#4cc38a' },
        warning: { main: '#f0a44b' },
        error: { main: '#f07070' },
        info: { main: '#6aa6f8' },
        background: { default: '#0f0f11', paper: '#17171a', subtle: '#1e1e22' },
        text: { primary: '#ececef', secondary: '#9d9da6', disabled: '#63636b' },
        divider: 'rgba(236, 236, 239, 0.08)',
        action: { hover: 'rgba(236, 236, 239, 0.05)', selected: 'rgba(236, 236, 239, 0.08)' },
        role: ROLE_COLORS,
        stage: STAGE_COLORS,
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily,
    fontSize: 14,
    h1: { fontWeight: 650, letterSpacing: '-0.02em' },
    h2: { fontWeight: 650, letterSpacing: '-0.02em' },
    h3: { fontWeight: 650, letterSpacing: '-0.02em' },
    h4: { fontWeight: 650, letterSpacing: '-0.02em', fontSize: '1.5rem' },
    h5: { fontWeight: 650, letterSpacing: '-0.01em', fontSize: '1.2rem' },
    h6: { fontWeight: 600, letterSpacing: '-0.005em', fontSize: '1rem' },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    body2: { fontSize: '0.875rem' },
    button: { textTransform: 'none', fontWeight: 550, letterSpacing: 0 },
    overline: { fontWeight: 600, letterSpacing: '0.06em', fontSize: '0.7rem' },
    caption: { fontSize: '0.78rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 9, paddingInline: 14, minHeight: 36 },
        sizeSmall: { paddingInline: 10, minHeight: 30 },
        outlined: ({ theme }) => ({ borderColor: theme.vars?.palette.divider }),
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 9 } } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 14,
          borderColor: theme.vars?.palette.divider,
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
        }),
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500, borderRadius: 999 },
        sizeSmall: { height: 24, fontSize: '0.75rem' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 9,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.vars?.palette.divider },
        }),
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: false },
      styleOverrides: { tooltip: { fontSize: '0.75rem', fontWeight: 500, borderRadius: 7 } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 16 } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({ borderColor: theme.vars?.palette.divider }),
        head: ({ theme }) => ({
          fontWeight: 500,
          fontSize: '0.78rem',
          color: theme.vars?.palette.text.secondary,
        }),
      },
    },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 550, minHeight: 40 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 40 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 550 } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 99 } } },
    MuiSkeleton: { defaultProps: { animation: 'wave' } },
  },
});
