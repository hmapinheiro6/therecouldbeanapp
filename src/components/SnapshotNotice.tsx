export function SnapshotNotice({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <p className="notice" role="status">
      Showing the saved catalog from{" "}
      {new Date(at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC while the
      live database is unavailable. Recent changes may be missing; submissions
      and approvals are paused.
    </p>
  );
}
