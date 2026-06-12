// ==========================================
// 1. CONFIGURAÇÃO E ESTADOS GLOBAIS
// ==========================================
const SUPABASE_URL = 'https://jchzgqztsmvznjvrszet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SMarpZSlzxw0_R2FJSi3zw_L6qaaSfD';

const clienteSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true
    }
});

let bancoClientes      = [];
let idUsuarioLogado    = null;
let clienteAtivo       = null;
let classeAtiva        = 'renda_fixa';
let dataAtiva          = null;
let emModoEdicao       = false;
let analyticsModoAtivo = false;
let autoriaTextosAtuais = {};
let respostasAPIAtuais  = {};

const TIPOS_ALERTA_PERMITIDOS = new Set(['sucesso', 'erro', 'aviso']);
const LIMITE_TOKEN_ANALYTICS  = 250_000;
const CLASSE_ALOCACAO_PERCENTUAL = 'alocacao_percentual';
const CLASSE_REGISTRO_PERCENTUAL = '__alocacao_pct__';
const CLASSE_REGISTRO_AUTORIA_TEXTOS = '__autoria_textos__';

// Whitelist de IDs de abas — previne manipulação via onclick
const ABAS_RESUMO_PERMITIDAS = new Set([
    'resumo-aba-perfil', 'resumo-aba-objetivos', 'resumo-aba-restricoes'
]);

const mapeamentoClasses = {
    renda_fixa:          { titulo: 'Renda Fixa Tradicional',      label: 'Indexador / Tipo',      padrao: [['', '', '', '']] },
    credito_privado:     { titulo: 'Crédito Privado',             label: 'Emissor / Rating',      padrao: [['', '', '', '']] },
    acoes:               { titulo: 'Ações',                       label: 'Ticker / Setor',        padrao: [['', '', '', '']] },
    fundos_imobiliarios: { titulo: 'Fundos Imobiliários',         label: 'Ticker / Tipo',         padrao: [['', '', '', '']] },
    fundos_investimento: { titulo: 'Fundos de Investimento',      label: 'Fundo / Estratégia',    padrao: [['', '', '', '']] },
    derivativos:         { titulo: 'Derivativos / Estruturados',  label: 'Estrutura / Opção',     padrao: [['', '', '', '']] },
    previdencia:         { titulo: 'Previdência',                 label: 'Seguradora / Regime',   padrao: [['', '', '', '']] }
};

// ==========================================
// 2. FUNÇÕES DE SEGURANÇA
// ==========================================
function escaparHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#039;');
}

/** Só usa para mensagens geradas internamente pelo sistema — nunca com input de usuário */
function mensagemSegura(valor) {
    return escaparHTML(valor)
        .replace(/&lt;b&gt;/g,   '<b>')
        .replace(/&lt;\/b&gt;/g, '</b>')
        .replace(/&lt;br&gt;/g,  '<br>');
}

function tipoAlertaSeguro(tipo) {
    return TIPOS_ALERTA_PERMITIDOS.has(tipo) ? tipo : 'erro';
}

// ==========================================
// 3. FUNÇÕES DE INTERFACE
// ==========================================
let toastTimer = null;

function mostrarToast(texto, tipo) {
    const caixa = document.getElementById('mensagem-alerta-painel');
    if (!caixa) return;
    clearTimeout(toastTimer);
    const tipoSeguro = tipoAlertaSeguro(tipo);
    caixa.innerHTML   = mensagemSegura(texto);
    caixa.className   = `mensagem-alerta ${tipoSeguro}`;
    toastTimer = setTimeout(() => {
        caixa.className = 'mensagem-alerta oculto';
    }, 5000);
}

const setText = (id, texto) => {
    const el = document.getElementById(id);
    if (el) el.textContent = texto;
};

// ==========================================
// MODAIS — usando AbortController para evitar acúmulo de listeners
// ==========================================
function solicitarDataModal(titulo, descricao, valorPadrao = '') {
    return new Promise(resolve => {
        const modal       = document.getElementById('modal-data');
        const input       = document.getElementById('modal-input');
        const btnConfirmar = document.getElementById('modal-btn-confirmar');
        const btnCancelar  = document.getElementById('modal-btn-cancelar');

        setText('modal-titulo',    titulo);
        setText('modal-descricao', descricao);
        if (input) input.value = valorPadrao;
        if (modal) modal.classList.remove('oculto');
        if (input) input.focus();

        const ac = new AbortController();
        const { signal } = ac;

        const fechar = (valor) => {
            ac.abort();
            if (modal) modal.classList.add('oculto');
            resolve(valor);
        };

        btnConfirmar?.addEventListener('click', () => {
            fechar(document.getElementById('modal-input')?.value ?? null);
        }, { signal });

        btnCancelar?.addEventListener('click', () => fechar(null), { signal });
    });
}

function solicitarConfirmacaoModal(titulo, descricao) {
    return new Promise(resolve => {
        const modal       = document.getElementById('modal-confirmacao');
        const btnConfirmar = document.getElementById('modal-conf-btn-confirmar');
        const btnCancelar  = document.getElementById('modal-conf-btn-cancelar');
        const descEl      = document.getElementById('modal-conf-descricao');

        setText('modal-conf-titulo', titulo);
        if (descEl) descEl.innerHTML = mensagemSegura(descricao);
        if (modal)  modal.classList.remove('oculto');

        const ac = new AbortController();
        const { signal } = ac;

        const fechar = (resultado) => {
            ac.abort();
            if (modal) modal.classList.add('oculto');
            resolve(resultado);
        };

        btnConfirmar?.addEventListener('click', () => fechar(true),  { signal });
        btnCancelar?.addEventListener('click',  () => fechar(false), { signal });
    });
}

// ==========================================
// 4. AUTENTICAÇÃO E INICIALIZAÇÃO
// ==========================================
async function verificarAcesso() {
    const overlay = document.getElementById('painel-loading');
    try {
        const { data: { session }, error } = await clienteSupabase.auth.getSession();
        if (error || !session) {
            window.location.replace('index.html');
            return;
        }
        idUsuarioLogado = session.user.id;
        // Sanitiza o nome antes de exibir — user_metadata pode conter dados arbitrários
        const nomeRaw = session.user.user_metadata?.nome_completo
            || session.user.email?.split('@')[0]
            || 'Consultor';
        // Trunca e escapa — textContent é seguro, mas limitamos o tamanho
        const nome = String(nomeRaw).slice(0, 80);
        setText('identificador-usuario', nome);
        await carregarClientesDoSupabase();
    } catch (err) {
        console.error('[Prisma] Falha na verificação de acesso:', err);
        window.location.replace('index.html');
    } finally {
        if (overlay) {
            overlay.classList.add('painel-loading-saindo');
            setTimeout(() => overlay.remove(), 420);
        }
    }
}
verificarAcesso();

// Renovação de sessão — redireciona se expirar
clienteSupabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED_FAILURE') {
        window.location.replace('index.html');
    }
});

// ==========================================
// 5. CARREGAMENTO DE CLIENTES
// ==========================================
function mostrarSkeletonSidebar() {
    const lista = document.getElementById('lista-clientes-standby');
    if (!lista) return;
    lista.innerHTML = Array(4).fill(
        '<li class="skeleton-item skeleton-cliente" aria-hidden="true"></li>'
    ).join('');
}

