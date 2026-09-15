import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useRef, useState, type DragEvent } from 'react';
import { errorMessage } from '@/lib/errors';
import { resizeImageFile } from '@/lib/image';
import { UserAvatar } from './identity';
import { useToast } from './ToastProvider';

/**
 * Current picture plus "Upload" / "Remove". Accepts a click or a dropped file;
 * the image is cropped and shrunk in the browser before it is sent.
 */
export function PhotoUpload({
  avatarId,
  photoId,
  label,
  size = 72,
  onUpload,
  onRemove,
  previewUrl,
  hint = 'JPEG, PNG or WebP. We crop it to a square.',
}: {
  avatarId: string | null | undefined;
  photoId: string | null | undefined;
  label: string;
  size?: number;
  onUpload: (dataUrl: string) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  /** Shows an unsaved picture instead of the stored one. */
  previewUrl?: string | null;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await task();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => onUpload(await resizeImageFile(file)), 'Photo updated');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && input.current?.click()}
        sx={{
          position: 'relative',
          borderRadius: '50%',
          cursor: busy ? 'default' : 'pointer',
          outline: '2px dashed',
          outlineOffset: 3,
          outlineColor: dragging ? 'primary.main' : 'transparent',
          transition: 'outline-color .15s',
        }}
      >
        <UserAvatar avatarId={avatarId} photoId={photoId} label={label} size={size} src={previewUrl ?? undefined} />
        {busy && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', bgcolor: 'rgba(0,0,0,.35)' }}>
            <CircularProgress size={22} sx={{ color: '#fff' }} />
          </Box>
        )}
      </Box>
      <Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" color="inherit" startIcon={<CloudUploadOutlined />} disabled={busy} onClick={() => input.current?.click()}>
            Upload photo
          </Button>
          {(photoId || previewUrl) && onRemove && (
            <Button size="small" color="inherit" disabled={busy} onClick={() => void run(onRemove, 'Photo removed')}>
              Remove
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
          {hint}
        </Typography>
      </Box>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Stack>
  );
}
