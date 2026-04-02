"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ConversationRedirectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const conversationId = decodeURIComponent(params?.id || "");

  useEffect(() => {
    if (!conversationId) {
      router.replace("/dashboard/inbox");
      return;
    }
    router.replace(`/dashboard/inbox?c=${encodeURIComponent(conversationId)}`);
  }, [conversationId, router]);

  return null;
}
