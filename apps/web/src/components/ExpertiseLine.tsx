import { Typography, type TypographyProps } from '@mui/material';

/** A Profile's niche field, as one labelled line. Nothing when it has none yet. */
export function ExpertiseLine({ expertise, sx }: { expertise: string | undefined; sx?: TypographyProps['sx'] }) {
  if (!expertise) return null;
  return (
    <Typography variant="body2" sx={sx}>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ fontWeight: 600, mr: 0.75, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Expertise
      </Typography>
      {expertise}
    </Typography>
  );
}
