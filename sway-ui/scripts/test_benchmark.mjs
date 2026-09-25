async function runBenchmark() {
  const tracks = [
    { title: 'Tum Hi Ho', artist: 'Arijit Singh', d: 262000 },
    { title: 'Kesariya', artist: 'Arijit Singh', d: 268000 },
    { title: 'Husn', artist: 'Anuv Jain', d: 218000 },
    { title: 'Softly', artist: 'Karan Aujla', d: 155000 },
    { title: 'Starboy', artist: 'The Weeknd', d: 230000 },
    { title: 'Blinding Lights', artist: 'The Weeknd', d: 200000 },
    { title: 'Shape of You', artist: 'Ed Sheeran', d: 233000 },
    { title: 'Until I Found You', artist: 'Stephen Sanchez', d: 177000 },
  ];

  console.log('='.repeat(80));
  console.log('ULTRA LYRICS ENGINE - RESOLUTION BENCHMARK');
  console.log('='.repeat(80));

  for (const t of tracks) {
    const url = `http://localhost:3000/api/lyrics/resolve?title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist)}&durationMs=${t.d}`;
    const start = Date.now();
    try {
      const res = await fetch(url);
      const json = await res.json();
      const elapsed = Date.now() - start;

      const hasWords = json.lines && json.lines.some((l) => l.words && l.words.length > 0);
      const wordCount = (json.lines || []).reduce((acc, l) => acc + (l.words ? l.words.length : 0), 0);

      console.log(
        `${t.title.padEnd(20)} | ${json.status.padEnd(6)} | Sync: ${(hasWords ? 'WORD' : json.syncQuality).padEnd(5)} | Words: ${String(wordCount).padStart(3)} | Lines: ${String(json.lines ? json.lines.length : 0).padStart(2)} | Provider: ${(json.source?.provider || 'none').padEnd(10)} | Latency: ${elapsed}ms`
      );
    } catch (e) {
      console.log(`${t.title.padEnd(20)} | ERROR: ${e.message}`);
    }
  }
  console.log('='.repeat(80));
}

runBenchmark();
