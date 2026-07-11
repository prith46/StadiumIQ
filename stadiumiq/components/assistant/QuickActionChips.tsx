"use client";

import React from 'react';

interface QuickActionChipsProps {
  onSelect: (text: string) => void;
  disabled?: boolean;
}

export function QuickActionChips({ onSelect, disabled }: QuickActionChipsProps) {
  const chips = [
    "Where's the nearest restroom?",
    "How do I get to my seat?",
    "What's nearby?"
  ];

  return (
    <div className="flex flex-wrap gap-2 py-1.5 w-full overflow-x-auto no-scrollbar">
      {chips.map((text, idx) => (
        <button
          key={idx}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(text)}
          className="px-3.5 py-1.5 bg-surface text-xs font-semibold text-accent border border-accent/20 rounded-full hover:bg-accent/5 disabled:opacity-50 disabled:pointer-events-none transition-colors duration-150 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
