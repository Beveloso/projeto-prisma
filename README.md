# Prisma Consultoria

> Plataforma web de gestão de carteiras de investimento para consultores financeiros e seus clientes.

---

## Visão Geral

**Prisma** é uma aplicação web completa voltada para consultorias de investimento. Ela permite que consultores cadastrem clientes, organizem carteiras por classe de ativo, registrem análises e gerem relatórios em PDF — tudo em uma interface moderna com autenticação segura via Supabase.

Construído com foco em segurança, usabilidade e boas práticas de desenvolvimento front-end.

---

## Funcionalidades

### Autenticação
- Login e cadastro abertos — qualquer pessoa pode criar uma conta
- Sessão persistente com refresh automático de token (Supabase Auth)
- Logout com limpeza de dados locais (LGPD-compliant)

### Painel do Consultor
- **Gestão de clientes** — cadastro completo com perfil financeiro, objetivos e restrições
- **Carteira de investimentos** — organizada por 7 classes de ativos:
  - Renda Fixa Tradicional
  - Crédito Privado
  - Ações
  - Fundos Imobiliários
  - Fundos de Investimento
  - Derivativos / Estruturados
  - Previdência
- **Alocação percentual** — visualização e edição por classe
- **Analytics** — modo de análise com processamento de tokens e geração de textos
- **Tarefas** — sistema de to-do por cliente, salvo localmente
- **Exportação PDF** — impressão de relatórios de carteira formatados

### Interface
- Design luxury dark com paleta navy/sky blue
- Animação de fundo em WebGL (Three.js) com shader GLSL customizado
- Degradação graciosa sem WebGL
- Totalmente responsivo

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5, CSS3, JavaScript (Vanilla ES6+) |
| Backend / Banco | [Supabase](https://supabase.com) (PostgreSQL + Auth + RLS) |
| Animação 3D | Three.js `@0.128.0` via CDN |
| Fontes | Google Fonts — Inter, Outfit |
| Segurança CDN | Subresource Integrity (SRI SHA-384) |

> Sem frameworks JS, sem bundler, sem dependências de build — roda direto no browser.

---

## Estrutura de Arquivos

```
final prisma/
├── index.html      # Página de login / cadastro
├── painel.html     # Painel principal do consultor
├── painel.js       # Toda a lógica do painel (clientes, carteira, analytics, PDF)
├── style.css       # Estilos globais (login + painel)
├── shader.js       # Animação WebGL (Three.js) do background
└── script.js       # Scripts auxiliares da página de login
```

---

## Banco de Dados (Supabase)

A aplicação usa o Supabase como backend serverless. A tabela principal é `clientes`, que armazena:

- Dados cadastrais do cliente
- Perfil de investidor (suitability)
- Carteiras por classe de ativo (armazenadas como JSON)
- Textos de análise e autorias
- Campos de alocação percentual

### Row Level Security (RLS)

**RLS está ativo** na tabela `clientes`. Cada consultor acessa apenas os clientes vinculados ao seu `user_id`. Nenhum dado de um usuário é visível para outro.

A chave pública (`sb_publishable_`) exposta no código é segura por design — o Supabase a usa para identificar o projeto, e as políticas de RLS garantem o isolamento dos dados.

---

## Como Rodar Localmente

Não há build necessário. Sirva os arquivos com qualquer servidor HTTP estático:

```bash
# Python
python -m http.server 8000

# Node (http-server)
npx http-server .

# VS Code
# Instale a extensão "Live Server" e clique em "Go Live"
```

Acesse `http://localhost:8000` no browser.

> **Atenção:** abrir `index.html` diretamente como `file://` pode bloquear requisições ao Supabase por CORS. Use sempre um servidor local.

---

## Variáveis de Configuração

As credenciais do Supabase estão em `painel.js` (linhas 4–5):

```javascript
const SUPABASE_URL = 'https://<seu-projeto>.supabase.co';
const SUPABASE_KEY = 'sb_publishable_...';
```

Para usar seu próprio projeto Supabase, substitua esses valores e crie a tabela `clientes` com as colunas correspondentes.

---

## Autor

**Bernardo V.**  
Repositório: [github.com/Beveloso/projeto-prisma](https://github.com/Beveloso/projeto-prisma)
