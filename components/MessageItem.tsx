"use client";

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
};

// メッセージ（Google Classroomのストリーム風）
export default function MessageItem({
  message,
  currentUserId,
  displayName,
  onDelete,
}: MessageItemProps) {
  const isOwn = message.user_id === currentUserId;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const hours = diff / (1000 * 60 * 60);

    if (hours < 24) {
      return d.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return d.toLocaleDateString("ja-JP", {
      month: "numeric",
      day: "numeric",
    });
  };

  return (
    <div className="flex gap-3 mb-4 group">
      <Avatar userId={message.user_id} name={displayName} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm text-gray-900">
            {displayName}
            {isOwn && (
              <span className="text-xs text-gray-400 font-normal ml-1">
                （自分）
              </span>
            )}
          </span>
          <span className="text-xs text-gray-400">
            {formatDate(message.created_at)}
          </span>
          {isOwn && (
            <button
              onClick={() => onDelete(message.id)}
              className="ml-auto text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              削除
            </button>
          )}
        </div>
        {message.image_url && (
          <img
            src={message.image_url}
            alt="添付"
            className="mt-2 max-w-sm max-h-80 rounded-lg border border-gray-200 object-contain"
          />
        )}
        {message.content && (
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words mt-1 leading-relaxed">
            {message.content.split(/(https?:\/\/[^\s]+)/g).map((part, i) => {
              if (part.match(/https?:\/\/[^\s]+/)) {
                return (
                  <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {part}
                  </a>
                );
              }
              return part;
            })}
          </p>
        )}
      </div>
    </div>
  );
}
