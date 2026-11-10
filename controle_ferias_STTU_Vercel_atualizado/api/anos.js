import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({erro:'Método não permitido.'});
  if (!process.env.DATABASE_URL) return res.status(503).json({erro:'Banco não configurado.'});
  try {
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT ano FROM sttu_ferias_anos WHERE liberado = TRUE ORDER BY ano`;
    return res.status(200).json({anos:rows.map(r=>r.ano)});
  } catch (e) {console.error('Lista de anos:',e);return res.status(503).json({erro:'Não foi possível consultar os anos liberados.'});}
}
