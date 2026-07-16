"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { ZONES } from '../../lib/venue/venue';
import { Zone } from '../../lib/types';
import { generateDemoQrPayload, parseQrPayload } from '../../lib/onboarding/qr';

interface BlockPickerProps {
  onSelect: (zoneId: string) => void;
  onError: (msg: string) => void;
}

export function BlockPicker({ onSelect, onError }: BlockPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // 100ms debounce on search keystroke
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 100);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  // Extract all sections from ZONES
  const sections = useMemo(() => {
    return ZONES.filter(z => z.type === 'section');
  }, []);

  // Filter sections based on debounced search query
  const filteredSections = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(sec => sec.label.toLowerCase().includes(q));
  }, [sections, debouncedQuery]);

  // Group sections by Tier and Stand in a logical order
  const groupedSections = useMemo(() => {
    const groups: Record<string, Zone[]> = {};
    
    // Static group order to keep layout stable:
    // Tiers: Lower, Mid, Upper. Stands: North, East, South, West.
    const tierMap: Record<number, string> = { 1: 'Lower Tier', 2: 'Mid Tier', 3: 'Upper Tier' };
    const standMap: Record<string, string> = { n: 'North Stand', e: 'East Stand', s: 'South Stand', w: 'West Stand' };

    filteredSections.forEach(sec => {
      const tierName = sec.tier ? (tierMap[sec.tier] || `Tier ${sec.tier}`) : 'Other Tier';
      const standName = sec.stand ? (standMap[sec.stand] || 'Other Stand') : 'Other Stand';
      const key = `${tierName} - ${standName}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(sec);
    });

    return groups;
  }, [filteredSections]);

  // Sorted list of keys so that the output groups order remains consistent
  const orderedGroupKeys = useMemo(() => {
    const tiers = ['Lower Tier', 'Mid Tier', 'Upper Tier'];
    const stands = ['North Stand', 'East Stand', 'South Stand', 'West Stand'];
    const keys: string[] = [];

    tiers.forEach(tier => {
      stands.forEach(stand => {
        const key = `${tier} - ${stand}`;
        if (groupedSections[key] && groupedSections[key].length > 0) {
          keys.push(key);
        }
      });
    });

    return keys;
  }, [groupedSections]);

  const handleSelect = (zone: Zone) => {
    // Single validated entry path: we create the JSON payload and pass it to parseQrPayload
    const payload = generateDemoQrPayload(zone.id);
    const validated = parseQrPayload(payload);
    if (validated) {
      onSelect(validated.zoneId);
    } else {
      onError("Section validation failed");
    }
  };

  const handleClearFilter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setSearchQuery('');
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="text-center max-w-sm mx-auto">
        <h2 className="text-lg font-bold text-text-primary">Find Your Section</h2>
        <p className="text-sm text-text-secondary mt-1">
          Select your seat block manually from the stadium list below.
        </p>
      </div>

      {/* Filter Input */}
      <div className="w-full">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search section number (e.g. 214)"
          aria-label="Filter sections"
          className="w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary/70 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* List Container */}
      <div className="w-full max-h-[300px] overflow-y-auto border border-border rounded-lg bg-surface">
        {orderedGroupKeys.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-secondary flex flex-col gap-1">
            <span>No section matches &apos;{debouncedQuery}&apos;</span>
            <a
              href="#"
              onClick={handleClearFilter}
              className="text-accent font-semibold hover:underline"
            >
              Clear filter
            </a>
          </div>
        ) : (
          orderedGroupKeys.map((key) => (
            <div key={key} className="border-b border-border last:border-b-0">
              {/* Group Header */}
              <div className="bg-canvas/50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary sticky top-0 border-b border-border/50">
                {key}
              </div>
              {/* Group Sections */}
              <div className="divide-y divide-border/30">
                {groupedSections[key].map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => handleSelect(sec)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(sec);
                      }
                    }}
                    className="w-full h-11 px-4 text-left text-sm hover:bg-canvas/40 flex items-center justify-between transition-colors focus:outline-none focus:bg-canvas/40 focus:ring-2 focus:ring-accent focus:ring-inset"
                  >
                    <span className="font-semibold text-text-primary">Section {sec.label}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-accent/10 text-accent">
                      {sec.tier === 1 ? 'Lower' : sec.tier === 2 ? 'Mid' : 'Upper'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
