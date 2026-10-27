// Builds README.md (frame index with captions) and, when ffmpeg is installed, story.mp4: a stitched
// slideshow of every frame in story order (each frame letterboxed to 1440x900, 4 s each).
// An optional NOTES.md in <demoOutDir> (reviewer notes: status, known gaps) is placed above the frame index.
// Usage: node make-readme.mjs <demoOutDir>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const out = process.argv[2];
const frames = existsSync(join(out, 'frames.json')) ? JSON.parse(readFileSync(join(out, 'frames.json'), 'utf8')) : [];
const story = existsSync(join(out, 'story.log')) ? readFileSync(join(out, 'story.log'), 'utf8').trim() : '';
const notes = existsSync(join(out, 'NOTES.md')) ? readFileSync(join(out, 'NOTES.md'), 'utf8').trim() : '';
const videos = existsSync(join(out, 'video'))
  ? readdirSync(join(out, 'video'), { recursive: true }).filter((f) => String(f).endsWith('.webm')).map(String).sort()
  : [];

let stitched = false;
if (frames.length) {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    const list = frames.map((f) => `file '${join(out, 'frames', f.file)}'\nduration 4`).join('\n') + `\nfile '${join(out, 'frames', frames.at(-1).file)}'\n`;
    writeFileSync(join(out, 'frames.ffconcat'), list);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(out, 'frames.ffconcat'),
      '-vf', 'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p',
      '-r', '25', '-c:v', 'libx264', '-crf', '28', join(out, 'story.mp4')]);
    stitched = true;
  } catch {
    stitched = false;
  }
}

const md = [
  '# Flavrly × Novaryq India — integrated demo (local)',
  '',
  'Recorded by `scripts/integrated-demo/run-demo.sh` (maverick-food-hub, branch `demo/flavrly-novaryq-india`) against a',
  'local stack: Novaryq API + web from `feat/flavrly-ordering-channel`, Flavrly web from `feat/novaryq-integration`,',
  'private Postgres 16 + Redis, fake demo data only. Nothing here touched production.',
  '',
  stitched ? '- `story.mp4` — every frame below in order (4 s each).' : '- (ffmpeg not available: no stitched video)',
  '- `video/<actor>/*.webm` — raw per-browser recordings (Flavrly admin, customer, Novaryq kitchen, …).',
  '- `story.log` — timestamped notes the run wrote (what was done through which surface).',
  '',
  ...(notes ? [notes, ''] : []),
  '## Frames',
  '',
  '| # | Frame | What it shows |',
  '|---|---|---|',
  ...frames.map((f, i) => `| ${i + 1} | [${f.file}](frames/${f.file}) | ${f.caption.replace(/\|/g, '\\|')} |`),
  '',
  '## Raw videos',
  '',
  ...(videos.length ? videos.map((v) => `- video/${v}`) : ['- (none)']),
  '',
  '## Run notes',
  '',
  '```',
  story || '(no notes)',
  '```',
  '',
];
writeFileSync(join(out, 'README.md'), md.join('\n'));
console.log(`README.md: ${frames.length} frames${stitched ? ', story.mp4 stitched' : ''}`);
