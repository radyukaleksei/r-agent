"use client";

import { addDoc, collection, getFirestore, onSnapshot, orderBy, query } from "firebase/firestore";
import { firebaseApp } from "./firebaseClient";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
}

const firestore = getFirestore(firebaseApp);

/**
 * CRUD проектов идёт напрямую через Firestore client SDK (не через API routes) —
 * это простые операции без тяжёлой валидации/rate limiting, полностью
 * покрытые Security Rules (users/{uid}/projects/{id}, доступ только владельцу).
 * В отличие от создания jobs (см. lib/apiClient.ts), которое всегда идёт
 * через сервер — там нужны rate limiting и защита payload'а.
 */
export function subscribeToProjects(
  userId: string,
  onChange: (projects: ProjectSummary[]) => void
) {
  const q = query(collection(firestore, "users", userId, "projects"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string; createdAt: number }) })));
  });
}

export async function createProject(userId: string, name: string): Promise<string> {
  const ref = await addDoc(collection(firestore, "users", userId, "projects"), {
    name,
    createdAt: Date.now(),
  });
  return ref.id;
}
