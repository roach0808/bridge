import { Box } from '@mui/material';
import { BRAND, Lockup, MARK_RATIO, Monogram } from './brand';

/**
 * Silver Horizon's logo in the app: `full` is the SH mark beside the name, for
 * the sidebar; `mark` is the SH mark alone, for the phone's top bar. Navy on the
 * light theme, silver with its sunlit arc on the dark one, where navy would vanish.
 * `height` is the mark's height.
 */
export function BrandLogo({ height = 26, variant = 'full' }: { height?: number; variant?: 'full' | 'mark' }) {
  const markWidth = Math.round(height * MARK_RATIO);
  const both = (onDark: boolean) =>
    variant === 'mark' ? (
      <Monogram width={markWidth} onDark={onDark} title="Silver Horizon" />
    ) : (
      // Sized to sit inside the 240px sidebar.
      <Lockup onDark={onDark} markWidth={markWidth} textSize={Math.max(10, Math.round(height * 0.4 * 10) / 10)} gap={1} />
    );
  return (
    <>
      <Box sx={(t) => ({ display: 'block', ...t.applyStyles('dark', { display: 'none' }) })}>{both(false)}</Box>
      <Box sx={(t) => ({ display: 'none', color: BRAND.silver, ...t.applyStyles('dark', { display: 'block' }) })}>{both(true)}</Box>
    </>
  );
}
