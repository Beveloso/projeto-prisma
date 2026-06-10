// ==========================================
// CONFIGURAÇÃO E CONSTANTES
// ==========================================
const SUPABASE_URL  = 'https://jchzgqztsmvznjvrszet.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_SMarpZSlzxw0_R2FJSi3zw_L6qaaSfD';

// Whitelist de tipos de alerta — bloco de injeção de classe CSS
const TIPOS_ALERTA  = new Set(['sucesso', 'erro', 'aviso']);

// Limite de tentativas de login (proteção anti-brute-force no cliente)
const MAX_TENTATIVAS_LOGIN = 5;
const JANELA_BLOQUEIO_MS   = 15 * 60 * 1000; // 15 minutos

// ==========================================
// INICIALIZAÇÃO DO SUPABASE
// ==========================================
if (typeof window.supabase === 'undefined') {
    console.error('[Prisma] Biblioteca Supabase não carregada.');
}
const clienteSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
    }
});

// ==========================================
// FUNÇÕES DE SEGURANÇA
// ==========================================

/**
 * Escapa caracteres HTML para prevenir XSS.
 */
function escaparHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Permite apenas tags seguras e conhecidas nas mensagens do sistema.
 * Nunca use com input de usuário.
 */
function mensagemSegura(valor) {
    return escaparHTML(valor)
        .replace(/&lt;b&gt;/g,   '<b>')
        .replace(/&lt;\/b&gt;/g, '</b>')
        .replace(/&lt;br&gt;/g,  '<br>');
}

function tipoAlertaSeguro(tipo) {
    return TIPOS_ALERTA.has(tipo) ? tipo : 'erro';
}

/** Validação de e-mail com regex conservadora */
function emailValido(email) {
    if (!email || email.length > 254) return false;
    return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email);
}

/** Validação mínima de senha */
function senhaValida(senha) {
    return typeof senha === 'string' && senha.length >= 8 && senha.length <= 128;
}

// ==========================================
// PROTEÇÃO ANTI-BRUTE-FORCE (CLIENTE)
// ==========================================
function obterEstadoBloqueio() {
    try {
        const raw = sessionStorage.getItem('prisma_login_attempts');
        return raw ? JSON.parse(raw) : { tentativas: 0, desde: null };
    } catch { return { tentativas: 0, desde: null }; }
}

function registrarTentativaFalha() {
    const estado = obterEstadoBloqueio();
    const agora  = Date.now();
    // Reseta janela se já passou o período de bloqueio
    if (estado.desde && agora - estado.desde > JANELA_BLOQUEIO_MS) {
        sessionStorage.setItem('prisma_login_attempts', JSON.stringify({ tentativas: 1, desde: agora }));
        return false;
    }
    const novoEstado = {
        tentativas: (estado.tentativas || 0) + 1,
        desde: estado.desde || agora
    };
    sessionStorage.setItem('prisma_login_attempts', JSON.stringify(novoEstado));
    return novoEstado.tentativas >= MAX_TENTATIVAS_LOGIN;
}

function estaBloqueado() {
    const estado = obterEstadoBloqueio();
    if (!estado.desde || estado.tentativas < MAX_TENTATIVAS_LOGIN) return false;
    const restante = JANELA_BLOQUEIO_MS - (Date.now() - estado.desde);
    return restante > 0;
}

function limparBloqueio() {
    sessionStorage.removeItem('prisma_login_attempts');
}

function minutosRestanteBloqueio() {
    const estado = obterEstadoBloqueio();
    if (!estado.desde) return 0;
    const restante = JANELA_BLOQUEIO_MS - (Date.now() - estado.desde);
    return Math.ceil(restante / 60000);
}

// ==========================================
// ANIMAÇÃO DE SPLASH SCREEN
// ==========================================
function iniciarSplash() {
    const splash   = document.getElementById('splash-screen');
    const authPage = document.getElementById('auth-page');
    if (!splash) return;

    // Após 1.8s inicia o fade-out do splash e revela a página
    setTimeout(() => {
        splash.classList.add('splash-saindo');
        if (authPage) authPage.classList.add('visivel');
        setTimeout(() => {
            splash.style.display = 'none';
            splash.setAttribute('aria-hidden', 'true');
        }, 600);
    }, 1800);
}

