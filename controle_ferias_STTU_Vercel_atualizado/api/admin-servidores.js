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
   return res.status(400).json({erro:'Identifique o servidor por nome ou matrícula, confirme as regras e escolha dois meses diferentes.'});
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
