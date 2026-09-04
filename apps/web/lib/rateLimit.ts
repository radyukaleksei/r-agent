import { db } from "./firebaseAdmin";

const MAX_ACTIVE_JOBS_PER_USER = Number(process.env.MAX_ACTIVE_JOBS_PER_USER ?? 3);
const MAX_JOBS_PER_HOUR_PER_USER = Number(process.env.MAX_JOBS_PER_HOUR_PER_USER ?? 20);

export class RateLimitError extends Error {}

/**
 * Ограничивает количество одновременно активных (QUEUED/RUNNING) job'ов
 * и общее число job'ов за скользящий час на пользователя — простая, но
 * достаточная для MVP защита от злоупотребления массовым сканированием
 * (см. п. "Firebase Security" / "rate limiting" исходного ТЗ по инфраструктуре).
 *
 * Для production под нагрузкой: вынести в Cloud Firestore distributed
 * counter или в отдельный rate-limiting сервис (напр. Upstash Redis),
 * т.к. подсчёт через `.get()` каждого запроса не масштабируется на очень
 * большое число одновременных пользователей.
 */
export async function assertWithinJobRateLimit(userId: string): Promise<void> {
  const jobsRef = db().collection("jobs");

  const activeSnap = await jobsRef
    .where("userId", "==", userId)
    .where("status", "in", ["QUEUED", "RUNNING"])
    .get();
  if (activeSnap.size >= MAX_ACTIVE_JOBS_PER_USER) {
    throw new RateLimitError(
      `Превышен лимит одновременных задач (${MAX_ACTIVE_JOBS_PER_USER}). Дождитесь завершения текущих.`
    );
  }

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const hourlySnap = await jobsRef
    .where("userId", "==", userId)
    .where("createdAt", ">=", oneHourAgo)
    .get();
  if (hourlySnap.size >= MAX_JOBS_PER_HOUR_PER_USER) {
    throw new RateLimitError(
      `Превышен часовой лимит задач (${MAX_JOBS_PER_HOUR_PER_USER}). Попробуйте позже.`
    );
  }
}
