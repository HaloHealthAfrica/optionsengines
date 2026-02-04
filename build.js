import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build TypeScript
console.log('Building TypeScript...');
execSync('tsc', { stdio: 'inherit' });

// Copy SQL migrations
console.log('Copying SQL migrations...');
const migrationsDir = join(__dirname, 'src', 'migrations');
const distMigrationsDir = join(__dirname, 'dist', 'migrations');

try {
  mkdirSync(distMigrationsDir, { recursive: true });
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  files.forEach(file => {
    copyFileSync(
      join(migrationsDir, file),
      join(distMigrationsDir, file)
    );
    console.log(`Copied ${file}`);
  });
  console.log('Build complete!');
} catch (err) {
  console.error('Error copying migrations:', err);
  process.exit(1);
}