// ==========================================
// NAVEGAÇÃO ENTRE TELAS
// ==========================================
function trocarTela(idAlvo) {
    const IDsPermitidos = new Set(['form-login', 'form-cadastro', 'form-recuperar', 'form-nova-senha', 'form-confirmacao-email']);
    if (!IDsPermitidos.has(idAlvo)) return;

    document.querySelectorAll('.form-container').forEach(f => f.classList.remove('active'));
    const alvo = document.getElementById(idAlvo);
    if (alvo) {
        alvo.classList.add('active');
        const primeiroInput = alvo.querySelector('input');
        if (primeiroInput) setTimeout(() => primeiroInput.focus(), 50);
    }
}

// ==========================================
// ALERTAS
// ==========================================
let alertaTimer = null;

function mostrarAlerta(texto, tipo) {
    const caixa = document.getElementById('mensagem-alerta');
    if (!caixa) return;

    clearTimeout(alertaTimer);
    const tipoSeguro = tipoAlertaSeguro(tipo);
    caixa.innerHTML = mensagemSegura(texto);
    caixa.className = `mensagem-alerta ${tipoSeguro}`;
    caixa.removeAttribute('hidden');

    alertaTimer = setTimeout(() => {
        caixa.className = 'mensagem-alerta oculto';
    }, 5000);
}

// ==========================================
// VERIFICAR SESSÃO AO CARREGAR
// ==========================================
async function verificarSessaoInicial() {
    try {
        const { data: { session }, error } = await clienteSupabase.auth.getSession();
        if (error) {
            console.warn('[Prisma] Erro ao verificar sessão:', error.message);
            return false;
        }
        if (session) {
            window.location.replace('painel.html');
            return true; // está redirecionando
        }
        return false;
    } catch (err) {
        console.error('[Prisma] Falha crítica na verificação de sessão:', err);
        return false;
    }
}

// Detectar redirecionamento de recuperação de senha
async function verificarRecuperacaoSenha() {
    const hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) {
        trocarTela('form-nova-senha');
    }
}

// ==========================================
// LOGIN
// ==========================================
async function realizarLogin() {
    if (estaBloqueado()) {
        mostrarAlerta(
            `Muitas tentativas. Aguarde ${minutosRestanteBloqueio()} min para tentar novamente.`,
            'erro'
        );
        return;
    }

    const email = document.getElementById('login-email')?.value?.trim() ?? '';
    const senha = document.getElementById('login-senha')?.value ?? '';
    const btn   = document.getElementById('btn-entrar');

    if (!email || !senha) {
        mostrarAlerta('Preencha e-mail e senha para continuar.', 'erro');
        return;
    }
    if (!emailValido(email)) {
        mostrarAlerta('Informe um e-mail válido para continuar.', 'erro');
        return;
    }
    if (!senhaValida(senha)) {
        mostrarAlerta('Senha inválida. Mínimo de 8 caracteres.', 'erro');
        return;
    }

    if (btn) { btn.textContent = 'Entrando…'; btn.disabled = true; }

    try {
        const { data, error } = await clienteSupabase.auth.signInWithPassword({
            email,
            password: senha
        });

        if (error) {
            const bloqueado = registrarTentativaFalha();
            if (bloqueado) {
                mostrarAlerta(`Conta temporariamente bloqueada por ${minutosRestanteBloqueio()} min.`, 'erro');
            } else {
                mostrarAlerta('Credenciais inválidas. Verifique seus dados.', 'erro');
            }
            if (btn) { btn.textContent = 'Entrar'; btn.disabled = false; }
        } else {
            limparBloqueio();
            if (btn) { btn.textContent = 'Redirecionando…'; }
            mostrarAlerta('<b>Acesso autorizado!</b> Redirecionando…', 'sucesso');
            setTimeout(() => window.location.replace('painel.html'), 400);
        }
    } catch (err) {
        mostrarAlerta('Erro de conexão. Verifique sua rede.', 'erro');
        if (btn) { btn.textContent = 'Entrar'; btn.disabled = false; }
    }
}

