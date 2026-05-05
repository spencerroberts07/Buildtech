import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const isProduction = process.env.NODE_ENV === 'production';
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : (isProduction ? { rejectUnauthorized: false } : false),
});

export const query = (text, params) => pool.query(text, params);