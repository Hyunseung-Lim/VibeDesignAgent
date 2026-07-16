"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ImagePreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  imageUrl?: string;
  alt?: string;
  caption?: string;
};

export function ImagePreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  imageUrl,
  alt,
  caption,
}: ImagePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="session-image-preview-description"
        className="max-w-3xl overflow-hidden p-0"
      >
        {imageUrl && (
          <>
            <DialogHeader className="border-b border-slate-100 px-5 py-4 pr-12">
              <DialogTitle className="leading-snug">{title}</DialogTitle>
              <DialogDescription id="session-image-preview-description">
                {description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[calc(100vh-8rem)] flex-col gap-4 overflow-y-auto p-5">
              <div className="flex items-center justify-center rounded-xl bg-slate-100 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={alt || title}
                  className="max-h-[60vh] max-w-full rounded-lg object-contain"
                />
              </div>
              {caption?.trim() && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                  {caption.trim()}
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
