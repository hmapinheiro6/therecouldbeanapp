export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api" + path, options);
  let data: { error?: { message?: string; code?: string } };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new ApiError(
      "The catalog is temporarily unavailable. Please try again later.",
      response.status,
    );
  }
  if (
    !response.ok &&
    data.error?.code === "database_daily_limit" &&
    (!options?.method || options.method === "GET")
  ) {
    const { snapshotApi } = await import("./snapshot");
    return (await snapshotApi(path, options?.signal ?? undefined)) as T;
  }
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? "Something went wrong. Please try again.",
      response.status,
    );
  return data as T;
}
