import { neon } from '@neondatabase/serverless';
import { requireAdmin, validYear } from '../lib/admin-auth.js';
const MONTHS=[1,2,3,4,5,6,7,8,9,10,11,12];
export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='GET')return res.status(405).json({erro:'Método não permitido.'});
  const ano=Number(req.query.ano??2027),mes=Number(req.query.mes??0),periodo=Number(req.query.periodo??0);
  const busca=String(req.query.busca||'').trim().slice(0,120);
  if(!validYear(ano)||!Number.isInteger(mes)||mes<0||mes>12||!Number.isInteger(periodo)||periodo<0||periodo>2)return res.status(400).json({erro:'Filtros inválidos.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const [solicitacoes,vagas,anos]=await Promise.all([
      sql`SELECT s.id,s.ano,s.nome_completo,COALESCE(c.matricula_exibicao,s.matricula) AS matricula,
         s.mes_1,s.periodo_1,s.mes_2,s.periodo_2,
         to_char(s.criada_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') AS solicitada_em
         FROM sttu_ferias_solicitacoes AS s
         LEFT JOIN sttu_ferias_servidores AS c ON c.matricula=s.matricula
         WHERE s.ano=${ano}
           AND (${mes}::integer=0 OR
             (s.mes_1=${mes} AND (${periodo}::integer=0 OR s.periodo_1=${periodo})) OR
             (s.mes_2=${mes} AND (${periodo}::integer=0 OR s.periodo_2=${periodo})))
           AND (${busca}::text='' OR position(lower(${busca}::text) in lower(s.nome_completo))>0 OR
             position(lower(${busca}::text) in lower(s.matricula))>0 OR
             position(lower(${busca}::text) in lower(COALESCE(c.matricula_exibicao,'')))>0)
         ORDER BY s.criada_em DESC,s.id DESC LIMIT 500`,
      sql`WITH calendario AS (
        SELECT m AS mes, p AS periodo,
          CASE WHEN ${ano}::integer=2027 AND m=1 THEN DATE '2026-12-31'
               ELSE make_date(${ano}::integer,m,1)-45 END AS data_limite,
          (m NOT IN (6,12) AND (m<>2 OR p=1)) AS liberacao_padrao
        FROM generate_series(1,12) m CROSS JOIN generate_series(1,2) p
      )
      SELECT c.mes,c.periodo,COALESCE(v.ocupadas,0)::integer AS ocupadas,
        COALESCE(cfg.capacidade,10)::integer AS capacidade,
        (COALESCE(cfg.capacidade,10)-COALESCE(v.ocupadas,0))::integer AS restantes,
        COALESCE(cfg.liberado,c.liberacao_padrao) AS habilitado,
        to_char(c.data_limite,'YYYY-MM-DD') AS limite,
        (COALESCE(cfg.liberado,c.liberacao_padrao) AND
          (now() AT TIME ZONE 'America/Fortaleza')::date<=c.data_limite) AS aberto
      FROM calendario c
      LEFT JOIN sttu_ferias_periodos_config cfg ON cfg.ano=${ano} AND cfg.mes=c.mes AND cfg.periodo=c.periodo
      LEFT JOIN sttu_ferias_vagas v ON v.ano=${ano} AND v.mes=c.mes AND v.periodo=c.periodo
      ORDER BY c.mes,c.periodo`,
      sql`SELECT ano,liberado FROM sttu_ferias_anos ORDER BY ano`
    ]);
    const total=solicitacoes.length;
    return res.status(200).json({ano,mes,periodo,solicitacoes,vagas,anos,contagem:total,meses:MONTHS});
  }catch(e){console.error('Admin dados:',e);return res.status(503).json({erro:'Falha ao consultar. Execute a migração SQL no Neon.'});}
}
