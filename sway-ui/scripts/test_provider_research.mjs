const testCases = [
  { title: 'Aaj Ki Raat (From "Stree 2")', artist: 'Sachin-Jigar, Madhubanti Bagchi, Divya Kumar', album: 'Stree 2' },
  { title: 'Aayi Nai (From "Stree 2")', artist: 'Pawan Singh, Simran Choudhary, Divya Kumar, Sachin-Jigar', album: 'Stree 2' },
  { title: 'Taras (From "Munjya")', artist: 'Sachin-Jigar, Jasmine Sandlas, Amitabh Bhattacharya', album: 'Munjya' },
  { title: 'Soni Soni (From "Ishq Vishk Rebound")', artist: 'Darshan Raval, Jonita Gandhi, Rochak Kohli', album: 'Ishq Vishk Rebound' },
  { title: 'Naina (From "Crew")', artist: 'Diljit Dosanjh, Badshah, Raj Ranjodh', album: 'Crew' },
  { title: 'Illuminati (From "Aavesham")', artist: 'Sushin Shyam, Dabzee', album: 'Aavesham' },
  { title: 'Pehle Bhi Main (From "Animal")', artist: 'Vishal Mishra, Raj Shekhar', album: 'Animal' },
  { title: 'O Maahi (From "Dunki")', artist: 'Pritam, Arijit Singh, Irshad Kamil', album: 'Dunki' },
  { title: 'Tauba Tauba (From "Bad Newz")', artist: 'Karan Aujla', album: 'Bad Newz' },
  { title: 'Channa Mereya - From "Ae Dil Hai Mushkil"', artist: 'Pritam, Arijit Singh', album: 'Ae Dil Hai Mushkil' },
  { title: 'Tum Hi Ho', artist: 'Arijit Singh, Mithoon', album: 'Aashiqui 2' },
  { title: 'Agar Tum Saath Ho', artist: 'Alka Yagnik, Arijit Singh', album: 'Tamasha' },
  { title: 'Kahani Suno 2.0', artist: 'Kaifi Khalil', album: 'Kahani Suno 2.0' },
  { title: 'Husn', artist: 'Anuv Jain', album: 'Husn' }
];

async function checkLRCLIB(title, artist) {
  try {
    const cleanTitle = title
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s*-\s*(?:From|OST|Original|Official).*/i, '')
      .replace(/\s*-\s*.*/, '')
      .trim() || title;
    const primaryArtist = artist.split(/[,&/|]/)[0].replace(/feat\..*/i, '').trim();

    const q = `${cleanTitle} ${primaryArtist}`;
    const res = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q), {
      headers: { 'Lrclib-Client': 'SwayMusic/2.0' }
    });
    const list = await res.json();
    const synced = Array.isArray(list) && list.some(x => x.syncedLyrics);
    const plain = Array.isArray(list) && list.some(x => x.plainLyrics);
    return { synced, plain, count: Array.isArray(list) ? list.length : 0 };
  } catch (e) {
    return { error: e.message };
  }
}

async function run() {
  console.log("Testing LRCLIB with 14 top Indian tracks:");
  for (const t of testCases) {
    const res = await checkLRCLIB(t.title, t.artist);
    console.log(`- "${t.title}" -> Synced: ${res.synced}, Plain: ${res.plain} (found ${res.count})`);
  }
}

run();
