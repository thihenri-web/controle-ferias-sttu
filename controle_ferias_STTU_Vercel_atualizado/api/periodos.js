import { neon } from '@neondatabase/serverless';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  if (req.method!=='GET') return res.status(405).json({erro:'Método não permitido.'});
  const ano=Number(req.query.ano);
  if (!Number.isInteger(ano)||ano<2027||ano>2100) return res.status(400).json({erro:'Ano inválido.'});
  if (!process.env.DATABASE_URL) return res.status(503).json({erro:'Banco não configurado.'});
  try {
    const sql=neon(process.env.DATABASE_URL);
    const liberacao=await sql`SELECT liberado FROM sttu_ferias_anos WHERE ano=${ano} AND liberado=TRUE`;
    if (!liberacao.length) return res.status(403).json({erro:'Ano ainda não liberado pela administração.',codigo:'ANO_BLOQUEADO'});
    const rows=await sql`
      WITH calendario AS (
        SELECT m AS mes, p AS periodo,
          CASE WHEN ${ano}::integer = 2027 AND m = 1
            THEN DATE '2026-12-31'
            ELSE make_date(${ano}::integer,m,1) - 45 END AS data_limite
        FROM generate_series(1,12) AS m CROSS JOIN generate_series(1,2) AS p
        WHERE m NOT IN (6,12) AND (m <> 2 OR p=1)
      )
      SELECT c.mes,c.periodo,coalesce(v.ocupadas,0)::integer AS ocupadas,
        (10-coalesce(v.ocupadas,0))::integer AS restantes,
        to_char(c.data_limite,'YYYY-MM-DD') AS limite,
        ((now() AT TIME ZONE 'America/Fortaleza')::date <= c.data_limite) AS aberto
      FROM calendario c LEFT JOIN sttu_ferias_vagas v
        ON v.ano=${ano} AND v.mes=c.mes AND v.periodo=c.periodo
      ORDER BY c.mes,c.periodo`;
    return res.status(200).json({ano,capacidade:10,capacidadeTotal:190,periodos:rows});
  } catch (e) {console.error('Vagas:',e);return res.status(503).json({erro:'Não foi possível consultar as vagas. Execute o schema_atualizacao_admin.sql no Neon.'});}
}
