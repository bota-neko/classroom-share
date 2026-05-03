"use client";

import { getAvatarColor, getInitial } from "@/lib/profiles";

type AvatarProps = {
  userId: string;
  name: string;
  size?: "sm" | "md" | "lg";
};

export default function Avatar({ userId, name, size = "md" }: AvatarProps) {
  const sizeClass = {
    sm: "w-7 h-7 text-xs",
    md: "w-9 h-9 text-sm",
    lg: "w-12 h-12 text-base",
  }[size];

  const color = getAvatarColor(userId);

  return (
    <div
      className={`${color.bg} ${color.text} ${sizeClass} rounded-full flex items-center justify-center font-medium shrink-0`}
    >
      {getInitial(name)}
    </div>
  );
}