async function carregarClientesDoSupabase() {
    mostrarSkeletonSidebar();
    try {
        // Clientes próprios
        const { data: meusClientes, error: erroProprios } = await clienteSupabase
            .from('clientes')
            .select('*')
            .eq('user_id', idUsuarioLogado);

        if (erroProprios) throw erroProprios;

        // Vínculos compartilhados
        const { data: vinculos, error: erroVinculos } = await clienteSupabase
            .from('consultores_clientes')
            .select('cliente_id')
            .eq('user_id', idUsuarioLogado);

        if (erroVinculos) console.warn('[Prisma] Erro ao buscar vínculos:', erroVinculos.message);

        let clientesCompartilhados = [];
        if (vinculos && vinculos.length > 0) {
            const ids = vinculos.map(v => v.cliente_id);
            const { data: compartilhados, error: erroComp } = await clienteSupabase
                .from('clientes')
                .select('*')
                .in('id', ids);

            if (erroComp) console.warn('[Prisma] Erro ao buscar clientes compartilhados:', erroComp.message);
            else clientesCompartilhados = compartilhados || [];
        }

        const todos = [...(meusClientes || []), ...clientesCompartilhados];
        // Deduplica e ordena
        bancoClientes = [...new Map(todos.map(item => [item.id, item])).values()]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        atualizarListaSidebar();
        atualizarDashboardConsultor();
    } catch (err) {
        console.error('[Prisma] carregarClientesDoSupabase:', err);
        const lista = document.getElementById('lista-clientes-standby');
        if (lista) {
            lista.innerHTML = '';
            const erroLi = document.createElement('li');
            erroLi.className = 'sidebar-empty sidebar-erro';
            erroLi.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><strong>Falha na conexão</strong><span>Não foi possível carregar os clientes.</span>`;
            const btnRetry = document.createElement('button');
            btnRetry.type = 'button';
            btnRetry.className = 'btn-retry-sidebar';
            btnRetry.textContent = 'Tentar novamente';
            btnRetry.addEventListener('click', carregarClientesDoSupabase);
            erroLi.appendChild(btnRetry);
            lista.appendChild(erroLi);
        }
    }
}

// ==========================================
// 6. COMPARTILHAMENTO DE SALAS
// ==========================================
document.getElementById('btn-entrar-sala')?.addEventListener('click', async () => {
    const inputCodigo = document.getElementById('input-codigo-sala');
    if (!inputCodigo) return;
    const codigo = inputCodigo.value.trim();

    // Valida formato do código
    if (!codigo || !/^[A-Za-z0-9_\-]{4,32}$/.test(codigo)) {
        mostrarToast('Código de sala inválido.', 'erro');
        return;
    }

    try {
        const { data: clienteEnc, error } = await clienteSupabase
            .from('clientes')
            .select('id, nome, codigo_sala')
            .eq('codigo_sala', codigo)
            .single();

        if (error || !clienteEnc) {
            mostrarToast('Sala não encontrada. Verifique o código.', 'erro');
            return;
        }

        const { error: erroVinc } = await clienteSupabase
            .from('consultores_clientes')
            .insert([{ user_id: idUsuarioLogado, cliente_id: clienteEnc.id }]);

        if (erroVinc && !erroVinc.message.includes('duplicate key')) {
            mostrarToast('Erro ao conectar à sala.', 'erro');
        } else {
            mostrarToast(`<b>Conectado!</b><br>Você agora divide a sala de ${escaparHTML(clienteEnc.nome)}.`, 'sucesso');
            inputCodigo.value = '';
            await carregarClientesDoSupabase();
        }
    } catch (err) {
        mostrarToast('Erro de conexão. Tente novamente.', 'erro');
    }
});

// ==========================================
// 7. QUESTIONÁRIO DE SUITABILITY (CVM 30)
// ==========================================
const questoesAPI = [
    { id: 'q1', titulo: '1. Qual é o propósito primordial que motivou a abertura da sua conta e a alocação de recursos na Prisma Investimentos?', opcoes: [{v:0, t:'[A] Preservar integralmente o capital acumulado, priorizando segurança absoluta e liquidez imediata para contingências (Reserva de Emergência).'}, {v:4, t:'[B] Obter ganhos moderados acima da inflação no médio prazo, aceitando pequenas oscilações para atingir objetivos específicos.'}, {v:8, t:'[C] Maximizar o crescimento patrimonial no longo prazo, com foco em acumulação de capital e independência financeira, tolerando fortes oscilações de mercado.'}] },
    { id: 'q2', titulo: '2. Por quanto tempo você pretende manter a maior parcela dos seus recursos aplicados na nossa plataforma antes de iniciar resgates estruturais?', opcoes: [{v:0, t:'[A] Curto prazo: Menos de 1 ano até o máximo de 2 anos.'}, {v:4, t:'[B] Médio prazo: De 2 a 5 anos.'}, {v:8, t:'[C] Longo prazo: Acima de 5 anos.'}] },
    { id: 'q3', titulo: '3. Qual das alternativas melhor descreve a sua renda mensal regular proveniente de salários, pró-labore, aluguéis ou rendimentos de PJ?', opcoes: [{v:1, t:'[A] Até R$ 5.000.'}, {v:3, t:'[B] De R$ 5.000 a R$ 15.000.'}, {v:5, t:'[C] De R$ 15.000 a R$ 30.000.'}, {v:7, t:'[D] Superior a R$ 30.000.'}] },
    { id: 'q4', titulo: '4. Qual o valor total estimado do seu patrimônio líquido já constituído (somando imóveis, veículos, participações societárias e investimentos financeiros gerais)?', opcoes: [{v:1, t:'[A] Até R$ 100.000.'}, {v:3, t:'[B] De R$ 100.000 a R$ 500.000.'}, {v:5, t:'[C] De R$ 500.000 a R$ 2.000.000.'}, {v:7, t:'[D] Superior a R$ 2.000.000.'}] },
    { id: 'q5', titulo: '5. Excluindo o horizonte planejado, qual é a sua necessidade real e estimada de saques/resgates desta carteira para cobrir despesas correntes ou obrigações nos próximos 12 meses?', opcoes: [{v:0, t:'[A] Alta e imediata: Preciso da liquidez disponível para complementar minha renda recorrente ou quitar compromissos de curto prazo.'}, {v:4, t:'[B] Moderada: Mantenho outros fluxos, mas posso precisar resgatar parcelas parciais em caso de imprevistos.'}, {v:8, t:'[C] Baixa ou Nula: Minhas fontes de renda habituais suprem plenamente minhas necessidades; não prevejo saques nos próximos meses.'}] },
    { id: 'q6', titulo: '6. Qual percentual da sua receita mensal você consegue poupar e destinar de forma recorrente para novos investimentos?', opcoes: [{v:0, t:'[A] Não consigo poupar rotineiramente ou possuo compromissos com dívidas estruturais em aberto.'}, {v:3, t:'[B] Poupo esporadicamente ou até 10% da minha renda líquida.'}, {v:6, t:'[C] Poupo e reinvisto consistentemente entre 11% e 30% da minha renda.'}, {v:9, t:'[D] Poupo e aloco de forma regular mais de 30% dos meus ganhos mensais.'}] },
    { id: 'q7', titulo: '7. Como você autoavalia o seu nível de conhecimento técnico e conceitual sobre o mercado de capitais e dinâmicas de risco?', opcoes: [{v:1, t:'[A] Básico/Iniciante: Compreendo apenas produtos tradicionais de balcão (Poupança, CDB) e os conceitos básicos de juros sólidos.'}, {v:4, t:'[B] Intermediário: Compreendo a diferença entre renda fixa e variável, o impacto da inflação e o conceito de diversificação por fundos.'}, {v:8, t:'[C] Avançado: Entendo conceitos complexos como marcação a mercado, volatilidade, duration, precificação de derivativos e risco de crédito privado.'}] },
    { id: 'q8', titulo: '8. Com quais das classes de ativos abaixo listadas você possui familiaridade prática ou já realizou operações reais de compra/venda?', multi: true, opcoes: [{v:1, t:'[A] Apenas Poupança, CDB, LCI/LCA ou Títulos Públicos via Tesouro Direto.'}, {v:4, t:'[B] Fundos de Investimento (Multimercados/Renda Fixa) e Debentures/Crédito Privado.'}, {v:7, t:'[C] Ações em Bolsa de Valores, Fundos Imobiliários (FIls) ou ETFs.'}, {v:10, t:'[D] Produtos complexos, derivativos (opções/futuros), Certificados de Operações Estruturadas (COE) ou Criptoativos.'}] },
    { id: 'q9', titulo: '9. Considerando o volume de recursos e a frequência, qual foi a natureza das suas operações financeiras nos últimos 24 meses?', opcoes: [{v:1, t:'[A] Inexistente ou muito esporádica.'}, {v:4, t:'[B] Frequência moderada (aportes trimestrais ou semestrais).'}, {v:8, t:'[C] Frequência alta (operações mensais ou semanais em renda variável).'}] },
    { id: 'q10', titulo: '10. (Aversão à Perda) Suponha que ocorra um estresse macroeconômico global e os investimentos de sua carteira consolidada sofram uma desvalorização temporária de 15%. Sabendo que o prazo de maturação dos ativos é longo, qual é a sua reação instintiva?', opcoes: [{v:0, t:'[A] Sinto extremo desconforto e solicito o resgate imediato de tudo para estancar a perda, mesmo consolidando o prejuízo.'}, {v:4, t:'[B] Fico preocupado e monitoro o cenário de perto. Aguardo um período razoável para verificar a recuperação.'}, {v:8, t:'[C] Compreendo a volatilidade inerente à renda variável. Mantenho a estratégia inalterada e avalio a oportunidade de aportar mais recursos.'}] },
    { id: 'q11', titulo: '11. (Perfil de Risco-Retorno) No mercado financeiro, maiores potenciais de rentabilidade estão umbilicalmente associados a maiores riscos de perda patrimonial. Qual das ponderações abaixo reflete a sua mentalidade?', opcoes: [{v:0, t:'[A] Priorizo a proteção total e nominal do meu dinheiro. Prefiro não ter ganho real significativo a expor meu capital a qualquer risco.'}, {v:4, t:'[B] Busco um equilíbrio ponderado. Aceito correr riscos controlados e moderados em parte do capital para tentar capturar retornos acima da inflação.'}, {v:8, t:'[C] Busco rentabilidade máxima no longo prazo. Aceito correr riscos elevados de perdas severas e oscilações bruscas sobre a totalidade dos ativos aplicados.'}] },
    { id: 'q12', titulo: '12. (Efeito de Ancoragem e Complexidade) Ao analisar uma oferta de Certificado de Operações Estruturadas (COE) ou derivativo, qual é o seu foco de decisão principal?', opcoes: [{v:0, t:'[A] Não invisto neste tipo de produto por não compreender integralmente o funcionamento dos cenários múltiplos.'}, {v:4, t:'[B] Sinto atração pelas promessas de "capital protegido", mas busco entender os custos implícitos e a falta de liquidez.'}, {v:8, t:'[C] Avalio o ativo subjacente e o cenário de ganho alavancado, ciente de que o custo de oportunidade e a falta de liquidez fazem parte do risco aceito.'}] }
];

function inicializarQuestionarioAPI() {
    const container = document.getElementById('lista-questoes-api');
    if (!container) return;
    container.innerHTML = '';

    questoesAPI.forEach(q => {
        const div = document.createElement('div');
        div.className = 'api-questao';

        const p = document.createElement('p');
        p.textContent = q.titulo;
        if (q.multi) {
            const tag = document.createElement('span');
            tag.style.cssText = 'color:#38BDF8;font-size:12px;margin-left:8px;';
            tag.textContent = '(Múltipla Escolha)';
            p.appendChild(tag);
        }
        div.appendChild(p);

        q.opcoes.forEach((op, index) => {
            const label = document.createElement('label');
            label.className = 'api-opcao';
            label.setAttribute('for', `${q.id}_${index}`);

            const input = document.createElement('input');
            input.type  = q.multi ? 'checkbox' : 'radio';
            input.name  = q.id;
            input.id    = `${q.id}_${index}`;
            input.value = String(op.v);  // valor numérico como string

            const span = document.createElement('span');
            span.textContent = op.t;

            label.appendChild(input);
            label.appendChild(span);
            div.appendChild(label);
        });

        container.appendChild(div);
    });
}
inicializarQuestionarioAPI();

document.getElementById('btn-abrir-questionario')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('modal-questionario-api')?.classList.remove('oculto');
});
document.getElementById('modal-api-btn-cancelar')?.addEventListener('click', () => {
    document.getElementById('modal-questionario-api')?.classList.add('oculto');
});
document.getElementById('modal-api-btn-fechar')?.addEventListener('click', () => {
    document.getElementById('modal-questionario-api')?.classList.add('oculto');
});

document.getElementById('modal-api-btn-calcular')?.addEventListener('click', () => {
    let pontuacao = 0;
    let todasRespondidas = true;
    const respostasCliente = {};

    questoesAPI.forEach(q => {
        if (q.multi) {
            const selecionados = document.querySelectorAll(`input[name="${q.id}"]:checked`);
            if (selecionados.length > 0) {
                let maxVal = 0;
                const arr = [];
                selecionados.forEach(el => {
                    const val = parseInt(el.value, 10);
                    if (!isNaN(val)) { arr.push(val); if (val > maxVal) maxVal = val; }
                });
                pontuacao += maxVal;
                respostasCliente[q.id] = arr;
            } else {
                todasRespondidas = false;
            }
        } else {
            const selecionado = document.querySelector(`input[name="${q.id}"]:checked`);
            if (selecionado) {
                const val = parseInt(selecionado.value, 10);
                if (!isNaN(val)) pontuacao += val;
                respostasCliente[q.id] = isNaN(parseInt(selecionado.value, 10)) ? 0 : parseInt(selecionado.value, 10);
            } else {
                todasRespondidas = false;
            }
        }
    });

    if (!todasRespondidas) {
        mostrarToast('Responda todas as 12 questões táticas para validar o API.', 'erro');
        return;
    }

    let perfilFinal  = pontuacao <= 25 ? 'Conservador' : pontuacao <= 65 ? 'Moderado' : 'Arrojado';
    let avisoGatilho = '';

    if (respostasCliente['q5'] === 0) {
        perfilFinal  = 'Conservador';
        avisoGatilho = '⚠️ REBAIXADO: Cliente exige liquidez imediata.';
    }
    if (perfilFinal === 'Arrojado' && Array.isArray(respostasCliente['q8'])) {
        const maxQ8 = Math.max(...respostasCliente['q8']);
        if (maxQ8 === 1) {
            avisoGatilho = '⛔ BLOQUEIO CVM: Exigir Termo de Letramento antes de operar em Bolsa.';
        }
    }

    setText('display-perfil-calculado',  perfilFinal);
    setText('display-pontuacao-calculada', `Pontuação: ${pontuacao} / 95`);

    const resInput  = document.getElementById('perfil-investidor-resultado');
    const pontInput = document.getElementById('perfil-investidor-pontuacao');
    if (resInput)  resInput.value  = perfilFinal;
    if (pontInput) pontInput.value = pontuacao;

    const lblAviso = document.getElementById('aviso-gatilho-api');
    if (lblAviso) {
        lblAviso.textContent     = avisoGatilho;
        lblAviso.style.display   = avisoGatilho ? 'block' : 'none';
    }

    respostasAPIAtuais = respostasCliente;
    document.getElementById('modal-questionario-api')?.classList.add('oculto');
    mostrarToast('Perfil API calculado com base na CVM 30!', 'sucesso');
});

// ==========================================
// 8. WIZARD DE SUITABILITY
// ==========================================
const WIZARD_LABELS = [
    'Dados do Cliente',
    'Situação Financeira',
    'Perfil de Investidor (API CVM 30)',
    'Objetivos Financeiros',
    'Restrições e Preferências',
    'Cenário Familiar e Sucessório',
    'Resultado Esperado',
    'Distribuição Inicial Sugerida'
];
let stepAtual = 1;
const TOTAL_STEPS = 8;

function irParaStepWizard(n) {
    stepAtual = Math.max(1, Math.min(n, TOTAL_STEPS));
    const secoes = document.querySelectorAll('#form-suitability .form-section');
    secoes.forEach((sec, idx) => {
        sec.classList.toggle('wizard-step-ativo', idx + 1 === stepAtual);
    });

    // Atualiza dots
    document.querySelectorAll('.wizard-step-dot').forEach(dot => {
        const s = parseInt(dot.dataset.step);
        dot.classList.toggle('active',    s === stepAtual);
        dot.classList.toggle('concluido', s < stepAtual);
    });
    // Atualiza linhas
    document.querySelectorAll('.wizard-step-line').forEach((line, idx) => {
        line.classList.toggle('concluido', idx + 1 < stepAtual);
    });

    const label = document.getElementById('wizard-step-label');
    if (label) label.textContent = `Passo ${stepAtual} de ${TOTAL_STEPS} — ${WIZARD_LABELS[stepAtual - 1]}`;

    const btnAnt  = document.getElementById('wizard-btn-anterior');
    const btnProx = document.getElementById('wizard-btn-proximo');
    const btnSalv = document.getElementById('btn-salvar-cliente');

    if (btnAnt)  btnAnt.style.display  = stepAtual > 1 ? '' : 'none';
    if (btnProx) btnProx.style.display = stepAtual < TOTAL_STEPS ? '' : 'none';
    if (btnSalv) btnSalv.style.display = stepAtual === TOTAL_STEPS ? '' : 'none';

    // Foca no primeiro input do step
    const primeiroInput = secoes[stepAtual - 1]?.querySelector('input, select, textarea');
    if (primeiroInput) setTimeout(() => primeiroInput.focus(), 80);

    // Scrolla para o topo do form
    document.getElementById('container-form-suitability')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function inicializarWizard() {
    document.getElementById('wizard-btn-proximo')?.addEventListener('click', () => irParaStepWizard(stepAtual + 1));
    document.getElementById('wizard-btn-anterior')?.addEventListener('click', () => irParaStepWizard(stepAtual - 1));
}
inicializarWizard();

// ==========================================
// 8. CADASTRO E EDIÇÃO DE CLIENTES
// ==========================================
function abrirFormNovoCliente() {
    emModoEdicao = false;
    setText('titulo-aba-suitability', 'Formulário de Suitability e Alocação Inicial');
    document.getElementById('form-suitability')?.reset();
    setText('display-perfil-calculado',   'Pendente');
    setText('display-pontuacao-calculada', 'Pontuação: 0 / 95');
    const avisoGatilho = document.getElementById('aviso-gatilho-api');
    if (avisoGatilho) avisoGatilho.style.display = 'none';
    const resPerf  = document.getElementById('perfil-investidor-resultado');
    const pontPerf = document.getElementById('perfil-investidor-pontuacao');
    if (resPerf)  resPerf.value  = 'Pendente';
    if (pontPerf) pontPerf.value = '0';
    respostasAPIAtuais = {};
    document.querySelectorAll('#lista-questoes-api input').forEach(r => r.checked = false);
    document.getElementById('estado-vazio')?.classList.remove('active');
    document.getElementById('container-workspace-cliente')?.classList.remove('active');
    document.getElementById('container-form-suitability')?.classList.add('active');
    irParaStepWizard(1);
}

document.getElementById('btn-novo-cliente')?.addEventListener('click', abrirFormNovoCliente);
document.getElementById('btn-dashboard-novo-cliente')?.addEventListener('click', abrirFormNovoCliente);

document.getElementById('btn-salvar-cliente')?.addEventListener('click', async () => {
    const nome = document.getElementById('cli-nome')?.value?.trim() ?? '';

    if (!nome) {
        mostrarToast('O Nome do Cliente é obrigatório.', 'erro');
        return;
    }
    if (nome.length > 120) {
        mostrarToast('Nome muito longo. Máximo de 120 caracteres.', 'erro');
        return;
    }

    const payloadDadosExtra = {
        fin_renda:             document.getElementById('fin-renda')?.value || '',
        fin_renda_conjuge:     document.getElementById('fin-renda-conjuge')?.value || '',
        fin_despesas:          document.getElementById('fin-despesas')?.value || '',
        fin_aporte:            document.getElementById('fin-aporte')?.value || '',
        fin_imoveis:           document.getElementById('fin-imoveis')?.value || '',
        fin_dividas:           document.getElementById('fin-dividas')?.value || '',
        perfil_investidor:     document.getElementById('perfil-investidor-resultado')?.value || 'Pendente',
        perfil_pontuacao:      (() => { const v = parseInt(document.getElementById('perfil-investidor-pontuacao')?.value || '0', 10); return Number.isNaN(v) ? 0 : v; })(),
        respostas_api:         respostasAPIAtuais || {},
        perfil_caracteristicas:document.getElementById('perfil-caracteristicas')?.value || '',
        objetivos: [
            [document.getElementById('obj-reserva-val')?.value || '', document.getElementById('obj-reserva-obs')?.value || '', document.getElementById('obj-reserva-horizonte')?.value || 'Imediato'],
            [document.getElementById('obj-2-nome')?.value || '',  document.getElementById('obj-2-val')?.value || '',  document.getElementById('obj-2-obs')?.value || '', document.getElementById('obj-2-horizonte')?.value || ''],
            [document.getElementById('obj-3-nome')?.value || '',  document.getElementById('obj-3-val')?.value || '',  document.getElementById('obj-3-obs')?.value || '', document.getElementById('obj-3-horizonte')?.value || ''],
            [document.getElementById('obj-4-nome')?.value || '',  document.getElementById('obj-4-val')?.value || '',  document.getElementById('obj-4-obs')?.value || '', document.getElementById('obj-4-horizonte')?.value || ''],
            [document.getElementById('obj-5-nome')?.value || '',  document.getElementById('obj-5-val')?.value || '',  document.getElementById('obj-5-obs')?.value || '', document.getElementById('obj-5-horizonte')?.value || '']
        ],
        rest_liquidez:         document.getElementById('rest-liquidez')?.value || '',
        rest_tributacao:       document.getElementById('rest-tributacao')?.value || '',
        rest_aversoes:         document.getElementById('rest-aversoes')?.value || '',
        rest_preferencias:     document.getElementById('rest-preferencias')?.value || '',
        sucessorio_detalhes:   document.getElementById('sucessorio-detalhes')?.value || '',
        resultado_esperado:    document.getElementById('resultado-esperado')?.value || '',
        distribuicao_sugerida: Array.from(
            document.querySelectorAll('#tabela-sugestoes-suitability tbody tr')
        ).map(tr => [
            tr.cells[0]?.textContent || '',
            tr.querySelector('.sug-p')?.value || '',
            tr.querySelector('.sug-v')?.value || ''
        ])
    };

    const idadeVal = document.getElementById('cli-idade')?.value;
    const pacoteCliente = {
        nome,
        idade:        idadeVal ? parseInt(idadeVal, 10) : null,
        estado_civil: document.getElementById('cli-estado-civil')?.value || '',
        dependentes:  document.getElementById('cli-dependentes')?.value  || '',
        profissao:    document.getElementById('cli-profissao')?.value    || '',
        cidade:       document.getElementById('cli-cidade')?.value       || '',
        conhecimento: document.getElementById('cli-conhecimento')?.value || '',
        patrimonio:   document.getElementById('fin-patrimonio')?.value   || '',
        dados_json:   payloadDadosExtra
    };

    const btn = document.getElementById('btn-salvar-cliente');
    if (btn) { btn.textContent = 'Salvando…'; btn.disabled = true; }

    try {
        let erroOperacao = null;

        if (emModoEdicao && clienteAtivo) {
            const { error } = await clienteSupabase
                .from('clientes')
                .update(pacoteCliente)
                .eq('id', clienteAtivo.id)
                .eq('user_id', idUsuarioLogado);
            erroOperacao = error;
        } else {
            pacoteCliente.user_id = idUsuarioLogado;
            const { error } = await clienteSupabase
                .from('clientes')
                .insert([pacoteCliente]);
            erroOperacao = error;
        }

        if (!erroOperacao) {
            mostrarToast('Ficha do cliente salva e sincronizada na nuvem.', 'sucesso');
            document.getElementById('container-form-suitability')?.classList.remove('active');
            await carregarClientesDoSupabase();
            if (emModoEdicao && clienteAtivo) {
                abrirWorkspaceCliente(Object.assign({}, clienteAtivo, pacoteCliente));
            }
        } else {
            mostrarToast('Erro ao salvar ficha: ' + escaparHTML(erroOperacao.message), 'erro');
        }
    } catch (err) {
        mostrarToast('Erro de conexão. Tente novamente.', 'erro');
    } finally {
        if (btn) { btn.textContent = 'Salvar Ficha'; btn.disabled = false; }
    }
});

// Edição de ficha existente
document.getElementById('btn-editar-suitability-ativo')?.addEventListener('click', () => {
    if (!clienteAtivo) return;
    emModoEdicao = true;
    setText('titulo-aba-suitability', `Editando Ficha: ${clienteAtivo.nome}`);

    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };

    setVal('cli-nome',        clienteAtivo.nome);
    setVal('cli-idade',       clienteAtivo.idade);
    setVal('cli-estado-civil',clienteAtivo.estado_civil);
    setVal('cli-dependentes', clienteAtivo.dependentes);
    setVal('cli-profissao',   clienteAtivo.profissao);
    setVal('cli-cidade',      clienteAtivo.cidade);
    setVal('cli-conhecimento',clienteAtivo.conhecimento);
    setVal('fin-patrimonio',  clienteAtivo.patrimonio);

    const extra = clienteAtivo.dados_json || {};
    setVal('fin-renda',           extra.fin_renda);
    setVal('fin-renda-conjuge',   extra.fin_renda_conjuge);
    setVal('fin-despesas',        extra.fin_despesas);
    setVal('fin-aporte',          extra.fin_aporte);
    setVal('fin-imoveis',         extra.fin_imoveis);
    setVal('fin-dividas',         extra.fin_dividas);
    setVal('perfil-caracteristicas', extra.perfil_caracteristicas);
    setVal('rest-liquidez',       extra.rest_liquidez);
    setVal('rest-tributacao',     extra.rest_tributacao);
    setVal('rest-aversoes',       extra.rest_aversoes);
    setVal('rest-preferencias',   extra.rest_preferencias);
    setVal('sucessorio-detalhes', extra.sucessorio_detalhes);
    setVal('resultado-esperado',  extra.resultado_esperado);
    setVal('perfil-investidor-resultado', extra.perfil_investidor || 'Pendente');
    setVal('perfil-investidor-pontuacao', extra.perfil_pontuacao  || 0);

    setText('display-perfil-calculado',   extra.perfil_investidor || 'Pendente');
    setText('display-pontuacao-calculada', `Pontuação: ${extra.perfil_pontuacao || 0} / 95`);

    // Restaura respostas do questionário
    respostasAPIAtuais = extra.respostas_api || {};
    document.querySelectorAll('#lista-questoes-api input').forEach(r => r.checked = false);
    if (extra.respostas_api) {
        for (const [qId, v] of Object.entries(extra.respostas_api)) {
            if (Array.isArray(v)) {
                v.forEach(val => {
                    const cb = document.querySelector(`input[name="${CSS.escape(qId)}"][value="${val}"]`);
                    if (cb) cb.checked = true;
                });
            } else {
                const radio = document.querySelector(`input[name="${CSS.escape(qId)}"][value="${v}"]`);
                if (radio) radio.checked = true;
            }
        }
    }

    // Restaura objetivos
    if (Array.isArray(extra.objetivos) && extra.objetivos.length >= 5) {
        setVal('obj-reserva-val',      extra.objetivos[0]?.[0]);
        setVal('obj-reserva-obs',      extra.objetivos[0]?.[1]);
        setVal('obj-reserva-horizonte',extra.objetivos[0]?.[2] || 'Imediato');
        [[1,'2'],[2,'3'],[3,'4'],[4,'5']].forEach(([idx, sfx]) => {
            setVal(`obj-${sfx}-nome`,     extra.objetivos[idx]?.[0]);
            setVal(`obj-${sfx}-val`,      extra.objetivos[idx]?.[1]);
            setVal(`obj-${sfx}-obs`,      extra.objetivos[idx]?.[2]);
            setVal(`obj-${sfx}-horizonte`,extra.objetivos[idx]?.[3] || '');
        });
    }

    // Restaura sugestão de distribuição
    if (Array.isArray(extra.distribuicao_sugerida)) {
        const trs = document.querySelectorAll('#tabela-sugestoes-suitability tbody tr');
        extra.distribuicao_sugerida.forEach((linha, i) => {
            if (!trs[i]) return;
            const p = trs[i].querySelector('.sug-p');
            const v = trs[i].querySelector('.sug-v');
            if (p) p.value = linha[1] || '';
            if (v) v.value = linha[2] || '';
        });
    }

    document.getElementById('container-workspace-cliente')?.classList.remove('active');
    document.getElementById('container-form-suitability')?.classList.add('active');
    irParaStepWizard(1);
});

// ==========================================
// 9. VISÃO RÁPIDA DE SUITABILITY (QUICK VIEW)
// ==========================================
document.getElementById('btn-ver-resumo-ativo')?.addEventListener('click', () => {
    if (!clienteAtivo) return;
    const extra = clienteAtivo.dados_json || {};

    setText('resumo-nome-cliente', clienteAtivo.nome);
    setText('res-idade',       clienteAtivo.idade ? `${clienteAtivo.idade} anos` : '-');
    setText('res-estado-civil', clienteAtivo.estado_civil || '-');
    setText('res-profissao',    clienteAtivo.profissao || '-');
    setText('res-renda',        extra.fin_renda    ? `R$ ${extra.fin_renda}`    : '-');
    setText('res-despesas',     extra.fin_despesas ? `R$ ${extra.fin_despesas}` : '-');
    setText('res-aporte',       extra.fin_aporte   ? `R$ ${extra.fin_aporte}`   : '-');
    setText('res-imoveis',      extra.fin_imoveis  ? `R$ ${extra.fin_imoveis}`  : '-');
    setText('res-dividas',      extra.fin_dividas  ? `R$ ${extra.fin_dividas}`  : '-');
    setText('res-patrimonio',   clienteAtivo.patrimonio ? `R$ ${clienteAtivo.patrimonio}` : '-');
    setText('res-conhecimento', clienteAtivo.conhecimento || '-');
    setText('res-pontuacao',    extra.perfil_pontuacao ? `${extra.perfil_pontuacao} / 95` : '-');
    setText('res-perfil',       extra.perfil_investidor || 'Não definido');
    setText('res-caract',       extra.perfil_caracteristicas || 'Nenhuma declarada');
    setText('res-resultado',    extra.resultado_esperado || 'Não documentado');
    setText('res-liquidez',     extra.rest_liquidez    || 'Sem restrições documentadas.');
    setText('res-tributacao',   extra.rest_tributacao  || 'Sem observações.');
    setText('res-aversoes',     extra.rest_aversoes    || 'Nenhuma.');
    setText('res-preferencias', extra.rest_preferencias || 'Nenhuma.');
    setText('res-sucessorio',   extra.sucessorio_detalhes || 'Sem planejamento detalhado.');

    const tbodyObj = document.getElementById('resumo-tabela-objetivos-body');
    if (tbodyObj) {
        tbodyObj.innerHTML = '';
        if (Array.isArray(extra.objetivos) && extra.objetivos.length > 0) {
            tbodyObj.innerHTML = `<tr><td>Reserva de Emergência</td><td>${escaparHTML(extra.objetivos[0]?.[2] || 'Imediato')}</td><td>${escaparHTML(extra.objetivos[0]?.[0] || '-')}</td><td>${escaparHTML(extra.objetivos[0]?.[1] || '-')}</td></tr>`;
            for (let i = 1; i < 5; i++) {
                if (extra.objetivos[i]?.[0]) {
                    tbodyObj.innerHTML += `<tr><td>${escaparHTML(extra.objetivos[i][0])}</td><td>${escaparHTML(extra.objetivos[i][3] || '-')}</td><td>${escaparHTML(extra.objetivos[i][1] || '-')}</td><td>${escaparHTML(extra.objetivos[i][2] || '-')}</td></tr>`;
                }
            }
        } else {
            tbodyObj.innerHTML = `<tr><td colspan="4" style="text-align:center;">Nenhum objetivo registrado</td></tr>`;
        }
    }

    const modal = document.getElementById('modal-resumo-suitability');
    if (modal) modal.classList.remove('oculto');

    // Reseta abas
    document.querySelectorAll('#modal-resumo-suitability .tab-button').forEach(b => b.classList.remove('active'));
    document.querySelector('#modal-resumo-suitability .tab-button')?.classList.add('active');
    document.querySelectorAll('.resumo-aba').forEach(a => a.classList.remove('active'));
    document.getElementById('resumo-aba-perfil')?.classList.add('active');
});

document.getElementById('modal-resumo-fechar')?.addEventListener('click', () => {
    document.getElementById('modal-resumo-suitability')?.classList.add('oculto');
});

/** Troca aba do resumo — com whitelist de IDs */
function mudarAbaResumo(abaId, botaoClicado) {
    if (!ABAS_RESUMO_PERMITIDAS.has(abaId)) return;
    document.querySelectorAll('#modal-resumo-suitability .tab-button').forEach(b => b.classList.remove('active'));
    if (botaoClicado) botaoClicado.classList.add('active');
    document.querySelectorAll('.resumo-aba').forEach(a => a.classList.remove('active'));
    document.getElementById(abaId)?.classList.add('active');
};

// ==========================================
// 10. DASHBOARD E MÉTRICAS
// ==========================================
function normalizarTexto(valor) {
    return String(valor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function moedaParaNumero(valor) {
    if (!valor) return 0;
    const limpo = String(valor).replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
    const numero = parseFloat(limpo);
    return Number.isFinite(numero) ? numero : 0;
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

function obterExtraCliente(cliente) {
    return cliente?.dados_json || {};
}

function calcularCompletudeCliente(cliente) {
    const extra = obterExtraCliente(cliente);
    const checks = [
        cliente?.nome,
        cliente?.idade,
        cliente?.profissao,
        cliente?.cidade,
        cliente?.conhecimento,
        cliente?.patrimonio,
        extra.fin_renda,
        extra.fin_despesas,
        extra.fin_aporte,
        extra.perfil_investidor && extra.perfil_investidor !== 'Pendente',
        extra.resultado_esperado,
        extra.rest_liquidez,
        extra.objetivos?.some(obj => Array.isArray(obj) && obj.some(Boolean))
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function obterPendenciasCliente(cliente) {
    const extra = obterExtraCliente(cliente);
    const pendencias = [];
    if (!cliente?.patrimonio) pendencias.push('Patrimônio não informado');
    if (!extra.perfil_investidor || extra.perfil_investidor === 'Pendente') pendencias.push('API de perfil pendente');
    if (!extra.objetivos?.some(obj => Array.isArray(obj) && obj.some(Boolean))) pendencias.push('Objetivos financeiros incompletos');
    if (!extra.rest_liquidez) pendencias.push('Restrição de liquidez não documentada');
    if (cliente?.conhecimento === 'Iniciante' && extra.perfil_investidor === 'Arrojado') pendencias.push('Perfil arrojado com conhecimento iniciante');
    if (calcularCompletudeCliente(cliente) < 70) pendencias.push('Ficha abaixo de 70% de completude');
    return pendencias;
}

function atualizarDashboardConsultor() {
    const patrimonioTotal = bancoClientes.reduce((acc, cli) => acc + moedaParaNumero(cli.patrimonio), 0);
    const apiPendentes    = bancoClientes.filter(cli => {
        const perfil = obterExtraCliente(cli).perfil_investidor;
        return !perfil || perfil === 'Pendente';
    }).length;
    const tarefasPendentes = carregarTarefas().filter(t => !t.concluida).length;
    const alertas = bancoClientes.flatMap(cli =>
        obterPendenciasCliente(cli).slice(0, 2).map(txt => ({ cliente: cli.nome, texto: txt }))
    );

    setText('dash-total-clientes',    bancoClientes.length);
    setText('dash-patrimonio-total',  formatarMoeda(patrimonioTotal));
    setText('dash-api-pendente',      apiPendentes);
    setText('dash-tarefas-pendentes', tarefasPendentes);
    setText('dash-alertas-count',     `${alertas.length} itens`);

    const listaAlertas = document.getElementById('lista-alertas-inteligentes');
    if (listaAlertas) {
        if (alertas.length > 0) {
            listaAlertas.innerHTML = alertas.slice(0, 6).map(a =>
                `<div class="smart-alert"><strong>${escaparHTML(a.cliente)}</strong><span>${escaparHTML(a.texto)}</span></div>`
            ).join('');
        } else {
            listaAlertas.innerHTML = `<div class="empty-mini">Nenhum alerta crítico no momento.</div>`;
        }
    }

    const recentes = document.getElementById('lista-clientes-recentes');
    if (recentes) {
        if (bancoClientes.length > 0) {
            recentes.innerHTML = bancoClientes.slice(0, 5).map(cli => {
                const completude = calcularCompletudeCliente(cli);
                return `<button class="recent-client" data-cliente-id="${escaparHTML(String(cli.id))}"><span>${escaparHTML(cli.nome)}</span><strong>${completude}%</strong></button>`;
            }).join('');
            recentes.querySelectorAll('[data-cliente-id]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cliente = bancoClientes.find(cli => String(cli.id) === String(btn.dataset.clienteId));
                    if (cliente) abrirWorkspaceCliente(cliente);
                });
            });
        } else {
            recentes.innerHTML = `<div class="empty-mini">Cadastre o primeiro cliente para iniciar.</div>`;
        }
    }
}

// ==========================================
// 11. SIDEBAR E DELEÇÃO
// ==========================================
function atualizarListaSidebar() {
    const lista = document.getElementById('lista-clientes-standby');
    if (!lista) return;
    lista.innerHTML = '';

    const busca     = normalizarTexto(document.getElementById('input-busca-cliente')?.value || '');
    const filtro    = document.getElementById('filtro-status-cliente')?.value || 'todos';
    const sortOrder = document.getElementById('sort-clientes')?.value || 'recente';

    const clientesOrdenados = [...bancoClientes].sort((a, b) => {
        if (sortOrder === 'nome')       return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
        if (sortOrder === 'patrimonio') return moedaParaNumero(b.patrimonio) - moedaParaNumero(a.patrimonio);
        if (sortOrder === 'completude') return calcularCompletudeCliente(b) - calcularCompletudeCliente(a);
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const clientesFiltrados = clientesOrdenados.filter(cli => {
        const completude = calcularCompletudeCliente(cli);
        const extra = obterExtraCliente(cli);
        const nomeOk = normalizarTexto(cli.nome).includes(busca);
        const statusOk =
            filtro === 'todos' ||
            (filtro === 'incompletos'  && completude < 80) ||
            (filtro === 'api-pendente' && (!extra.perfil_investidor || extra.perfil_investidor === 'Pendente')) ||
            (filtro === 'prontos'      && completude >= 80 && extra.perfil_investidor && extra.perfil_investidor !== 'Pendente');
        return nomeOk && statusOk;
    });

    if (clientesFiltrados.length === 0) {
        const vazio = document.createElement('li');
        vazio.className = 'sidebar-empty';
        if (bancoClientes.length === 0) {
            vazio.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg><strong>Nenhum cliente ainda</strong><span>Clique em "+ Adicionar Cliente" para começar.</span>`;
        } else {
            vazio.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><strong>Sem resultados</strong><span>Nenhum cliente encontrado com este filtro.</span>`;
        }
        lista.appendChild(vazio);
        return;
    }

    const fragment = document.createDocumentFragment();

    clientesFiltrados.forEach(cli => {
        const li = document.createElement('li');
        li.className = 'cliente-item-ativo container-item-cliente-sidebar';
        if (clienteAtivo?.id === cli.id) li.classList.add('active-sidebar');

        const labelNome = document.createElement('div');
        labelNome.className = 'nome-clicavel-sidebar';

        const nome = document.createElement('span');
        nome.textContent = cli.nome || 'Cliente sem nome';

        const subtitulo = document.createElement('small');
        subtitulo.textContent = `${obterExtraCliente(cli).perfil_investidor || 'Pendente'} · ${calcularCompletudeCliente(cli)}% completo`;

        labelNome.appendChild(nome);
        labelNome.appendChild(subtitulo);
        labelNome.addEventListener('click', () => {
            document.querySelectorAll('.cliente-item-ativo').forEach(el => el.classList.remove('active-sidebar'));
            li.classList.add('active-sidebar');
            abrirWorkspaceCliente(cli);
        });

        const btnExcluir = document.createElement('button');
        btnExcluir.className = 'btn-excluir-cliente-sidebar';
        btnExcluir.setAttribute('aria-label', `Excluir ${cli.nome}`);
        btnExcluir.innerHTML = `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

        btnExcluir.addEventListener('click', async (e) => {
            e.stopPropagation();
            const acao = cli.user_id === idUsuarioLogado ? 'excluir permanentemente' : 'remover o acesso compartilhado de';
            const conf = await solicitarConfirmacaoModal('Atenção crítica!', `Deseja ${acao} <b>${escaparHTML(cli.nome)}</b>?`);
            if (!conf) return;

            try {
                if (cli.user_id === idUsuarioLogado) {
                    const { error } = await clienteSupabase
                        .from('clientes').delete()
                        .eq('id', cli.id)
                        .eq('user_id', idUsuarioLogado);
                    if (error) throw error;
                } else {
                    const { error } = await clienteSupabase
                        .from('consultores_clientes').delete()
                        .eq('cliente_id', cli.id)
                        .eq('user_id', idUsuarioLogado);
                    if (error) throw error;
                }
                if (clienteAtivo?.id === cli.id) {
                    clienteAtivo = null;
                    document.getElementById('container-workspace-cliente')?.classList.remove('active');
                    document.getElementById('estado-vazio')?.classList.add('active');
                }
                await carregarClientesDoSupabase();
            } catch (err) {
                mostrarToast('Erro ao excluir cliente. Tente novamente.', 'erro');
            }
        });

        li.appendChild(labelNome);
        li.appendChild(btnExcluir);
        fragment.appendChild(li);
    });

    lista.appendChild(fragment);
}

