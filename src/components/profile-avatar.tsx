"use client";
import { useState } from "react";
import { useWorkspace } from "./workspace-provider";

export function ProfileAvatar({ large = false }: { large?: boolean }) {
  const { state, mode } = useWorkspace();
  const path = state.profile.avatarPath;
  const source =
    path === "brand"
      ? "/brand/grupo-pomar-claro.png"
      : path && mode === "cloud"
        ? `/api/profile?path=${encodeURIComponent(path)}`
        : "";
  const [failed, setFailed] = useState("");
  return (
    <span
      className={`profile-avatar ${large ? "profile-avatar-large" : ""} ${path === "brand" ? "profile-avatar-brand" : ""}`}
    >
      {source && failed !== source ? (
        <img
          src={source}
          alt={
            path === "brand"
              ? "Grupo Pomar"
              : `Foto de ${state.settings.displayName}`
          }
          width={large ? 96 : 34}
          height={large ? 96 : 34}
          onError={() => setFailed(source)}
        />
      ) : (
        state.settings.displayName.slice(0, 1)
      )}
    </span>
  );
}
