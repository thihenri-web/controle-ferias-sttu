import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export function adminConfigured(){
  return Boolean(process.env.ADMIN_PASSWORD?.length >= 8 && process.env.ADMIN_SESSION_SECRET?.length >= 32);
}
function encode(payload){return Buffer.from(JSON.stringify(payload)).toString('base64url');}
function signature(value){return createHmac('sha256',process.env.ADMIN_SESSION_SECRET).update(value).digest('base64url');}
function equal(a,b){
  const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
export function validatePassword(value){
  if (!adminConfigured()) return false;
  const a=createHash('sha256').update(String(value)).digest();
  const b=createHash('sha256').update(process.env.ADMIN_PASSWORD).digest();
  return timingSafeEqual(a,b);
}
export function createSession(){
  const data=encode({aud:'sttu-ferias-admin',exp:Math.floor(Date.now()/1000)+8*60*60});
  return `${data}.${signature(data)}`;
}
export function adminAuthenticated(req){
  if (!adminConfigured()) return false;
  const value=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-sttu_admin='))?.split('=')[1];
  if (!value) return false;
  const parts=value.split('.');
  if (parts.length!==2 || !equal(parts[1],signature(parts[0]))) return false;
  try{
    const payload=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    return payload.aud==='sttu-ferias-admin' && Number.isFinite(payload.exp) && payload.exp>Math.floor(Date.now()/1000);
  }catch{return false;}
}
export function setSessionCookie(res,token){
  res.setHeader('Set-Cookie',`__Host-sttu_admin=${token}; Max-Age=28800; Path=/; Secure; HttpOnly; SameSite=Strict`);
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
  const origin=req.headers.origin;
  const host=req.headers['x-forwarded-host']||req.headers.host;
  if (!origin || !host) return false;
  try {return new URL(origin).host===host && new URL(origin).protocol==='https:';}catch{return false;}
}
export function requireAdmin(req,res){
  commonHeaders(res);
  if (!adminAuthenticated(req)){
    res.status(401).json({erro:'Acesso administrativo não autorizado.'});return false;
  }
  return true;
}
export function normalizedAddressHash(req){
  const address=(String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown')).split(',')[0].trim().slice(0,128);
  return createHash('sha256').update((process.env.ADMIN_SESSION_SECRET||'')+':'+address).digest('hex');
}
export function validYear(n){return Number.isInteger(n)&&n>=2027&&n<=2100;}
