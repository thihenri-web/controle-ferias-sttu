import { neon } from '@neondatabase/serverless';
import { getAdminSession,adminConfigured,clearSessionCookie,commonHeaders,createSession,normalizedAddressHash,sameOrigin,setSessionCookie,validateCredentials,hasPermission } from '../lib/admin-auth.js';
function publicSession(req){
  const identity=getAdminSession(req);
  return {autenticado:Boolean(identity),configurado:adminConfigured(),
    usuario:identity?.username||null,perfil:identity?.role||null,
    permissoes:{consultar:hasPermission(identity,'read'),editar:hasPermission(identity,'edit'),cancelar:hasPermission(identity,'cancel')}};
}
export default async function handler(req,res){
  commonHeaders(res);
  if(req.method==='GET')return res.status(200).json(publicSession(req));
  if(!['POST','DELETE'].includes(req.method))return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  if(req.method==='DELETE'){clearSessionCookie(res);return res.status(200).json({sucesso:true});}
  if(!adminConfigured())return res.status(503).json({erro:'Configure ADMIN_PASSWORD e ADMIN_SESSION_SECRET na Vercel.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco de dados não configurado.'});
  let b;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}catch{return res.status(400).json({erro:'Dados inválidos.'});}
  const usuario=String(b.usuario||'').trim().toUpperCase(),senha=String(b.senha||'');
  if(usuario.length>64||senha.length>256||!usuario||!senha)return res.status(400).json({erro:'Informe usuário e senha.'});
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
    if(tentativa[0].tentativas>10)return res.status(429).json({erro:'Muitas tentativas de login. Aguarde 15 minutos.'});
    const identity=validateCredentials(usuario,senha);
    if(!identity)return res.status(401).json({erro:'Usuário ou senha incorretos.'});
    await sql`DELETE FROM sttu_ferias_login_tentativas WHERE chave=${chave}`;
    setSessionCookie(res,createSession(identity));
    return res.status(200).json({sucesso:true,autenticado:true,
      usuario:identity.username,perfil:identity.role,
      permissoes:{consultar:true,editar:hasPermission(identity,'edit'),cancelar:hasPermission(identity,'cancel')}});
  }catch(e){console.error('Login admin:',e);return res.status(503).json({erro:'Não foi possível validar o acesso administrativo.'});}
}
