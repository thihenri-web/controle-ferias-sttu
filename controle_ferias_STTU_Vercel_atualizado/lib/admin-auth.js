import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// Credenciais sempre no ambiente da Vercel, nunca neste repositório.
// A sessão expira no servidor após 5 minutos sem renovação por atividade humana.
export const ADMIN_IDLE_SECONDS = 5 * 60;
const USERS = () => [
  {username:'THIAGO-HENRIQUE',role:'admin',password:process.env.ADMIN_PASSWORD},
  {username:'ANDREA-CASTRO',role:'admin',password:process.env.ANDREA_PASSWORD},
  {username:'DFV-CONSULTA',role:'viewer',password:process.env.DFV_CONSULTA_PASSWORD},
  {username:(process.env.CANCELAMENTO_LOGIN||'DFV-CANCELAMENTO').trim().toUpperCase(),role:'canceller',password:process.env.CANCELAMENTO_PASSWORD}
];
export function adminConfigured(){
  return Boolean(process.env.ADMIN_PASSWORD?.length >= 8 && process.env.ADMIN_SESSION_SECRET?.length >= 32);
}
function usableUser(u){
  return u&&/^[A-Z0-9][A-Z0-9-]{2,63}$/.test(u.username)&&u.password?.length>=8;
}
function encode(payload){return Buffer.from(JSON.stringify(payload)).toString('base64url');}
function signature(value){return createHmac('sha256',process.env.ADMIN_SESSION_SECRET).update(value).digest('base64url');}
function equal(a,b){
  const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function passwordDigest(p){return createHash('sha256').update(String(p)).digest('hex');}
function userByName(name){
  const upper=String(name??'').trim().toUpperCase();
  // Não permitir que a conta opcional de cancelamento substitua outra conta.
  const entries=USERS();
  const matches=entries.filter(u=>u.username===upper&&usableUser(u));
  return matches.length===1?matches[0]:null;
}
export function validateCredentials(username,password){
  if(!adminConfigured())return null;
  const account=userByName(username);
  // A comparação não expõe qual dos dois campos está incorreto.
  const given=Buffer.from(passwordDigest(password));
  const expected=Buffer.from(passwordDigest(account?.password||'senha-invalida-sentinela'));
  return timingSafeEqual(given,expected)&&account?{username:account.username,role:account.role}:null;
}
export function createSession(identity){
  if(!adminConfigured())throw Error('Credenciais administrativas não configuradas');
  const u=userByName(identity?.username);
  if(!u||u.role!==identity.role)throw Error('Conta administrativa não configurada');
  const data=encode({aud:'sttu-ferias-admin-v2',u:u.username,role:u.role,
    ver:passwordDigest(u.password).slice(0,24),exp:Math.floor(Date.now()/1000)+ADMIN_IDLE_SECONDS});
  return `${data}.${signature(data)}`;
}
export function getAdminSession(req){
  if(!adminConfigured())return null;
  const cookie=req.headers?.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-sttu_admin='))?.slice('__Host-sttu_admin='.length);
  if(!cookie)return null;
  const parts=cookie.split('.');
  if(parts.length!==2||!equal(parts[1],signature(parts[0])))return null;
  try{
    const payload=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    if(payload.aud!=='sttu-ferias-admin-v2'||!Number.isFinite(payload.exp)||payload.exp<=Date.now()/1000)return null;
    const u=userByName(payload.u);
    if(!u||u.role!==payload.role||payload.ver!==passwordDigest(u.password).slice(0,24))return null;
    return {username:u.username,role:u.role};
  }catch{return null;}
}
export function adminAuthenticated(req){return Boolean(getAdminSession(req));}
export function hasPermission(identity,permission='read'){
  if(!identity)return false;
  if(permission==='read')return true;
  if(permission==='edit')return identity.role==='admin';
  if(permission==='cancel')return identity.role==='admin'||identity.role==='canceller';
  return false;
}
export function requireAdmin(req,res,permission='read'){
  commonHeaders(res);
  const identity=getAdminSession(req);
  if(!identity){res.status(401).json({erro:'Acesso administrativo não autorizado.'});return false;}
  if(!hasPermission(identity,permission)){res.status(403).json({erro:'Seu perfil não tem permissão para realizar esta operação.'});return false;}
  return true;
}
export function setSessionCookie(res,token){
  res.setHeader('Set-Cookie',`__Host-sttu_admin=${token}; Max-Age=${ADMIN_IDLE_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict`);
}
export function clearSessionCookie(res){
  res.setHeader('Set-Cookie','__Host-sttu_admin=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict');
}
export function commonHeaders(res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
}
export function sameOrigin(req){
  const origin=req.headers?.origin;
  const host=req.headers?.['x-forwarded-host']||req.headers?.host;
  if(!origin||!host)return false;
  try{return new URL(origin).host===host&&new URL(origin).protocol==='https:';}catch{return false;}
}
export function normalizedAddressHash(req){
  const address=String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,128);
  return createHash('sha256').update((process.env.ADMIN_SESSION_SECRET||'')+':'+address).digest('hex');
}
export function validYear(n){return Number.isInteger(n)&&n>=2027&&n<=2100;}
