"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  SmartphoneIcon,
  MonitorIcon,
  XIcon,
} from "lucide-react";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { isAdminEmail } from "@/lib/admin";

type Device = "desktop" | "mobile";

type AssetImage = {
  url: string;
  path: string;
  note?: string;
};

type MissionContent = {
  id: string;
  title: string;
  description: string;
  content: string;
  assetImages: AssetImage[];
};

function createEmptyContent(): MissionContent {
  return {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    content: "",
    assetImages: [],
  };
}

const EMPTY_FORM = {
  title: "",
  description: "",
  device: "desktop" as Device,
  durationMinutes: 30,
  contentBlock: createEmptyContent(),
};

async function uploadMissionAsset(file: File, token: string): Promise<AssetImage> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/admin/mission-assets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? "이미지 업로드에 실패했습니다.");
  }
  return data as AssetImage;
}

async function deleteMissionAsset(path: string, token: string) {
  const res = await fetch("/api/admin/mission-assets", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "이미지 삭제에 실패했습니다.");
  }
}

export default function NewMissionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user || !isAdminEmail(user.email)) {
        router.replace("/lobby");
        return;
      }
      setReady(true);
    });
  }, [router]);

  const updateContent = (changes: Partial<MissionContent>) => {
    setForm((prev) => ({
      ...prev,
      contentBlock: { ...prev.contentBlock, ...changes },
    }));
  };

  const updateAssetImage = (path: string, changes: Partial<AssetImage>) => {
    setForm((prev) => ({
      ...prev,
      contentBlock: {
        ...prev.contentBlock,
        assetImages: prev.contentBlock.assetImages.map((image) =>
          image.path === path ? { ...image, ...changes } : image,
        ),
      },
    }));
  };

  const uploadAssetImages = async (files: File[]) => {
    if (files.length === 0) return;
    setError("");
    setIsUploading(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("로그인이 필요합니다.");
      const token = await getIdToken(user);
      const uploaded: AssetImage[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        uploaded.push(await uploadMissionAsset(file, token));
      }
      if (uploaded.length > 0) {
        setForm((prev) => ({
          ...prev,
          contentBlock: {
            ...prev.contentBlock,
            assetImages: [...prev.contentBlock.assetImages, ...uploaded].slice(
              0,
              12,
            ),
          },
        }));
      }
    } catch (err) {
      console.error("[admin/new] asset image upload failed", err);
      setError(
        err instanceof Error ? err.message : "이미지 업로드에 실패했습니다.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const removeAssetImage = async (image: AssetImage) => {
    setForm((prev) => ({
      ...prev,
      contentBlock: {
        ...prev.contentBlock,
        assetImages: prev.contentBlock.assetImages.filter(
          (item) => item.path !== image.path,
        ),
      },
    }));
    if (image.path) {
      const user = firebaseAuth.currentUser;
      const token = user ? await getIdToken(user) : null;
      if (!token) return;
      await deleteMissionAsset(image.path, token).catch((err) => {
        console.warn("[admin/new] asset image delete failed", err);
      });
    }
  };

  const hasContentTitle = form.contentBlock.title.trim();
  const canSubmit =
    form.title.trim() && hasContentTitle && !isCreating && !isUploading;

  const createMission = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    setError("");
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("로그인이 필요합니다.");
      const token = await getIdToken(user);
      const res = await fetch("/api/admin/missions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          device: form.device,
          durationMinutes: form.durationMinutes > 0 ? form.durationMinutes : null,
          // Firestore still stores the mission content in options[0] so the
          // existing session content plumbing remains compatible.
          options: [
            {
              ...form.contentBlock,
              title: form.contentBlock.title.trim(),
              description: form.contentBlock.description.trim(),
              assetImages: form.contentBlock.assetImages,
            },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "미션 생성에 실패했습니다.");
      }
      router.push("/admin");
    } catch (err) {
      console.error("[admin/new] create mission failed", err);
      setError(err instanceof Error ? err.message : "미션 생성에 실패했습니다.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm text-slate-500 transition hover:text-slate-900">
              <ArrowLeftIcon size={14} className="inline" /> 관리자
            </Link>
            <h1 className="text-lg font-semibold text-slate-900">새 미션 만들기</h1>
          </div>
          <button
            onClick={createMission}
            disabled={!canSubmit}
            className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
          >
            {isCreating ? "생성 중..." : "만들기"}
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 lg:px-10">
        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {error}
          </div>
        )}
        <div className="rounded-3xl border border-slate-100 bg-white p-6 space-y-4">
          <p className="text-sm font-semibold text-slate-500">기본 정보</p>

          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="미션 제목"
            autoFocus
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="미션 설명 (선택)"
            rows={3}
            className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
          />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">제한 시간 (분)</p>
            <input
              type="number"
              min={0}
              value={form.durationMinutes}
              onChange={(e) => setForm((p) => ({ ...p, durationMinutes: Number(e.target.value) }))}
              placeholder="0 = 시간 제한 없음"
              className="w-40 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">디바이스</p>
            <div className="flex gap-2">
              {(["desktop", "mobile"] as Device[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, device: d }))}
                  className={`flex-1 rounded-2xl border py-3 text-sm font-semibold transition ${
                    form.device === d
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {d === "desktop"
                    ? <><MonitorIcon size={14} className="inline mr-1" />PC</>
                    : <><SmartphoneIcon size={14} className="inline mr-1" />모바일</>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mission content */}
        <div className="rounded-3xl border border-slate-100 bg-white p-6 space-y-4">
          <p className="text-sm font-semibold text-slate-500">미션 콘텐츠</p>

          <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <input
              value={form.contentBlock.title}
              onChange={(e) => updateContent({ title: e.target.value })}
              placeholder="주제/브랜드 이름"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <textarea
              value={form.contentBlock.description}
              onChange={(e) => updateContent({ description: e.target.value })}
              placeholder="한 줄 설명"
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">콘텐츠 (마크다운)</p>
              <textarea
                value={form.contentBlock.content}
                onChange={(e) => updateContent({ content: e.target.value })}
                placeholder={"## 서비스 개요\n- ...\n\n## 주요 기능\n- ..."}
                rows={6}
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-slate-400"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">
                콘텐츠 이미지 (선택)
              </p>
              <p className="text-xs text-slate-400">
                실제 상품 사진이나 UI 캡쳐를 올리면 목업 생성 시 이 이미지를 그대로
                넣어 만듭니다.
              </p>
              {form.contentBlock.assetImages.length > 0 && (
                <div className="space-y-2">
                  {form.contentBlock.assetImages.map((image) => (
                    <div
                      key={image.path || image.url}
                      className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:flex-row"
                    >
                      <div className="group relative h-24 w-full shrink-0 overflow-hidden rounded-lg bg-slate-50 sm:w-24">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={image.note?.trim() || "콘텐츠 이미지"}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeAssetImage(image)}
                          className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
                          aria-label="이미지 삭제"
                        >
                          <XIcon size={12} />
                        </button>
                      </div>
                      <textarea
                        value={image.note ?? ""}
                        onChange={(e) =>
                          updateAssetImage(image.path, { note: e.target.value })
                        }
                        placeholder="이미지 설명: 예) 린넨 셔츠 대표 상품 사진, 상품 카드에 사용"
                        rows={2}
                        className="min-h-24 w-full resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                      />
                    </div>
                  ))}
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={isUploading}
                  onChange={(e) => {
                    const files = Array.from(e.currentTarget.files ?? []);
                    void uploadAssetImages(files);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
                {isUploading ? "업로드 중..." : "이미지 추가"}
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
