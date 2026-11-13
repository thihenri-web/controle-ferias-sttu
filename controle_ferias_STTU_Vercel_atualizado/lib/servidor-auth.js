import {createHmac, timingSafeEqual, randomBytes, scryptSync, createHash} from 'node:crypto';

// A conta do servidor é distinta do acesso administrativo.
const secret = () => process.env.SERVIDOR_SESSION_SECRET || '';
const SESSION_SECONDS = 60 * 60;     // sessão do servidor: 1 hora, sem renovação implícita
const CHANGE_SECONDS = 10 * 60;     // troca obrigatória: até 10 minutos
const COOKIE = '__Host-sttu_servidor';
const CHANGE_COOKIE = '__Host-sttu_primeiro_acesso';
export const normalizeMatricula = value => String(value ?? '').replace(/\D/g, '');
export const serverAuthConfigured = () => secret().length >= 32 && !!process.env.DATABASE_URL;
export function serverOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!origin || !host) return false;
  try { const u = new URL(origin); return u.protocol === 'https:' && u.host === String(host).split(',')[0].trim(); }
  catch { return false; }
}
export function serverHeaders(res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = value => createHmac('sha256', secret()).update('sttu-servidor-v1:'+value).digest('base64url');
const safeEqual = (a,b) => {
  const ba=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
  return ba.length===bb.length && timingSafeEqual(ba,bb);
};
const cookies = req => Object.fromEntries(String(req.headers?.cookie||'').split(';').map(s=>s.trim().split('=').slice(0,2)).filter(x=>x.length===2));
function verify(token,kind){
  if(!serverAuthConfigured() || !token || typeof token!=='string')return null;
  const parts=token.split('.');
  if(parts.length!==2 || !safeEqual(parts[1],sign(parts[0])))return null;
  try{
    const p=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(p.aud!=='sttu-servidor-v1'||p.kind!==kind||!/^\d{4,14}$/.test(p.m)||
       !Number.isInteger(p.v)||!Number.isSafeInteger(p.exp)||p.exp<=Math.floor(Date.now()/1000))return null;
    return p;
  }catch{return null;}
}
function issue(m,version,kind,seconds){
  const payload=encode({aud:'sttu-servidor-v1',kind,m,v:version,exp:Math.floor(Date.now()/1000)+seconds});
  return `${payload}.${sign(payload)}`;
}
const cookieStr = (name, token, seconds) => `${name}=${token}; Max-Age=${seconds}; Path=/; Secure; HttpOnly; SameSite=Strict`;
export function setLoginCookie(res,m,version){
  res.setHeader('Set-Cookie',[cookieStr(COOKIE,issue(m,version,'session',SESSION_SECONDS),SESSION_SECONDS),cookieStr(CHANGE_COOKIE,'',0)]);
}
export function setChangeCookie(res,m,version){
  res.setHeader('Set-Cookie',[cookieStr(CHANGE_COOKIE,issue(m,version,'change',CHANGE_SECONDS),CHANGE_SECONDS),cookieStr(COOKIE,'',0)]);
}
export function clearServidorCookies(res){
  res.setHeader('Set-Cookie',[cookieStr(COOKIE,'',0),cookieStr(CHANGE_COOKIE,'',0)]);
}
export function readChange(req){return verify(cookies(req)[CHANGE_COOKIE],'change');}
export async function getServidor(req,sql){
  const p=verify(cookies(req)[COOKIE],'session');
  if(!p)return null;
  const rows=await sql`
    SELECT c.matricula,c.matricula_exibicao,c.nome_completo AS nome,c.funcao_turno,
           a.versao_sessao
    FROM sttu_ferias_servidores c
    JOIN sttu_ferias_servidor_credenciais a ON a.matricula=c.matricula
    WHERE c.matricula=${p.m} AND c.ativo=TRUE AND a.senha_hash IS NOT NULL
      AND a.versao_sessao=${p.v}
    LIMIT 1`;
  return rows[0]||null;
}
export function hashSenha(senha,salt){
  return scryptSync(String(senha),Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
}
export function novaSenha(senha){
  return /^\d{8}$/.test(senha) && !/(\d)\1{7}/.test(senha) &&
    !['12345678','87654321','01234567','76543210'].includes(senha);
}
export function novoSalt(){return randomBytes(24).toString('hex');}
export function verificaSenha(senha,salt,hash){
  try{return safeEqual(hashSenha(senha,salt),hash);}catch{return false;}
}
export function chaveTentativas(req,m){
  const ip=String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'indefinido').split(',')[0].trim().slice(0,120);
  return [createHash('sha256').update(secret()+'|mat|'+m).digest('hex'),
    createHash('sha256').update(secret()+'|ip|'+ip).digest('hex')];
}
