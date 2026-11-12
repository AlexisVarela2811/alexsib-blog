export const existingObjectsQuery = "SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 1";
