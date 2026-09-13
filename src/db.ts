import { Pool, type PoolClient } from 'pg';
export const db = new Pool({connectionString:process.env.DATABASE_URL, max:4, connectionTimeoutMillis:5000, statement_timeout:10000});
export async function transaction<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T> {
 const c=await db.connect();
 try { await c.query('BEGIN'); const r=await fn(c); await c.query('COMMIT'); return r; }
 catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
