"use client";

import {
  collection,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { firebaseApp } from "./firebaseClient";
import type { SearchResultItem, Website } from "@site-network-agent/types";

const firestore = getFirestore(firebaseApp);

function websitesCol(userId: string, projectId: string) {
  return collection(firestore, "users", userId, "projects", projectId, "websites");
}

/**
 * Гарантирует, что для найденного в поиске URL существует Website-документ
 * (результаты поиска и сайты для анализа — разные сущности, см. схему в
 * README). Если сайт уже заводили раньше (напр. из другого поиска) —
 * переиспользует существующий документ вместо дубликата.
 */
export async function ensureWebsiteForResult(
  userId: string,
  projectId: string,
  result: SearchResultItem
): Promise<string> {
  const col = websitesCol(userId, projectId);
  const existing = await getDocs(query(col, where("normalizedUrl", "==", result.normalizedUrl)));
  if (!existing.empty) return existing.docs[0].id;

  const ref = doc(col);
  const website: Website = {
    id: ref.id,
    projectId,
    url: result.url,
    normalizedUrl: result.normalizedUrl,
    domain: result.domain,
    status: "PENDING",
    discoveredFromSearchId: result.searchId,
    discoveredAtDepth: 0,
    lastAnalyzedAt: null,
    createdAt: Date.now(),
  };
  await setDoc(ref, website);
  return ref.id;
}

export function subscribeToWebsites(
  userId: string,
  projectId: string,
  onChange: (websites: Website[]) => void
) {
  const q = query(websitesCol(userId, projectId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => d.data() as Website)));
}
