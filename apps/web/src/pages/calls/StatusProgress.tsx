import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { STAGE_LABELS, STATUS_LABELS, STATUS_STAGE, TRACK_STAGES, stagesForRole, type CallStatus, type Role } from '@god/shared';
import { STATUS_COLORS } from '@/components/StatusChip';

/** The happy path; `on_rescheduling` is shown as a detour on `scheduled`. */
const TRACK: CallStatus[] = ['on_scheduling', 'scheduled', 'confirmed', 'ongoing', 'finished', 'invoice_submit', 'invoice_approve', 'process_to_bank'];

/** Experts don't see the invoicing stage (their calls end at Finished). */
export function StatusProgress({ status, role }: { status: CallStatus; role: Role }) {
  const position = TRACK.indexOf(status === 'on_rescheduling' ? 'scheduled' : status);
  // A cancelled call left the track: the bar would say nothing true about it.
  if (status === 'cancelled') {
    return (
      <Typography variant="body2" color="text.secondary">
        This call was cancelled — it never took place and earns nothing.
      </Typography>
    );
  }
  return (
    <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
      <Stack direction="row" sx={{ minWidth: 640 }}>
        {stagesForRole(role)
          .filter((stage) => TRACK_STAGES.includes(stage))
          .map((stage) => {
          const steps = TRACK.filter((s) => STATUS_STAGE[s] === stage);
          return (
            <Box key={stage} sx={{ flex: steps.length, px: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, pl: 0.25 }}>
                {STAGE_LABELS[stage]}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                {steps.map((s) => {
                  const i = TRACK.indexOf(s);
                  const done = i < position;
                  const current = i === position;
                  const detour = current && status === 'on_rescheduling';
                  const c = detour ? STATUS_COLORS.on_rescheduling : STATUS_COLORS[s];
                  return (
                    <Tooltip key={s} title={detour ? 'Being rescheduled' : STATUS_LABELS[s]}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                          sx={(t) => ({
                            height: 4,
                            borderRadius: 99,
                            bgcolor: current ? c : done ? `rgba(${t.vars!.palette.text.primaryChannel} / 0.28)` : 'action.selected',
                          })}
                        />
                        <Typography
                          variant="caption"
                          noWrap
                          component="div"
                          sx={{ mt: 0.75, pl: 0.25, fontWeight: current ? 600 : 400, color: current ? 'text.primary' : done ? 'text.secondary' : 'text.disabled' }}
                        >
                          {detour ? STATUS_LABELS.on_rescheduling : STATUS_LABELS[s]}
                        </Typography>
                      </Box>
                    </Tooltip>
                  );
                })}
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
