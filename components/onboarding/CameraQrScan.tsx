"use client";

import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseQrPayload } from '../../lib/onboarding/qr';

interface CameraQrScanProps {
  onScan: (zoneId: string) => void;
  onError: (msg: string) => void;
  onCancel: () => void;
}

type CameraStatus = 'starting' | 'scanning' | 'error';

export function CameraQrScan({ onScan, onError, onCancel }: CameraQrScanProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [status, setStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function scanLoop() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });

          if (code?.data) {
            const validated = parseQrPayload(code.data);
            if (validated) {
              cancelled = true;
              onScan(validated.zoneId);
              return;
            }
            onError('QR code scanned, but it is not a valid seat block code.');
          }
        }
      }

      rafRef.current = requestAnimationFrame(scanLoop);
    }

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera access isn't supported on this device or browser.");
        setStatus('error');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (cancelled) return;
        setStatus('scanning');
        rafRef.current = requestAnimationFrame(scanLoop);
      } catch {
        if (!cancelled) {
          setCameraError("Couldn't access your camera. Check permissions and try again.");
          setStatus('error');
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [onScan, onError]);

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div
        className="relative w-48 h-48 rounded-xl overflow-hidden bg-black flex items-center justify-center border border-border"
        role="img"
        aria-label="Camera viewfinder for scanning a QR code"
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
          aria-hidden="true"
        />
        <canvas ref={canvasRef} className="hidden" />

        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-xs font-semibold">
            Starting camera...
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white text-xs text-center p-4">
            {cameraError}
          </div>
        )}

        {status === 'scanning' && (
          <div className="absolute inset-0 border-2 border-accent/70 rounded-xl pointer-events-none" aria-hidden="true" />
        )}
      </div>

      <p className="text-xs text-text-secondary text-center max-w-[220px]">
        Point your camera at any seat block QR code to set your location.
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="text-sm font-semibold text-accent hover:underline focus:outline-none"
      >
        Cancel camera scan
      </button>
    </div>
  );
}
