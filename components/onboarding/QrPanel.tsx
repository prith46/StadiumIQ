"use client";

import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { generateDemoQrPayload, parseQrPayload } from '../../lib/onboarding/qr';
import { CameraQrScan } from './CameraQrScan';

interface QrPanelProps {
  onScan: (zoneId: string) => void;
  onError: (msg: string) => void;
  onShowPicker: () => void;
}

export function QrPanel({ onScan, onError, onShowPicker }: QrPanelProps) {
  const [qrSvg, setQrSvg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [showCamera, setShowCamera] = useState<boolean>(false);

  // Memoize payload to ensure QR is not unnecessarily regenerated
  const demoPayload = useMemo(() => generateDemoQrPayload('sec-214'), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    QRCode.toString(
      demoPayload,
      {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      },
      (err, svgString) => {
        if (active) {
          setLoading(false);
          if (err) {
            onError('Could not generate QR code');
          } else if (svgString) {
            setQrSvg(svgString);
          }
        }
      }
    );

    return () => {
      active = false;
    };
  }, [demoPayload, onError]);

  const handleSimulateScan = () => {
    // 500-byte security check is run inside parseQrPayload
    const validated = parseQrPayload(demoPayload);
    if (validated) {
      onScan(validated.zoneId);
    } else {
      onError("Invalid scan payload");
    }
  };

  if (showCamera) {
    return (
      <div className="flex flex-col items-center gap-6 w-full">
        <div className="text-center w-full">
          <h2 className="text-2xl font-bold text-text-primary">Scan QR Code</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Point your camera at any seat block QR code around the stadium.
          </p>
        </div>
        <CameraQrScan
          onScan={onScan}
          onError={onError}
          onCancel={() => setShowCamera(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <div className="text-center w-full">
        <h2 className="text-2xl font-bold text-text-primary">Scan QR Code</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Scan the QR code printed on your seat block with your phone camera to set your location instantly.
        </p>
      </div>

      {/* Scannable Frame */}
      <div className="relative p-6 bg-white rounded-xl shadow-inner border border-border flex items-center justify-center">
        {/* Corner Brackets */}
        <div className="absolute top-2 left-2 w-6 h-6 border-t-4 border-l-4 border-accent rounded-tl" />
        <div className="absolute top-2 right-2 w-6 h-6 border-t-4 border-r-4 border-accent rounded-tr" />
        <div className="absolute bottom-2 left-2 w-6 h-6 border-b-4 border-l-4 border-accent rounded-bl" />
        <div className="absolute bottom-2 right-2 w-6 h-6 border-b-4 border-r-4 border-accent rounded-br" />

        {loading ? (
          <div className="w-48 h-48 flex items-center justify-center bg-gray-50 rounded animate-pulse" aria-hidden="true">
            <span className="text-gray-400 text-xs">Generating QR...</span>
          </div>
        ) : (
          <div
            className="w-48 h-48 flex items-center justify-center select-none"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            aria-label="Onboarding QR Code"
            role="img"
          />
        )}
      </div>

      <div className="w-full flex flex-col gap-4 items-center">
        <button
          type="button"
          onClick={handleSimulateScan}
          className="w-full py-2.5 px-4 bg-accent hover:bg-accent/95 text-white font-semibold rounded-lg shadow-sm transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Simulate Scan
        </button>

        <button
          type="button"
          onClick={() => setShowCamera(true)}
          className="w-full py-2.5 px-4 bg-transparent border border-border hover:bg-canvas/50 text-text-primary font-semibold rounded-lg transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
        >
          Scan with Camera
        </button>

        <button
          type="button"
          onClick={onShowPicker}
          className="w-full text-center text-sm font-semibold text-accent hover:underline focus:outline-none"
        >
          I don&apos;t have a QR code
        </button>
      </div>
    </div>
  );
}
