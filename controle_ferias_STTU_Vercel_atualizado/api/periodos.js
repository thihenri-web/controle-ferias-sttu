import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });
  const ano = Number(req.query.ano);
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) {
    return res.status(400).json({ erro: 'Ano inválido.' });
  }
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ erro: 'Banco de dados não configurado. Conecte o Neon à Vercel.' });
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      WITH calendario AS (
        SELECT m AS mes, p AS periodo
        FROM generate_series(1, 12) AS m CROSS JOIN generate_series(1, 2) AS p
        WHERE m NOT IN (6, 12) AND (m <> 2 OR p = 1)
      )
      SELECT c.mes, c.periodo, coalesce(v.ocupadas, 0)::integer AS ocupadas,
        (10 - coalesce(v.ocupadas, 0))::integer AS restantes
      FROM calendario c
      LEFT JOIN sttu_ferias_vagas v
        ON v.ano = ${ano} AND v.mes = c.mes AND v.periodo = c.periodo
      ORDER BY c.mes, c.periodo
    `;
    return res.status(200).json({ ano, capacidade: 10, capacidadeTotal: 190, periodos: rows });
  } catch (e) {
    console.error('Erro ao buscar vagas:', e);
    return res.status(503).json({ erro: 'Não foi possível consultar as vagas. Verifique a instalação do banco e o schema.sql.' });
  }
}
