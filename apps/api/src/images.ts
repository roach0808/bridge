import { badRequest } from './errors';

/** Decodes a data URL and checks the bytes really are the declared image type. */
export function decodeImageDataUrl(dataUrl: string, maxBytes: number): { contentType: string; data: Buffer } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw badRequest('Upload a JPEG, PNG or WebP image');
  const contentType = match[1]!;
  const data = Buffer.from(match[2]!, 'base64');
  if (!data.length) throw badRequest('The image is empty');
  if (data.length > maxBytes) throw badRequest(`The image is too large (max ${Math.round(maxBytes / 1024)} KB)`);

  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  const ok = { 'image/jpeg': isJpeg, 'image/png': isPng, 'image/webp': isWebp }[contentType];
  if (!ok) throw badRequest('The file is not a valid image');
  return { contentType, data };
}
