'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';

interface SpectrumVisualizerProps {
  height?: number;
  barCount?: number;
  className?: string;
  showPeaks?: boolean;
}

export function SpectrumVisualizer({
  height = 96,
  barCount = 32,
  className = '',
  showPeaks = true,
}: SpectrumVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const status = usePlayerStore((s) => s.status);
  const isPlaying = status === 'playing';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const bufferLength = 64;
    const dataArray = new Uint8Array(bufferLength);
    const peaks = new Float32Array(barCount).fill(0);
    const smoothedValues = new Float32Array(barCount).fill(0);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(rect.width * dpr, 100);
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let phase = 0;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const h = height;

      ctx.clearRect(0, 0, width, h);

      if (audioEngine) {
        audioEngine.getFrequencyData(dataArray);
      }

      const totalBars = barCount;
      const spacing = 3;
      const totalSpacing = spacing * (totalBars - 1);
      const barWidth = Math.max(2, (width - totalSpacing) / totalBars);

      // Gradient for bars
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
      gradient.addColorStop(0.5, 'var(--art-primary, rgba(255, 255, 255, 0.75))');
      gradient.addColorStop(1, 'var(--art-secondary, rgba(255, 255, 255, 0.95))');

      const isSilenced = !isPlaying || dataArray.every((v) => v === 0);

      phase += 0.04;

      for (let i = 0; i < totalBars; i++) {
        // Map bar index to frequency spectrum with logarithmic weight
        const binIndex = Math.min(
          bufferLength - 1,
          Math.floor(Math.pow(i / totalBars, 1.35) * (bufferLength - 4))
        );
        const raw = isSilenced
          ? isPlaying
            ? Math.sin(phase + i * 0.3) * 6 + 10
            : 4 + Math.sin(phase * 0.5 + i * 0.2) * 2
          : dataArray[binIndex] || 0;

        const targetHeight = Math.max(3, (raw / 255) * (h - 8));

        // Smooth damping
        smoothedValues[i] += (targetHeight - smoothedValues[i]) * 0.35;
        const curHeight = smoothedValues[i];

        // Peak tracking with gravity
        if (curHeight > peaks[i]) {
          peaks[i] = curHeight;
        } else {
          peaks[i] = Math.max(0, peaks[i] - 0.75);
        }

        const x = i * (barWidth + spacing);
        const y = h - curHeight;

        // Draw rounded bar
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = Math.min(barWidth / 2, 3);
        ctx.roundRect(x, y, barWidth, curHeight, [radius, radius, 0, 0]);
        ctx.fill();

        // Draw peak dot / line
        if (showPeaks && peaks[i] > 3) {
          const peakY = Math.max(0, h - peaks[i] - 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.beginPath();
          ctx.roundRect(x, peakY, barWidth, 1.5, [1, 1, 1, 1]);
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [height, barCount, isPlaying, showPeaks]);

  return (
    <div className={`relative w-full overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ height: `${height}px` }}
        className="w-full block"
      />
    </div>
  );
}
