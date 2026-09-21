import { Box } from '@mui/material';

/**
 * Silver Horizon's logo. `full` is the mark with the name (a light version
 * in dark mode, where the navy lettering would disappear); `mark` is the S alone.
 */
export function BrandLogo({ height = 32, variant = 'full' }: { height?: number; variant?: 'full' | 'mark' }) {
  if (variant === 'mark') {
    return <Box component="img" src="/brand/mark.png" alt="Silver Horizon" sx={{ height, width: 'auto', display: 'block' }} />;
  }
  return (
    <>
      <Box
        component="img"
        src="/brand/logo.png"
        alt="Silver Horizon"
        sx={(t) => ({ height, width: 'auto', display: 'block', ...t.applyStyles('dark', { display: 'none' }) })}
      />
      <Box
        component="img"
        src="/brand/logo-dark.png"
        alt="Silver Horizon"
        sx={(t) => ({ height, width: 'auto', display: 'none', ...t.applyStyles('dark', { display: 'block' }) })}
      />
    </>
  );
}
