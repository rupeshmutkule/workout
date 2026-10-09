import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist/web', { recursive: true });
await Promise.all(['index.html', 'styles.css', 'quiet.css', 'landing.css', 'aira-doodle.svg', 'aira-portrait.png'].map(file => copyFile(`src/web/${file}`, `dist/web/${file}`)));
console.log('Built local server and browser assets.');
