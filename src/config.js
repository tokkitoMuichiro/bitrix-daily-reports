import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const port = Number(process.env.PORT) || 3000;
export const publicDir = path.join(__dirname, '../public');
export const rootDir = path.join(__dirname, '..');