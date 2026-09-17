import AddReactionOutlined from '@mui/icons-material/AddReactionOutlined';
import BrokenImageOutlined from '@mui/icons-material/BrokenImageOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { Box, ButtonBase, CircularProgress, Dialog, IconButton, Popover, Skeleton, Stack, Tooltip, useColorScheme } from '@mui/material';
import { QUICK_REACTIONS, type ChatMessageDTO, type ConversationDTO } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { replaceChatMessage } from '@/realtime/RealtimeProvider';

// The picker and its emoji data only load the first time someone opens it.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

/** A searchable emoji picker in a popover; "recently used" comes first. */
export function EmojiPickerPopover({
  anchor,
  onClose,
  onPick,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === 'system' ? systemMode : mode) === 'dark';
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { borderRadius: 2, overflow: 'hidden' } } }}
    >
      <Suspense
        fallback={
          <Stack alignItems="center" justifyContent="center" sx={{ width: 320, height: 380 }}>
            <CircularProgress size={22} />
          </Stack>
        }
      >
        <EmojiPicker
          onEmojiClick={(e) => onPick(e.emoji)}
          theme={(dark ? 'dark' : 'light') as never}
          emojiStyle={'native' as never}
          lazyLoadEmojis
          previewConfig={{ showPreview: false }}
          width={320}
          height={380}
        />
      </Suspense>
    </Popover>
  );
}

/** Loads a chat picture with the caller's token and shows it as an object URL. */
function useChatImageUrl(imageId: string) {
  const query = useQuery({
    queryKey: ['chat', 'image', imageId],
    queryFn: () => api.chat.image(imageId),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const next = URL.createObjectURL(query.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [query.data]);
  return { url, isError: query.isError };
}

/** A picture in a chat bubble, sized before it loads so the thread does not jump; click to enlarge. */
export function ChatImage({ image }: { image: NonNullable<ChatMessageDTO['image']> }) {
  const { url, isError } = useChatImageUrl(image.id);
  const [open, setOpen] = useState(false);
  const maxW = 280;
  const maxH = 320;
  const scale = Math.min(1, maxW / image.width, maxH / image.height);
  const width = Math.max(80, Math.round(image.width * scale));
  const height = Math.max(60, Math.round(image.height * scale));

  return (
    <>
      <ButtonBase
        onClick={() => url && setOpen(true)}
        aria-label="Open picture"
        sx={{ display: 'block', width, maxWidth: '100%', aspectRatio: `${width} / ${height}`, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover' }}
      >
        {isError ? (
          <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', color: 'text.secondary' }}>
            <BrokenImageOutlined />
          </Stack>
        ) : url ? (
          <Box component="img" src={url} alt="Picture" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Skeleton variant="rectangular" sx={{ width: '100%', height: '100%' }} />
        )}
      </ButtonBase>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth={false} slotProps={{ paper: { sx: { bgcolor: 'transparent', boxShadow: 'none', m: 1 } } }}>
        <IconButton
          onClick={() => setOpen(false)}
          aria-label="Close picture"
          sx={{ position: 'fixed', top: 12, right: 12, bgcolor: 'rgba(0,0,0,.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,.75)' } }}
        >
          <CloseRounded />
        </IconButton>
        {url && (
          <Box
            component="img"
            src={url}
            alt="Picture"
            onClick={() => setOpen(false)}
            sx={{ display: 'block', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)', objectFit: 'contain', borderRadius: 1 }}
          />
        )}
      </Dialog>
    </>
  );
}

/** Toggles the caller's reaction and updates the thread right away. */
export function useReact(message: ChatMessageDTO) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (emoji: string) => api.chat.react(message.id, emoji),
    onSuccess: (saved) => replaceChatMessage(queryClient, saved),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Reactions under a message: each emoji with its count; yours are highlighted and click to undo. */
export function ReactionChips({ message, conversation, align }: { message: ChatMessageDTO; conversation: ConversationDTO; align: 'left' | 'right' }) {
  const me = useMe();
  const react = useReact(message);
  if (!message.reactions.length) return null;
  const name = (id: string) => (id === me.id ? 'You' : id === conversation.other.id ? conversation.other.nickname : 'Someone');
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" justifyContent={align === 'right' ? 'flex-end' : 'flex-start'} sx={{ mt: 0.4, mx: 0.5 }}>
      {message.reactions.map((r) => {
        const mine = r.userIds.includes(me.id);
        return (
          <Tooltip key={r.emoji} title={r.userIds.map(name).join(', ')}>
            <ButtonBase
              onClick={() => conversation.canSend && react.mutate(r.emoji)}
              disabled={react.isPending || !conversation.canSend}
              aria-pressed={mine}
              aria-label={`${r.emoji} ${r.userIds.length}`}
              sx={{
                px: 0.75,
                height: 24,
                borderRadius: 99,
                fontSize: 13,
                gap: 0.4,
                border: 1,
                borderColor: mine ? 'primary.main' : 'divider',
                bgcolor: mine ? 'action.selected' : 'background.paper',
              }}
            >
              <span>{r.emoji}</span>
              {r.userIds.length > 1 && <Box component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>{r.userIds.length}</Box>}
            </ButtonBase>
          </Tooltip>
        );
      })}
    </Stack>
  );
}

/** A small hover bar with the quick reactions and "more…" (the full picker). */
export function QuickReactionBar({ message, onMore }: { message: ChatMessageDTO; onMore: (anchor: HTMLElement) => void }) {
  const react = useReact(message);
  return (
    <Stack
      direction="row"
      className="msg-actions"
      sx={{
        opacity: { xs: 0, md: 0 },
        pointerEvents: 'none',
        transition: 'opacity .15s',
        alignSelf: 'center',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 99,
        px: 0.25,
        display: { xs: 'none', md: 'flex' },
      }}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <ButtonBase
          key={emoji}
          onClick={() => react.mutate(emoji)}
          disabled={react.isPending}
          aria-label={`React ${emoji}`}
          sx={{ width: 28, height: 28, borderRadius: 99, fontSize: 16, '&:hover': { bgcolor: 'action.hover' } }}
        >
          {emoji}
        </ButtonBase>
      ))}
      <Tooltip title="More reactions">
        <IconButton size="small" onClick={(e) => onMore(e.currentTarget)} aria-label="More reactions" sx={{ width: 28, height: 28 }}>
          <AddReactionOutlined sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

/** Invalidates the chat list after a message changes (its preview may be the deleted one). */
export function useRefreshChatList() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
}
