// pnpm db:migrate — applies new migrations from db/migrations using MIGRATION_DATABASE_URL (database owner).
import { loadEnvFile } from '../src/core/config/app-config';
import { runMigrations } from '../src/core/database/migrations';

loadEnvFile();
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL is not set');
  process.exit(1);
}
runMigrations(url, console.log)
  .then((count) => console.log(count ? `${count} migration(s) applied` : 'database is up to date'))
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
