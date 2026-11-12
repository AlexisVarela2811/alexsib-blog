/* eslint-disable @typescript-eslint/no-require-imports -- This diagnostic runs directly as CommonJS. */
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@libsql/client');

loadEnvConfig(process.cwd());
let client;
try {
  client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  client.execute("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name")
    .then((result) => console.log('Tablas:', result.rows.map((row) => row.name).join(', ') || '(ninguna)'))
    .catch(() => { console.error('Falló la consulta del esquema'); process.exitCode = 1; })
    .finally(() => client.close());
} catch {
  console.error('Falló la configuración de Turso');
  process.exitCode = 1;
}
