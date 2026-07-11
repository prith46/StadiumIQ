"use client";

import * as React from "react";
import { useSimStore } from "../lib/store/simStore";

const LANGUAGES = [
  { code: "en", flag: "🇺🇸", name: "English" },
  { code: "es", flag: "🇪🇸", name: "Español" },
  { code: "fr", flag: "🇫🇷", name: "Français" },
  { code: "pt", flag: "🇧🇷", name: "Português" },
  { code: "ja", flag: "🇯🇵", name: "日本語" },
  { code: "ko", flag: "🇰🇷", name: "한국어" },
  { code: "de", flag: "🇩🇪", name: "Deutsch" },
  { code: "it", flag: "🇮🇹", name: "Italiano" },
  { code: "nl", flag: "🇳🇱", name: "Nederlands" },
  { code: "hr", flag: "🇭🇷", name: "Hrvatski" },
  { code: "da", flag: "🇩🇰", name: "Dansk" },
  { code: "sv", flag: "🇸🇪", name: "Svenska" },
  { code: "pl", flag: "🇵🇱", name: "Polski" },
  { code: "uk", flag: "🇺🇦", name: "Українська" },
  { code: "ar", flag: "🇸🇦", name: "العربية" },
  { code: "fa", flag: "🇮🇷", name: "فارسی" },
  { code: "zh", flag: "🇨🇳", name: "中文" },
] as const;

export function LanguagePicker() {
  const currentLangCode = useSimStore((s) => s.fanContext.language) || "en";
  const setFanLanguage = useSimStore((s) => s.setFanLanguage);

  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const currentLang = LANGUAGES.find((l) => l.code === currentLangCode) || LANGUAGES[0];

  // Close dropdown on outside click
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  React.useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    } else {
      setSearch("");
    }
  }, [isOpen]);

  const filtered = LANGUAGES.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.code.toLowerCase().includes(search.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select Language"
        className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border hover:bg-surface-hover hover:border-text-secondary text-text-primary text-xs font-semibold rounded-control shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
      >
        <span className="text-sm">{currentLang.flag}</span>
        <span className="uppercase text-[10px] tracking-wide text-text-secondary font-bold">
          {currentLang.code}
        </span>
        {/* Chevron Icon */}
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current opacity-60" fill="none" strokeWidth={2.5}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Languages"
          className="absolute right-0 mt-1.5 w-52 rounded-xl bg-surface border border-border shadow-dropdown py-2 z-50 flex flex-col gap-1 focus-visible:outline-none"
        >
          {/* Search Box */}
          <div className="px-2 pb-1.5 border-b border-border">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search language..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-canvas border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

          {/* Language Options */}
          <div className="max-h-48 overflow-y-auto flex flex-col px-1">
            {filtered.length > 0 ? (
              filtered.map((lang) => {
                const selected = lang.code === currentLangCode;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setFanLanguage(lang.code);
                      setIsOpen(false);
                    }}
                    className={`flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      selected
                        ? "bg-accent/15 text-accent"
                        : "text-text-primary hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm">{lang.flag}</span>
                      <span>{lang.name}</span>
                    </span>
                    {selected && (
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current" fill="none" strokeWidth={3}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })
            ) : (
              <span className="px-3 py-2 text-xs text-text-secondary italic">No languages found</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
