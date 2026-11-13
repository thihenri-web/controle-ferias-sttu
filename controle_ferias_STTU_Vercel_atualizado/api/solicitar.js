import { neon } from '@neondatabase/serverless';
import {getServidor,normalizeMatricula,serverOrigin} from '../lib/servidor-auth.js';
import servidorAcessoHandler from '../lib/servidor-acesso.js';
const mensagens = {
  'ANO_INVALIDO': 'Ano inválido.',
  'ANO_BLOQUEADO': 'Este ano ainda não foi liberado pela administração.',
  'PERIODO_BLOQUEADO': 'Um dos períodos escolhidos não está liberado pela administração.',
  'PRAZO_ENCERRADO': 'O prazo de escolha de um dos meses terminou (45 dias de antecedência do dia 1º). Janeiro de 2027 é exceção até 31/12/2026.',
  'NOME_INVALIDO': 'Digite seu nome completo.',
  'MATRICULA_INVALIDA': 'Matrícula inválida.',
  'FUNCAO_NAO_CADASTRADA': 'Função/Turno não cadastrada para esta matrícula. Procure a administração.',
  'SERVIDOR_NAO_CADASTRADO': 'Matrícula não encontrada na relação oficial de servidores.',
  'DADOS_DIVERGENTES': 'Nome e matrícula não correspondem ao cadastro. Atualize a página e selecione novamente.',
  'PERIODOS_INVALIDOS': 'Escolha dois períodos de 15 dias em meses diferentes.',
  'JA_SOLICITADO': 'Já existe uma solicitação para esta matrícula neste ano.',
  'LIMITE_FUNCAO_TURNO': 'Limite por Função/Turno excedido',
  'PERIODO_ESGOTADO': 'Uma das vagas foi preenchida. Atualize as opções e escolha outro período.',
  'REGISTRANTE_NOME_INVALIDO': 'Informe o nome completo de quem está fazendo a solicitação.',
  'REGISTRANTE_EMAIL_INVALIDO': 'Informe um e-mail válido de quem está fazendo a solicitação.',
  'CIENCIA_REGRAS_OBRIGATORIA': 'É necessário ler e confirmar as regras de solicitação de férias.'
};
// O ID numérico permanece interno; o código visível incorpora o ano.
function protocoloPublico(ano,id){
  const n=Number(id);
  return Number.isSafeInteger(n)&&n>0?String(ano)+String(n).padStart(4,'0'):null;
}
// Rótulo informativo; cada escolha continua reservando sua própria vaga/cota.
function tipoDeSolicitacao(ano,periodos){
  if(!Array.isArray(periodos)||periodos.length!==2)return '15+15';
  const a=periodos.find(p=>Number(p.periodo)===2),b=periodos.find(p=>Number(p.periodo)===1);
  if(!a||!b||Number(b.mes)!==Number(a.mes)+1)return '15+15';
  if(Number(ano)===2027&&(Number(a.mes)===1||Number(a.mes)===8))return '15+15';
  return '30';
}
export default async function handler(req, res) {
  // Compartilhamento da mesma Function: ?acesso=1 encaminha apenas autenticacao.
  // O fluxo de ferias continua separado e intacto abaixo.
  if (req.query?.acesso === '1') return servidorAcessoHandler(req, res);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  // Diagnóstico seguro da versão publicada; não retorna dados ou credenciais.
  if (req.method === 'GET') return res.status(200).json({ ok:true, versao:'2027.11-servidor-autenticado', consulta_matricula:'sessao', comprovante:'sessao' });
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if(!serverOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ erro: 'Banco de dados não configurado. Conecte o Neon à Vercel.' });
  }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    // A matrícula e o nome vêm sempre do cookie autenticado e confirmado no Neon.
    // Não aceitamos declarações de identidade do navegador.
    const sqlAuth=neon(process.env.DATABASE_URL);
    const titular=await getServidor(req,sqlAuth);
    if(!titular)return res.status(401).json({erro:'Faça login com sua matrícula para continuar.'});
    if(b.matricula&&normalizeMatricula(b.matricula)!==titular.matricula)
      return res.status(403).json({erro:'Não é permitido solicitar férias para outra matrícula.'});
    if(b.nome&&String(b.nome).trim()!==titular.nome)
      return res.status(403).json({erro:'O nome informado não corresponde à conta autenticada.'});
    const ano=Number(b.ano),nome=titular.nome;
    const matricula=titular.matricula;
    const registranteNome=titular.nome;
    // Marcador técnico explícito para compatibilidade com a função antiga do Neon.
    // O servidor não fornece e-mail nesta versão; .invalid nunca recebe mensagens.
    const registranteEmail = String(b.registrante_email || '').trim().toLowerCase() || 'nao-informado@sttu.invalid';
    // Consulta vinculada à matrícula autenticada; não permite pesquisar terceiros.
    if (b.acao === 'verificar') {
      if (!Number.isInteger(ano) || ano < 2027 || ano > 2100 ||
          !/^[0-9]{4,14}$/.test(matricula.replace(/\D/g, ''))) {
        return res.status(400).json({ erro: 'Ano ou matrícula inválidos.' });
      }
      const digits = matricula.replace(/\D/g, '');
      const sql = neon(process.env.DATABASE_URL);
      const rows = await sql`
        SELECT 1 FROM public.sttu_ferias_solicitacoes
        WHERE ano=${ano}
          AND regexp_replace(matricula,'[^0-9]','','g')=${digits}
        LIMIT 1`;
      return res.status(200).json({ ja_solicitado: rows.length > 0 });
    }
    // Reemissão: diretamente pela matrícula autenticada ou por protocolo, para compatibilidade.
    if (b.acao === 'consultar_comprovante' || b.acao === 'consultar_comprovante_direto') {
      const consultaDireta = b.acao === 'consultar_comprovante_direto';
      const digits = matricula.replace(/\D/g, '');
      const rawProtocolo = String(b.protocolo ?? '').trim();
      const anoPrefixo = String(ano);
      const protocoloCorreto = consultaDireta || (/^\d{8}$/.test(rawProtocolo)
        ? rawProtocolo.startsWith(anoPrefixo)
        : /^\d{1,7}$/.test(rawProtocolo));
      const protocolo = consultaDireta ? 0 : Number(/^\d{8}$/.test(rawProtocolo) ? rawProtocolo.slice(4) : rawProtocolo);
      if (!Number.isInteger(ano) || ano < 2027 || ano > 2100 ||
          !/^[0-9]{4,14}$/.test(digits) ||
          !protocoloCorreto || (!consultaDireta && (!Number.isSafeInteger(protocolo) || protocolo < 1))) {
        return res.status(400).json({ erro: 'Dados de consulta inválidos.' });
      }
      const sql = neon(process.env.DATABASE_URL);
      const rows = await sql`
        SELECT s.id, s.ano, s.nome_completo AS nome, s.matricula,
          COALESCE(s.funcao_turno, c.funcao_turno) AS funcao_turno,
          s.mes_1, s.periodo_1, s.mes_2, s.periodo_2,
          s.registrado_por_nome, s.registrado_por_email,
          to_char(s.criada_em AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI') AS registrada_em,
          to_char(s.ciencia_regras_em AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI') AS ciencia_regras_em,
          to_char(p1.data_inicio, 'YYYY-MM-DD') AS inicio_1,
          to_char(p1.data_fim, 'YYYY-MM-DD') AS fim_1,
          to_char(p2.data_inicio, 'YYYY-MM-DD') AS inicio_2,
          to_char(p2.data_fim, 'YYYY-MM-DD') AS fim_2
        FROM public.sttu_ferias_solicitacoes s
        LEFT JOIN public.sttu_ferias_servidores c ON c.matricula=s.matricula
        LEFT JOIN public.sttu_ferias_periodos_config p1
          ON p1.ano=s.ano AND p1.mes=s.mes_1 AND p1.periodo=s.periodo_1
        LEFT JOIN public.sttu_ferias_periodos_config p2
          ON p2.ano=s.ano AND p2.mes=s.mes_2 AND p2.periodo=s.periodo_2
        WHERE s.ano=${ano}
          AND regexp_replace(s.matricula,'[^0-9]','','g')=${digits}
          AND (${consultaDireta} OR s.id=${protocolo})
        ORDER BY s.id DESC
        LIMIT 1`;
      if (!rows.length) return res.status(404).json({
        erro: consultaDireta ? 'Não foi possível localizar a solicitação desta matrícula. Entre em contato com o DFV.' : 'Comprovante não encontrado com os dados informados. Caso não tenha o número do protocolo, entre em contato com o DFV.'
      });
      const s = rows[0];
      return res.status(200).json({ sucesso:true, solicitacao:{
        id:s.id, protocolo:protocoloPublico(s.ano,s.id), ano:s.ano, nome:s.nome, matricula:s.matricula,
        funcao_turno:s.funcao_turno,
        registrado_por_nome:s.registrado_por_nome,
        registrado_por_email:s.registrado_por_email,
        registrada_em:s.registrada_em, ciencia_regras_em:s.ciencia_regras_em,
        reemissao:true, modalidade:tipoDeSolicitacao(s.ano,[{mes:s.mes_1,periodo:s.periodo_1},{mes:s.mes_2,periodo:s.periodo_2}]),
        escolhas:[
          {mes:s.mes_1,periodo:s.periodo_1,data_inicio:s.inicio_1,data_fim:s.fim_1},
          {mes:s.mes_2,periodo:s.periodo_2,data_inicio:s.inicio_2,data_fim:s.fim_2}
        ]
      }});
    }
    const selecoes = b.selecoes;
    if (b.aceite_regras !== true) return res.status(400).json({ erro: mensagens.CIENCIA_REGRAS_OBRIGATORIA, codigo: 'CIENCIA_REGRAS_OBRIGATORIA' });
    if (!Number.isInteger(ano) || ano < 2027 || ano > 2100 ||
      nome.length < 5 || nome.length > 180 || !nome.includes(' ') ||
      registranteNome.length < 5 || registranteNome.length > 150 || !registranteNome.includes(' ') ||
      registranteEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registranteEmail) ||
      matricula.replace(/[^a-zA-Z0-9]/g, '').length < 3 ||
      !Array.isArray(selecoes) || selecoes.length !== 2 ||
      selecoes.some(x => !Number.isInteger(x.mes) || !Number.isInteger(x.periodo) || x.mes < 1 || x.mes > 12 || ![1,2].includes(x.periodo)) ||
      selecoes[0].mes === selecoes[1].mes) {
      return res.status(400).json({ erro: 'Preencha corretamente os dados e selecione dois períodos em meses diferentes.' });
    }
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`
      SELECT sttu_registrar_ferias_com_ciencia(
        ${ano}, ${nome}, ${matricula},
        ${selecoes[0].mes}, ${selecoes[0].periodo},
        ${selecoes[1].mes}, ${selecoes[1].periodo},
        ${registranteNome}, ${registranteEmail}, ${true}
      ) AS solicitacao
    `;
    const criada=result[0].solicitacao;
    return res.status(201).json({ sucesso:true, solicitacao:{...criada, modalidade:tipoDeSolicitacao(ano,selecoes), protocolo:protocoloPublico(criada.ano||ano,criada.id)} });
  } catch (e) {
    const code = Object.keys(mensagens).sort((a,b) => b.length - a.length).find(c => String(e.message || '').includes(c));
    if (code) return res.status(['LIMITE_FUNCAO_TURNO','JA_SOLICITADO','PERIODO_ESGOTADO','PRAZO_ENCERRADO','ANO_BLOQUEADO','PERIODO_BLOQUEADO'].includes(code) ? 409 : 400).json({ erro: mensagens[code], codigo: code });
    console.error('Erro ao registrar férias:', e);
    return res.status(503).json({ erro: 'Não foi possível registrar a solicitação. Verifique a conexão e tente novamente.' });
  }
}
