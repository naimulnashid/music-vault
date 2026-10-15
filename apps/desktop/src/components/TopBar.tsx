import { useEffect, useRef } from "react";
import { ArrowLeft, Menu as MenuIcon, Search, UploadCloud, X } from "lucide-react";
import { useLibraryStore } from "../store/libraryStore";
import { useUiStore } from "../store/uiStore";
import { useUploadStore } from "../store/uploadStore";
import { useAuthStore } from "../store/authStore";
import { AccountMenu } from "./AccountMenu";
import { IconButton } from "./ui/Button";
import { Logo } from "./Logo";

/**
 * Full-width bar above everything: menu + wordmark on the left, the one
 * search field in the middle, upload + account on the right.
 */
export function TopBar() {
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const mainView = useUiStore((s) => s.mainView);
  const showSearch = useUiStore((s) => s.showSearch);
  const goBack = useUiStore((s) => s.goBack);
  const canGoBack = useUiStore((s) => s.canGoBack);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  const uploading = useUploadStore((s) => s.running);
  const openUpload = useUploadStore((s) => s.openWith);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K or "/" focuses search from anywhere (unless typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onChange = (value: string) => {
    setSearch(value);
    if (value.trim()) showSearch();
  };

  const clear = () => {
    setSearch("");
    if (mainView === "search") goBack();
    inputRef.current?.blur();
  };

  return (
    <header className="h-16 shrink-0 flex items-center gap-2 md:gap-4 px-2 md:px-4 relative z-20">
      <div className="flex items-center gap-1 md:w-[13.5rem] shrink-0">
        <IconButton label="Menu" size="md" onClick={toggleSidebar} className="md:hidden">
          <MenuIcon className="w-5 h-5" />
        </IconButton>
        <IconButton label="Collapse sidebar" size="md" onClick={toggleSidebarCollapsed} className="hidden md:inline-flex">
          <MenuIcon className="w-5 h-5" />
        </IconButton>
        <Logo className="hidden sm:flex ml-1" />
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        <IconButton
          label="Back"
          size="md"
          onClick={goBack}
          disabled={!canGoBack}
          className="hidden md:inline-flex disabled:invisible"
        >
          <ArrowLeft className="w-5 h-5" />
        </IconButton>
        <div className="relative w-full max-w-xl group">
          <Search className="w-[18px] h-[18px] absolute left-4 top-1/2 -translate-y-1/2 text-subtle group-focus-within:text-fg transition-colors pointer-events-none" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => search.trim() && showSearch()}
            onKeyDown={(e) => {
              if (e.key === "Escape") clear();
            }}
            placeholder="Search songs, albums, artists"
            spellCheck={false}
            className="w-full h-11 pl-11 pr-10 rounded-full bg-surface-2 border border-transparent text-sm text-fg placeholder:text-subtle transition-[background-color,border-color,box-shadow] duration-200 hover:bg-surface-3 focus:outline-none focus:bg-surface focus:border-line focus:shadow-[0_8px_30px_-12px_rgb(0_0_0/0.5)]"
          />
          {search && (
            <button
              onClick={clear}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-3 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {signedIn && (
          <button
            onClick={() => openUpload()}
            title="Upload music to your vault"
            className="hidden sm:inline-flex items-center gap-2 h-9 px-4 rounded-full text-sm font-semibold text-fg bg-surface-2 hover:bg-surface-3 active:scale-[0.97] transition-[background-color,transform]"
          >
            <UploadCloud className={`w-4 h-4 ${uploading ? "text-accent animate-pulse" : ""}`} />
            {uploading ? "Uploading…" : "Upload"}
          </button>
        )}
        <AccountMenu />
      </div>
    </header>
  );
}
