import { NextResponse } from "next/server";
import { UnauthorizedError, ForbiddenError } from "./auth";
import { RateLimitError } from "./rateLimit";

export function handleApiError(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json({ error: err.message }, { status: 429 });
  }
  console.error(err);
  return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
}
