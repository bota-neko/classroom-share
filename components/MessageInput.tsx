"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type MessageInputProps = {
  onSend: (content: string, imageUrl: string | null) => void;
};

export default function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const uploadImage = async (file: File): Promise<string | null> => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      alert("画像はJPEG、PNG、GIF、WebPのみ対応しています");
      return null;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert("ファイルサイズは10MB以下にしてください");
      return null;
    }
    const ext = file.name.split(".").pop();
    const fileName = `messages/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from("uploads")
      .upload(fileName, file);
    if (error) {
      console.log("画像アップロードエラー:", error);
      return null;
    }
    const { data } = supabase.storage.from("uploads").getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    const file = fileInputRef.current?.files?.[0];
    if (!trimmed && !file) return;

    setUploading(true);
    let imageUrl: string | null = null;

    if (file) {
      imageUrl = await uploadImage(file);
      if (!imageUrl) {
        alert("画像のアップロードに失敗しました");
        setUploading(false);
        return;
      }
    }

    onSend(trimmed, imageUrl);
    setText("");
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
        {previewUrl && (
          <div className="relative inline-block mb-2">
            <img
              src={previewUrl}
              alt="プレビュー"
              className="max-h-24 rounded-lg border border-gray-200"
            />
            <button
              onClick={() => {
                setPreviewUrl(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="absolute -top-2 -right-2 bg-black text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 bg-gray-50 rounded-2xl p-2 border border-gray-200 focus-within:border-black focus-within:bg-white transition-colors">
          <label className="p-2 hover:bg-gray-100 rounded-lg cursor-pointer text-gray-500 transition-colors shrink-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              />
            </svg>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="クラスへ共有..."
            rows={1}
            disabled={uploading}
            className="flex-1 resize-none bg-transparent px-1 py-2 focus:outline-none text-sm placeholder:text-gray-400 max-h-32"
          />

          <button
            onClick={() => { onSend("👍", null); }}
            disabled={uploading}
            className="p-2 text-xl leading-none hover:scale-110 transition-transform shrink-0"
            title="いいね！"
          >
            👍
          </button>

          <button
            onClick={handleSubmit}
            disabled={uploading || (!text.trim() && !previewUrl)}
            className="p-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