document.getElementById('btn-entrar')?.addEventListener('click', realizarLogin);
document.getElementById('login-senha')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') realizarLogin();
});

// ==========================================
// CADASTRO
// ==========================================
document.getElementById('btn-cadastrar')?.addEventListener('click', async () => {
    const nome  = document.getElementById('cad-nome')?.value?.trim() ?? '';
    const email = document.getElementById('cad-email')?.value?.trim() ?? '';
    const senha = document.getElementById('cad-senha')?.value ?? '';
    const btn   = document.getElementById('btn-cadastrar');

    // Validações
    if (!nome || !email || !senha) {
        mostrarAlerta('Preencha todos os campos para criar sua conta.', 'erro');
        return;
    }
    if (nome.length > 120) {
        mostrarAlerta('Nome muito longo. Máximo de 120 caracteres.', 'erro');
        return;
    }
    if (!emailValido(email)) {
        mostrarAlerta('Informe um e-mail profissional válido.', 'erro');
        return;
    }
    if (!senhaValida(senha)) {
        mostrarAlerta('A senha deve ter entre 8 e 128 caracteres.', 'erro');
        return;
    }

    if (btn) { btn.textContent = 'Criando conta…'; btn.disabled = true; }

    try {
        const { data, error } = await clienteSupabase.auth.signUp({
            email,
            password: senha,
            options: { data: { nome_completo: nome } }
        });

        if (error) {
            // Mensagem genérica — não revela se o e-mail já existe
            mostrarAlerta('Não foi possível criar a conta. Tente novamente.', 'erro');
        } else {
            const display = document.getElementById('email-confirmacao-display');
            if (display) display.textContent = email;
            trocarTela('form-confirmacao-email');
        }
    } catch (err) {
        mostrarAlerta('Erro de conexão. Verifique sua rede.', 'erro');
    } finally {
        if (btn) { btn.textContent = 'Cadastrar'; btn.disabled = false; }
    }
});

