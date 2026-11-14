import {neon} from '@neondatabase/serverless';
import {requireAdmin,validYear,sameOrigin,getAdminSession} from '../lib/admin-auth.js';
export default async function handler(req,res){
 if(req.method==='POST')return registrarPeloAdmin(req,res);
 if(!requireAdmin(req,res))return;
 if(req.method!=='GET')return res.status(405).json({erro:'Método não permitido.'});
 const ano=Number(req.query.ano??2027),busca=String(req.query.busca||'').trim().slice(0,120),funcao=String(req.query.funcao||'').trim();
 if(!validYear(ano))return res.status(400).json({erro:'Ano inválido.'});
 try{
  const sql=neon(process.env.DATABASE_URL);
  // Pesquisa direta por matrícula. Resultado único, permitido apenas a quem pode editar.
  // O cadastro é a fonte oficial; a consulta não altera nenhuma informação.
  if(req.query.matricula!==undefined){
    if(!requireAdmin(req,res,'edit'))return;
    const matricula=String(req.query.matricula||'').replace(/\D/g,'');
    if(!/^\d{4,14}$/.test(matricula))return res.status(400).json({erro:'Informe uma matrícula válida.'});
    const found=await sql`
      SELECT c.nome_completo AS nome,c.matricula AS matricula_chave,
        c.matricula_exibicao AS matricula,c.funcao_turno,
        s.id AS protocolo,s.ano AS solicitacao_ano,s.nome_completo AS solicitacao_nome,
        COALESCE(s.funcao_turno,c.funcao_turno) AS solicitacao_funcao_turno,
        s.mes_1,s.periodo_1,s.mes_2,s.periodo_2,
        s.registrado_por_nome,
        to_char(s.criada_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') AS registrada_em,
        to_char(s.ciencia_regras_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') AS ciencia_regras_em,
        to_char(p1.data_inicio,'YYYY-MM-DD') AS inicio_1,
        to_char(p1.data_fim,'YYYY-MM-DD') AS fim_1,
        to_char(p2.data_inicio,'YYYY-MM-DD') AS inicio_2,
        to_char(p2.data_fim,'YYYY-MM-DD') AS fim_2
      FROM sttu_ferias_servidores c
      LEFT JOIN sttu_ferias_solicitacoes s ON s.matricula=c.matricula AND s.ano=${ano}
      LEFT JOIN sttu_ferias_periodos_config p1
        ON p1.ano=s.ano AND p1.mes=s.mes_1 AND p1.periodo=s.periodo_1
      LEFT JOIN sttu_ferias_periodos_config p2
        ON p2.ano=s.ano AND p2.mes=s.mes_2 AND p2.periodo=s.periodo_2
      WHERE c.matricula=${matricula} AND c.ativo=TRUE
      LIMIT 1`;
    if(found.length===0)return res.status(404).json({erro:'Matrícula não encontrada no cadastro ativo.'});
    const r=found[0];
    const servidor={nome:r.nome,matricula_chave:r.matricula_chave,matricula:r.matricula,
      funcao_turno:r.funcao_turno,protocolo:r.protocolo};
    const solicitacao=r.protocolo?{
      id:r.protocolo,ano:r.solicitacao_ano,nome:r.solicitacao_nome||r.nome,
      matricula:r.matricula,funcao_turno:r.solicitacao_funcao_turno,
      registrado_por_nome:r.registrado_por_nome,
      registrada_em:r.registrada_em,ciencia_regras_em:r.ciencia_regras_em,
      escolhas:[
        {mes:r.mes_1,periodo:r.periodo_1,data_inicio:r.inicio_1,data_fim:r.fim_1},
        {mes:r.mes_2,periodo:r.periodo_2,data_inicio:r.inicio_2,data_fim:r.fim_2}
      ]
    }:null;
    return res.status(200).json({servidor,solicitacao});
  }
  const rows=await sql`
    SELECT c.nome_completo AS nome,c.matricula_exibicao AS matricula,c.funcao_turno,
      s.id AS protocolo,s.mes_1,s.periodo_1,s.mes_2,s.periodo_2,
      s.registrado_por_nome,s.registrado_por_email,
      to_char(s.criada_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') AS solicitada_em
    FROM sttu_ferias_servidores c LEFT JOIN sttu_ferias_solicitacoes s ON s.matricula=c.matricula AND s.ano=${ano}
    WHERE c.ativo=TRUE AND (${funcao}::text='' OR c.funcao_turno=${funcao})
      AND (${busca}::text='' OR position(lower(${busca}::text) in lower(c.nome_completo))>0
           OR (regexp_replace(${busca}::text,'[^0-9]','','g')<>'' AND position(regexp_replace(${busca}::text,'[^0-9]','','g') in c.matricula)>0)
           OR position(lower(${busca}::text) in lower(c.matricula_exibicao))>0)
    ORDER BY c.nome_completo,c.matricula_exibicao`;
  return res.status(200).json({ano,servidores:rows,total:rows.length});
 }catch(e){console.error('Admin servidores:',e);return res.status(503).json({erro:'Erro ao consultar o cadastro.'});}
}


