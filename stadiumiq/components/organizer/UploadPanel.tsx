"use client";

import React, { useState, useRef } from 'react';
import { useSimStore } from '@/lib/store/simStore';
import { validateUploadDataset } from '@/lib/validation/uploadDataset';
import { ZONES } from '@/lib/venue/venue';
import {
  UploadCloud,
  FileCode,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Eye,
  EyeOff
} from 'lucide-react';

export function UploadPanel() {
  const importDataset = useSimStore((s) => s.importDataset);
  const reset = useSimStore((s) => s.reset);

  // Form State
  const [jsonText, setJsonText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [successMsg, setSuccessMsg] = useState('');
  const [showSample, setShowSample] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sample upload schema content (synced from data/sample-upload.json)
  const sampleJsonText = JSON.stringify(
    {
      density: {
        "sec-101": 0.45,
        "sec-102": 0.50,
        "gate-a": 0.90,
      },
      gateStatus: {
        "gate-a": "congested",
        "gate-b": "open",
        "gate-d": "closed",
      },
      incidents: [
        {
          id: "inc-1001",
          type: "medical",
          zoneId: "sec-105",
          note: "Fan experiencing heat exhaustion.",
          status: "pending",
          createdAt: 300,
        },
      ],
    },
    null,
    2
  );

  // Handle file select & read
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size first before reading
    const maxSize = 200000;
    if (file.size > maxSize) {
      setErrors([`File size exceeds limit of ${maxSize / 1000}KB.`]);
      setSuccessMsg('');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setJsonText(text);
    };
    reader.onerror = () => {
      setErrors(['Failed to read file. Please try copy-pasting JSON text directly.']);
      setSuccessMsg('');
    };
    reader.readAsText(file);
  };

  // Submit and apply dataset
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setSuccessMsg('');

    // 1. Perform client-side validation
    const validation = validateUploadDataset(jsonText);

    if (!validation.valid || !validation.data) {
      setErrors(validation.errors);
      return;
    }

    // 2. Call importDataset store action
    const res = importDataset(validation.data);

    if (!res.ok) {
      setErrors([res.error || 'Failed to import dataset.']);
      return;
    }

    // 3. Clear text, reset file selector, show success banner
    setJsonText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    
    // Count active variables for success badge
    const zonesCount = Object.keys(validation.data.density || {}).length;
    const incidentsCount = validation.data.incidents?.length || 0;
    setSuccessMsg(`Dataset applied successfully — ${zonesCount} zones and ${incidentsCount} incidents updated.`);
  };

  // Reset baseline simulation
  const handleReset = () => {
    reset(ZONES);
    setErrors([]);
    setSuccessMsg('');
    setJsonText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full" data-testid="upload-panel-container" role="region" aria-label="Dataset Importer">
      {/* 1. File Upload Dropzone */}
      <div className="flex items-center gap-2">
        <label className="flex-1 flex items-center justify-center gap-2 py-2 px-3 border border-dashed border-blue-200 hover:border-blue-300 bg-blue-50/20 hover:bg-blue-50/50 rounded-xl text-blue-800 text-[11px] font-bold transition-all cursor-pointer select-none">
          <UploadCloud className="w-4 h-4 text-blue-600" />
          <span>Upload JSON File</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
            data-testid="upload-file-input"
          />
        </label>

        {/* View Sample Format Link */}
        <button
          type="button"
          onClick={() => setShowSample(!showSample)}
          data-testid="view-sample-format-toggle"
          className="p-2 border border-border hover:bg-canvas rounded-xl text-text-secondary transition-colors cursor-pointer"
          title={showSample ? "Hide sample JSON structure" : "View sample JSON structure"}
        >
          {showSample ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {/* 2. Sample Code Block */}
      {showSample && (
        <div className="bg-canvas border border-border/80 rounded-xl p-3 text-xs flex flex-col gap-1.5 animate-fadeIn" data-testid="sample-format-block">
          <span className="text-[9px] text-text-secondary font-bold uppercase tracking-wider flex items-center gap-1">
            <FileCode className="w-3.5 h-3.5 text-accent" />
            Sample Upload Dataset Format
          </span>
          <pre className="font-mono text-sm text-text-primary bg-surface border border-border/60 p-2.5 rounded overflow-x-auto max-h-[140px] leading-relaxed">
            {sampleJsonText}
          </pre>
        </div>
      )}

      {/* 3. Paste Text Area Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-text-secondary uppercase font-bold tracking-wider px-0.5">Or Paste JSON Dataset</span>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder='{ "density": { "sec-101": 0.8 }, "gateStatus": { "gate-a": "closed" } }'
            data-testid="upload-textarea"
            rows={4}
            className="w-full p-3 rounded-xl border border-border bg-canvas focus:outline-none focus:ring-1 focus:ring-accent font-mono text-sm leading-relaxed placeholder:text-text-secondary/50 text-text-primary resize-none"
          />
        </div>

        {/* Validation Errors display */}
        {errors.length > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-[11px] flex flex-col gap-1.5 animate-fadeIn" data-testid="upload-error-list">
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-[9px] text-red-950">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
              Rejection: Malformed Dataset
            </div>
            <ul className="list-disc pl-4 flex flex-col gap-0.5 font-medium leading-normal">
              {errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Success Confirmation display */}
        {successMsg && (
          <div className="p-3.5 bg-green-50 border border-green-200 text-green-800 rounded-xl text-xs flex items-center gap-2 animate-fadeIn" data-testid="upload-success-banner">
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
            <span className="font-semibold text-green-950 leading-relaxed">{successMsg}</span>
          </div>
        )}

        {/* Actions button row */}
        <div className="flex items-center gap-2 mt-1">
          <button
            type="submit"
            disabled={!jsonText.trim()}
            data-testid="upload-submit-btn"
            className="flex-1 py-2 px-3 rounded-xl bg-accent hover:bg-accent/95 disabled:opacity-40 text-white font-bold text-[11px] transition-colors cursor-pointer flex items-center justify-center gap-1.5 select-none shadow-sm"
          >
            <FileCode className="w-3.5 h-3.5" />
            Validate & Apply
          </button>
          
          <button
            type="button"
            onClick={handleReset}
            data-testid="upload-reset-btn"
            className="py-2 px-3 rounded-xl border border-border bg-canvas hover:bg-canvas/80 font-bold text-[11px] text-text-secondary transition-colors cursor-pointer flex items-center gap-1.5 select-none shadow-sm font-sans"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Baseline
          </button>
        </div>
      </form>
    </div>
  );
}
