import { neon } from '@neondatabase/serverless';
import {
  getAdminSession, adminConfigured, clearSessionCookie, commonHeaders,
  createSession, normalizedAddressHash, sameOrigin, setSessionCookie,
  validateCredentials, hasPermission, requireAdmin
} from '../lib/admin-auth.js';

// Esta função mantém a autenticação administrativa existente.
// A auditoria é incremental e utiliza a mesma função Vercel (não cria uma 13ª API).
function publicSession(req){
  const identity=getAdminSession(req);
  return {autenticado:Boolean(identity),configurado:adminConfigured(),
    usuario:identity?.username||null,perfil:identity?.role||null,
    permissoes:{consultar:hasPermission(identity,'read'),editar:hasPermission(identity,'edit'),cancelar:hasPermission(identity,'cancel')}};
}
function auditTable(sql,{usuario,perfil=null,evento,chave}){
  // Nunca registrar senha, cookie, sessão ou endereço IP em claro.
  return sql`INSERT INTO sttu_ferias_acessos_admin_auditoria
    (usuario,perfil,evento,origem_hash)
    VALUES (${usuario},${perfil},${evento},${chave})`;
}
async function auditBestEffort(sql,record){
  try{await auditTable(sql,record);}
  catch(e){console.error('Auditoria de acesso administrativo indisponível:',e?.code||'erro');}
}
async function listAudit(req,res){
  if(!requireAdmin(req,res,'edit'))return;
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco de dados não configurado.'});
  const raw=String(req.query?.limite??'150');
  if(!/^\d{1,3}$/.test(raw))return res.status(400).json({erro:'Limite inválido.'});
  const limite=Math.min(250,Math.max(1,Number(raw)));
  try{
    const sql=neon(process.env.DATABASE_URL);
    const registros=await sql`
      SELECT id,usuario,perfil,evento,
        to_char(criada_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI:SS') AS data_hora
      FROM sttu_ferias_acessos_admin_auditoria
      ORDER BY id DESC LIMIT ${limite}`;
    return res.status(200).json({registros});
  }catch(e){console.error('Consulta de auditoria administrativa:',e?.code||'erro');
    return res.status(503).json({erro:'Histórico indisponível. Execute primeiro a migração de auditoria no Neon.'});}
}
export default async function handler(req,res){
  commonHeaders(res);
  // GET sem parâmetro continua exatamente como antes, para não afetar o painel.
  if(req.method==='GET'){
    if(req.query?.auditoria==='1')return listAudit(req,res);
    return res.status(200).json(publicSession(req));
  }
  if(!['POST','DELETE'].includes(req.method))return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  if(req.method==='DELETE'){
    const current=getAdminSession(req);
    clearSessionCookie(res);
    if(current && process.env.DATABASE_URL){
      const sql=neon(process.env.DATABASE_URL);
      await auditBestEffort(sql,{usuario:current.username,perfil:current.role,
        evento:'SAIDA',chave:normalizedAddressHash(req)});
    }
    return res.status(200).json({sucesso:true});
  }
  if(!adminConfigured())return res.status(503).json({erro:'Configure ADMIN_PASSWORD e ADMIN_SESSION_SECRET na Vercel.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco de dados não configurado.'});
  let b;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}
  catch{return res.status(400).json({erro:'Dados inválidos.'});}
  // A sessão somente é renovada por atividade humana registrada pelo painel.
  // Não reexecutar login nem contabilizar tentativas para essa operação.
  if(b.acao==='renovar'){
    const active=getAdminSession(req);
    if(!active)return res.status(401).json({erro:'Sessão expirada. Faça login novamente.'});
    setSessionCookie(res,createSession(active));
    return res.status(200).json(publicSession(req));
  }
  const usuario=String(b.usuario||'').trim().toUpperCase(),senha=String(b.senha||'');
  if(usuario.length>64||senha.length>256||!usuario||!senha)
    return res.status(400).json({erro:'Informe usuário e senha.'});
  try{
    const sql=neon(process.env.DATABASE_URL),chave=normalizedAddressHash(req);
    const tentativa=await sql`
      INSERT INTO sttu_ferias_login_tentativas (chave,tentativas,primeira_em)
      VALUES (${chave},1,now())
      ON CONFLICT (chave) DO UPDATE SET
        tentativas=CASE WHEN now()-sttu_ferias_login_tentativas.primeira_em>interval '15 minutes'
          THEN 1 ELSE sttu_ferias_login_tentativas.tentativas+1 END,
        primeira_em=CASE WHEN now()-sttu_ferias_login_tentativas.primeira_em>interval '15 minutes'
          THEN now() ELSE sttu_ferias_login_tentativas.primeira_em END
      RETURNING tentativas`;
    if(tentativa[0].tentativas>10){
      // No máximo um registro por janela de bloqueio para evitar explosão da tabela.
      if(Number(tentativa[0].tentativas)===11)
        await auditBestEffort(sql,{usuario,evento:'BLOQUEIO',chave});
      return res.status(429).json({erro:'Muitas tentativas de login. Aguarde 15 minutos.'});
    }
    const identity=validateCredentials(usuario,senha);
    if(!identity){
      await auditBestEffort(sql,{usuario,evento:'ENTRADA_RECUSADA',chave});
      return res.status(401).json({erro:'Usuário ou senha incorretos.'});
    }
    await sql`DELETE FROM sttu_ferias_login_tentativas WHERE chave=${chave}`;
    // Falha eventual do histórico nunca deve impedir um login com credenciais válidas.
    await auditBestEffort(sql,{usuario:identity.username,perfil:identity.role,evento:'ENTRADA',chave});
    setSessionCookie(res,createSession(identity));
    return res.status(200).json({sucesso:true,autenticado:true,
      usuario:identity.username,perfil:identity.role,
      permissoes:{consultar:true,editar:hasPermission(identity,'edit'),cancelar:hasPermission(identity,'cancel')}});
  }catch(e){console.error('Login admin:',e);return res.status(503).json({erro:'Não foi possível validar o acesso administrativo.'});}
}
