import { useEffect, useRef } from "react";

interface AudioVisualizerProps {
  isPlaying: boolean;
  analyser: AnalyserNode | null;
  themeColor: string; // e.g., 'rgb(14, 165, 233)'
}

export default function AudioVisualizer({ isPlaying, analyser, themeColor }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize observer to handle dynamic containers
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width * (window.devicePixelRatio || 1);
        canvas.height = entry.contentRect.height * (window.devicePixelRatio || 1);
        ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      }
    });

    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    let t = 0;
    const bufferLength = analyser ? analyser.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);

      ctx.clearRect(0, 0, width, height);

      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(dataArray);

        // Draw double-sided smooth wave or symmetric bar spectrum
        const barWidth = (width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;

        ctx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          barHeight = (dataArray[i] / 255) * (height * 0.7);

          // Smooth colors combining theme with accents
          const r = 14 + (dataArray[i] / 255) * 40;
          const g = 165 + (dataArray[i] / 255) * 50;
          const b = 233 + (dataArray[i] / 255) * 22;

          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
          
          // Draw symmetric bars
          const yPos = (height - barHeight) / 2;
          ctx.fillRect(x, yPos, barWidth - 1, barHeight);

          x += barWidth;
        }
      } else {
        // Fallback procedural visualizer (sleek modern sine waves) when stream is active but Analyser CORS is restricted
        t += 0.05;
        const numWaves = 3;
        
        ctx.lineWidth = 2;
        
        for (let w = 0; w < numWaves; w++) {
          ctx.beginPath();
          const amplitude = isPlaying ? (20 - w * 4) : 2; // waves dance when playing
          const frequency = 0.015 + w * 0.005;
          const opacity = 0.6 - w * 0.15;
          
          ctx.strokeStyle = themeColor.replace(")", `, ${opacity})`).replace("rgb", "rgba");

          for (let x = 0; x < width; x++) {
            const y = height / 2 + Math.sin(x * frequency + t + w * 0.8) * amplitude * Math.sin(x * 0.005);
            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }

        // Draw a light floating audio indicator when playing (ambient equalizer circles or bars)
        if (isPlaying) {
          const barCount = 18;
          const barSpacing = width / barCount;
          ctx.fillStyle = themeColor.replace(")", ", 0.25)").replace("rgb", "rgba");

          for (let i = 0; i < barCount; i++) {
            const h = Math.abs(Math.sin(t + i * 0.4) * (height * 0.3)) + 4;
            const x = i * barSpacing + barSpacing / 2;
            const y = (height - h) / 2;
            ctx.fillRect(x - 2, y, 4, h);
          }
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      resizeObserver.disconnect();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, analyser, themeColor]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block focus:outline-none pointer-events-none"
      aria-hidden="true"
    />
  );
}
