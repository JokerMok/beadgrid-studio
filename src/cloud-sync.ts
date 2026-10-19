// Local-only metadata. Never included in exported .bead.json files.
export type CloudSync = {
  source: string;
  userId: number;
  projectId: string;
  updated: number;
};
export function validCloudSync(value: unknown, projectId: string) {
  const v = value as CloudSync | undefined;
  if (
    !v ||
    v.projectId !== projectId ||
    typeof v.source !== "string" ||
    !Number.isSafeInteger(v.userId) ||
    v.userId < 1 ||
    !Number.isSafeInteger(v.updated) ||
    v.updated < 1
  )
    return undefined;
  try {
    const url = new URL(v.source);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.href !== url.origin + "/api"
    )
      return undefined;
  } catch {
    return undefined;
  }
  return { source: v.source, userId: v.userId, projectId, updated: v.updated };
}
export const cloudSyncKey = (
  source: string,
  userId: number,
  projectId: string,
) => JSON.stringify([source, userId, projectId]);
