import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from './admin-auth.js';

const GROUPS=['Manhã','Adm','Insp','Noite','COTT','Tarde','Corujão'];
export default async function handleDistribution(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  let b;
  try{b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}
  catch{return res.status(400).json({erro:'Dados inválidos.'});}
  const ano=Number(b.ano),mes=Number(b.mes),periodo=Number(b.periodo),capacidade=Number(b.capacidade);
  const cotas=b.cotas;
  if(!validYear(ano)||!Number.isInteger(mes)||mes<1||mes>12||![1,2].includes(periodo)
    ||!Number.isInteger(capacidade)||capacidade<1||capacidade>30
    ||!cotas||typeof cotas!=='object'||Array.isArray(cotas)
    ||Object.keys(cotas).length!==GROUPS.length
    ||!GROUPS.every(g=>Number.isInteger(cotas[g])&&cotas[g]>=0&&cotas[g]<=30))
    return res.status(400).json({erro:'Informe as sete cotas de 0 a 30 e a capacidade de 1 a 30.'});
  const total=GROUPS.reduce((a,g)=>a+cotas[g],0);
  if(total!==capacidade)
    return res.status(409).json({codigo:'SOMA_COTAS_DIFERENTE_CAPACIDADE',erro:`A soma das cotas (${total}) precisa ser igual à capacidade de ${capacidade} vagas.`});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT public.sttu_salvar_distribuicao_periodo(${ano},${mes},${periodo},${capacidade},${JSON.stringify(cotas)}::jsonb) AS resultado`;
    return res.status(200).json(rows[0].resultado);
  }catch(e){
    const msg=String(e.message||'');
    if(msg.includes('SOMA_COTAS_DIFERENTE_CAPACIDADE'))return res.status(409).json({erro:'A soma das vagas por função deve ser igual à capacidade do período.'});
    if(msg.includes('COTA_INFERIOR_OCUPACAO'))return res.status(409).json({erro:'Distribuição incompatível com as solicitações existentes, inclusive a vaga flutuante Tarde/Corujão.'});
    if(msg.includes('CAPACIDADE_INFERIOR_OCUPACAO'))return res.status(409).json({erro:'O período já tem mais reservas normais que a nova capacidade.'});
    if(msg.includes('DISTRIBUICAO_INVALIDA'))return res.status(400).json({erro:'A distribuição informada é inválida.'});
    console.error('Distribuição STTU:',e);
    return res.status(503).json({erro:'Não foi possível salvar. Verifique a atualização SQL no Neon.'});
  }
}
