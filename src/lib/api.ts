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
  const data = (await response.json()) as { error?: { message?: string } };
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? "Something went wrong. Please try again.",
      response.status,
    );
  return data as T;
}
