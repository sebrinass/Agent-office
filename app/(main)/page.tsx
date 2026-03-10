"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { OpenView } from "@/components/open-view";
import { useAppStore } from "@/store";
import { addRecentFile } from "@/utils/recent-files";

export default function HomePage() {
  const router = useRouter();
  const { server } = useAppStore();

  const handleFileSelect = useCallback(
    async (file: File, handle?: FileSystemFileHandle) => {
      if (handle) {
        try {
          await addRecentFile(handle);
        } catch (err) {
          console.error("Failed to save dropped file to recent:", err);
        }
      }
      const result = await server.open(file);
      // 导航到编辑器，带上存储的文档ID
      const editorUrl = result.storedDocId 
        ? `/editor?doc=${result.storedDocId}` 
        : `/editor`;
      router.push(editorUrl);
    },
    [router, server],
  );

  const getNewUrl = (type: string) => `/editor?new=${type}`;

  return (
    <OpenView
      setActiveTab={(tab) => router.push(`/${tab === "open" ? "" : tab}`)}
      onFileSelect={handleFileSelect}
      getNewUrl={getNewUrl}
    />
  );
}
