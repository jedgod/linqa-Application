export function RecordedVideoDisclosure({
  recordedAt,
  retentionLabel
}: {
  recordedAt: string;
  retentionLabel: string;
}) {
  return (
    <div className="recorded-video-disclosure" role="status">
      <strong>RECORDED VIDEO — NOT LIVE</strong>
      <span>Recorded {new Date(recordedAt).toLocaleString()}</span>
      <span>{retentionLabel}</span>
    </div>
  );
}
