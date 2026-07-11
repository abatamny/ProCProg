// Client-side WebP compression (SPEC §5a). The upload endpoint only accepts
// image/webp, so a failed conversion is a hard error, never a silent fallback.

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This photo could not be opened.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function elementCanvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.type === 'image/webp') resolve(blob);
      else reject(new Error('This browser could not prepare the photo.'));
    }, 'image/webp', quality);
  });
}

export async function compressToWebp(file, maxDim = 1600, quality = 0.8) {
  const image = await decode(file);
  try {
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    if (typeof OffscreenCanvas === 'function'
      && typeof OffscreenCanvas.prototype.convertToBlob === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.type === 'image/webp') return blob;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return await elementCanvasBlob(canvas, quality);
  } finally {
    image.close?.();
  }
}
