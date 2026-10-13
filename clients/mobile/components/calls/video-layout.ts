export interface VideoBounds { width: number; height: number }
export interface VideoPosition { x: number; y: number }

export function videoTileSize({ width, height }: VideoBounds): number {
  const available = Math.max(1, Math.min(width, height) - 16);
  return Math.min(available, Math.max(64, Math.min(144, width * 0.36, height * 0.42)));
}

export function clampVideoPosition(position: VideoPosition, bounds: VideoBounds, size: number): VideoPosition {
  const margin = Math.min(8, Math.max(0, (Math.min(bounds.width, bounds.height) - size) / 2));
  return {
    x: Math.max(margin, Math.min(position.x, bounds.width - size - margin)),
    y: Math.max(margin, Math.min(position.y, bounds.height - size - margin)),
  };
}

export const initialVideoPosition = (bounds: VideoBounds, size: number): VideoPosition =>
  clampVideoPosition({ x: bounds.width - size - 12, y: bounds.height - size - 12 }, bounds, size);
