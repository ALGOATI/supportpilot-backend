import { Suspense } from "react";
import InboxContent from "./InboxContent";

export default function InboxPage() {
  return (
    <Suspense fallback={<div>Loading inbox...</div>}>
      <InboxContent />
    </Suspense>
  );
}
