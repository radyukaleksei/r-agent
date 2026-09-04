"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/useAuth";
import { subscribeToProjects, createProject, type ProjectSummary } from "@/lib/projects";

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    if (!user) return;
    return subscribeToProjects(user.uid, setProjects);
  }, [user]);

  if (loading) {
    return <Centered>Загрузка…</Centered>;
  }

  if (!user) {
    return (
      <Centered>
        <div className="text-center space-y-4">
          <p className="text-text-secondary text-sm">
            Войдите, чтобы начать исследование сетей сайтов
          </p>
          <button
            className="btn-primary"
            onClick={() => signInWithPopup(firebaseAuth, new GoogleAuthProvider())}
          >
            Войти через Google
          </button>
        </div>
      </Centered>
    );
  }

  async function handleCreate() {
    if (!newProjectName.trim() || !user) return;
    const id = await createProject(user.uid, newProjectName.trim());
    setNewProjectName("");
    router.push(`/projects/${id}/search`);
  }

  return (
    <div className="max-w-3xl mx-auto py-16 px-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">Проекты</h1>
          <p className="text-text-secondary text-sm mt-1">{user.email}</p>
        </div>
        <button className="btn-secondary text-xs" onClick={() => signOut(firebaseAuth)}>
          Выйти
        </button>
      </div>

      <div className="panel rounded-md p-4 flex gap-2 mb-6">
        <input
          className="input flex-1"
          placeholder="Название проекта"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <button className="btn-primary" onClick={handleCreate}>
          Создать проект
        </button>
      </div>

      <div className="space-y-2">
        {projects.length === 0 && (
          <p className="text-text-secondary text-sm">Пока нет ни одного проекта.</p>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => router.push(`/projects/${p.id}/search`)}
            className="panel rounded-md p-4 w-full text-left hover:border-accent-teal/50 transition-colors flex items-center justify-between"
          >
            <span>{p.name}</span>
            <span className="text-text-secondary text-xs">
              {new Date(p.createdAt).toLocaleDateString("ru-RU")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-screen flex items-center justify-center">{children}</div>;
}
