import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await cp('node_modules/mathjax/es5', 'public/vendor/mathjax', { recursive: true });
