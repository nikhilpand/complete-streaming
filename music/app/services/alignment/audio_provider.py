"""
Audio acquisition and line-constrained windowing service.

Fetches streaming audio via HTTP/CDN and decodes directly to 16kHz mono PCM float32
using ffmpeg streaming pipes without leaving temporary files on disk.
"""

from __future__ import annotations

import asyncio
import subprocess
import numpy as np
import httpx
from typing import Optional, Tuple


class AudioProvider:
    DEFAULT_SAMPLE_RATE: int = 16000

    @classmethod
    async def fetch_and_decode(
        cls,
        stream_url: str,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        timeout_seconds: float = 40.0,
    ) -> np.ndarray:
        """
        Stream audio from URL and decode to 16kHz mono float32 PCM in memory.
        """
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-i", "pipe:0",
            "-f", "s16le",
            "-acodec", "pcm_s16le",
            "-ac", "1",
            "-ar", str(sample_rate),
            "-",
        ]

        # Use httpx to stream audio chunks directly into ffmpeg stdin
        async with httpx.AsyncClient(
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
            },
            follow_redirects=True,
            timeout=timeout_seconds,
        ) as client:
            async with client.stream("GET", stream_url) as response:
                response.raise_for_status()

                # Start ffmpeg process asynchronously
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                async def feed_input():
                    try:
                        async for chunk in response.aiter_bytes(chunk_size=65536):
                            if proc.stdin and not proc.stdin.is_closing():
                                proc.stdin.write(chunk)
                                await proc.stdin.drain()
                    except Exception:
                        pass
                    finally:
                        if proc.stdin and not proc.stdin.is_closing():
                            proc.stdin.close()
                            await proc.stdin.wait_closed()

                # Run feeder and stdout reader concurrently
                feed_task = asyncio.create_task(feed_input())
                stdout_data, stderr_data = await proc.communicate()
                await feed_task

                if proc.returncode != 0 and len(stdout_data) == 0:
                    err_msg = stderr_data.decode("utf-8", errors="replace").strip()
                    raise RuntimeError(f"FFmpeg decode error (code {proc.returncode}): {err_msg}")

                if len(stdout_data) == 0:
                    raise RuntimeError("FFmpeg produced 0 bytes of decoded audio.")

                # Convert s16le raw bytes to float32 [-1.0, 1.0]
                raw_int16 = np.frombuffer(stdout_data, dtype=np.int16)
                float32_pcm = raw_int16.astype(np.float32) / 32768.0
                return float32_pcm

    @classmethod
    def slice_window(
        cls,
        audio_pcm: np.ndarray,
        start_ms: int,
        end_ms: int,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        pad_ms: int = 200,
    ) -> Tuple[np.ndarray, int]:
        """
        Extract a padded line-constrained audio window from full-track audio.

        Returns:
            (window_pcm, actual_start_ms)
        """
        total_samples = len(audio_pcm)
        total_duration_ms = int((total_samples / sample_rate) * 1000)

        actual_start_ms = max(0, start_ms - pad_ms)
        actual_end_ms = min(total_duration_ms, end_ms + pad_ms)

        start_sample = int((actual_start_ms / 1000.0) * sample_rate)
        end_sample = int((actual_end_ms / 1000.0) * sample_rate)

        window_pcm = audio_pcm[start_sample:end_sample]
        return window_pcm, actual_start_ms
