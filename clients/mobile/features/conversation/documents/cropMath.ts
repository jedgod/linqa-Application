// Pure geometry for the crop tool, kept separate so it can be unit tested.

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** Where an image of `image` size lands inside `box` with resizeMode="contain". */
export function containRect(image: Size, box: Size): Rect {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** Largest rect of the given aspect (w/h) centered in `area`. null aspect = whole area. */
export function initialCrop(area: Rect, aspect: number | null, inset = 0.9): Rect {
  let width = area.width * inset;
  let height = area.height * inset;
  if (aspect) {
    if (width / height > aspect) width = height * aspect;
    else height = width / aspect;
  }
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}

export const MIN_CROP = 48;

/** Moves the crop by (dx, dy), kept inside `area`. */
export function moveCrop(crop: Rect, dx: number, dy: number, area: Rect): Rect {
  return {
    ...crop,
    x: clamp(crop.x + dx, area.x, area.x + area.width - crop.width),
    y: clamp(crop.y + dy, area.y, area.y + area.height - crop.height),
  };
}

/** Resizes from the bottom-right corner, keeping aspect when set, kept inside `area`. */
export function resizeCrop(crop: Rect, dx: number, dy: number, area: Rect, aspect: number | null): Rect {
  const maxW = area.x + area.width - crop.x;
  const maxH = area.y + area.height - crop.y;
  let width = clamp(crop.width + dx, MIN_CROP, maxW);
  let height = clamp(crop.height + dy, MIN_CROP, maxH);
  if (aspect) {
    // Follow whichever drag axis moved further, then fit inside bounds.
    if (Math.abs(dx) >= Math.abs(dy)) height = width / aspect;
    else width = height * aspect;
    if (height > maxH) {
      height = maxH;
      width = height * aspect;
    }
    if (width > maxW) {
      width = maxW;
      height = width / aspect;
    }
  }
  return { ...crop, width, height };
}

/** Converts a crop drawn on screen into pixel coordinates in the source image. */
export function toImagePixels(crop: Rect, displayed: Rect, image: Size): { originX: number; originY: number; width: number; height: number } {
  const sx = image.width / displayed.width;
  const sy = image.height / displayed.height;
  const originX = Math.round(clamp((crop.x - displayed.x) * sx, 0, image.width - 1));
  const originY = Math.round(clamp((crop.y - displayed.y) * sy, 0, image.height - 1));
  return {
    originX,
    originY,
    width: Math.round(clamp(crop.width * sx, 1, image.width - originX)),
    height: Math.round(clamp(crop.height * sy, 1, image.height - originY)),
  };
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
