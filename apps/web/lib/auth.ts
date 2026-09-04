import type { NextRequest } from "next/server";
import { auth, db } from "./firebaseAdmin";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

/**
 * Проверяет Firebase ID token из заголовка Authorization: Bearer <token>.
 * Каждый API route обязан вызывать это ПЕРВЫМ действием — см. README →
 * "Firebase Security": без этой проверки пользователь мог бы читать/писать
 * чужие данные, просто подставив другой projectId в теле запроса.
 */
export async function requireUser(req: NextRequest): Promise<string> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new UnauthorizedError("Отсутствует Authorization header");

  try {
    const decoded = await auth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    throw new UnauthorizedError("Невалидный или истёкший token");
  }
}

/**
 * Проверяет, что project действительно принадлежит указанному userId.
 * Обязателен на КАЖДОМ endpoint, принимающем projectId — иначе пользователь A
 * сможет читать/анализировать проект пользователя B, просто подставив его id
 * (см. п. "Firebase Security" исходного ТЗ по инфраструктуре).
 */
export async function assertOwnsProject(userId: string, projectId: string): Promise<void> {
  const snap = await db()
    .collection("users")
    .doc(userId)
    .collection("projects")
    .doc(projectId)
    .get();
  if (!snap.exists) throw new ForbiddenError("Проект не найден или не принадлежит пользователю");
}
