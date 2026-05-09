"use client";

import React, { useState } from "react";
import Avatar from "./Avatar";

type Message = {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
};

type MessageItemProps = {
  message: Message;
  currentUserId: string;
  displayName: string;
  onDelete: (id: string) => void;
  onLike: (id: string) => void;
  likeCount: number;
  liked: boolean;
  bubbleColor?: string;
};

export default function MessageItem({
  message,
  currentUserId,
  displayName,
  onDelete,
  onLike,
  likeCount,
  liked,
  bubbleColor = "#9bee8c",
}: MessageItemProps) {
  const isOwn = message.user_id === currentUserId;
  const [animKey, setAnimKey] = useState(-1);

  const handleLikeClick = () => {
    setAnimKey((k) => k + 1);
    onLike(message.id);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    if (now.getTime() - d.getTime() < 24 * 60 * 60 * 1000) {
      return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  };

  const renderContent = (content: string) =>
    content.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
      part.match(/https?:\/\/[^\s]+/) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline opacity-70">
          {part}
        </a>
      ) : (
        part
      )
    );

  const heart = (
    <svg
      key={animKey}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`w-3.5 h-3.5 ${animKey >= 0 ? "like-pop" : ""}`}
    >
      <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </svg>
  );

  // いいねがある場合はバッジ表示、ない場合はホバー時のみ薄く表示
  const likeBtn = likeCount > 0 ? (
    <button
      onClick={handleLikeClick}
      className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border transition-colors ${
        liked
          ? "bg-red-50 border-red-200 text-red-500"
          : "bg-white border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-400"
      }`}
    >
      {heart}
      <span className="font-medium">{likeCount}</span>
    </button>
  ) : (
    <button
      onClick={handleLikeClick}
      className="flex items-center gap-0.5 text-[11px] text-gray-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
    >
      {heart}
    </button>
  );

  if (isOwn) {
    return (
      <div className="flex justify-end items-end gap-2 mb-4 group">
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => onDelete(message.id)}
            className="text-[10px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity mr-4"
          >
            削除
          </button>
          <div className="flex items-end gap-2">
            <span className="text-[10px] text-gray-400 shrink-0 pb-0.5">{formatDate(message.created_at)}</span>
            <div className="max-w-xs sm:max-w-sm overflow-visible">
              {message.image_url && (
                <img src={message.image_url} alt="添付" className="max-w-full max-h-60 rounded-xl mb-1 object-contain" />
              )}
              {message.content && (
                <div className="relative inline-block">
                  <div className="bubble-own" style={{ backgroundColor: bubbleColor }}>
                    {renderContent(message.content)}
                  </div>
                  <div style={{
                    position: "absolute", top: "35%", right: 0, width: 0, height: 0,
                    borderStyle: "solid", borderWidth: "0 0 10px 10px",
                    borderColor: `transparent transparent transparent ${bubbleColor}`,
                    transform: "translate(100%, calc(-50% - 0.4px)) skew(0, -10deg)",
                    transformOrigin: "left",
                  }} />
                </div>
              )}
              <div className="flex justify-end mt-1 mr-4">
                {likeBtn}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 mb-4">
      <Avatar userId={message.user_id} name={displayName} size="sm" />
      <div className="flex flex-col gap-1 max-w-[70%]">
        <span className="text-[11px] text-gray-500">{displayName}</span>
        <div className="flex items-end gap-2">
          <div>
            {message.image_url && (
              <img src={message.image_url} alt="添付" className="max-w-full max-h-60 rounded-xl mb-1 object-contain" />
            )}
            {message.content && (
              <div className="bubble-other">
                {renderContent(message.content)}
              </div>
            )}
            <div className="mt-1 ml-1">
              {likeBtn}
            </div>
          </div>
          <span className="text-[10px] text-gray-400 shrink-0 pb-0.5">{formatDate(message.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
