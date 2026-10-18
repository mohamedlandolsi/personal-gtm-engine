import "server-only";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// HTTP driver: one round trip per query, no connection pool to manage on Vercel.
// Always use the tagged template: sql`select ... where id = ${id}` (values are sent as parameters).
export const sql = neon(url);