let sidebarRenderRAF = null;
function agendarAtualizacaoSidebar() {
    if (sidebarRenderRAF) cancelAnimationFrame(sidebarRenderRAF);
    sidebarRenderRAF = requestAnimationFrame(() => {
        sidebarRenderRAF = null;
        atualizarListaSidebar();
    });
}

document.getElementById('input-busca-cliente')?.addEventListener('input',  agendarAtualizacaoSidebar);
document.getElementById('filtro-status-cliente')?.addEventListener('change', atualizarListaSidebar);
document.getElementById('sort-clientes')?.addEventListener('change', atualizarListaSidebar);

// ==========================================
// 12. TAREFAS / FOLLOW-UPS
// ==========================================
function obterChaveTarefas() {
    return `prisma_tarefas_${idUsuarioLogado || 'local'}`;
}

function carregarTarefas() {
    try {
        const raw = localStorage.getItem(obterChaveTarefas());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function salvarTarefas(tarefas) {
    localStorage.setItem(obterChaveTarefas(), JSON.stringify(tarefas));
}

function obterTarefasCliente(clienteId) {
    return carregarTarefas().filter(t => t.cliente_id === clienteId);
}

function atualizarResumoExecutivoCliente() {
    if (!clienteAtivo) return;
    const extra      = obterExtraCliente(clienteAtivo);
    const completude = calcularCompletudeCliente(clienteAtivo);
    const pendencias = obterPendenciasCliente(clienteAtivo);

    setText('exec-nome-cliente',     clienteAtivo.nome || 'Cliente selecionado');
    setText('exec-descricao-cliente', `${clienteAtivo.profissao || 'Perfil em acompanhamento'} – ${clienteAtivo.cidade || 'Cidade não informada'}`);
    setText('exec-completude',       `${completude}%`);
    setText('exec-perfil',           extra.perfil_investidor || 'Pendente');
    setText('exec-pontuacao',        extra.perfil_pontuacao  ? `Pontuação ${extra.perfil_pontuacao} / 95` : 'API não calculada');
    setText('exec-pendencias',       pendencias.length);
    setText('exec-pendencias-texto', pendencias[0] || 'Nenhuma pendência crítica');

    const barra = document.getElementById('exec-completude-barra');
    if (barra) barra.style.width = `${completude}%`;

    renderizarTarefasCliente();
}

function renderizarTarefasCliente() {
    const lista = document.getElementById('lista-tarefas-cliente');
    if (!lista || !clienteAtivo) return;

    const tarefas  = obterTarefasCliente(clienteAtivo.id)
        .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
    const pendentes = tarefas.filter(t => !t.concluida).length;
    setText('cliente-tarefas-count', `${pendentes} pendentes`);

    if (tarefas.length === 0) {
        lista.innerHTML = `<div class="empty-mini">Nenhum follow-up registrado para este cliente.</div>`;
        return;
    }

    lista.innerHTML = tarefas.map(t => `
        <div class="task-item ${t.concluida ? 'done' : ''}">
            <button class="task-check" data-task-id="${escaparHTML(t.id)}" title="Concluir tarefa" aria-label="Concluir ${escaparHTML(t.titulo)}">${t.concluida ? '✓' : ''}</button>
            <div>
                <strong>${escaparHTML(t.titulo)}</strong>
                <span>${t.data ? new Date(t.data + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem data'}</span>
            </div>
            <button class="task-delete" data-task-delete="${escaparHTML(t.id)}" title="Excluir tarefa" aria-label="Excluir ${escaparHTML(t.titulo)}">×</button>
        </div>
    `).join('');

    lista.querySelectorAll('[data-task-id]').forEach(btn => {
        btn.addEventListener('click', () => alternarTarefa(btn.dataset.taskId));
    });
    lista.querySelectorAll('[data-task-delete]').forEach(btn => {
        btn.addEventListener('click', () => excluirTarefa(btn.dataset.taskDelete));
    });
}

function alternarTarefa(id) {
    const tarefas = carregarTarefas().map(t => t.id === id ? { ...t, concluida: !t.concluida } : t);
    salvarTarefas(tarefas);
    renderizarTarefasCliente();
    atualizarDashboardConsultor();
}

function excluirTarefa(id) {
    salvarTarefas(carregarTarefas().filter(t => t.id !== id));
    renderizarTarefasCliente();
    atualizarDashboardConsultor();
}

function abrirModalTarefa() {
    if (!clienteAtivo) return;
    const titulo = document.getElementById('tarefa-titulo');
    const data   = document.getElementById('tarefa-data');
    if (titulo) titulo.value = '';
    if (data)   data.value   = new Date().toISOString().split('T')[0];
    document.getElementById('modal-tarefa')?.classList.remove('oculto');
}

function salvarTarefaAtual() {
    if (!clienteAtivo) return;
    const titulo = document.getElementById('tarefa-titulo')?.value.trim() ?? '';
    const data   = document.getElementById('tarefa-data')?.value || '';

    if (!titulo) {
        mostrarToast('Informe um título para o follow-up.', 'erro');
        return;
    }
    if (titulo.length > 200) {
        mostrarToast('Título muito longo. Máximo de 200 caracteres.', 'erro');
        return;
    }

    const tarefas = carregarTarefas();
    tarefas.push({
        id:         crypto.randomUUID(),
        cliente_id: clienteAtivo.id,
        titulo,
        data,
        concluida:  false
    });
    salvarTarefas(tarefas);
    document.getElementById('modal-tarefa')?.classList.add('oculto');
    renderizarTarefasCliente();
    atualizarDashboardConsultor();
    mostrarToast('Follow-up registrado.', 'sucesso');
}

document.getElementById('btn-adicionar-tarefa-cliente')?.addEventListener('click', abrirModalTarefa);
document.getElementById('modal-tarefa-cancelar')?.addEventListener('click', () => document.getElementById('modal-tarefa')?.classList.add('oculto'));
document.getElementById('modal-tarefa-salvar')?.addEventListener('click', salvarTarefaAtual);

// ==========================================
// 13. RELATÓRIO EXECUTIVO
// ==========================================
function gerarRelatorioCliente() {
    if (!clienteAtivo) return;
    const extra      = obterExtraCliente(clienteAtivo);
    const pendencias = obterPendenciasCliente(clienteAtivo);
    const objetivos  = extra.objetivos || [];
    const tarefas    = obterTarefasCliente(clienteAtivo.id).filter(t => !t.concluida);
    const conteudo   = document.getElementById('relatorio-conteudo-cliente');

    setText('relatorio-titulo-cliente', clienteAtivo.nome || 'Cliente');

    if (conteudo) {
        conteudo.innerHTML = `
            <section>
                <h4>Dados principais</h4>
                <p><strong>Patrimônio:</strong> ${clienteAtivo.patrimonio ? `R$ ${escaparHTML(clienteAtivo.patrimonio)}` : '–'}<br>
                <strong>Perfil:</strong> ${escaparHTML(extra.perfil_investidor || 'Pendente')}<br>
                <strong>Completude:</strong> ${calcularCompletudeCliente(clienteAtivo)}%</p>
            </section>
            <section>
                <h4>Objetivos</h4>
                ${objetivos.length
                    ? `<ul>${objetivos.map(obj => `<li>${Array.isArray(obj) ? escaparHTML(obj.filter(Boolean).join(' – ')) : ''}</li>`).join('')}</ul>`
                    : '<p>Nenhum objetivo registrado.</p>'}
            </section>
            <section>
                <h4>Pendências e alertas</h4>
                ${pendencias.length
                    ? `<ul>${pendencias.map(p => `<li>${escaparHTML(p)}</li>`).join('')}</ul>`
                    : '<p>Nenhuma pendência crítica.</p>'}
            </section>
            <section>
                <h4>Follow-ups abertos</h4>
                ${tarefas.length
                    ? `<ul>${tarefas.map(t => `<li>${escaparHTML(t.titulo)}${t.data ? ` – ${new Date(t.data + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}</li>`).join('')}</ul>`
                    : '<p>Nenhum follow-up pendente.</p>'}
            </section>
            <section>
                <h4>Resultado esperado</h4>
                <p>${escaparHTML(extra.resultado_esperado || 'Não documentado.')}</p>
            </section>
        `;
    }
    document.getElementById('modal-relatorio-cliente')?.classList.remove('oculto');
}

function imprimirRelatorioCliente() {
    const conteudo = document.getElementById('relatorio-conteudo-cliente')?.innerHTML || '';
    const titulo   = document.getElementById('relatorio-titulo-cliente')?.textContent || 'Relatório';
    const frame    = document.getElementById('prisma-print-frame');
    if (!frame) return;

    const docHTML = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${escaparHTML(titulo)}</title>
<style>
*{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;padding:32px;font-size:13px;line-height:1.6}
h1{font-size:20px;font-weight:800;margin-bottom:6px}h4{font-size:13px;font-weight:700;margin:18px 0 6px;color:#0f172a}
section{border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:12px}
ul{padding-left:18px}li{margin-bottom:4px}
.marca{color:#2563EB;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
@media print{@page{margin:20mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head>
<body><div class="marca">Prisma Consultoria</div><h1>${escaparHTML(titulo)}</h1>${conteudo}</body></html>`;

    frame.srcdoc = docHTML;
    frame.contentWindow?.addEventListener('load', () => {
        setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 200);
    });
    setTimeout(() => { try { frame.contentWindow.print(); } catch (e) { console.warn('[Prisma] print fallback:', e); } }, 800);
}

document.getElementById('btn-gerar-relatorio-cliente')?.addEventListener('click', gerarRelatorioCliente);
document.getElementById('modal-relatorio-fechar')?.addEventListener('click', () => document.getElementById('modal-relatorio-cliente')?.classList.add('oculto'));
document.getElementById('btn-imprimir-relatorio')?.addEventListener('click', imprimirRelatorioCliente);

// ==========================================
// 14. WORKSPACE DO CLIENTE
// ==========================================
function abrirWorkspaceCliente(cliente) {
    clienteAtivo       = cliente;
    analyticsModoAtivo = false;
    // Limpa caches de comentários — novo cliente começa sempre do zero
    cacheComentariosCoord = [];
    cacheComentariosGeral = [];

    // Reseta view de analytics
    const btnAnalyt = document.getElementById('btn-alternar-analytics-view');
    if (btnAnalyt && analyticsModoAtivo) btnAnalyt.click();

    document.getElementById('input-token-base64')
        && (document.getElementById('input-token-base64').value = '');
    document.getElementById('bloco-dashboard-metricas-quant')
        && (document.getElementById('bloco-dashboard-metricas-quant').style.display = 'none');

    document.getElementById('estado-vazio')?.classList.remove('active');
    document.getElementById('container-form-suitability')?.classList.remove('active');
    document.getElementById('container-workspace-cliente')?.classList.add('active');

    setText('nome-cabecalho-cliente',      cliente.nome);
    setText('patrimonio-cabecalho-cliente', `Patrimônio: R$ ${cliente.patrimonio || '–'}`);
    setText('label-codigo-sala',           cliente.codigo_sala || 'N/A');

    atualizarResumoExecutivoCliente();
    carregarDiasTimeline();
}

// ==========================================
// 15. LINHA DO TEMPO
// ==========================================
async function carregarDiasTimeline() {
    if (!clienteAtivo) return;

    try {
        const { data: historicos, error } = await clienteSupabase
            .from('historico_alocacoes')
            .select('data_registro')
            .eq('cliente_id', clienteAtivo.id);

        if (error) throw error;

        const listaUL = document.getElementById('lista-dias-timeline');
        if (listaUL) listaUL.innerHTML = '';

        const datasUnicas = new Set();
        historicos?.forEach(h => datasUnicas.add(h.data_registro));

        if (dataAtiva && !datasUnicas.has(dataAtiva)) datasUnicas.add(dataAtiva);
        if (datasUnicas.size === 0) {
            dataAtiva = new Date().toISOString().split('T')[0];
            datasUnicas.add(dataAtiva);
        }

        const datasOrdenadas = Array.from(datasUnicas).sort((a, b) => new Date(b) - new Date(a));

        datasOrdenadas.forEach(dataStr => {
            const li  = document.createElement('li');
            const btn = document.createElement('button');
            btn.className = `dia-item-btn${dataAtiva === dataStr ? ' active' : ''}`;
            const partes = (dataStr || '').split('-');
            const [ano, mes, dia] = partes.length === 3 ? partes : ['?', '?', '?'];
            btn.textContent = `${dia}/${mes}/${ano}`;
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dia-item-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                dataAtiva = dataStr;
                // Limpa cache ao trocar de data — cada data tem seus próprios comentários
                cacheComentariosCoord = [];
                cacheComentariosGeral = [];
                carregarDadosAlocacaoETese();
            });
            li.appendChild(btn);
            listaUL?.appendChild(li);
        });

        if (!dataAtiva || !datasUnicas.has(dataAtiva)) dataAtiva = datasOrdenadas[0];
        carregarDadosAlocacaoETese();
    } catch (err) {
        mostrarToast('Erro ao carregar timeline. Tente novamente.', 'erro');
        console.error('[Prisma] carregarDiasTimeline:', err);
    }
}

document.getElementById('btn-novo-dia-linha')?.addEventListener('click', async () => {
    const novaDataISO = await solicitarDataModal('Adicionar Novo Dia', 'Selecione a data para este comitê:', new Date().toISOString().split('T')[0]);
    if (!novaDataISO) return;
    dataAtiva = novaDataISO;
    await salvarDadosAlocacao(true);
    carregarDiasTimeline();
});

document.getElementById('btn-editar-data')?.addEventListener('click', async () => {
    if (!dataAtiva || !clienteAtivo) return;
    const novaDataISO = await solicitarDataModal('Modificar Data', 'Alterar esta data atualizará todo o histórico desse dia:', dataAtiva);
    if (!novaDataISO || novaDataISO === dataAtiva) return;
    try {
        const { error } = await clienteSupabase
            .from('historico_alocacoes')
            .update({ data_registro: novaDataISO })
            .eq('cliente_id', clienteAtivo.id)
            .eq('data_registro', dataAtiva);
        if (error) throw error;
        dataAtiva = novaDataISO;
        carregarDiasTimeline();
    } catch (err) {
        console.error('[Prisma] Erro ao alterar data — detalhes:', err);
        mostrarToast('Erro ao alterar data.', 'erro');
    }
});

document.getElementById('btn-excluir-data')?.addEventListener('click', async () => {
    if (!dataAtiva || !clienteAtivo) return;
    const confirmacao = await solicitarConfirmacaoModal('Excluir Comitê', 'Tem certeza que deseja excluir permanentemente todo o comitê deste dia?');
    if (!confirmacao) return;
    try {
        const { error } = await clienteSupabase
            .from('historico_alocacoes').delete()
            .eq('cliente_id', clienteAtivo.id)
            .eq('data_registro', dataAtiva);
        if (error) throw error;
        dataAtiva = null;
        carregarDiasTimeline();
    } catch (err) {
        mostrarToast('Erro ao excluir comitê.', 'erro');
    }
});

// ==========================================
// 16. TABELA DE ATIVOS
// ==========================================

// Whitelist de classes de ativos
const CLASSES_ATIVO_VALIDAS = new Set(Object.keys(mapeamentoClasses));

window.mudarClasseAtivo = async function(novaClasse, botaoClicado) {
    if (novaClasse === CLASSE_ALOCACAO_PERCENTUAL) {
        document.querySelectorAll('.tabs-navegacao-ativos .tab-button').forEach(b => b.classList.remove('active'));
        if (botaoClicado) botaoClicado.classList.add('active');
        await ativarPainelPercentual();
        return;
    }
    if (!CLASSES_ATIVO_VALIDAS.has(novaClasse)) return;
    document.querySelectorAll('.tabs-navegacao-ativos .tab-button').forEach(b => b.classList.remove('active'));
    if (botaoClicado) botaoClicado.classList.add('active');
    classeAtiva = novaClasse;
    alternarPainelPercentual(false);
    await carregarDadosAlocacaoETese();
};

function adicionarLinhaNaTabela(ativo = '', detalhe = '', dataAloc = '', valor = '') {
    const tbody = document.getElementById('corpo-tabela-ativos-dia');
    if (!tbody) return;

    const tr     = document.createElement('tr');
    const campos = [
        { classe: 'row-ativo',   tipo: 'text', valor: ativo,   placeholder: 'Ex: Ticker' },
        { classe: 'row-detalhe', tipo: 'text', valor: detalhe, placeholder: '' },
        { classe: 'row-data',    tipo: 'date', valor: dataAloc, placeholder: '' },
        { classe: 'row-valor',   tipo: 'text', valor: valor,   placeholder: 'R$' }
    ];

    campos.forEach(campo => {
        const td    = document.createElement('td');
        const input = document.createElement('input');
        input.type        = campo.tipo;
        input.value       = campo.valor || '';
        input.placeholder = campo.placeholder;
        input.className   = `input-tabela ${campo.classe}`;
        input.maxLength   = 120;
        td.appendChild(input);
        tr.appendChild(td);
    });

    const tdAcao = document.createElement('td');
    tdAcao.style.textAlign = 'center';
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'btn-icon danger btn-deletar-linha';
    btn.setAttribute('aria-label', 'Remover linha');
    btn.innerHTML = `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    btn.addEventListener('click', () => tr.remove());
    tdAcao.appendChild(btn);
    tr.appendChild(tdAcao);
    tbody.appendChild(tr);
}

document.getElementById('btn-adicionar-linha-tabela')?.addEventListener('click', () => adicionarLinhaNaTabela());

function alternarPainelPercentual(ativo) {
    document.getElementById('card-investimento-dia')?.classList.toggle('painel-percentual-ativo', ativo);

    // Oculta/exibe painel percentual exclusivo
    const painelExclusivo = document.getElementById('painel-percentual-exclusivo');
    if (painelExclusivo) painelExclusivo.classList.toggle('oculto', !ativo);

    // Oculta/exibe tabela e tese quando está no modo percentual
    const tabela = document.querySelector('.tabela-dinamica')?.closest('.table-wrapper');
    const btnAdd  = document.getElementById('btn-adicionar-linha-tabela');
    const tese    = document.querySelector('.bloco-tese-investimento');
    const coordSec = document.querySelector('.coord-section-wrapper');
    const geraisSec = document.querySelector('.comentarios-gerais-wrapper');
    [tabela, btnAdd, tese, coordSec, geraisSec].forEach(el => {
        if (el) el.style.display = ativo ? 'none' : '';
    });

    const btnSalvar = document.getElementById('btn-salvar-dados-dia');
    if (btnSalvar) {
        btnSalvar.innerHTML = ativo
            ? `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Arquivar Percentuais`
            : `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Arquivar Alocação e Tese`;
    }
}

async function carregarPercentuaisDaData() {
    if (!clienteAtivo || !dataAtiva) return;
    try {
        const { data, error } = await clienteSupabase
            .from('historico_alocacoes').select('valores_alocacao')
            .eq('cliente_id',    clienteAtivo.id)
            .eq('data_registro', dataAtiva)
            .eq('classe_ativo',  CLASSE_REGISTRO_PERCENTUAL);
        if (error) throw error;

        let pctSalvo = {};
        if (data?.[0]?.valores_alocacao?.[0]?.[0]) {
            try { pctSalvo = JSON.parse(data[0].valores_alocacao[0][0]); } catch (e) { console.warn('[Prisma] JSON inválido em carregarPercentuaisDaData:', e); }
        }
        pctAlvoSalvo = { ...pctSalvo };
        document.querySelectorAll('.alocacao-pct-input').forEach(inp => {
            const classe = inp.dataset.classePct;
            inp.value = pctSalvo[classe] != null ? pctSalvo[classe] : '';
        });
    } catch (err) {
        console.warn('[Prisma] carregarPercentuaisDaData:', err);
    }
}

async function ativarPainelPercentual() {
    classeAtiva = CLASSE_ALOCACAO_PERCENTUAL;
    alternarPainelPercentual(true);
    setText('titulo-classe-ativa', 'Distribuição Percentual da Carteira');
    setText('th-coluna-especifica', 'Detalhamento');
    document.getElementById('banner-alocacao-classe-ativa')?.classList.add('oculto');

    // Mostra o painel exclusivo e atualiza o título com a data
    const painelExclusivo = document.getElementById('painel-percentual-exclusivo');
    if (painelExclusivo) painelExclusivo.classList.remove('oculto');

    const [ano, mes, dia] = (dataAtiva || '').split('-');
    const dataFmt = dia && mes && ano ? `${dia}/${mes}/${ano}` : '—';
    setText('pct-titulo-data', `Comitê: ${dataFmt}`);

    await carregarPercentuaisDaData();
    atualizarBarrasAlocacao();
}

async function carregarDadosAlocacaoETese() {
    if (!clienteAtivo || !dataAtiva) return;
    if (classeAtiva === CLASSE_ALOCACAO_PERCENTUAL) {
        await ativarPainelPercentual();
        return;
    }
    if (!CLASSES_ATIVO_VALIDAS.has(classeAtiva)) return;
    alternarPainelPercentual(false);

    const config = mapeamentoClasses[classeAtiva];
    setText('titulo-classe-ativa', config.titulo);
    setText('th-coluna-especifica', config.label);

    const [ano, mes, dia] = dataAtiva.split('-');
    const badge = document.getElementById('data-badge-ativa');
    if (badge) {
        badge.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
        badge.appendChild(document.createTextNode(` Dia: ${dia}/${mes}/${ano}`));
    }

    try {
        // Busca dados da classe ativa E o registro de alocação percentual juntos
        const [{ data, error }, { data: dataPct, error: erroPct }, { data: dataAutoria, error: erroAutoria }] = await Promise.all([
            clienteSupabase
                .from('historico_alocacoes').select('*')
                .eq('cliente_id',    clienteAtivo.id)
                .eq('data_registro', dataAtiva)
                .eq('classe_ativo',  classeAtiva),
            clienteSupabase
                .from('historico_alocacoes').select('valores_alocacao,tese_investimento')
                .eq('cliente_id',    clienteAtivo.id)
                .eq('data_registro', dataAtiva)
                .eq('classe_ativo',  CLASSE_REGISTRO_PERCENTUAL),
            clienteSupabase
                .from('historico_alocacoes').select('valores_alocacao')
                .eq('cliente_id',    clienteAtivo.id)
                .eq('data_registro', dataAtiva)
                .eq('classe_ativo',  CLASSE_REGISTRO_AUTORIA_TEXTOS)
        ]);

        if (error) throw error;
        if (erroPct) console.warn('[Prisma] Erro ao buscar alocacao_pct:', erroPct.message);
        if (erroAutoria) console.warn('[Prisma] Erro ao buscar autoria_textos:', erroAutoria.message);

        const tbody = document.getElementById('corpo-tabela-ativos-dia');
        if (tbody) tbody.innerHTML = '';

        const linhas = data?.[0]?.valores_alocacao?.length > 0
            ? data[0].valores_alocacao
            : config.padrao;

        const tese = document.getElementById('txt-tese-investimento-dia');
        if (tese) tese.value = data?.[0]?.tese_investimento || '';

        autoriaTextosAtuais = {};
        if (dataAutoria?.[0]?.valores_alocacao?.[0]?.[0]) {
            try { autoriaTextosAtuais = JSON.parse(dataAutoria[0].valores_alocacao[0][0]); } catch (e) { console.warn('[Prisma] JSON inválido em autoria_textos:', e); }
        }
        atualizarIndicadorAutoriaTese();

        // Lê alocação percentual do registro separado.
        let pctSalvo = {};
        if (dataPct?.[0]?.valores_alocacao?.[0]?.[0]) {
            try { pctSalvo = JSON.parse(dataPct[0].valores_alocacao[0][0]); } catch (e) { console.warn('[Prisma] JSON inválido em alocacao_pct:', e); }
        }

        document.querySelectorAll('.alocacao-pct-input').forEach(inp => {
            const classe = inp.dataset.classePct;
            inp.value = pctSalvo[classe] != null ? pctSalvo[classe] : '';
        });
        atualizarBarrasAlocacao();

        linhas.forEach(item => adicionarLinhaNaTabela(item[0], item[1], item[2], item[3]));

        // Atualiza banner da classe ativa com percentual e valor equivalente
        await atualizarBannerAlocacaoClasse(pctSalvo);

        // Carrega comentários coordenadores e gerais
        await carregarComentarios();
    } catch (err) {
        mostrarToast('Erro ao carregar dados de alocação.', 'erro');
        console.error('[Prisma] carregarDadosAlocacaoETese:', err);
    }
}

function obterNomeUsuarioAtual() {
    const nome = document.getElementById('identificador-usuario')?.textContent?.trim();
    return nome && nome !== 'Carregando...' ? nome : 'Consultor';
}

function formatarDataHoraAutoria(valor) {
    if (!valor) return '';
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return '';
    return data.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function atualizarIndicadorAutoriaTese() {
    const indicador = document.getElementById('tese-autoria-indicador');
    if (!indicador) return;

    const info = autoriaTextosAtuais?.[classeAtiva]?.tese;
    if (!info?.autor) {
        indicador.classList.add('oculto');
        indicador.removeAttribute('data-tooltip');
        indicador.textContent = 'Autoria';
        return;
    }

    const dataTexto  = formatarDataHoraAutoria(info.atualizado_em);
    const tooltipTxt = dataTexto
        ? `Escrito por ${info.autor} · ${dataTexto}`
        : `Escrito por ${info.autor}`;

    // Chip visível + tooltip via CSS ::after + data-tooltip
    indicador.classList.remove('oculto');
    indicador.dataset.tooltip  = tooltipTxt;
    indicador.setAttribute('aria-label', tooltipTxt);
    indicador.setAttribute('title', tooltipTxt); // fallback para acessibilidade
    // Exibe as iniciais do autor no chip
    const iniciais = info.autor.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    indicador.textContent = iniciais || 'AU';
}

async function salvarAutoriaTese() {
    if (!clienteAtivo || !dataAtiva || !CLASSES_ATIVO_VALIDAS.has(classeAtiva)) return;

    const tese = document.getElementById('txt-tese-investimento-dia')?.value.trim() || '';
    if (!tese) {
        if (autoriaTextosAtuais?.[classeAtiva]?.tese) {
            delete autoriaTextosAtuais[classeAtiva].tese;
        }
    } else {
        autoriaTextosAtuais[classeAtiva] = {
            ...(autoriaTextosAtuais[classeAtiva] || {}),
            tese: {
                autor: obterNomeUsuarioAtual(),
                user_id: idUsuarioLogado,
                atualizado_em: new Date().toISOString()
            }
        };
    }

    const { error } = await clienteSupabase.from('historico_alocacoes').upsert({
        cliente_id:        clienteAtivo.id,
        data_registro:     dataAtiva,
        classe_ativo:      CLASSE_REGISTRO_AUTORIA_TEXTOS,
        valores_alocacao:  [[JSON.stringify(autoriaTextosAtuais)]],
        tese_investimento: '',
        updated_at:        new Date().toISOString()
    }, { onConflict: 'cliente_id,data_registro,classe_ativo' });

    if (error) console.warn('[Prisma] Erro ao salvar autoria_textos:', error.message);
    atualizarIndicadorAutoriaTese();
}

async function salvarDadosAlocacao(apenasCriarDia = false) {
    if (!clienteAtivo || !dataAtiva) return;
    const salvandoApenasPercentuais = classeAtiva === CLASSE_ALOCACAO_PERCENTUAL;
    if (!CLASSES_ATIVO_VALIDAS.has(classeAtiva) && !salvandoApenasPercentuais) return;

    let matriz = [];
    if (!apenasCriarDia && !salvandoApenasPercentuais) {
        document.querySelectorAll('#corpo-tabela-ativos-dia tr').forEach(tr => {
            const ativo    = tr.querySelector('.row-ativo')?.value  || '';
            const detalhe  = tr.querySelector('.row-detalhe')?.value || '';
            const dataAloc = tr.querySelector('.row-data')?.value   || '';
            const valor    = tr.querySelector('.row-valor')?.value  || '';
            if (ativo || valor) matriz.push([ativo, detalhe, dataAloc, valor]);
        });
    } else if (apenasCriarDia && !salvandoApenasPercentuais) {
        matriz = mapeamentoClasses[classeAtiva].padrao;
    }

    const tese           = document.getElementById('txt-tese-investimento-dia')?.value || '';
    const teseParaSalvar = apenasCriarDia || salvandoApenasPercentuais ? '' : tese;

    try {
        // Salva os dados da classe ativa (sem alocacao_pct — coluna não existe no schema)
        if (!salvandoApenasPercentuais) {
        const { error } = await clienteSupabase.from('historico_alocacoes').upsert({
            cliente_id:        clienteAtivo.id,
            data_registro:     dataAtiva,
            classe_ativo:      classeAtiva,
            valores_alocacao:  matriz,
            tese_investimento: teseParaSalvar,
            updated_at:        new Date().toISOString()
        }, { onConflict: 'cliente_id,data_registro,classe_ativo' });

        if (error) throw error;
        if (!apenasCriarDia) await salvarAutoriaTese();
        }

        // Salva alocação percentual em registro separado com classe '__alocacao_pct__'
        if (!apenasCriarDia || salvandoApenasPercentuais) {
            const alocacaoPct = {};
            document.querySelectorAll('.alocacao-pct-input').forEach(inp => {
                const classe = inp.dataset.classePct;
                const val = parseFloat(inp.value);
                if (classe && !isNaN(val) && val >= 0 && val <= 100) alocacaoPct[classe] = val;
            });

            // Guarda os percentuais como JSON serializado no campo valores_alocacao
            // e o patrimônio disponível (se informado) na tese_investimento
            const patrimonioDisponivel = document.getElementById('patrimonio-cabecalho-cliente')
                ?.textContent?.replace(/[^\d,.]/g, '').trim() || '';

            const { error: erroPct } = await clienteSupabase.from('historico_alocacoes').upsert({
                cliente_id:        clienteAtivo.id,
                data_registro:     dataAtiva,
                classe_ativo:      CLASSE_REGISTRO_PERCENTUAL,
                valores_alocacao:  [[JSON.stringify(alocacaoPct)]],
                tese_investimento: patrimonioDisponivel,
                updated_at:        new Date().toISOString()
            }, { onConflict: 'cliente_id,data_registro,classe_ativo' });

            if (erroPct) console.warn('[Prisma] Erro ao salvar alocacao_pct:', erroPct.message);
        }

        if (!apenasCriarDia) {
            mostrarToast(salvandoApenasPercentuais ? '<b>Percentuais arquivados!</b>' : '<b>Arquivado com sucesso!</b>', 'sucesso');
            // Atualiza o banner da classe ativa com os novos percentuais
            if (salvandoApenasPercentuais) atualizarBarrasAlocacao();
            else await atualizarBannerAlocacaoClasse();
        }
    } catch (err) {
        if (!apenasCriarDia) mostrarToast('Erro ao arquivar: ' + escaparHTML(err.message), 'erro');
        console.error('[Prisma] salvarDadosAlocacao:', err);
    }
}

document.getElementById('btn-salvar-dados-dia')?.addEventListener('click', () => salvarDadosAlocacao(false));

// ==========================================
// 17. ALOCAÇÃO PERCENTUAL — PAINEL EXCLUSIVO
// ==========================================

const PCT_CORES = {
    renda_fixa:          '#38BDF8',
    credito_privado:     '#818CF8',
    acoes:               '#4ADE80',
    fundos_imobiliarios: '#FB923C',
    fundos_investimento: '#F472B6',
    derivativos:         '#FBBF24',
    previdencia:         '#A78BFA'
};

function atualizarBarrasAlocacao() {
    let total = 0;
    const valores = {};

    document.querySelectorAll('.alocacao-pct-input').forEach(inp => {
        const classe = inp.dataset.classePct;
        const val = Math.max(0, Math.min(100, parseFloat(inp.value) || 0));
        if (classe) valores[classe] = val;
        total += val;
    });

    // Aviso por classe — compara contra os valores arquivados no Supabase
    const classesExcedidas = [];
    Object.entries(valores).forEach(([classe, val]) => {
        const alvo = pctAlvoSalvo[classe];
        const item = document.querySelector(`.pct-classe-item[data-classe-pct="${CSS.escape(classe)}"]`);
        if (item) {
            const excede = alvo != null && alvo > 0 && val > alvo;
            item.classList.toggle('pct-classe-over', excede);
            if (excede) classesExcedidas.push({ classe, val, alvo });
        }
    });
    if (classesExcedidas.length > 0) {
        const nomes = { renda_fixa: 'Renda Fixa', credito_privado: 'Crédito Privado', acoes: 'Ações', fundos_imobiliarios: 'FIIs', fundos_investimento: 'Fundos', derivativos: 'Derivativos', previdencia: 'Previdência' };
        const msg = classesExcedidas.map(({ classe, val, alvo }) =>
            `<b>${nomes[classe] || classe}</b>: ${val.toFixed(1)}% (limite ${alvo.toFixed(1)}%)`
        ).join(' · ');
        mostrarToast(`⚠ Alocação acima do limite — ${msg}`, 'aviso');
    }

    // Barras horizontais
    Object.entries(valores).forEach(([classe, val]) => {
        const item = document.querySelector(`.pct-classe-item[data-classe-pct="${CSS.escape(classe)}"]`);
        if (!item) return;
        const barra = item.querySelector('.pct-classe-barra');
        if (barra) barra.style.setProperty('--pct-scale', String(Math.min(val, 100) / 100));

        // Valor equivalente em reais
        const patrimonioNum = moedaParaNumero(clienteAtivo?.patrimonio || '');
        const equiv = document.getElementById(`pct-equiv-${classe}`);
        if (equiv) {
            equiv.textContent = val > 0 && patrimonioNum > 0
                ? `≈ ${formatarMoeda(patrimonioNum * val / 100)}`
                : '';
        }
    });

    // Badge total
    const badge = document.getElementById('alocacao-pct-total-badge');
    if (badge) {
        badge.textContent = `${total.toFixed(1)}%`;
        badge.className = 'alocacao-pct-total-badge'
            + (total > 100 ? ' over' : total >= 99.9 && total <= 100.1 ? ' exact' : '');
    }

    // Texto do donut
    const donutTxt = document.getElementById('pct-donut-total-txt');
    if (donutTxt) donutTxt.textContent = `${total.toFixed(0)}%`;

    // Patrimônio no rodapé
    const patrimonioNum = moedaParaNumero(clienteAtivo?.patrimonio || '');
    const rodapePatr = document.getElementById('pct-rodape-patrimonio');
    if (rodapePatr) {
        rodapePatr.textContent = patrimonioNum > 0
            ? `Base patrimonial: ${formatarMoeda(patrimonioNum)}`
            : 'Informe o patrimônio na ficha para ver os valores equivalentes';
    }

    // Donut SVG
    desenharDonut(valores, total);

    // Banner inline nas classes comuns continua atualizado
    atualizarBannerAlocacaoClasse();
}

function desenharDonut(valores, total) {
    const g = document.getElementById('pct-donut-segments');
    if (!g) return;
    g.innerHTML = '';

    const raio       = 48;
    const cx         = 60;
    const cy         = 60;
    const circunf    = 2 * Math.PI * raio;
    const strokeW    = 14;
    let offsetAngulo = -90; // começa do topo

    if (total <= 0) return;

    Object.entries(valores).forEach(([classe, val]) => {
        if (val <= 0) return;
        const pct        = Math.min(val, 100) / Math.max(total, 100) * 100;
        const dashLen    = (pct / 100) * circunf;
        const dashGap    = circunf - dashLen;
        const anguloRad  = (offsetAngulo * Math.PI) / 180;
        const dashOffset = circunf * (1 - offsetAngulo / 360);
        const cor        = PCT_CORES[classe] || '#64748b';

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r',  raio);
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', cor);
        circle.setAttribute('stroke-width', strokeW);
        circle.setAttribute('stroke-dasharray', `${dashLen} ${dashGap}`);
        circle.setAttribute('stroke-dashoffset', circunf - (offsetAngulo / 360) * circunf);
        circle.style.transform = 'rotate(-90deg)';
        circle.style.transformOrigin = '50% 50%';
        circle.style.transition = 'stroke-dasharray 0.4s ease';

        // Usa stroke-dashoffset corretamente com rotate via transform no grupo
        const frac = offsetAngulo / 360;
        circle.setAttribute('stroke-dashoffset', circunf * (1 - frac));

        g.appendChild(circle);
        offsetAngulo += (pct / 100) * 360;
    });
}

let alocacaoRAF = null;
let pctAlvoSalvo = {}; /* percentuais arquivados no Supabase — referência para aviso de excesso */
function agendarAtualizacaoBarrasAlocacao() {
    if (alocacaoRAF) cancelAnimationFrame(alocacaoRAF);
    alocacaoRAF = requestAnimationFrame(() => {
        alocacaoRAF = null;
        atualizarBarrasAlocacao();
    });
}

document.querySelectorAll('.alocacao-pct-input').forEach(inp => {
    inp.addEventListener('input', agendarAtualizacaoBarrasAlocacao);
});
async function atualizarBannerAlocacaoClasse(pctExterno) {
    const banner = document.getElementById('banner-alocacao-classe-ativa');
    if (!banner) return;

    const pctMap = pctExterno || (() => {
        const m = {};
        document.querySelectorAll('.alocacao-pct-input').forEach(inp => {
            const c = inp.dataset.classePct;
            const v = parseFloat(inp.value);
            if (c && !isNaN(v)) m[c] = v;
        });
        return m;
    })();

    const pct = pctMap[classeAtiva];

    if (!pct || pct <= 0 || classeAtiva === CLASSE_ALOCACAO_PERCENTUAL) {
        banner.classList.add('oculto');
        return;
    }

    const patrimonioRaw   = clienteAtivo?.patrimonio || '';
    const patrimonioNum   = moedaParaNumero(patrimonioRaw);
    const valorEquivalente = patrimonioNum > 0 ? (patrimonioNum * pct / 100) : null;
    const nomeClasse      = mapeamentoClasses[classeAtiva]?.titulo || classeAtiva;
    const cor             = PCT_CORES[classeAtiva] || '#38BDF8';
    const [ano, mes, dia] = (dataAtiva || '').split('-');
    const dataFormatada   = dia && mes && ano ? `${dia}/${mes}/${ano}` : '—';

    banner.classList.remove('oculto');
    banner.innerHTML = `
        <div class="banner-aloc-pro" style="--banner-cor:${cor}">
            <div class="banner-aloc-pro-barra" style="background:${cor}"></div>
            <div class="banner-aloc-pro-conteudo">
                <div class="banner-aloc-pro-linha-topo">
                    <span class="banner-aloc-pro-classe">${escaparHTML(nomeClasse)}</span>
                    <span class="banner-aloc-pro-data">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        Comitê: ${escaparHTML(dataFormatada)}
                    </span>
                </div>
                <div class="banner-aloc-pro-linha-pct">
                    <strong class="banner-aloc-pro-numero" style="color:${cor}">${pct.toFixed(1)}%</strong>
                    <span class="banner-aloc-pro-rotulo">desta carteira</span>
                    ${valorEquivalente !== null
                        ? `<span class="banner-aloc-pro-sep">·</span>
                           <span class="banner-aloc-pro-equiv">≈ <strong>${escaparHTML(formatarMoeda(valorEquivalente))}</strong></span>
                           <span class="banner-aloc-pro-base">sobre ${escaparHTML(formatarMoeda(patrimonioNum))}</span>`
                        : `<span class="banner-aloc-pro-sem-pat">Informe o patrimônio na ficha para calcular o valor equivalente</span>`
                    }
                </div>
                <div class="banner-aloc-pro-barra-prog-track">
                    <div class="banner-aloc-pro-barra-prog" style="width:${Math.min(pct, 100)}%;background:${cor}"></div>
                </div>
            </div>
        </div>
    `;
}


// ==========================================
// 18. COMENTÁRIOS — COORDENADORES E EQUIPE
// ==========================================
// Comentários são armazenados na tabela historico_alocacoes que já existe,
// usando chaves especiais de classe_ativo: '__coord__' e '__geral__'.
// Cada registro contém um array de comentários serializado em valores_alocacao.

const CLASSE_COMENTARIOS_COORD = '__comentarios_coord__';
const CLASSE_COMENTARIOS_GERAL = '__comentarios_geral__';

// Tipos e configurações
const COORD_TIPO_CONFIG = {
    diretriz:     { label: 'Diretriz',     cor: '#38BDF8' },
    alerta:       { label: 'Alerta',       cor: '#F87171' },
    oportunidade: { label: 'Oportunidade', cor: '#4ADE80' },
    restricao:    { label: 'Restrição',    cor: '#FBBF24' },
    revisao:      { label: 'Revisão',      cor: '#A78BFA' },
    aprovacao:    { label: 'Aprovação',    cor: '#34D399' }
};
const COORD_PRIOR_CONFIG = {
    normal:  { label: 'Normal',  classe: 'prior-normal'  },
    alta:    { label: 'Alta',    classe: 'prior-alta'    },
    critica: { label: 'Crítica', classe: 'prior-critica' }
};
const TIPOS_COORD_VALIDOS = new Set(['diretriz','alerta','oportunidade','restricao','revisao','aprovacao']);
const PRIOR_COORD_VALIDOS = new Set(['normal','alta','critica']);

let coordTipoAtivo  = 'diretriz';
let coordPriorAtivo = 'normal';

// Cache em memória dos comentários por chave "clienteId|data|classe"
let cacheComentariosCoord = [];
let cacheComentariosGeral = [];

/** Gera ID único para um comentário */
function gerarIdComentario() {
    return crypto.randomUUID();
}

/** Lê lista de comentários de um registro do Supabase */
function lerListaComentarios(registro) {
    if (!registro?.valores_alocacao?.[0]?.[0]) return [];
    try { return JSON.parse(registro.valores_alocacao[0][0]); } catch (e) { console.warn('[Prisma] JSON inválido em comentários:', e); return []; }
}

/** Salva lista de comentários como registro especial no historico_alocacoes */
async function persistirComentarios(classeEspecial, lista) {
    if (!clienteAtivo || !dataAtiva) return false;

    const dadosUpsert = {
        cliente_id:        clienteAtivo.id,
        data_registro:     dataAtiva,
        classe_ativo:      classeEspecial,
        valores_alocacao:  [[JSON.stringify(lista)]],
        tese_investimento: '',
        updated_at:        new Date().toISOString()
    };

    const { error } = await clienteSupabase.from('historico_alocacoes').upsert(dadosUpsert,
        { onConflict: 'cliente_id,data_registro,classe_ativo' });

    if (error) {
        console.error('[Prisma] ❌ persistirComentarios erro:', error.message);
        return false;
    }

    return true;
}

async function carregarComentarios() {
    if (!clienteAtivo || !dataAtiva) return;
    try {
        const [resCoord, resGeral] = await Promise.all([
            clienteSupabase.from('historico_alocacoes').select('valores_alocacao')
                .eq('cliente_id',    clienteAtivo.id)
                .eq('data_registro', dataAtiva)
                .eq('classe_ativo',  CLASSE_COMENTARIOS_COORD)
                .maybeSingle(),
            clienteSupabase.from('historico_alocacoes').select('valores_alocacao')
                .eq('cliente_id',    clienteAtivo.id)
                .eq('data_registro', dataAtiva)
                .eq('classe_ativo',  CLASSE_COMENTARIOS_GERAL)
                .maybeSingle()
        ]);

        cacheComentariosCoord = lerListaComentarios(resCoord?.data);
        cacheComentariosGeral = lerListaComentarios(resGeral?.data);

        renderizarComentariosCoord(cacheComentariosCoord);
        renderizarComentariosGerais(cacheComentariosGeral);
    } catch (err) {
        console.error('[Prisma] ❌ carregarComentarios:', err);
    }
}

// ---- Modal de coordenador ----
function inicializarModalCoord() {
    document.querySelectorAll('#coord-tipo-grid .coord-tipo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#coord-tipo-grid .coord-tipo-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            coordTipoAtivo = btn.dataset.tipo;
        });
    });
    document.querySelectorAll('.coord-prioridade-row .coord-prior-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.coord-prioridade-row .coord-prior-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            coordPriorAtivo = btn.dataset.prior;
        });
    });
}
inicializarModalCoord();

document.getElementById('btn-novo-comentario-coord')?.addEventListener('click', () => {
    if (!clienteAtivo || !dataAtiva) {
        mostrarToast('Selecione um cliente e um dia antes de comentar.', 'erro');
        return;
    }
    ['coord-autor','coord-titulo-input','coord-corpo','coord-acao'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    coordTipoAtivo  = 'diretriz';
    coordPriorAtivo = 'normal';
    document.querySelectorAll('#coord-tipo-grid .coord-tipo-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tipo="diretriz"]')?.classList.add('active');
    document.querySelectorAll('.coord-prior-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-prior="normal"]')?.classList.add('active');
    document.getElementById('modal-comentario-coord')?.classList.remove('oculto');
    document.getElementById('coord-autor')?.focus();
});

['modal-coord-fechar','modal-coord-cancelar'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
        document.getElementById('modal-comentario-coord')?.classList.add('oculto');
    });
});

document.getElementById('modal-coord-salvar')?.addEventListener('click', async () => {
    const autor  = (document.getElementById('coord-autor')?.value.trim() ?? '').slice(0, 80);
    const titulo = (document.getElementById('coord-titulo-input')?.value.trim() ?? '').slice(0, 120);
    const corpo  = (document.getElementById('coord-corpo')?.value.trim() ?? '').slice(0, 2000);
    const acao   = (document.getElementById('coord-acao')?.value.trim() ?? '').slice(0, 200);

    if (!autor)  { mostrarToast('Informe o nome do coordenador.', 'erro'); return; }
    if (!titulo) { mostrarToast('Informe um título para o comentário.', 'erro'); return; }
    if (!corpo)  { mostrarToast('O desenvolvimento não pode estar vazio.', 'erro'); return; }
    if (!TIPOS_COORD_VALIDOS.has(coordTipoAtivo)) { mostrarToast('Tipo inválido.', 'erro'); return; }
    if (!PRIOR_COORD_VALIDOS.has(coordPriorAtivo)) { mostrarToast('Prioridade inválida.', 'erro'); return; }

    const btn = document.getElementById('modal-coord-salvar');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

    const novoComentario = {
        id:           gerarIdComentario(),
        tipo:         'coord',
        autor,
        tipo_destaque: coordTipoAtivo,
        prioridade:   coordPriorAtivo,
        titulo,
        corpo,
        acao,
        user_id:      idUsuarioLogado,
        criado_em:    new Date().toISOString()
    };

    const listaAtualizada = [...cacheComentariosCoord, novoComentario];
    const ok = await persistirComentarios(CLASSE_COMENTARIOS_COORD, listaAtualizada);

    if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Registrar comentário'; }

    if (ok) {
        cacheComentariosCoord = listaAtualizada;
        document.getElementById('modal-comentario-coord')?.classList.add('oculto');
        mostrarToast('Comentário de coordenação registrado.', 'sucesso');
        renderizarComentariosCoord(cacheComentariosCoord);
    } else {
        mostrarToast('Erro ao salvar comentário. Tente novamente.', 'erro');
    }
});

// ---- Modal de comentário geral ----
document.getElementById('btn-novo-comentario-geral')?.addEventListener('click', () => {
    if (!clienteAtivo || !dataAtiva) {
        mostrarToast('Selecione um cliente e um dia antes de comentar.', 'erro');
        return;
    }
    const corpo = document.getElementById('geral-corpo');
    if (corpo) corpo.value = '';
    document.getElementById('modal-comentario-geral')?.classList.remove('oculto');
    corpo?.focus();
});

document.getElementById('modal-geral-cancelar')?.addEventListener('click', () => {
    document.getElementById('modal-comentario-geral')?.classList.add('oculto');
});

document.getElementById('modal-geral-salvar')?.addEventListener('click', async () => {
    const corpo = (document.getElementById('geral-corpo')?.value.trim() ?? '').slice(0, 1000);
    if (!corpo) { mostrarToast('Escreva algo antes de publicar.', 'erro'); return; }

    const nomeAutor = (document.getElementById('identificador-usuario')?.textContent?.trim() || 'Consultor').slice(0, 120);

    const btn = document.getElementById('modal-geral-salvar');
    if (btn) { btn.disabled = true; btn.textContent = 'Publicando…'; }

    const novoComentario = {
        id:        gerarIdComentario(),
        tipo:      'geral',
        autor:     nomeAutor,
        corpo,
        user_id:   idUsuarioLogado,
        criado_em: new Date().toISOString()
    };

    const listaAtualizada = [...cacheComentariosGeral, novoComentario];
    const ok = await persistirComentarios(CLASSE_COMENTARIOS_GERAL, listaAtualizada);

    if (btn) { btn.disabled = false; btn.textContent = 'Publicar'; }

    if (ok) {
        cacheComentariosGeral = listaAtualizada;
        document.getElementById('modal-comentario-geral')?.classList.add('oculto');
        mostrarToast('Comentário publicado.', 'sucesso');
        renderizarComentariosGerais(cacheComentariosGeral);
    } else {
        mostrarToast('Erro ao publicar. Tente novamente.', 'erro');
    }
});

// ---- Renderização: comentários de coordenação ----
function renderizarComentariosCoord(lista) {
    const container = document.getElementById('lista-comentarios-coord');
    const vazio     = document.getElementById('coord-vazio-estado');
    if (!container) return;

    Array.from(container.children).forEach(c => { if (c.id !== 'coord-vazio-estado') c.remove(); });

    if (!lista.length) {
        if (vazio) vazio.style.display = '';
        return;
    }
    if (vazio) vazio.style.display = 'none';

    // Ordena mais recente por último
    const ordenados = [...lista].sort((a, b) => {
        const da = new Date(a.criado_em); const db = new Date(b.criado_em);
        if (isNaN(da)) return 1; if (isNaN(db)) return -1;
        return da - db;
    });

    ordenados.forEach(c => {
        const config = COORD_TIPO_CONFIG[c.tipo_destaque] || { label: c.tipo_destaque || 'Nota', cor: '#94a3b8' };
        const prior  = COORD_PRIOR_CONFIG[c.prioridade] || COORD_PRIOR_CONFIG.normal;
        const dataFmt = new Date(c.criado_em).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const ehAutor = c.user_id === idUsuarioLogado;

        const card = document.createElement('div');
        card.className = `coord-card coord-card--${c.prioridade || 'normal'}`;
        card.innerHTML = `
            <div class="coord-card-top">
                <div class="coord-card-badges">
                    <span class="coord-badge-tipo" style="--cor:${config.cor}">${escaparHTML(config.label)}</span>
                    <span class="coord-badge-prior ${prior.classe}">${escaparHTML(prior.label)}</span>
                </div>
                <div class="coord-card-meta">
                    <span class="coord-autor-tag"
                          title="Escrito por ${escaparHTML(c.autor || '—')} em ${escaparHTML(dataFmt)}">
                        ${escaparHTML(c.autor || '—')}
                    </span>
                    <span class="coord-data-tag">${escaparHTML(dataFmt)}</span>
                </div>
            </div>
            <h5 class="coord-card-titulo">${escaparHTML(c.titulo || '')}</h5>
            <p class="coord-card-corpo">${escaparHTML(c.corpo || '')}</p>
            ${c.acao ? `<div class="coord-card-acao">
                <svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                <span>${escaparHTML(c.acao)}</span>
            </div>` : ''}
            ${ehAutor ? `<button class="coord-card-excluir" data-coord-id="${escaparHTML(c.id)}" aria-label="Excluir comentário">
                <svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>` : ''}
        `;

        card.querySelector('[data-coord-id]')?.addEventListener('click', async (e) => {
            const idAlvo = e.currentTarget.dataset.coordId;
            const ok = await solicitarConfirmacaoModal('Excluir comentário', 'Deseja excluir permanentemente este comentário de coordenação?');
            if (!ok) return;
            const novaLista = cacheComentariosCoord.filter(x => x.id !== idAlvo);
            const salvou = await persistirComentarios(CLASSE_COMENTARIOS_COORD, novaLista);
            if (salvou) {
                cacheComentariosCoord = novaLista;
                renderizarComentariosCoord(cacheComentariosCoord);
            } else {
                mostrarToast('Erro ao excluir comentário.', 'erro');
            }
        });

        container.appendChild(card);
    });
}

// ---- Renderização: comentários gerais com autoria no hover ----
function renderizarComentariosGerais(lista) {
    const container = document.getElementById('lista-comentarios-gerais');
    const vazio     = document.getElementById('gerais-vazio-estado');
    if (!container) return;

    Array.from(container.children).forEach(c => { if (c.id !== 'gerais-vazio-estado') c.remove(); });

    if (!lista.length) {
        if (vazio) vazio.style.display = '';
        return;
    }
    if (vazio) vazio.style.display = 'none';

    const ordenados = [...lista].sort((a, b) => {
        const da = new Date(a.criado_em); const db = new Date(b.criado_em);
        if (isNaN(da)) return 1; if (isNaN(db)) return -1;
        return da - db;
    });

    ordenados.forEach(c => {
        const dataFmt  = new Date(c.criado_em).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const iniciais = (c.autor || '?').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
        const ehAutor  = c.user_id === idUsuarioLogado;
        // Tooltip aparece no hover do avatar — nome + horário
        const tooltipTxt = `${escaparHTML(c.autor || 'Consultor')} · ${escaparHTML(dataFmt)}`;

        const item = document.createElement('div');
        item.className = `geral-comentario-item${ehAutor ? ' proprio' : ''}`;
        item.innerHTML = `
            <div class="geral-avatar-wrap">
                <div class="geral-avatar" aria-hidden="true">${escaparHTML(iniciais)}</div>
                <div class="geral-autoria-tooltip" role="tooltip">${tooltipTxt}</div>
            </div>
            <div class="geral-corpo-wrap">
                <p class="geral-texto">${escaparHTML(c.corpo || '')}</p>
                <div class="geral-rodape">
                    <time class="geral-tempo" datetime="${escaparHTML(c.criado_em)}">${escaparHTML(dataFmt)}</time>
                    ${ehAutor ? `<button class="geral-excluir" data-geral-id="${escaparHTML(c.id)}" aria-label="Excluir comentário" title="Excluir">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>` : ''}
                </div>
            </div>
        `;

        item.querySelector('[data-geral-id]')?.addEventListener('click', async (e) => {
            const idAlvo = e.currentTarget.dataset.geralId;
            const ok = await solicitarConfirmacaoModal('Excluir comentário', 'Deseja excluir este comentário?');
            if (!ok) return;
            const novaLista = cacheComentariosGeral.filter(x => x.id !== idAlvo);
            const salvou = await persistirComentarios(CLASSE_COMENTARIOS_GERAL, novaLista);
            if (salvou) {
                cacheComentariosGeral = novaLista;
                renderizarComentariosGerais(cacheComentariosGeral);
            } else {
                mostrarToast('Erro ao excluir.', 'erro');
            }
        });

        container.appendChild(item);
    });
}

// ==========================================
// 19. ANALYTICS (MOTOR BASE64)
// ==========================================
document.getElementById('btn-alternar-analytics-view')?.addEventListener('click', () => {
    analyticsModoAtivo = !analyticsModoAtivo;
    const btn       = document.getElementById('btn-alternar-analytics-view');
    const viewAloc  = document.getElementById('container-alocacao-tradicional');
    const viewTabs  = document.getElementById('navegacao-classes-ativos-wrapper');
    const viewAnal  = document.getElementById('container-analytics-portfolio');

    if (analyticsModoAtivo) {
        btn?.innerHTML && (btn.innerHTML = `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Alocação Manual`);
        btn?.classList.remove('accent');
        viewAloc?.classList.add('oculto');
        if (viewTabs) viewTabs.style.display = 'none';
        viewAnal?.classList.add('active');
    } else {
        if (btn) btn.innerHTML = `<svg class="svg-icon" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> Análise Quantitativa`;
        btn?.classList.add('accent');
        viewAloc?.classList.remove('oculto');
        if (viewTabs) viewTabs.style.display = 'flex';
        viewAnal?.classList.remove('active');
    }
});

document.getElementById('btn-processar-token-analytics')?.addEventListener('click', () => {
    const inputToken = document.getElementById('input-token-base64');
    const tokenB64   = inputToken?.value.trim() || '';

    if (!tokenB64) {
        mostrarToast('Insira uma chave Base64 válida para prosseguir.', 'erro');
        return;
    }
    if (tokenB64.length > LIMITE_TOKEN_ANALYTICS) {
        mostrarToast('Chave Base64 excede o tamanho permitido.', 'erro');
        return;
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(tokenB64)) {
        mostrarToast('Chave Base64 com formato inválido.', 'erro');
        return;
    }

    try {
        const bytes          = Uint8Array.from(atob(tokenB64), c => c.charCodeAt(0));
        const carteiraObjeto = JSON.parse(new TextDecoder('utf-8').decode(bytes));

        if (!carteiraObjeto || typeof carteiraObjeto !== 'object' || Array.isArray(carteiraObjeto)) {
            mostrarToast('Token não possui estrutura de carteira válida.', 'erro');
            return;
        }
        const ativosFiltrados = Object.keys(carteiraObjeto).filter(k => !k.startsWith('__meta'));
        if (ativosFiltrados.length === 0) {
            mostrarToast('Token válido, porém nenhuma classe de ativo foi localizada.', 'erro');
            return;
        }

        // Limpa métricas anteriores antes de exibir novas
        const metricas = [
            'mq-capital-inicial','mq-saldo-atualizado','mq-impacto-dividendos',
            'mq-rentabilidade-acumulada','mq-alpha-jensen','mq-sharpe',
            'mq-sortino','mq-volatilidade','mq-max-drawdown','mq-var-historico','mq-beta'
        ];
        metricas.forEach(id => setText(id, '—'));

        // Exibe métricas presentes no token se disponíveis
        const meta = carteiraObjeto.__meta || {};
        if (meta.capital_inicial)         setText('mq-capital-inicial',        meta.capital_inicial);
        if (meta.saldo_atualizado)         setText('mq-saldo-atualizado',       meta.saldo_atualizado);
        if (meta.rentabilidade_acumulada)  setText('mq-rentabilidade-acumulada',meta.rentabilidade_acumulada);
        if (meta.sharpe)                   setText('mq-sharpe',                 meta.sharpe);
        if (meta.sortino)                  setText('mq-sortino',                meta.sortino);
        if (meta.volatilidade)             setText('mq-volatilidade',           meta.volatilidade);
        if (meta.max_drawdown)             setText('mq-max-drawdown',           meta.max_drawdown);
        if (meta.var_historico)            setText('mq-var-historico',          meta.var_historico);
        if (meta.beta)                     setText('mq-beta',                   meta.beta);
        if (meta.alpha_jensen)             setText('mq-alpha-jensen',           meta.alpha_jensen);
        if (meta.impacto_dividendos)       setText('mq-impacto-dividendos',     meta.impacto_dividendos);

        // Matriz de correlação
        const tabelaMatriz = document.getElementById('tabela-matriz-correlacao');
        if (tabelaMatriz) {
            const linhasHTML = [];
            let headerHTML = '<tr><th>Ativo</th>';
            ativosFiltrados.forEach(t => { headerHTML += `<th>${escaparHTML(t)}</th>`; });
            headerHTML += '</tr>';
            linhasHTML.push(headerHTML);

            ativosFiltrados.forEach((linhaTick, i) => {
                let linhaHTML = `<tr><td style="background:#050a0f;color:#fff;text-align:left;font-size:12px;">${escaparHTML(linhaTick)}</td>`;
                ativosFiltrados.forEach((colunaTick, j) => {
                    let coef = 0.0;
                    if (i === j) {
                        coef = 1.00;
                    } else {
                        // Tenta usar correlação do próprio token se disponível
                        const corr = carteiraObjeto[linhaTick]?.correlacoes?.[colunaTick];
                        coef = (typeof corr === 'number') ? Math.max(-1, Math.min(1, corr))
                            : Math.abs((linhaTick.charCodeAt(0) - colunaTick.charCodeAt(0)) % 10) / 10;
                    }
                    const bgColor = i === j
                        ? 'rgba(239,68,68,0.4)'
                        : coef >= 0
                            ? `rgba(248,113,113,${(Math.abs(coef) * 0.4).toFixed(3)})`
                            : `rgba(56,189,248,${(Math.abs(coef) * 0.4).toFixed(3)})`;
                    linhaHTML += `<td style="background:${bgColor};color:#fff;">${coef.toFixed(2)}</td>`;
                });
                linhaHTML += '</tr>';
                linhasHTML.push(linhaHTML);
            });
            tabelaMatriz.innerHTML = linhasHTML.join('');
        }

        document.getElementById('bloco-dashboard-metricas-quant')
            && (document.getElementById('bloco-dashboard-metricas-quant').style.display = 'block');
        mostrarToast('<b>Sincronização concluída!</b><br>Métricas importadas com sucesso.', 'sucesso');

    } catch (e) {
        mostrarToast('Falha na decodificação. Verifique a integridade da chave Base64.', 'erro');
        console.error('[Prisma] analytics token error:', e);
    }
});

// ==========================================
// 18. EXPORTAÇÃO PDF — IFRAME PRINT
// ==========================================
// Usa <iframe> oculto embutido na página para disparar window.print()
// diretamente — sem abrir guia nova, sem ser bloqueado por pop-up blocker.

const PDF = (() => {
    // ---- Paleta de cores por classe ----
    const COR = {
        renda_fixa:          '#2563EB',
        credito_privado:     '#7C3AED',
        acoes:               '#059669',
        fundos_imobiliarios: '#D97706',
        fundos_investimento: '#DB2777',
        derivativos:         '#B45309',
        previdencia:         '#6D28D9'
    };
    const NOME = {
        renda_fixa:          'Renda Fixa Tradicional',
        credito_privado:     'Crédito Privado',
        acoes:               'Ações',
        fundos_imobiliarios: 'Fundos Imobiliários',
        fundos_investimento: 'Fundos de Investimento',
        derivativos:         'Derivativos / Estruturados',
        previdencia:         'Previdência',
        alocacao_percentual: 'Distribuição Percentual da Carteira'
    };

    function fd(iso) {
        if (!iso) return '—';
        const [a, m, d] = iso.split('-');
        return `${d}/${m}/${a}`;
    }

    // ---- CSS do documento PDF ----
    function css() {
        return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#fff;color:#1e293b;font-family:'Inter',sans-serif;font-size:13px;line-height:1.5}
/* CABEÇALHO */
.hd{background:#0f172a;padding:24px 40px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #3B82F6;gap:20px}
.hd-marca{display:flex;align-items:center;gap:14px;flex-shrink:0}
.hd-txt{display:flex;flex-direction:column;gap:2px}
.hd-nome{font-size:20px;font-weight:800;color:#f8fafc;letter-spacing:-.02em}
.hd-sub{font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.1em}
.hd-dir{text-align:right;min-width:0;flex:1;max-width:320px}
.hd-doc{font-size:12px;font-weight:600;color:#93c5fd;display:block;word-break:break-word;line-height:1.4}
.hd-data{font-size:10px;color:#64748b;margin-top:3px;display:block}
/* FAIXA CLIENTE — grid 2 colunas, sem corte */
.fc{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:20px 40px;
    display:grid;grid-template-columns:1fr 1fr;gap:16px 40px}
.fc-b{display:flex;flex-direction:column;gap:4px}
.fc-b.full{grid-column:1/-1}
.fc-l{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8}
.fc-v{font-size:13px;font-weight:600;color:#0f172a;word-break:break-word;line-height:1.4}
.fc-v.nm{font-size:18px;font-weight:800;color:#0f172a;line-height:1.2}
.fc-v.cl{color:#2563EB}
.fc-linha-acento{height:3px;background:linear-gradient(90deg,#3B82F6 0%,#93c5fd 60%,transparent 100%)}
/* CORPO */
.body{padding:0 40px 32px}
/* BANNER ALOCAÇÃO */
.ba{margin:24px 0 0;padding:16px 20px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;
    border-left:4px solid #3B82F6;display:flex;align-items:center;justify-content:space-between;
    box-shadow:0 1px 4px rgba(0,0,0,.05)}
.ba-l{display:flex;align-items:center;gap:12px}
.ba-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.ba-nm{font-size:14px;font-weight:700;color:#0f172a;display:block}
.ba-vl{font-size:12px;color:#64748b;margin-top:2px;display:block}
.ba-pct{font-size:32px;font-weight:800;line-height:1;letter-spacing:-.02em}
.ba-pct sup{font-size:15px;font-weight:600;opacity:.65;vertical-align:super;line-height:0}
/* SEÇÃO */
.sec{margin:28px 0 0;padding-bottom:8px;border-bottom:2px solid #f1f5f9;
     display:flex;align-items:center;gap:8px}
.sec-ico{width:16px;height:16px;flex-shrink:0}
.sec-t{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
/* TABELA */
.tb{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
.tb thead tr{background:#0f172a}
.tb th{padding:10px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;
       letter-spacing:.06em;color:#94a3b8;white-space:nowrap}
.tb th.r,.tb td.r{text-align:right}
.tb th.c,.tb td.c{text-align:center}
.tb tbody tr:nth-child(odd){background:#fff}
.tb tbody tr:nth-child(even){background:#f8fafc}
.tb tbody tr:last-child td{border-bottom:2px solid #e2e8f0}
.tb td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}
.tb td.tk{font-weight:700;color:#0f172a;font-family:monospace;letter-spacing:.02em}
.tb .vz{text-align:center;color:#94a3b8;padding:32px 14px;font-style:italic}
/* TESE */
.tese-box{margin-top:16px;padding:16px 20px;background:#f8fafc;border:1px solid #e2e8f0;
          border-radius:8px;border-left:3px solid #3B82F6}
.tese-txt{font-size:13px;color:#334155;line-height:1.75;white-space:pre-wrap}
/* GRÁFICO PERCENTUAL */
.pct-wrap{display:flex;gap:32px;align-items:flex-start;margin-top:24px}
.pct-chart{position:relative;flex-shrink:0;width:200px;height:200px}
.pct-chart svg{width:200px;height:200px}
.pct-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}
.pct-center-n{font-size:22px;font-weight:800;line-height:1;display:block;letter-spacing:-.02em}
.pct-center-s{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;display:block;margin-top:2px}
.pct-leg{flex:1;display:flex;flex-direction:column;gap:0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.pct-leg-item{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #f1f5f9}
.pct-leg-item:last-child{border-bottom:none}
.pct-leg-item:nth-child(odd){background:#fff}
.pct-leg-item:nth-child(even){background:#f8fafc}
.pct-leg-d{width:11px;height:11px;border-radius:3px;flex-shrink:0}
.pct-leg-nm{flex:1;font-size:12px;font-weight:500;color:#334155}
.pct-leg-pct{font-size:14px;font-weight:800;width:46px;text-align:right;letter-spacing:-.01em}
.pct-leg-bar{width:80px;height:5px;background:#f1f5f9;border-radius:999px;overflow:hidden;flex-shrink:0}
.pct-leg-fill{height:100%;border-radius:inherit}
/* TABELA PERCENTUAL DETALHADA */
.tb-pct-cls{display:flex;align-items:center;gap:9px;font-weight:600;color:#0f172a}
.tb-pct-d{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.td-barra{width:120px}
.td-barra-t{height:5px;background:#f1f5f9;border-radius:999px;overflow:hidden}
.td-barra-f{height:100%;border-radius:inherit}
.td-pct-n{font-size:14px;font-weight:800;letter-spacing:-.01em;text-align:right;width:60px}
.tb tr.total{background:#f8fafc!important}
.tb tr.total td{border-top:2px solid #0f172a;font-weight:700;padding-top:12px}
.nota-base{margin-top:10px;font-size:10px;color:#94a3b8}
/* RODAPÉ */
.foot{margin-top:40px;padding:16px 40px;background:#f8fafc;border-top:2px solid #e2e8f0;
      display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
.foot-av{font-size:10px;color:#64748b;line-height:1.6;max-width:480px}
.foot-as{font-size:10px;color:#94a3b8;text-align:right;flex-shrink:0}
.foot-as strong{display:block;font-size:11px;color:#64748b;margin-bottom:2px}
/* PRINT */
@media print{
  html,body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  @page{size:A4;margin:0}
  .no-print{display:none!important}
}`;
    }

    // ---- SVG do gráfico de pizza ----
    function pizza(pctMap) {
        const entradas = Object.entries(pctMap).filter(([, v]) => parseFloat(v) > 0);
        const total    = entradas.reduce((s, [, v]) => s + parseFloat(v), 0);
        if (total <= 0 || entradas.length === 0) {
            return `<svg width="200" height="200" viewBox="0 0 200 200"><circle cx="100" cy="100" r="80" fill="#f1f5f9"/><circle cx="100" cy="100" r="45" fill="white"/><text x="100" y="105" text-anchor="middle" font-size="12" fill="#94a3b8">Sem dados</text></svg>`;
        }

        const cx = 100, cy = 100, r = 80, ri = 45;
        let ang = -Math.PI / 2;
        let fatias = '';

        // Gap entre fatias (em radianos)
        const gap = entradas.length > 1 ? 0.018 : 0;

        entradas.forEach(([cls, v]) => {
            const frac   = parseFloat(v) / total;
            const sweep  = frac * 2 * Math.PI - gap;
            if (sweep <= 0) return;
            const angFim = ang + sweep;
            const x1o = cx + r  * Math.cos(ang),   y1o = cy + r  * Math.sin(ang);
            const x2o = cx + r  * Math.cos(angFim), y2o = cy + r  * Math.sin(angFim);
            const x1i = cx + ri * Math.cos(angFim), y1i = cy + ri * Math.sin(angFim);
            const x2i = cx + ri * Math.cos(ang),    y2i = cy + ri * Math.sin(ang);
            const la = sweep > Math.PI ? 1 : 0;
            const cor = COR[cls] || '#94a3b8';
            fatias += `<path d="M${x1o.toFixed(2)},${y1o.toFixed(2)} A${r},${r} 0 ${la},1 ${x2o.toFixed(2)},${y2o.toFixed(2)} L${x1i.toFixed(2)},${y1i.toFixed(2)} A${ri},${ri} 0 ${la},0 ${x2i.toFixed(2)},${y2i.toFixed(2)} Z" fill="${cor}"/>`;
            ang = angFim + gap;
        });

        // Anel de fundo
        const bg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f1f5f9"/><circle cx="${cx}" cy="${cy}" r="${ri}" fill="white"/>`;

        return `<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${bg}${fatias}<circle cx="${cx}" cy="${cy}" r="${ri}" fill="white"/></svg>`;
    }

    // ---- Cabeçalho padrão ----
    function cab(nomeClasse, dataComite) {
        const nc  = escaparHTML(clienteAtivo?.nome || '—');
        const pat = clienteAtivo?.patrimonio
            ? formatarMoeda(moedaParaNumero(clienteAtivo.patrimonio)) : null;
        const prf = clienteAtivo?.dados_json?.perfil_investidor || '—';
        const pro = clienteAtivo?.profissao || null;
        const cid = clienteAtivo?.cidade || null;
        const ago = new Date().toLocaleString('pt-BR', {
            day:'2-digit', month:'2-digit', year:'numeric',
            hour:'2-digit', minute:'2-digit'
        });
        return `
<div class="hd">
  <div class="hd-marca">
    <svg width="40" height="40" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 8 52 20v24L32 56 12 44V20L32 8z" fill="none" stroke="#475569" stroke-width="4" stroke-linejoin="round"/>
      <path d="M32 17 44 24v16l-12 7-12-7V24l12-7z" fill="none" stroke="#3B82F6" stroke-width="3" stroke-linejoin="round"/>
      <path d="M32 17v30M20 24l24 16M44 24 20 40" stroke="#475569" stroke-width="2.5" stroke-linecap="round" opacity=".6"/>
    </svg>
    <div class="hd-txt">
      <span class="hd-nome">Prisma Consultoria</span>
      <span class="hd-sub">Relatório de Carteira</span>
    </div>
  </div>
  <div class="hd-dir">
    <span class="hd-doc">${escaparHTML(nomeClasse)}</span>
    <span class="hd-data">Emitido em ${ago}</span>
  </div>
</div>
<div class="fc">
  <!-- Nome ocupa a linha inteira -->
  <div class="fc-b full">
    <span class="fc-l">Cliente</span>
    <span class="fc-v nm">${nc}</span>
  </div>
  <!-- Linha 2: Data + Classe de Ativo -->
  <div class="fc-b">
    <span class="fc-l">Data do Comitê</span>
    <span class="fc-v">${escaparHTML(dataComite)}</span>
  </div>
  <div class="fc-b">
    <span class="fc-l">Classe de Ativo</span>
    <span class="fc-v cl">${escaparHTML(nomeClasse)}</span>
  </div>
  <!-- Linha 3: Patrimônio + Perfil -->
  ${pat ? `<div class="fc-b">
    <span class="fc-l">Patrimônio Base</span>
    <span class="fc-v">${pat}</span>
  </div>` : `<div class="fc-b"></div>`}
  <div class="fc-b">
    <span class="fc-l">Perfil do Investidor</span>
    <span class="fc-v">${escaparHTML(prf)}</span>
  </div>
  <!-- Linha 4: Profissão + Cidade (quando disponíveis) -->
  ${pro ? `<div class="fc-b">
    <span class="fc-l">Profissão</span>
    <span class="fc-v">${escaparHTML(pro)}</span>
  </div>` : ''}
  ${cid ? `<div class="fc-b">
    <span class="fc-l">Cidade</span>
    <span class="fc-v">${escaparHTML(cid)}</span>
  </div>` : ''}
</div>
<div class="fc-linha-acento"></div>`;
    }

    // ---- Rodapé ----
    function rod() {
        return `
<div class="foot">
  <div class="foot-av">
    <strong style="display:block;margin-bottom:4px;color:#475569">Aviso Legal</strong>
    Este relatório é de uso exclusivo entre consultor e cliente. As informações são baseadas
    nas declarações prestadas pelo cliente e não constituem garantia de rentabilidade futura.
    Investimentos envolvem riscos e podem resultar em perdas.
  </div>
  <div class="foot-as">
    <strong>Prisma Consultoria</strong>
    Plataforma para Consultores
  </div>
</div>`;
    }

    // ---- HTML para classe de ativo ----
    async function htmlClasse(classeAlvo) {
        const nomeClasse = NOME[classeAlvo] || classeAlvo;
        const dataFmt    = fd(dataAtiva);
        const config     = mapeamentoClasses[classeAlvo];
        if (!config) return null;

        const [r1, r2] = await Promise.all([
            clienteSupabase.from('historico_alocacoes').select('*')
                .eq('cliente_id', clienteAtivo.id).eq('data_registro', dataAtiva)
                .eq('classe_ativo', classeAlvo).maybeSingle(),
            clienteSupabase.from('historico_alocacoes').select('valores_alocacao')
                .eq('cliente_id', clienteAtivo.id).eq('data_registro', dataAtiva)
                .eq('classe_ativo', CLASSE_REGISTRO_PERCENTUAL).maybeSingle()
        ]);

        const linhas = r1.data?.valores_alocacao?.length ? r1.data.valores_alocacao : [];
        const tese   = r1.data?.tese_investimento || '';
        let pctMap   = {};
        if (r2.data?.valores_alocacao?.[0]?.[0]) {
            try { pctMap = JSON.parse(r2.data.valores_alocacao[0][0]); } catch (e) { console.warn('[Prisma] JSON inválido em pctMap (htmlClasse):', e); }
        }

        const pct  = pctMap[classeAlvo] || 0;
        const patN = moedaParaNumero(clienteAtivo?.patrimonio || '');
        const cor  = COR[classeAlvo] || '#3B82F6';
        const linhasValidas = linhas.filter(l => l.some(c => String(c || '').trim()));

        const trs = linhasValidas.length
            ? linhasValidas.map(l => `
              <tr>
                <td class="tk">${escaparHTML(l[0] || '—')}</td>
                <td>${escaparHTML(l[1] || '—')}</td>
                <td class="c">${l[2] ? fd(l[2]) : '—'}</td>
                <td class="r">${escaparHTML(l[3] || '—')}</td>
              </tr>`).join('')
            : `<tr><td colspan="4" class="vz">Nenhum ativo registrado para este comitê.</td></tr>`;

        return `${cab(nomeClasse, dataFmt)}
<div class="body">
${pct > 0 ? `
<div class="ba" style="border-left-color:${cor}">
  <div class="ba-l">
    <span class="ba-dot" style="background:${cor}"></span>
    <div>
      <span class="ba-nm">${escaparHTML(nomeClasse)}</span>
      ${patN > 0 ? `<span class="ba-vl">Equivalente a ${formatarMoeda(patN * pct / 100)} sobre base de ${formatarMoeda(patN)}</span>` : ''}
    </div>
  </div>
  <div class="ba-pct" style="color:${cor}">${pct.toFixed(1)}<sup>%</sup></div>
</div>` : ''}
<div class="sec" style="margin-top:${pct > 0 ? '24px' : '28px'}">
  <svg class="sec-ico" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
  <span class="sec-t">Posições Registradas</span>
</div>
<table class="tb">
  <thead><tr>
    <th>Ativo / Ticker</th>
    <th>${escaparHTML(config.label)}</th>
    <th class="c">Alocação em</th>
    <th class="r">Valor</th>
  </tr></thead>
  <tbody>${trs}</tbody>
</table>
${tese ? `
<div class="sec" style="margin-top:28px">
  <svg class="sec-ico" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  <span class="sec-t">Tese de Investimento — Visão do Comitê</span>
</div>
<div class="tese-box"><p class="tese-txt">${escaparHTML(tese)}</p></div>` : ''}
</div>
${rod()}`;
    }

    // ---- HTML para distribuição percentual ----
    async function htmlPercentual() {
        const dataFmt = fd(dataAtiva);
        const { data } = await clienteSupabase.from('historico_alocacoes').select('valores_alocacao')
            .eq('cliente_id', clienteAtivo.id).eq('data_registro', dataAtiva)
            .eq('classe_ativo', CLASSE_REGISTRO_PERCENTUAL).maybeSingle();

        let pctMap = {};
        if (data?.valores_alocacao?.[0]?.[0]) {
            try { pctMap = JSON.parse(data.valores_alocacao[0][0]); } catch (e) { console.warn('[Prisma] JSON inválido em pctMap (htmlPercentual):', e); }
        }

        const patN  = moedaParaNumero(clienteAtivo?.patrimonio || '');
        const total = Object.values(pctMap).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        const cls   = Object.entries(pctMap)
            .filter(([, v]) => parseFloat(v) > 0)
            .sort(([, a], [, b]) => parseFloat(b) - parseFloat(a));

        const corTotal = total >= 99.5 && total <= 100.5 ? '#059669' : total > 100 ? '#DC2626' : '#0f172a';

        // Legenda lateral do gráfico
        const legenda = cls.map(([c, v]) => {
            const cor  = COR[c] || '#94a3b8';
            const nome = NOME[c] || c;
            const pct  = parseFloat(v);
            const barW = Math.min(pct, 100);
            return `
            <div class="pct-leg-item">
              <span class="pct-leg-d" style="background:${cor}"></span>
              <span class="pct-leg-nm">${escaparHTML(nome)}</span>
              <div class="pct-leg-bar"><div class="pct-leg-fill" style="width:${barW}%;background:${cor}"></div></div>
              <span class="pct-leg-pct" style="color:${cor}">${pct.toFixed(1)}%</span>
            </div>`;
        }).join('');

        // Tabela detalhada
        const trs = cls.map(([ c, v]) => {
            const cor  = COR[c] || '#94a3b8';
            const nome = NOME[c] || c;
            const pct  = parseFloat(v);
            const eq   = patN > 0 ? formatarMoeda(patN * pct / 100) : '—';
            return `
            <tr>
              <td><div class="tb-pct-cls"><span class="tb-pct-d" style="background:${cor}"></span>${escaparHTML(nome)}</div></td>
              <td class="td-pct-n" style="color:${cor}">${pct.toFixed(1)}%</td>
              <td class="td-barra"><div class="td-barra-t"><div class="td-barra-f" style="width:${Math.min(pct,100)}%;background:${cor}"></div></div></td>
              <td class="r">${escaparHTML(eq)}</td>
            </tr>`;
        }).join('');

        return `${cab('Distribuição Percentual da Carteira', dataFmt)}
<div class="body">
<div class="sec" style="margin-top:24px">
  <svg class="sec-ico" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
  <span class="sec-t">Composição da Carteira — ${escaparHTML(fd(dataAtiva))}</span>
</div>
<div class="pct-wrap">
  <div class="pct-chart">
    ${pizza(pctMap)}
    <div class="pct-center">
      <span class="pct-center-n" style="color:${corTotal}">${total.toFixed(0)}%</span>
      <span class="pct-center-s">alocado</span>
    </div>
  </div>
  <div class="pct-leg">${legenda}</div>
</div>
<div class="sec" style="margin-top:28px">
  <svg class="sec-ico" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
  <span class="sec-t">Distribuição Detalhada</span>
</div>
<table class="tb">
  <thead><tr>
    <th>Classe de Ativo</th>
    <th class="r" style="width:64px">Alocação</th>
    <th style="width:120px">Visual</th>
    <th class="r">Valor Equivalente</th>
  </tr></thead>
  <tbody>
    ${trs}
    <tr class="total">
      <td><strong>Total</strong></td>
      <td class="td-pct-n" style="color:${corTotal}"><strong>${total.toFixed(1)}%</strong></td>
      <td></td>
      <td class="r"><strong>${patN > 0 ? formatarMoeda(patN) : '—'}</strong></td>
    </tr>
  </tbody>
</table>
${patN > 0 ? `<p class="nota-base">* Valores calculados proporcionalmente sobre base patrimonial de ${formatarMoeda(patN)}.</p>` : ''}
</div>
${rod()}`;
    }

    // ---- PRINT via iframe oculto ----
    function imprimir(htmlConteudo) {
        const frame = document.getElementById('prisma-print-frame');
        if (!frame) { console.error('[Prisma] iframe de impressão não encontrado'); return; }

        const docHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>${css()}</style>
</head>
<body>${htmlConteudo}</body>
</html>`;

        // Escreve o documento no iframe e dispara print
        const iframeDoc = frame.contentDocument || frame.contentWindow?.document;
        if (!iframeDoc) return;

        frame.srcdoc = docHTML;

        // Aguarda recursos carregarem antes de imprimir
        frame.contentWindow?.addEventListener('load', () => {
            setTimeout(() => {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            }, 200);
        });

        // Fallback se load já disparou
        setTimeout(() => {
            try { frame.contentWindow.print(); } catch (e) { console.warn('[Prisma] print fallback:', e); }
        }, 800);
    }

    return { htmlClasse, htmlPercentual, imprimir };
})();

// ---- Listener do botão ----
document.getElementById('btn-exportar-pdf')?.addEventListener('click', async () => {
    if (!clienteAtivo || !dataAtiva) {
        mostrarToast('Selecione um cliente e um dia antes de exportar.', 'erro');
        return;
    }

    const btn = document.getElementById('btn-exportar-pdf');
    if (btn) { btn.disabled = true; btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/></svg> Gerando…`; }

    try {
        let html = null;

        if (classeAtiva === CLASSE_ALOCACAO_PERCENTUAL) {
            html = await PDF.htmlPercentual();
        } else if (CLASSES_ATIVO_VALIDAS.has(classeAtiva)) {
            html = await PDF.htmlClasse(classeAtiva);
        } else {
            mostrarToast('Navegue para uma aba de ativo antes de exportar.', 'erro');
            return;
        }

        if (!html) {
            mostrarToast('Não foi possível gerar o PDF. Tente novamente.', 'erro');
            return;
        }

        PDF.imprimir(html);
        mostrarToast('<b>Diálogo de impressão aberto.</b><br>Selecione "Salvar como PDF" na impressora.', 'sucesso');

    } catch (err) {
        console.error('[Prisma] Erro ao gerar PDF:', err);
        mostrarToast('Erro ao gerar PDF. Tente novamente.', 'erro');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg> Exportar PDF`;
        }
    }
});

// ==========================================
// 19. LISTENERS DAS TABS (substituem onclick inline removidos do HTML)
// ==========================================

// Tabs de classes de ativos — data-classe
document.querySelectorAll('#navegacao-classes-ativos-wrapper [data-classe]').forEach(btn => {
    btn.addEventListener('click', async () => {
        const novaClasse = btn.dataset.classe;
        if (novaClasse === CLASSE_ALOCACAO_PERCENTUAL) {
            document.querySelectorAll('#navegacao-classes-ativos-wrapper .tab-button')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            await ativarPainelPercentual();
            return;
        }
        if (!CLASSES_ATIVO_VALIDAS.has(novaClasse)) return;
        document.querySelectorAll('#navegacao-classes-ativos-wrapper .tab-button')
            .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        classeAtiva = novaClasse;
        alternarPainelPercentual(false);
        await carregarDadosAlocacaoETese();
    });
});

// Tabs do resumo de suitability — data-aba
document.querySelectorAll('#modal-resumo-suitability [data-aba]').forEach(btn => {
    btn.addEventListener('click', () => {
        const abaId = btn.dataset.aba;
        if (!ABAS_RESUMO_PERMITIDAS.has(abaId)) return;
        document.querySelectorAll('#modal-resumo-suitability .tab-button')
            .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.resumo-aba').forEach(a => a.classList.remove('active'));
        document.getElementById(abaId)?.classList.add('active');
    });
});

// ==========================================
// 20. ACESSIBILIDADE: ESCAPE E TRAP DE FOCO
// ==========================================
const FOCUSABLE_SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function obterModalAberto() {
    return document.querySelector('.modal-overlay:not(.oculto)');
}

function fecharModalAberto() {
    const modal = obterModalAberto();
    if (!modal) return;
    // Aciona o botão de cancelar/fechar do modal aberto
    const btnClose = modal.querySelector('.btn-fechar-modal') ||
                     modal.querySelector('[id$="-cancelar"]') ||
                     modal.querySelector('[id$="-btn-cancelar"]') ||
                     modal.querySelector('[id$="-fechar"]');
    if (btnClose) btnClose.click();
}

// Escape fecha modal ativo
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fecharModalAberto();
});

// Tab fica preso dentro do modal aberto
document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const modal = obterModalAberto();
    if (!modal) return;
    const focusaveis = Array.from(modal.querySelectorAll(FOCUSABLE_SEL))
        .filter(el => el.offsetParent !== null);
    if (focusaveis.length === 0) return;
    const primeiro = focusaveis[0];
    const ultimo   = focusaveis[focusaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault(); ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault(); primeiro.focus();
    }
});

// ==========================================
// 19. LOGOUT
// ==========================================
document.getElementById('btn-sair')?.addEventListener('click', async () => {
    try {
        await clienteSupabase.auth.signOut();
    } catch (err) {
        console.warn('[Prisma] Erro no logout:', err);
    } finally {
        localStorage.removeItem(obterChaveTarefas());
        window.location.replace('index.html');
    }
});

// ==========================================
// 20. HOME — Voltar ao Dashboard
// ==========================================
function voltarAoDashboard() {
    clienteAtivo = null;
    document.getElementById('container-form-suitability')?.classList.remove('active');
    document.getElementById('container-workspace-cliente')?.classList.remove('active');
    document.getElementById('estado-vazio')?.classList.add('active');
    atualizarDashboardConsultor();
}

document.getElementById('btn-home-dashboard')?.addEventListener('click', voltarAoDashboard);
