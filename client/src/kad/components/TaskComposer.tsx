/**
 * Composer dùng chung giữa `/cong-viec/moi` (hero, giữa trang) và
 * `/cong-viec/:id` (compact, docked đáy màn) — spec/ui/07-giao-viec-intake-
 * report-card.md §1 (hero) + §5 (chat trong task). Cùng hành vi ở cả 2 nơi:
 * đính kèm + voice-to-text, KHÔNG có picker thư mục làm việc (thư mục chỉ
 * chọn một lần ở trang giao việc mới — xem CongViecMoi.tsx).
 *
 * Textarea tự tăng chiều cao theo nội dung (scrollHeight), chỉ hiện thanh
 * cuộn dọc khi vượt max-height. size="hero" canh giữa placeholder/nội dung
 * theo chiều dọc bằng padding đối xứng (không dùng flex align-items trên
 * chính textarea — không đáng tin cậy giữa các trình duyệt).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { FileText, Mic, Paperclip, Send, X } from "lucide-react";
import { KadButton } from "./primitives";

function autosizeTextarea(ta: HTMLTextAreaElement | null) {
  if (!ta) return;
  ta.style.height = "auto";
  const max = parseFloat(getComputedStyle(ta).maxHeight) || 240;
  const h = Math.min(ta.scrollHeight, max);
  ta.style.height = `${h}px`;
  ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
}

// Web Speech API chưa có type chuẩn trong lib.dom — khai báo tối thiểu đủ dùng
// cho voice-to-text (spec 07 §5). V1 cố ý KHÔNG auto-send transcript.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const VOICE_FALLBACK_DEMO =
  "Bổ sung thêm phần thực hành với Claude cho buổi 5, ưu tiên bài tập theo nhóm.";

export interface TaskComposerHandle {
  focus: () => void;
}

/**
 * Keyed by an id (not just a display name) — two different local files can
 * share a name (e.g. two exports both called "report.pdf"); a name-only list
 * would silently collapse them, making the second one unremovable once
 * attached (real bug this shape fixes — see kad/phase-02c review notes).
 */
export interface ComposerAttachment {
  id: string;
  name: string;
}

interface TaskComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  attachments: ComposerAttachment[];
  /** Native file picker result (spec 07 §1/§5 — real files, no more demo-cycle). */
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /** hero = giữa trang giao việc mới (cao gấp đôi, canh giữa); compact = docked đáy chat. */
  size?: "hero" | "compact";
  sendLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const TaskComposer = forwardRef<TaskComposerHandle, TaskComposerProps>(function TaskComposer(
  {
    value,
    onChange,
    onSubmit,
    placeholder,
    attachments,
    onFilesSelected,
    onRemoveAttachment,
    size = "compact",
    sendLabel = "Gửi",
    disabled = false,
    autoFocus = false,
  },
  ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const isHero = size === "hero";

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
  }));

  useEffect(() => {
    autosizeTextarea(taRef.current);
  }, [value]);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
    };
  }, []);

  const toggleMic = () => {
    if (recording) {
      recRef.current?.stop();
      setRecording(false);
      return;
    }
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;
    baseTextRef.current = value ? `${value} ` : "";
    if (SR) {
      const rec = new SR();
      rec.lang = "vi-VN";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let s = "";
        for (let i = 0; i < e.results.length; i++) s += e.results[i]?.[0]?.transcript ?? "";
        onChange(baseTextRef.current + s);
      };
      rec.onend = () => setRecording(false);
      rec.onerror = () => setRecording(false);
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } else {
      // Trình duyệt không hỗ trợ Web Speech API — mô phỏng transcript đổ dần
      // (chỉ để demo hành vi UI, không phải giả lập nhận diện giọng nói thật).
      setRecording(true);
      let i = 0;
      const timer = setInterval(() => {
        i += 3;
        onChange(VOICE_FALLBACK_DEMO.slice(0, i));
        if (i >= VOICE_FALLBACK_DEMO.length) {
          clearInterval(timer);
          setRecording(false);
        }
      }, 60);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!disabled) onSubmit();
    }
  };

  return (
    <div className="w-full">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="kad-caption inline-flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md border border-kad-border bg-kad-surface-2 text-kad-text-muted"
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
              {a.name}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.id)}
                aria-label={`Bỏ đính kèm ${a.name}`}
                className="text-kad-text-faint hover:text-kad-text"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className={`flex rounded-xl border border-kad-border-strong bg-kad-surface transition-colors focus-within:border-kad-accent focus-within:ring-2 focus-within:ring-kad-accent/20 ${
          isHero ? "items-center px-3.5 py-3 gap-2.5" : "items-end px-2 py-2 gap-1.5"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFilesSelected(files);
            e.target.value = ""; // allow re-selecting the same file later
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Đính kèm tài liệu"
          aria-label="Đính kèm tài liệu"
          className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2 transition-colors"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={toggleMic}
          title="Nói để nhập (vi-VN) — không tự gửi"
          aria-label="Nhập bằng giọng nói"
          className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center transition-colors ${
            recording
              ? "bg-[#fceaea] text-kad-danger animate-pulse"
              : "text-kad-text-muted hover:text-kad-text hover:bg-kad-surface-2"
          }`}
        >
          <Mic className="w-5 h-5" />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`kad-body flex-1 min-w-0 resize-none bg-transparent border-none outline-none text-kad-text placeholder:text-kad-text-faint ${
            isHero ? "py-[33px] max-h-[240px]" : "py-1.5 min-h-[36px] max-h-[150px]"
          }`}
          style={{ overflowY: "hidden" }}
        />
        <KadButton
          variant="primary"
          icon={Send}
          onClick={onSubmit}
          disabled={disabled}
          className="flex-shrink-0"
        >
          {sendLabel}
        </KadButton>
      </div>
    </div>
  );
});
