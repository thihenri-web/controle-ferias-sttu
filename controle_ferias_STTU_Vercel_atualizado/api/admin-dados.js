import {neon} from '@neondatabase/serverless';
import {requireAdmin,validYear} from '../lib/admin-auth.js';
export default async function handler(req,res){
 if(!requireAdmin(req,res))return;
 if(req.method!=='GET')return res.status(405).json({erro:'Método não permitido.'});
 const ano=Number(req.query.ano??2027),mes=Number(req.query.mes??0),periodo=Number(req.query.periodo??0);
 const busca=String(req.query.busca||'').trim().slice(0,120);
 if(!validYear(ano)||!Number.isInteger(mes)||mes<0||mes>12||![0,1,2].includes(periodo))return res.status(400).json({erro:'Filtros inválidos.'});
 if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
 try{
  const sql=neon(process.env.DATABASE_URL);
  const [solicitacoes,vagas,anos,cotas,ocupacao_funcao]=await Promise.all([
   sql`SELECT s.id,s.ano,s.nome_completo,COALESCE(c.matricula_exibicao,s.matricula) AS matricula,
       COALESCE(s.funcao_turno,c.funcao_turno,'Não identificado') AS funcao_turno,
       s.mes_1,s.periodo_1,s.mes_2,s.periodo_2,
       to_char(s.criada_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') AS solicitada_em
     FROM sttu_ferias_solicitacoes s LEFT JOIN sttu_ferias_servidores c ON c.matricula=s.matricula
     WHERE s.ano=${ano}
       AND (${mes}::integer=0 OR (s.mes_1=${mes} AND (${periodo}::integer=0 OR s.periodo_1=${periodo}))
         OR (s.mes_2=${mes} AND (${periodo}::integer=0 OR s.periodo_2=${periodo})))
       AND (${busca}::text='' OR position(lower(${busca}::text) in lower(s.nome_completo))>0
         OR position(lower(${busca}::text) in lower(s.matricula))>0
         OR position(lower(${busca}::text) in lower(COALESCE(c.matricula_exibicao,'')))>0)
     ORDER BY s.criada_em DESC,s.id DESC LIMIT 500`,
   sql`WITH calendario AS(
      SELECT m AS mes,p AS periodo,
        CASE WHEN ${ano}::integer=2027 AND m=1 THEN DATE '2026-12-31'
             ELSE make_date(${ano}::integer,m,1)-45 END AS data_limite,
        (m NOT IN (6,12) AND (m<>2 OR p=1)) AS liberacao_padrao
      FROM generate_series(1,12) m CROSS JOIN generate_series(1,2) p
     ),ocup AS (
       SELECT z.mes,z.periodo,COUNT(*)::integer AS total,
        COUNT(*) FILTER(WHERE COALESCE(s.funcao_turno,c.funcao_turno)='Insp Chefe')::integer AS chefes,
        COUNT(*) FILTER(WHERE COALESCE(s.funcao_turno,c.funcao_turno) IS DISTINCT FROM 'Insp Chefe')::integer AS normais
       FROM sttu_ferias_solicitacoes s LEFT JOIN sttu_ferias_servidores c ON c.matricula=s.matricula
       CROSS JOIN LATERAL(VALUES(s.mes_1,s.periodo_1),(s.mes_2,s.periodo_2)) z(mes,periodo)
       WHERE s.ano=${ano} GROUP BY z.mes,z.periodo
     )
     SELECT cal.mes,cal.periodo,COALESCE(o.total,0)::integer AS ocupadas,
        COALESCE(o.normais,0)::integer AS normais,COALESCE(o.chefes,0)::integer AS chefes,
        COALESCE(cfg.capacidade,10)::integer AS capacidade,
        GREATEST(0,COALESCE(cfg.capacidade,10)-COALESCE(o.normais,0))::integer AS restantes,
        COALESCE(cfg.liberado,cal.liberacao_padrao) AS habilitado,
        to_char(cal.data_limite,'YYYY-MM-DD') AS limite,
        (COALESCE(cfg.liberado,cal.liberacao_padrao)
         AND (now() AT TIME ZONE 'America/Fortaleza')::date<=cal.data_limite) AS aberto
     FROM calendario cal
     LEFT JOIN sttu_ferias_periodos_config cfg ON cfg.ano=${ano} AND cfg.mes=cal.mes AND cfg.periodo=cal.periodo
     LEFT JOIN ocup o ON o.mes=cal.mes AND o.periodo=cal.periodo
     ORDER BY cal.mes,cal.periodo`,
   sql`SELECT ano,liberado FROM sttu_ferias_anos ORDER BY ano`,
   sql`SELECT mes,periodo,funcao_turno,limite FROM sttu_ferias_cotas_funcao WHERE ano=${ano} ORDER BY mes,periodo,funcao_turno`,
   sql`SELECT z.mes,z.periodo,COALESCE(s.funcao_turno,c.funcao_turno,'Não identificado') AS funcao_turno,
         COUNT(*)::integer AS ocupadas
       FROM sttu_ferias_solicitacoes s LEFT JOIN sttu_ferias_servidores c ON c.matricula=s.matricula
       CROSS JOIN LATERAL(VALUES(s.mes_1,s.periodo_1),(s.mes_2,s.periodo_2)) z(mes,periodo)
       WHERE s.ano=${ano} GROUP BY z.mes,z.periodo,COALESCE(s.funcao_turno,c.funcao_turno,'Não identificado')`
  ]);
  return res.status(200).json({ano,mes,periodo,solicitacoes,vagas,anos,cotas,ocupacao_funcao,contagem:solicitacoes.length});
 }catch(e){console.error('Admin dados:',e);return res.status(503).json({erro:'Falha na consulta. Execute a migração Função/Turno no Neon.'});}
}