// ==========================================
// RECUPERAÇÃO DE SENHA
// ==========================================
document.getElementById('btn-enviar-recuperacao')?.addEventListener('click', async () => {
    const email = document.getElementById('recuperar-email')?.value?.trim() ?? '';
    const btn   = document.getElementById('btn-enviar-recuperacao');

    if (!email) {
        mostrarAlerta('Informe seu e-mail de cadastro.', 'erro');
        return;
    }
    if (!emailValido(email)) {
        mostrarAlerta('Informe um e-mail válido para recuperação.', 'erro');
        return;
    }

    if (btn) { btn.textContent = 'Enviando…'; btn.disabled = true; }

    try {
        // Sempre exibe mensagem genérica de sucesso — não revela se o e-mail existe
        await clienteSupabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/index.html`
        });
        mostrarAlerta('<b>Se o e-mail existir, você receberá o link em instantes.</b>', 'sucesso');
    } catch (err) {
        mostrarAlerta('Erro de conexão. Tente novamente.', 'erro');
    } finally {
        if (btn) { btn.textContent = 'Enviar Link de Acesso'; btn.disabled = false; }
    }
});

// ==========================================
// NOVA SENHA
// ==========================================
document.getElementById('btn-salvar-nova-senha')?.addEventListener('click', async () => {
    const novaSenha = document.getElementById('nova-senha-input')?.value ?? '';

    if (!senhaValida(novaSenha)) {
        mostrarAlerta('A nova senha deve ter entre 8 e 128 caracteres.', 'erro');
        return;
    }

    const btn = document.getElementById('btn-salvar-nova-senha');
    if (btn) { btn.textContent = 'Salvando…'; btn.disabled = true; }

    try {
        const { error } = await clienteSupabase.auth.updateUser({ password: novaSenha });

        if (error) {
            mostrarAlerta('Erro ao atualizar senha. O link pode ter expirado.', 'erro');
        } else {
            mostrarAlerta('<b>Senha atualizada!</b> Redirecionando…', 'sucesso');
            setTimeout(() => {
                window.location.hash = '';
                trocarTela('form-login');
            }, 1500);
        }
    } catch (err) {
        mostrarAlerta('Erro de conexão. Tente novamente.', 'erro');
    } finally {
        if (btn) { btn.textContent = 'Salvar nova senha'; btn.disabled = false; }
    }
});

// ==========================================
// FORÇA DE SENHA
// ==========================================
function calcularForcaSenha(senha) {
    if (!senha) return null;
    let pontos = 0;
    if (senha.length >= 8)             pontos++;
    if (senha.length >= 12)            pontos++;
    if (/[A-Z]/.test(senha))           pontos++;
    if (/[0-9]/.test(senha))           pontos++;
    if (/[^A-Za-z0-9]/.test(senha))   pontos++;
    if (pontos <= 1) return { nivel: 'fraca',  texto: 'Senha fraca',  largura: '33%' };
    if (pontos <= 3) return { nivel: 'media',  texto: 'Senha média',  largura: '66%' };
    return             { nivel: 'forte',  texto: 'Senha forte',  largura: '100%' };
}

document.addEventListener('input', e => {
    if (e.target.id !== 'cad-senha') return;
    const wrap  = document.getElementById('senha-forca-wrap');
    const fill  = document.getElementById('senha-forca-fill');
    const texto = document.getElementById('senha-forca-texto');
    if (!wrap || !fill || !texto) return;

    const forca = calcularForcaSenha(e.target.value);
    if (!forca) { wrap.classList.add('oculto'); return; }

    wrap.classList.remove('oculto');
    fill.className          = `senha-forca-fill nivel-${forca.nivel}`;
    fill.style.setProperty('--senha-scale', String(parseInt(forca.largura, 10) / 100));
    texto.textContent       = forca.texto;
    texto.className         = `senha-forca-texto nivel-${forca.nivel}`;
});

// ==========================================
// INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Registra listeners dos botões de navegação (substituem onclicks inline)
    document.querySelectorAll('[data-tela]').forEach(btn => {
        btn.addEventListener('click', () => trocarTela(btn.dataset.tela));
    });

    // Botões de mostrar/ocultar senha (event delegation — funciona mesmo em forms ocultos)
    document.addEventListener('click', e => {
        const btn = e.target.closest('.btn-toggle-senha');
        if (!btn) return;
        const wrap = btn.closest('.input-wrap-rel');
        if (!wrap) return;
        const input = wrap.querySelector('input');
        if (!input) return;
        const mostrando = input.type === 'text';
        input.type = mostrando ? 'password' : 'text';
        btn.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
        btn.style.color = mostrando ? '' : 'rgba(125,211,252,0.70)';
    });

    // BUG FIX: detecta o link de recuperação de senha ANTES de verificar sessão.
    // O Supabase injeta #type=recovery na URL após o clique no e-mail de reset.
    // Se verificarSessaoInicial() rodar antes, ele detecta a sessão temporária e
    // redireciona para painel.html sem nunca mostrar o formulário de nova senha.
    const hash = window.location.hash;
    const ehRecuperacao = hash && hash.includes('type=recovery');

    if (ehRecuperacao) {
        // Mostra a página imediatamente (sem splash) e abre o form de nova senha
        const authPage = document.getElementById('auth-page');
        if (authPage) authPage.classList.add('visivel');
        trocarTela('form-nova-senha');
        // Registra listener para salvar via onAuthStateChange do Supabase
        clienteSupabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                trocarTela('form-nova-senha');
            }
        });
    } else {
        // Fluxo normal: verifica sessão e só mostra splash se não estiver logado
        verificarSessaoInicial().then(jaLogado => {
            if (!jaLogado) {
                iniciarSplash();
                verificarRecuperacaoSenha();
            }
        });
    }
});
