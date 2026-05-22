import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronDown,
  Download,
  ImageIcon,
  Loader2,
  Settings2,
  UploadCloud,
  X
} from "lucide-react";
import clsx from "clsx";
import type { CompressionProfile } from "../shared/types.js";
import "./styles.css";

type UploadState = "idle" | "uploading" | "done" | "error";

interface LastDownload {
  url: string;
  filename: string;
  mode: "single" | "zip";
  inputBytes: number;
  outputBytes: number;
}

const profiles: Array<{ id: CompressionProfile; label: string; detail: string }> = [
  { id: "maximum-compatible", label: "Compatible", detail: "JPEG / PNG — works everywhere" },
  { id: "widely-supported", label: "WebP", detail: "Smaller than JPEG, modern browsers" },
  { id: "smallest-modern", label: "Smallest (AVIF)", detail: "Best compression, modern browsers" },
  { id: "lossless-screenshots", label: "Lossless", detail: "PNG — exact pixels, larger files" }
];

const ACCEPT = "image/*,.heic,.heif,.jxl";

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeFilenameHeader(value: string | null, fallback: string): string {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif")) return true;
  const type = file.type.toLowerCase();
  return type === "image/heic" || type === "image/heif";
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [profile, setProfile] = useState<CompressionProfile>("maximum-compatible");
  const [outputHeic, setOutputHeic] = useState(false);
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastDownload, setLastDownload] = useState<LastDownload | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const hasHeic = useMemo(() => files.some(isHeicFile), [files]);

  const addFiles = useCallback((list: FileList | null): void => {
    if (!list || !list.length) return;
    setFiles((current) => {
      const next = [...current, ...Array.from(list)];
      const seen = new Set<string>();
      return next.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    setState("idle");
    setErrorMessage("");
  }, []);

  // Window-level drag-and-drop so the user can drop anywhere on the page,
  // not just on the dropzone. We use a counter because dragenter/dragleave
  // fire on every nested element, and we'd lose the dragging state mid-hover
  // otherwise.
  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent): boolean => {
      const types = event.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i += 1) if (types[i] === "Files") return true;
      return false;
    };
    const onEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (carriesFiles(event)) addFiles(event.dataTransfer!.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  // Paste image data from the clipboard (Cmd/Ctrl-V) — screenshots, copied
  // images from another tab, etc. Pasted screenshots usually arrive as
  // `image/png` with a blank or generic name, so we give them a unique
  // timestamped name to keep dedup + downloads sensible.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // Ignore paste targeted at editable fields (we don't have any today,
      // but this guard keeps things safe if a text input is added later).
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))) return;

      const items = event.clipboardData?.items;
      if (!items || items.length === 0) return;

      const pasted: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const looksGeneric = !file.name || file.name === "image.png" || file.name === "image.jpeg";
        if (looksGeneric) {
          const ext = (item.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
          pasted.push(new File([file], `pasted-${Date.now()}-${i}.${ext}`, { type: file.type }));
        } else {
          pasted.push(file);
        }
      }

      if (pasted.length === 0) return;
      event.preventDefault();
      const dt = new DataTransfer();
      for (const file of pasted) dt.items.add(file);
      addFiles(dt.files);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  function removeFile(index: number): void {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  function clearAll(): void {
    setFiles([]);
    setState("idle");
    setProgress(0);
    setErrorMessage("");
    if (lastDownload) URL.revokeObjectURL(lastDownload.url);
    setLastDownload(null);
  }

  function compress(): void {
    if (!files.length || state === "uploading") return;
    if (lastDownload) URL.revokeObjectURL(lastDownload.url);
    setLastDownload(null);

    const form = new FormData();
    form.set("profile", profile);
    if (hasHeic && outputHeic) form.set("outputHeic", "true");
    for (const file of files) form.append("images", file, file.name);
    const isSingle = files.length === 1;
    const fallbackName = isSingle ? `compressed-${files[0].name}` : "compressed-images.zip";

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/compress");
    xhr.responseType = "blob";
    setState("uploading");
    setProgress(0);
    setErrorMessage("");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = xhr.response as Blob;
        const url = URL.createObjectURL(blob);
        const mode = (xhr.getResponseHeader("X-Mode") ?? (isSingle ? "single" : "zip")) as "single" | "zip";
        const filename = decodeFilenameHeader(xhr.getResponseHeader("X-Output-Filename"), fallbackName);
        const inputBytes = Number(xhr.getResponseHeader("X-Input-Bytes") ?? "0") || totalBytes;
        const outputBytes = Number(xhr.getResponseHeader("X-Output-Bytes") ?? "0") || blob.size;
        setLastDownload({ url, filename, mode, inputBytes, outputBytes });
        setState("done");
        setProgress(100);
        triggerDownload(url, filename);
        return;
      }
      setState("error");
      setErrorMessage(xhr.status ? `Server responded with ${xhr.status}.` : "Network error.");
    };

    xhr.onerror = () => {
      setState("error");
      setErrorMessage("Couldn't reach the server.");
    };

    xhr.send(form);
  }

  const savingsPercent =
    lastDownload && lastDownload.inputBytes > 0
      ? Math.max(0, Math.round((1 - lastDownload.outputBytes / lastDownload.inputBytes) * 100))
      : 0;

  return (
    <main className={clsx("page", dragging && "dragging")}>
      {dragging && <div className="drop-overlay" aria-hidden />}
      <div className="card">
        <header className="hero">
          <h1>Compress</h1>
          <p>Make your images smaller.</p>
        </header>

        <button
          type="button"
          className={clsx("dropzone", files.length && "has-files")}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud size={36} aria-hidden />
          <strong>{dragging ? "Drop to add" : "Drop images here or click to choose"}</strong>
          <span>JPG, PNG, WebP, HEIC, AVIF</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(event) => {
            addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        {files.length > 0 && (
          <div className="file-panel">
            <ul className="file-list" aria-label="Selected images">
              {files.map((file, index) => (
                <li key={`${file.name}:${file.size}:${file.lastModified}`}>
                  <ImageIcon size={16} aria-hidden />
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    className="remove-file"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeFile(index)}
                    disabled={state === "uploading"}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="file-panel-footer">
              <span>{files.length === 1 ? "1 file" : `${files.length} files`}</span>
              <span>Total {formatBytes(totalBytes)}</span>
            </div>
          </div>
        )}

        {hasHeic && (
          <label className="option-row">
            <input
              type="checkbox"
              checked={outputHeic}
              onChange={(event) => setOutputHeic(event.currentTarget.checked)}
              disabled={state === "uploading"}
            />
            <span>Save as HEIC</span>
          </label>
        )}

        <div className="primary-actions">
          <button
            type="button"
            className="primary"
            disabled={!files.length || state === "uploading"}
            onClick={compress}
          >
            {state === "uploading" ? <Loader2 className="spin" size={18} aria-hidden /> : null}
            {state === "uploading" ? "Compressing…" : `Compress${files.length > 1 ? ` ${files.length}` : ""}`}
          </button>
          {files.length > 0 && (
            <button
              type="button"
              className="ghost"
              onClick={clearAll}
              disabled={state === "uploading"}
            >
              Clear
            </button>
          )}
        </div>

        {state === "uploading" && (
          <div className="progress" aria-label="Upload progress">
            <div style={{ width: `${progress}%` }} />
          </div>
        )}

        {state === "done" && lastDownload && (
          <div className="result">
            <div className="result-headline">
              <strong>
                {savingsPercent > 0 ? `Saved ${savingsPercent}%` : "Done — no material reduction"}
              </strong>
              <span>
                {formatBytes(lastDownload.inputBytes)} → {formatBytes(lastDownload.outputBytes)}
              </span>
            </div>
            <button
              type="button"
              className="primary"
              onClick={() => triggerDownload(lastDownload.url, lastDownload.filename)}
            >
              <Download size={18} aria-hidden />
              Download {lastDownload.mode === "zip" ? "zip" : "image"}
            </button>
          </div>
        )}

        {state === "error" && (
          <div className="result error">
            <strong>Something went wrong</strong>
            <span>{errorMessage}</span>
          </div>
        )}

        <details
          className="advanced"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <Settings2 size={14} aria-hidden />
            Advanced
            <ChevronDown size={14} aria-hidden className="chev" />
          </summary>
          <div className="advanced-body" role="radiogroup" aria-label="Compression profile">
            {profiles.map((item) => (
              <label
                key={item.id}
                className={clsx("profile-option", profile === item.id && "selected")}
              >
                <input
                  type="radio"
                  name="profile"
                  value={item.id}
                  checked={profile === item.id}
                  onChange={() => setProfile(item.id)}
                />
                <span className="profile-label">{item.label}</span>
                <span className="profile-detail">{item.detail}</span>
              </label>
            ))}
          </div>
        </details>
      </div>
      <footer className="footnote">
        Files are processed on the server and never logged.
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
