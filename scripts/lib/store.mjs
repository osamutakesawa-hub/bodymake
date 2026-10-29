import fs from 'node:fs';
import path from 'node:path';

export function loadRecords(daysDir) {
  if (!fs.existsSync(daysDir)) return [];
  return fs
    .readdirSync(daysDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf8')));
}

export function loadConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
