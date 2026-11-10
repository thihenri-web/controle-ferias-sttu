import { neon } from '@neondatabase/serverless';
import { adminAuthenticated, adminConfigured, clearSessionCookie, commonHeaders, createSession, normalizedAddressHash, sameOrigin, setSessionCookie, validatePassword } from '../lib/admin-auth.js';

export default async function handler(req,res){
  commonHeaders(res);
  if(req.method==='GET') return res.status(200).json({autenticado:adminAuthenticated(req),configurado:adminConfigured()});
  if(!['POST','DELETE'].includes(req.method)) return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req)) return res.status(403).json({erro:'Origem inválida.'});
  if(req.method==='DELETE'){clearSessionCookie(res);return res.status(200).json({sucesso:true});}
  if(!adminConfigured()) return res.status(503).json({erro:'Configure ADMIN_PASSWORD (mínimo 8 caracteres) e ADMIN_SESSION_SECRET (mínimo 32 caracteres) na Vercel.'});
  if(!process.env.DATABASE_URL) return res.status(503).json({erro:'Banco de dados não configurado.'});
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const senha=String(b.senha||'');
  if(senha.length>256) return res.status(400).json({erro:'Senha inválida.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const chave=normalizedAddressHash(req);
    const tentativa=await sql`
      INSERT INTO sttu_ferias_login_tentativas (chave,tentativas,primeira_em)
      VALUES (${chave},1,now())
      ON CONFLICT (chave) DO UPDATE SET
        tentativas=CASE WHEN now()-sttu_ferias_login_tentativas.primeira_em>interval '15 minutes'
             THEN 1 ELSE sttu_ferias_login_tentativas.tentativas+1 END,
        primeira_em=CASE WHEN now()-sttu_ferias_login_tentativas.primeira_em>interval '15 minutes'
             THEN now() ELSE sttu_ferias_login_tentativas.primeira_em END
      RETURNING tentativas`;
    if(tentativa[0].tentativas>10) return res.status(429).json({erro:'Muitas tentativas de login. Tente novamente após 15 minutos.'});
    if(!validatePassword(senha)) return res.status(401).json({erro:'Senha incorreta.'});
    await sql`DELETE FROM sttu_ferias_login_tentativas WHERE chave=${chave}`;
    setSessionCookie(res,createSession());
    return res.status(200).json({sucesso:true});
  }catch(e){console.error('Login admin:',e);return res.status(503).json({erro:'Não foi possível validar o acesso administrativo.'});}
}
