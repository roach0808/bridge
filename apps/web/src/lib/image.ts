import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_SIDE, PHOTO_MAX_BYTES } from '@god/shared';

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image'));
    };
    img.src = url;
  });
}

const dataUrlBytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/**
 * Centre-crops an image to a square and scales it down, so uploads stay tiny
 * (typically 15–40 KB) and the database does not grow.
 */
export async function resizeImageFile(file: File, size = 320): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPEG, PNG or WebP)');
  if (file.size > 20 * 1024 * 1024) throw new Error('That image is larger than 20 MB');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const target = Math.min(size, side);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot resize images');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, target, target);

  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    let dataUrl = canvas.toDataURL('image/webp', quality);
    // Browsers without WebP encoding fall back to PNG; use JPEG instead.
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(dataUrl) <= PHOTO_MAX_BYTES) return dataUrl;
  }
  throw new Error('That image is too detailed to upload; try another one');
}

/**
 * Shrinks a picture for chat: at most 1600 px on its longest side, re-encoded as WebP
 * (or JPEG) small enough to send. Keeps the proportions, so screenshots stay readable.
 */
export async function shrinkChatImage(file: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Only pictures can be sent');
  if (file.size > 20 * 1024 * 1024) throw new Error('That picture is larger than 20 MB');
  const img = await loadImage(file as File);
  let scale = Math.min(1, CHAT_IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  for (let attempt = 0; attempt < 3; attempt++, scale *= 0.7) {
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser cannot resize pictures');
    // Transparent areas (e.g. in PNG screenshots) become white rather than black in JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    for (const quality of [0.85, 0.72, 0.6]) {
      let dataUrl = canvas.toDataURL('image/webp', quality);
      if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(dataUrl) <= CHAT_IMAGE_MAX_BYTES) return { dataUrl, width, height };
    }
  }
  throw new Error('That picture is too detailed to send; try a smaller one');
}
