import {neon} from '@neondatabase/serverless';
import {getAdminSession,hasPermission} from './admin-auth.js';
import {serverAuthConfigured,serverOrigin,serverHeaders,normalizeMatricula,readChange,
  getServidor,setLoginCookie,setChangeCookie,clearServidorCookies,
  hashSenha,novaSenha,novoSalt,verificaSenha,chaveTentativas} from './servidor-auth.js';

const json = (res,status,body)=>res.status(status).json(body);
const invalido = res=>json(res,401,{erro:'Matrícula ou senha incorretas.'});
async function cadastro(sql,m){
  const rows=await sql`SELECT matricula,matricula_exibicao,nome_completo AS nome,funcao_turno
    FROM sttu_ferias_servidores WHERE matricula=${m} AND ativo=TRUE LIMIT 1`;
  return rows[0]||null;
}
async function registrarEvento(sql,m,acao,ator,detalhe=''){
  await sql`INSERT INTO sttu_ferias_servidor_acessos_auditoria
    (matricula,acao,realizado_por,detalhe) VALUES (${m},${acao},${ator},${detalhe})`;
}
async function limite(sql,chaves){
  for(const chave of chaves){
    const rows=await sql`
      INSERT INTO sttu_ferias_servidor_tentativas(chave,tentativas,primeira_em)
      VALUES (${chave},1,now())
      ON CONFLICT (chave) DO UPDATE SET
       tentativas=CASE WHEN now()-sttu_ferias_servidor_tentativas.primeira_em > interval '15 minutes'
         THEN 1 ELSE sttu_ferias_servidor_tentativas.tentativas+1 END,
       primeira_em=CASE WHEN now()-sttu_ferias_servidor_tentativas.primeira_em > interval '15 minutes'
         THEN now() ELSE sttu_ferias_servidor_tentativas.primeira_em END
      RETURNING tentativas`;
    if(Number(rows[0].tentativas)>6)return false;
  }
  return true;
}
export default async function handler(req,res){
  serverHeaders(res);
  if(!serverAuthConfigured())return json(res,503,{erro:'Autenticação não configurada. Confira o SQL e SERVIDOR_SESSION_SECRET.'});
  if(!['GET','POST','DELETE'].includes(req.method))return json(res,405,{erro:'Método não permitido.'});
  if(req.method!=='GET'&&!serverOrigin(req))return json(res,403,{erro:'Origem não permitida.'});
  let body={};
  if(req.method==='POST')try{
    body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    if(!body||Array.isArray(body)||typeof body!=='object')throw Error();
  }catch{return json(res,400,{erro:'Requisição inválida.'});}
  try{
    const sql=neon(process.env.DATABASE_URL);
    if(req.method==='GET'){
      const pessoa=await getServidor(req,sql);
      if(pessoa)return json(res,200,{autenticado:true,servidor:{nome:pessoa.nome,matricula:pessoa.matricula_exibicao,funcao_turno:pessoa.funcao_turno}});
      return json(res,200,{autenticado:false,troca_obrigatoria:Boolean(readChange(req))});
    }
    if(req.method==='DELETE'){
      const pessoa=await getServidor(req,sql);
      if(pessoa){
        // O logout revoga também eventuais cópias da sessão em outras abas/dispositivos.
        await sql`UPDATE sttu_ferias_servidor_credenciais
          SET versao_sessao=versao_sessao+1,alterada_em=now()
          WHERE matricula=${pessoa.matricula} AND versao_sessao=${pessoa.versao_sessao}`;
      }
      clearServidorCookies(res);
      return json(res,200,{sucesso:true});
    }
    const acao=String(body.acao||'entrar');
    if(acao==='reset'){
      const admin=getAdminSession(req);
      if(!hasPermission(admin,'cancel'))return json(res,403,{erro:'Acesso restrito ao DFV autorizado.'});
      const matricula=normalizeMatricula(body.matricula);
      const motivo=String(body.motivo||'').trim();
      if(!/^\d{4,14}$/.test(matricula)||motivo.length<10||motivo.length>300)
        return json(res,400,{erro:'Informe matrícula válida e justificativa com pelo menos 10 caracteres.'});
      const pessoa=await cadastro(sql,matricula);
      if(!pessoa)return json(res,404,{erro:'Servidor não encontrado.'});
      // EXCLUSIVAMENTE CREDENCIAIS: não cancelar ou modificar solicitações,
      // protocolos, vagas ocupadas nem histórico de férias.
      // Se ainda não ativou, registrar o reset para fins de auditoria.
      await sql`INSERT INTO sttu_ferias_servidor_credenciais
        (matricula,senha_hash,senha_salt,versao_sessao)
        VALUES (${matricula},NULL,NULL,1)
        ON CONFLICT (matricula) DO UPDATE SET
          senha_hash=NULL,senha_salt=NULL,versao_sessao=sttu_ferias_servidor_credenciais.versao_sessao+1,
          alterada_em=now()`;
      await registrarEvento(sql,matricula,'RESET_SENHA',admin.username,motivo);
      return json(res,200,{sucesso:true,mensagem:'Senha redefinida. A senha inicial volta a ser a matrícula e deverá ser alterada. Sessões anteriores invalidadas. As férias já solicitadas, protocolos e vagas permanecem inalterados.'});
    }
    if(acao==='trocar'){
      const ativacao=readChange(req);
      if(!ativacao)return json(res,401,{erro:'Prazo da troca expirado. Entre novamente com matrícula e senha inicial.'});
      const senha=String(body.nova_senha||'');
      if(!novaSenha(senha))return json(res,400,{erro:'Escolha 8 dígitos numéricos; evite sequências e números repetidos.'});
      if(senha===ativacao.m || senha===String(ativacao.m).padStart(8,'0'))
        return json(res,400,{erro:'A nova senha não pode ser igual à matrícula.'});
      const salt=novoSalt(),hash=hashSenha(senha,salt);
      let rows=[];
      if(ativacao.v===0){
        rows=await sql`
          INSERT INTO sttu_ferias_servidor_credenciais
          (matricula,senha_hash,senha_salt,versao_sessao,ativada_em,alterada_em)
          SELECT matricula,${hash},${salt},1,now(),now()
          FROM sttu_ferias_servidores WHERE matricula=${ativacao.m} AND ativo=TRUE
          ON CONFLICT (matricula) DO NOTHING
          RETURNING versao_sessao`;
      }else{
        rows=await sql`
          UPDATE sttu_ferias_servidor_credenciais
          SET senha_hash=${hash},senha_salt=${salt},versao_sessao=versao_sessao+1,
              ativada_em=COALESCE(ativada_em,now()),alterada_em=now()
          WHERE matricula=${ativacao.m} AND versao_sessao=${ativacao.v} AND senha_hash IS NULL
          RETURNING versao_sessao`;
      }
      if(!rows.length){clearServidorCookies(res);return json(res,409,{erro:'A conta foi alterada durante a ativação. Procure o DFV se não reconhece a alteração.'});}
      await registrarEvento(sql,ativacao.m,'SENHA_CRIADA','SERVIDOR');
      const pessoa=await cadastro(sql,ativacao.m);
      setLoginCookie(res,ativacao.m,Number(rows[0].versao_sessao));
      return json(res,200,{sucesso:true,autenticado:true,servidor:{nome:pessoa.nome,matricula:pessoa.matricula_exibicao,funcao_turno:pessoa.funcao_turno}});
    }
    if(acao!=='entrar')return json(res,400,{erro:'Ação inválida.'});
    const m=normalizeMatricula(body.matricula);
    const senha=String(body.senha||'');
    if(!/^\d{4,14}$/.test(m)||senha.length<4||senha.length>128)return invalido(res);
    const chaves=chaveTentativas(req,m);
    if(!await limite(sql,chaves))return json(res,429,{erro:'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.'});
    const pessoa=await cadastro(sql,m);
    const registros=await sql`SELECT senha_hash,senha_salt,versao_sessao
      FROM sttu_ferias_servidor_credenciais WHERE matricula=${m} LIMIT 1`;
    const conta=registros[0]||null;
    let valid=false,primeiro=!conta?.senha_hash;
    if(!pessoa){valid=false;}
    else if(primeiro){valid=(senha===m || senha===pessoa.matricula_exibicao);}
    else{valid=verificaSenha(senha,conta.senha_salt,conta.senha_hash);}
    if(!valid)return invalido(res);
    for(const chave of chaves)await sql`DELETE FROM sttu_ferias_servidor_tentativas WHERE chave=${chave}`;
    if(primeiro){
      setChangeCookie(res,m,conta?Number(conta.versao_sessao):0);
      return json(res,200,{sucesso:true,troca_obrigatoria:true});
    }
    setLoginCookie(res,m,Number(conta.versao_sessao));
    return json(res,200,{sucesso:true,autenticado:true,servidor:{nome:pessoa.nome,matricula:pessoa.matricula_exibicao,funcao_turno:pessoa.funcao_turno}});
  }catch(e){
    console.error('Acesso do servidor:',e.code||e.message);
    return json(res,503,{erro:'Não foi possível validar o acesso. Verifique a migração de credenciais no Neon.'});
  }
}