// STTU — Registro administrativo de férias: mesma função de banco transacional usada
// pelo servidor autenticado; sem exposição de solicitação para perfis de consulta.
async function registrarPeloAdmin(req,res){
 if(!requireAdmin(req,res,'edit'))return;
 if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
 if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}
 catch{return res.status(400).json({erro:'Dados inválidos.'});}
 const ano=Number(body.ano),matricula=String(body.matricula||'').replace(/\D/g,''),
   selecoes=body.selecoes;
 // Compatibilidade com a função de gravação existente no Neon.
 // Não é endereço de contato: o domínio reservado .invalid não recebe e-mails.
 const emailTecnico='nao-informado@sttu.invalid';
 if(!validYear(ano)|| !/^\d{4,14}$/.test(matricula)||body.aceite_regras!==true||
   !Array.isArray(selecoes)||selecoes.length!==2||
   selecoes.some(s=>!Number.isInteger(s.mes)||s.mes<1||s.mes>12||![1,2].includes(s.periodo))||
   selecoes[0].mes===selecoes[1].mes)
   return res.status(400).json({erro:'Identifique o servidor pela matrícula, confirme as regras e escolha dois meses diferentes.'});
 const admin=getAdminSession(req);
 if(!admin)return res.status(401).json({erro:'Sessão administrativa expirada.'});
 try{
   const sql=neon(process.env.DATABASE_URL);
   const records=await sql`SELECT nome_completo AS nome,matricula FROM sttu_ferias_servidores
     WHERE matricula=${matricula} AND ativo=TRUE LIMIT 1`;
   if(!records.length)return res.status(404).json({erro:'Servidor não encontrado no cadastro oficial.'});
   const titular=records[0];
   const registrante='Administração STTU - '+admin.username;
   const rows=await sql`SELECT sttu_registrar_ferias_com_ciencia(
     ${ano},${titular.nome},${titular.matricula},
     ${selecoes[0].mes},${selecoes[0].periodo},${selecoes[1].mes},${selecoes[1].periodo},
     ${registrante},${emailTecnico},${true}
   ) AS solicitacao`;
   const created=rows[0]?.solicitacao;
   if(!created?.id)return res.status(503).json({erro:'O banco não confirmou a criação do protocolo.'});
   return res.status(201).json({sucesso:true,solicitacao:{
     ...created,protocolo:String(created.ano||ano)+String(created.id).padStart(4,'0')
   }});
 }catch(e){
   const errors={ANO_INVALIDO:'Ano inválido.',ANO_BLOQUEADO:'Ano bloqueado.',
     PERIODO_BLOQUEADO:'Período bloqueado.',PRAZO_ENCERRADO:'Prazo encerrado para uma das escolhas.',
     JA_SOLICITADO:'Este servidor já possui férias registradas neste ano.',
     PERIODO_ESGOTADO:'Vagas esgotadas.',LIMITE_FUNCAO_TURNO:'Limite por Função/Turno excedido.',
     PERIODOS_INVALIDOS:'Os períodos precisam estar em meses diferentes.',
     SERVIDOR_NAO_CADASTRADO:'Servidor não cadastrado.',CIENCIA_REGRAS_OBRIGATORIA:'Confirme a ciência das regras.'};
   const code=Object.keys(errors).find(k=>String(e?.message||'').includes(k));
   if(code)return res.status(409).json({erro:errors[code],codigo:code});
   console.error('Registro de férias administrativo:',e?.code||'erro');
   return res.status(503).json({erro:'Não foi possível concluir o registro. Confira o banco e as vagas antes de repetir.'});
 }
}
