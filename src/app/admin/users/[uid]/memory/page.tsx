"use client";

import { useParams } from "next/navigation";
import { MemoryClusterPage } from "@/app/agent/page";

export default function AdminUserMemoryPage() {
  const { uid } = useParams<{ uid: string }>();
  return <MemoryClusterPage targetUserId={uid} backHref="/admin" />;
}
