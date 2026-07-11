async function decodeImage(file) {
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

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== 'image/webp') {
        reject(new Error('This browser could not prepare the photo as WebP.'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

export async function compressImage(file, maxDim = 1600, quality = 0.8) {
  const image = await decodeImage(file);
  try {
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    let blob;

    if (typeof OffscreenCanvas === 'function'
      && typeof OffscreenCanvas.prototype.convertToBlob === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: 'image/webp', quality });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      blob = await canvasBlob(canvas, quality);
    }

    if (blob.type !== 'image/webp') {
      throw new Error('This browser could not prepare the photo as WebP.');
    }
    return blob;
  } finally {
    image.close?.();
  }
}

export async function uploadImage(blob, token) {
  const response = await fetch('/api/media', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'image/webp',
    },
    body: blob,
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 202 || !body.mediaId) {
    throw new Error(body.error || 'The photo could not be placed here.');
  }
  return body;
}
