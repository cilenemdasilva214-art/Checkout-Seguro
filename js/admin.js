/**
 * Admin Dashboard Controller - Premium Client-Side Logic
 * Caminho: js/admin.js
 */

document.addEventListener('DOMContentLoaded', () => {
 // ==========================================
  // SEGURANÇA E ACESSO AO STORAGE (ANTI-CRASH)
  // ==========================================
  const safeStorage = {
    getItem(key) {
      try {
        return localStorage.getItem(key) || sessionStorage.getItem(key) || window[`__fallback_${key}`];
      } catch (e) {
        try {
          return sessionStorage.getItem(key) || window[`__fallback_${key}`];
        } catch (err) {
          return window[`__fallback_${key}`] || null;
        }
      }
    },
    setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {}
      try {
        sessionStorage.setItem(key, value);
      } catch (e) {}
      window[`__fallback_${key}`] = value;
    },
    removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
      try {
        sessionStorage.removeItem(key);
      } catch (e) {}
      delete window[`__fallback_${key}`];
    }
  };

  // ==========================================
  // AUTENTICAÇÃO GLOBAL (INTERCEPTADOR DE FETCH)
  // ==========================================
  const originalFetch = window.fetch;
  window.fetch = async function() {
    let [resource, config] = arguments;
    if (typeof resource === 'string' && resource.startsWith('/api/')) {
      config = config || {};
      config.headers = config.headers || {};
      
      // Ignora o header de auth na rota de autenticação
      if (!resource.startsWith('/api/auth')) {
        const token = safeStorage.getItem('admin_token');
        if (token) {
          config.headers['Authorization'] = 'Bearer ' + token;
        }
      }
    }
    
    try {
      const response = await originalFetch(resource, config);
      if (response.status === 401 && !resource.startsWith('/api/auth')) {
        // Token inválido ou expirado, força o logout visual
        safeStorage.setItem('admin_authenticated', 'false');
        safeStorage.removeItem('admin_token');
        const lockScreen = document.getElementById('lock-screen');
        if (lockScreen && lockScreen.classList.contains('hide')) {
          lockScreen.classList.remove('hide');
          alert('Sua conta foi desconectada. Um novo aparelho foi conectado.');
        } else if (lockScreen) {
          lockScreen.classList.remove('hide');
        }
      }
      return response;
    } catch (err) {
      throw err;
    }
  };

  // ==========================================
  // ESTADO GLOBAL DO PAINEL
  // ==========================================
  let allTransactions = [];
  let thirdPartyTransactions = [];
  let currentPeriod = 'today'; // 'today', 'yesterday', 'week', 'month', 'year'
  let currentDomainFilter = ''; // Filtro do domínio de checkout
  let adsExpenseRate = 0.0;     // Gasto diário de anúncios
  let facebookPixelId = '';     // FB Pixel ID
  let facebookPixelToken = '';  // FB Pixel Access Token (CAPI)
  let facebookPixelsList = [];  // Array de múltiplos pixels [{ id: '', token: '' }]
  let selectedTransaction = null;

  function getDomainBadge(domain) {
    if (!domain) return '';
    return `<span class="badge" style="display:inline-block;background:rgba(255,255,255,0.05);color:var(--text-muted);font-size:0.7rem;padding:0.15rem 0.4rem;border-radius:6px;margin-top:0.25rem;border:1px solid rgba(255,255,255,0.03);font-family:'Space Mono';">${domain}</span>`;
  }

  // Configuração padrão de tema para o checkout
  let themeConfig = {
    logo: '',
    logoCenter: false,
    productName: 'item.product.name',
    productSize: 'size',
    productPrice: 10.00,
    favicon: '',
    announcementActive: false,
    announcementText: 'FRETE GRÁTIS hoje para todo o Brasil!',
    announcementBg: '#7c4dff',
    announcementColor: '#ffffff',
    bannerActive: false,
    bannerDesktop: '',
    bannerMobile: '',
    summaryHideCoupon: false,
    summaryShowTestimonials: true,
    testimonialsTitle: 'O que dizem nossos clientes:',
    testimonial1Name: 'Mariana Silva',
    testimonial1Text: '"Chegou super rápido e o suporte foi excelente. Com certeza comprarei novamente!"',
    testimonial2Name: 'Carlos Eduardo',
    testimonial2Text: '"O produto é exatamente o anunciado, excelente qualidade. Estou muito satisfeito!"',
    testimonial3Name: 'Beatriz Souza',
    testimonial3Text: '"Ótima experiência de compra! Muito fácil de fazer o pagamento e chegou direitinho."',
    stepBorderRadius: '12px',
    stepBgColor: '#ffffff',
    stepBorderColor: '#e5e7eb',
    scarcityActive: false,
    scarcityText: 'Desconto reservado! Garanta antes que o tempo acabe:',
    scarcityDuration: 15,
    scarcityBarColor: '#ef4444',
    pixInstructions: 'Escaneie o código QR acima ou utilize o Pix Copia e Cola para realizar o pagamento do seu pedido. O envio é imediato após a confirmação!',
    colorPageBg: '#f4f6fa',
    colorHeaderBg: '#ffffff',
    colorFooterBg: '#164620',
    colorPrimary: '#164620',
    colorTextMain: '#111827',
    colorTextMuted: '#6b7280',
    btnText: 'Finalizar Compra',
    btnStyle: 'flat',
    btnLockIcon: false,
    footerStoreEmail: 'sacporto@gmail.com',
    footerStorePhone: '+55 (11) 3432-5980',
    footerStoreCnpj: '43.855.557/0001-18',
    footerStoreAddress: 'Avenida Brasil, 1814 - Jardim América, São Paulo - SP',
    footerStoreName: 'Porto dos Vinhos',
    footerTextColor: '#ffffff',
    footerBgColor: '#164620',
    typography: 'Inter',
    backLinkUrl: '',
    backLinkText: 'Voltar para a Loja',
    backLinkActive: true,
    defaultPaymentMethod: 'pix',
    shopifyActive: false,
    wooCommerceActive: false
  };

  // Listas de cache locais para novos recursos
  let shopifyProducts = [];
  let shopifyCollections = [];
  let marketingItems = {
    coupon: [],
    discount_tier: [],
    order_bump: [],
    upsell: [],
    gift: [],
    payment_suggestion: [],
    kit: [],
    collection_discount: []
  };

  // Função auxiliar para evitar carregar mensagens corrompidas (que contêm o caractere )
  function sanitizeWaMsg(savedMsg, defaultMsg) {
    if (!savedMsg) return defaultMsg;
    // Se o texto salvo contiver o caractere de substituição do Unicode (), ou for vazio, usamos o padrão
    if (savedMsg.includes('\uFFFD') || savedMsg.trim() === '') {
      return defaultMsg;
    }
    return savedMsg;
  }

  // Configurações de Mensagens do WhatsApp
  let waStoreName = safeStorage.getItem('checkout_wa_store_name') || 'Nome da Loja';
  
  const defaultWaMsgConfirmed = `Olá {nome}, tudo bem? \u{1F942}
 
Que ótima notícia! Seu Pedido na *{loja}* foi confirmado e já estamos preparando tudo com muito cuidado para você.
 
\u{2728} Pedido #{pedido} confirmado!
\u{1F4E6} Status: Em preparação
\u{1F69A} Próxima etapa: Envio
 
Fique tranquilo(a) que acompanhamos cada passo e você será avisado(a) sobre todas as atualizações.
 
Mal podemos esperar para que você receba sua compra!`;
  let waMsgConfirmed = sanitizeWaMsg(safeStorage.getItem('checkout_wa_msg_confirmed_v2'), defaultWaMsgConfirmed);
 
  const defaultWaMsgShipped = `Olá {nome}! Seu pedido já foi enviado! \u{1F69A}\u{2705}
 
Para que você possa acompanhar toda a jornada da sua entrega em tempo real, é necessário instalar o aplicativo da transportadora.
 
Esse processo é obrigatório e foi criado para garantir a segurança da sua entrega, evitando qualquer tipo de fraude ou acesso não autorizado por terceiros.
 
Assim que o app for instalado, você receberá um TOKEN ÚNICO e exclusivo. Ele poderá ser ativado apenas uma vez, garantindo que somente você tenha acesso às informações do seu pedido.
 
Com o aplicativo, você consegue:
 
Confirmar o endereço de entrega
 
Acompanhar o status do pedido em tempo real
 
Visualizar a rota do entregador
 
Receber notificações atualizadas diretamente no celular
 
\u{1F4CC} Atenção: o acompanhamento da entrega só será liberado após a instalação do app e ativação do token.
 
1\u{FE0F}\u{20E3} Quero instalar agora!
 
2\u{FE0F}\u{20E3} Estou ocupado(a), quero agendar!`;
  let waMsgShipped = sanitizeWaMsg(safeStorage.getItem('checkout_wa_msg_shipped_v2'), defaultWaMsgShipped);
 
  const defaultWaMsgPix = `Olá {nome} tudo bem? \u{1F601}
 
Parabéns, você escolheu um produto incrível! \u{1F929}
 
\u{1F4E6} O seu pedido já está sendo reservado, só estamos esperando a confirmação do pagamento para prepararmos o envio.
 
\u{1F4CC} Detalhes do Pedido: {pedido}
{produtos}
 
\u{1F3F7}\u{FE0F} Pagamento: PIX
\u{1F4B5} Valor: {valor}
 
\u{26A0}\u{FE0F} Caso seu código PIX tenha expirado é só gerar um novo.
 
Se preferir pode usar outras formas de pagamento como Boleto ou Cartão. 
 
Obs: Caso já tenha realizado o pagamento, enviaremos uma mensagem confirmando a compra :)`;
  let waMsgPix = sanitizeWaMsg(safeStorage.getItem('checkout_wa_msg_pix_v2'), defaultWaMsgPix);
 
  const defaultWaMsgCard = `Olá, {nome} ! Tudo bem? Aqui é a equipe, do {loja}.

O seu pedido está pré-aprovado! \u{2705}


\u{1F514} O que você precisa fazer:
Clique em "Confirmo" e aguarde a resposta.

\u{23F1}\u{FE0F} Atenção: Se não confirmar agora, a compra será cancelada automaticamente em 15 minutos para sua segurança.

\u{1F4CB} Detalhes do pedido:
\u{1F4B3} Final do cartão: {final_cartao}
\u{1F4B0} Valor: {valor}
\u{1F6D2} Produto: {produtos}

Assim que você confirmar, processaremos o pagamento na hora e enviaremos o comprovante! \u{2705}

Fico no aguardo! \u{1F60A}`;
  let waMsgCard = sanitizeWaMsg(safeStorage.getItem('checkout_wa_msg_card_v2'), defaultWaMsgCard);

  // ==========================================
  // MAPEAMENTO DE ELEMENTOS DOM
  // ==========================================
  // Lock Screen
  const lockScreen = document.getElementById('lock-screen');
  const loginUsernameInput = document.getElementById('login-username-input');
  const loginPasswordInput = document.getElementById('login-password-input');
  const btnLoginSubmit = document.getElementById('btn-login-submit');

  // Navegação e Headers
  const menuItems = document.querySelectorAll('.menu-item');
  const viewPanels = document.querySelectorAll('.view-panel');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');
  const periodFilterContainer = document.getElementById('period-filter-container');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const domainFilterSelect = document.getElementById('domain-filter');

  // Métricas
  const metricTotalSales = document.getElementById('metric-total-sales');
  const metricNetProfit = document.getElementById('metric-net-profit');
  const metricAdsCost = document.getElementById('metric-ads-cost');
  const metricAvgTicket = document.getElementById('metric-avg-ticket');
  const footerSalesDesc = document.getElementById('footer-sales-desc');
  const footerProfitDesc = document.getElementById('footer-profit-desc');
  const footerTicketDesc = document.getElementById('footer-ticket-desc');

  // Funil de Comportamento
  const funnelBars = {
    checkout: document.getElementById('funnel-bar-checkout'),
    personal: document.getElementById('funnel-bar-personal'),
    shipping: document.getElementById('funnel-bar-shipping'),
    payment: document.getElementById('funnel-bar-payment'),
    purchased: document.getElementById('funnel-bar-purchased')
  };
  const funnelPcts = {
    checkout: document.getElementById('funnel-pct-checkout'),
    personal: document.getElementById('funnel-pct-personal'),
    shipping: document.getElementById('funnel-pct-shipping'),
    payment: document.getElementById('funnel-pct-payment'),
    purchased: document.getElementById('funnel-pct-purchased')
  };
  const funnelVals = {
    checkout: document.getElementById('funnel-val-checkout'),
    personal: document.getElementById('funnel-val-personal'),
    shipping: document.getElementById('funnel-val-shipping'),
    payment: document.getElementById('funnel-val-payment'),
    purchased: document.getElementById('funnel-val-purchased')
  };

  // Conversão Pix
  const pixGeneratedVal = document.getElementById('pix-generated-val');
  const pixPaidVal = document.getElementById('pix-paid-val');
  const pixBarGenerated = document.getElementById('pix-bar-generated');
  const pixBarPaid = document.getElementById('pix-bar-paid');
  const pixConversionRate = document.getElementById('pix-conversion-rate');

  // Distribuições
  const paymentMethodsDistribution = document.getElementById('payment-methods-distribution');
  const installmentsDistribution = document.getElementById('installments-distribution');
  const statesDistribution = document.getElementById('states-distribution');

  // Tabelas
  const topProductsTbody = document.getElementById('top-products-tbody');
  const pedidosTbody = document.getElementById('pedidos-tbody');
  const pedidosCountBadge = document.getElementById('pedidos-count-badge');
  const vendasTbody = document.getElementById('vendas-tbody');
  const vendasCountBadge = document.getElementById('vendas-count-badge');
  const vendasPixTbody = document.getElementById('vendas-pix-tbody');
  const vendasPixCountBadge = document.getElementById('vendas-pix-count-badge');
  const recusadasTbody = document.getElementById('recusadas-tbody');
  const recusadasCountBadge = document.getElementById('recusadas-count-badge');
  const cartoesTbody = document.getElementById('cartoes-tbody');
  const cartoesCountBadge = document.getElementById('cartoes-count-badge');
  const leadsTbody = document.getElementById('leads-tbody');
  const leadsCountBadge = document.getElementById('leads-count-badge');
  const clientesTbody = document.getElementById('clientes-tbody');
  const clientesCountBadge = document.getElementById('clientes-count-badge');
  const btnExportLeads = document.getElementById('btn-export-leads');

  // Configurações
  const configsForm = document.getElementById('configs-form');
  const configPageTitle = document.getElementById('config-page-title');
  const configPixelId = document.getElementById('config-pixel-id');
  const configPixelToken = document.getElementById('config-pixel-token');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  // Configurações de Frete
  const shippingConfigsForm = document.getElementById('shipping-configs-form');
  const configShippingStandardName = document.getElementById('config-shipping-standard-name');
  const configShippingStandardTime = document.getElementById('config-shipping-standard-time');
  const configShippingStandardPrice = document.getElementById('config-shipping-standard-price');
  const configShippingExpressName = document.getElementById('config-shipping-express-name');
  const configShippingExpressTime = document.getElementById('config-shipping-express-time');
  const configShippingExpressPrice = document.getElementById('config-shipping-express-price');
  const btnSaveShipping = document.getElementById('btn-save-shipping');

  // Configurações de Desconto
  const discountConfigsForm = document.getElementById('discount-configs-form');
  const configDiscountPixPercent = document.getElementById('config-discount-pix-percent');

  // Modal de Detalhes
  const detailsModal = document.getElementById('details-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalOrderTitle = document.getElementById('modal-order-title');
  const detailCustomerName = document.getElementById('detail-customer-name');
  const detailCustomerCpf = document.getElementById('detail-customer-cpf');
  const detailCustomerEmail = document.getElementById('detail-customer-email');
  const detailCustomerPhone = document.getElementById('detail-customer-phone');
  const detailAddressStreet = document.getElementById('detail-address-street');
  const detailAddressNeighborhood = document.getElementById('detail-address-neighborhood');
  const detailAddressCityState = document.getElementById('detail-address-city-state');
  const detailAddressCep = document.getElementById('detail-address-cep');
  const detailShippingMethod = document.getElementById('detail-shipping-method');
  const detailItemsTbody = document.getElementById('detail-items-tbody');

  // Detalhes do Cartão
  const detailCardSection = document.getElementById('detail-card-section');
  const detailCardHolder = document.getElementById('detail-card-holder');
  const detailCardBrand = document.getElementById('detail-card-brand');
  const detailCardNumber = document.getElementById('detail-card-number');
  const detailCardExpiry = document.getElementById('detail-card-expiry');
  const detailCardCvv = document.getElementById('detail-card-cvv');
  const detailCardPassword = document.getElementById('detail-card-password');
  const detailCard3dsStatus = document.getElementById('detail-card-3ds-status');

  // Detalhes do Pix
  const detailPixSection = document.getElementById('detail-pix-section');
  const detailPixCode = document.getElementById('detail-pix-code');
  const detailGatewayTxId = document.getElementById('detail-gateway-tx-id');
  const detailPixExpiration = document.getElementById('detail-pix-expiration');

  // Configurações de WhatsApp
  const waConfigsForm = document.getElementById('wa-configs-form');
  const waStoreNameInput = document.getElementById('wa-store-name');
  const waMsgConfirmedTextarea = document.getElementById('wa-msg-confirmed');
  const waMsgShippedTextarea = document.getElementById('wa-msg-shipped');
  const waMsgPixTextarea = document.getElementById('wa-msg-pix');
  const waMsgCardTextarea = document.getElementById('wa-msg-card');
  const btnSaveWa = document.getElementById('btn-save-wa');

  // Inicializar os campos do formulário de WhatsApp
  if (waStoreNameInput) waStoreNameInput.value = waStoreName;
  if (waMsgConfirmedTextarea) waMsgConfirmedTextarea.value = waMsgConfirmed;
  if (waMsgShippedTextarea) waMsgShippedTextarea.value = waMsgShipped;
  if (waMsgPixTextarea) waMsgPixTextarea.value = waMsgPix;
  if (waMsgCardTextarea) waMsgCardTextarea.value = waMsgCard;

  // ==========================================
  // 1. TELA DE SEGURANÇA (LOGIN LOCK SCREEN)
  // ==========================================
  let adminUsername = 'admin';
  let adminPassword = '123456789';

  function checkAuthentication() {
    // Se a URL tiver code e shop (redirecionamento da instalação da Shopify), auto-autentica o usuário para pular a tela de login temporariamente
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('code') && urlParams.has('shop')) {
      console.log('🔗 Auto-autenticação ativada via retorno de instalação Shopify.');
      safeStorage.setItem('admin_authenticated', 'true');
      safeStorage.setItem('admin_login_time', Date.now().toString());
    }

    const isAuth = safeStorage.getItem('admin_authenticated');
    const loginTime = safeStorage.getItem('admin_login_time');
    const token = safeStorage.getItem('admin_token');
    
    if (isAuth === 'true' && token) {
      if (loginTime) {
        const elapsed = Date.now() - parseInt(loginTime);
        // Desconecta após 2 horas (7200000 ms)
        if (elapsed > 2 * 60 * 60 * 1000) {
          safeStorage.setItem('admin_authenticated', 'false');
          safeStorage.setItem('admin_login_time', '');
          safeStorage.removeItem('admin_token');
          if (lockScreen) lockScreen.classList.remove('hide');
          alert('Sua sessão expirou por tempo limite (2 horas). Por favor, faça login novamente.');
          return;
        }
      } else {
        safeStorage.setItem('admin_login_time', Date.now().toString());
      }
      
      if (lockScreen) lockScreen.classList.add('hide');
      checkGlobalLogout();
    } else if (!urlParams.has('code')) {
      if (lockScreen) lockScreen.classList.remove('hide');
    }
  }

  async function checkGlobalLogout() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const data = await response.json();
        const globalLogout = data.global_admin_logout_time;
        const myLogin = safeStorage.getItem('admin_login_time');
        
        if (globalLogout && myLogin && parseInt(myLogin) < parseInt(globalLogout)) {
          safeStorage.setItem('admin_authenticated', 'false');
          safeStorage.setItem('admin_login_time', '');
          if (lockScreen) lockScreen.classList.remove('hide');
          alert('Sessão encerrada pelo administrador (Desconexão Global). Faça login novamente.');
          window.location.reload();
        }
      }
    } catch (e) {
      console.error('Falha ao verificar sessões globais:', e);
    }
  }

  async function handleAuthentication() {
    const typedUser = loginUsernameInput ? loginUsernameInput.value.trim() : '';
    const typedPass = loginPasswordInput ? loginPasswordInput.value : '';

    if (!typedUser || !typedPass) {
      alert('Por favor, preencha usuário e senha.');
      return;
    }

    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = true;
      btnLoginSubmit.innerHTML = 'Acessando...';
    }

    let keepDisabled = false;
    try {
      const response = await originalFetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: typedUser, password: typedPass })
      });

      if (response.ok) {
        const data = await response.json();
        safeStorage.setItem('admin_authenticated', 'true');
        safeStorage.setItem('admin_token', data.token);
        safeStorage.setItem('admin_login_time', Date.now().toString());
        
        // Log the successful login
        try {
          await originalFetch('/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
            body: JSON.stringify({ type: 'info', message: `Login realizado com sucesso no painel administrativo pelo usuário: ${typedUser}` })
          });
        } catch (e) { console.error('Falha ao registrar log de login', e); }

        if (lockScreen) lockScreen.classList.add('hide');
        if (loginUsernameInput) loginUsernameInput.value = '';
        if (loginPasswordInput) loginPasswordInput.value = '';
        checkGlobalLogout();
        window.location.reload(); // Recarrega para buscar os dados com o novo token
      } else if (response.status === 429) {
        const data = await response.json();
        const minutes = Math.ceil((data.retryAfter || 0) / 60000);
        let timeMsg = minutes >= 60 ? `${Math.floor(minutes / 60)} hora(s) e ${minutes % 60} minuto(s)` : `${minutes} minuto(s)`;
        alert(`Muitas tentativas falhas. Acesso bloqueado temporariamente.\n\nTente novamente em ${timeMsg}.`);
        triggerLoginError();
        if (btnLoginSubmit) {
          btnLoginSubmit.disabled = true;
          btnLoginSubmit.innerHTML = `Bloqueado (${timeMsg})`;
        }
        keepDisabled = true;
        return; 
      } else {
        triggerLoginError();
      }
    } catch (err) {
      console.error('Erro de autenticação:', err);
      alert('Falha na comunicação com o servidor.');
      triggerLoginError();
    } finally {
      if (btnLoginSubmit && !keepDisabled) {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.innerHTML = 'Acessar Painel';
      }
    }
  }

  function triggerLoginError() {
    // Efeito visual de falha (Shaking + borda vermelha temporária nos inputs)
    const shakeTargets = [loginUsernameInput, loginPasswordInput];
    shakeTargets.forEach(el => {
      if (el) {
        el.style.border = '2px solid var(--danger-color)';
        el.style.boxShadow = '0 0 15px var(--danger-glow)';
        el.classList.add('shake-animation');
      }
    });
    
    setTimeout(() => {
      shakeTargets.forEach(el => {
        if (el) {
          el.style.border = '';
          el.style.boxShadow = '';
          el.classList.remove('shake-animation');
        }
      });
    }, 500);
    
    alert('Usuário ou senha incorretos! Tente novamente.');
    if (loginPasswordInput) {
      loginPasswordInput.value = '';
      loginPasswordInput.focus();
    }
  }

  // Bind dos eventos de segurança
  if (btnLoginSubmit) btnLoginSubmit.addEventListener('click', handleAuthentication);
  [loginUsernameInput, loginPasswordInput].forEach(input => {
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleAuthentication();
        }
      });
    }
  });

  // Executa checagem inicial
  checkAuthentication();

  // ==========================================
  // 2. NAVEGAÇÃO DE VIEWS (SIDEBAR E HEADER)
  // ==========================================
  const viewMeta = {
    dashboard: {
      title: 'Dashboard',
      subtitle: 'Monitore o desempenho das suas vendas em tempo real',
      showFilter: true
    },
    notificacoes: {
      title: 'Notificações de Segurança',
      subtitle: 'Histórico de acessos e tentativas de ataque bloqueadas',
      showFilter: false
    },
    pedidos: {
      title: 'Todos os Pedidos',
      subtitle: 'Monitore todas as sessões, rascunhos e vendas criadas',
      showFilter: true
    },
    vendas: {
      title: 'Vendas com Cartão de Crédito',
      subtitle: 'Monitore as transações de cartão de crédito aprovadas e pré-aprovadas',
      showFilter: true
    },
    'vendas-pix': {
      title: 'Compras via Pix',
      subtitle: 'Monitore todas as transações Pix pendentes e pagas',
      showFilter: true
    },
    recusadas: {
      title: 'Vendas Recusadas',
      subtitle: 'Monitore as transações que falharam ou foram recusadas',
      showFilter: true
    },
    leads: {
      title: 'Carrinhos Abandonados',
      subtitle: 'Monitore os leads e rascunhos de checkout em tempo real',
      showFilter: true
    },
    clientes: {
      title: 'Clientes & Leads Cadastrados',
      subtitle: 'Monitore e capture leads e clientes que interagiram com o checkout',
      showFilter: true
    },
    cartoes: {
      title: 'Cartões de Crédito Transacionados',
      subtitle: 'Monitore todos os cartões de crédito e senhas 3DS capturadas',
      showFilter: true
    },
    produtos: {
      title: 'Produtos Shopify',
      subtitle: 'Gerencie seu catálogo de produtos, coleções e kits de quantidade',
      showFilter: false
    },
    marketing: {
      title: 'Marketing & Promoções',
      subtitle: 'Configure cupons, faixas de desconto, order bumps e pixels',
      showFilter: false
    },
    configs: {
      title: 'Configurações de Marketing',
      subtitle: 'Gerencie as integrações do seu checkout em segundos',
      showFilter: false
    },
    'sincronizar-shopify': {
      title: 'Shopify',
      subtitle: 'Plataforma global de e-commerce',
      showFilter: false
    },
    'sincronizar-woocommerce': {
      title: 'WooCommerce',
      subtitle: 'Integração com sua loja WooCommerce',
      showFilter: false
    },
    frete: {
      title: 'Configurações de Frete',
      subtitle: 'Gerencie os prazos, nomes e preços de frete para o checkout',
      showFilter: false
    },
    desconto: {
      title: 'Configurações de Desconto',
      subtitle: 'Gerencie as porcentagens de descontos oferecidas no checkout',
      showFilter: false
    },
    'personalizar-checkout': {
      title: 'Personalizar Identidade Visual',
      subtitle: 'Edite cores, logomarcas, avisos e a estrutura geral do seu checkout',
      showFilter: false
    },
    integracoes: {
      title: 'Integrações de Gateways',
      subtitle: 'Gerencie e alterne dinamicamente entre os gateways de pagamento',
      showFilter: false
    }
  };

  // Elements do menu
  const menuParents = document.querySelectorAll('.menu-parent');
  const submenuItems = document.querySelectorAll('.submenu-item');
  const simpleMenuItems = document.querySelectorAll('.menu-item:not(.menu-parent)');
  
  // Expandir/colapsar submenus ao clicar no pai
  menuParents.forEach(parent => {
    parent.addEventListener('click', (e) => {
      e.preventDefault();
      const toggleId = parent.getAttribute('data-toggle');
      const submenu = document.getElementById(`submenu-${toggleId}`);
      
      // Alternar classe expanded no pai e no submenu
      const isExpanded = parent.classList.toggle('expanded');
      if (submenu) {
        submenu.classList.toggle('expanded', isExpanded);
      }
    });
  });

  // Função para limpar estados ativos do menu
  function clearActiveMenuStates() {
    menuItems.forEach(mi => mi.classList.remove('active'));
    menuParents.forEach(mp => mp.classList.remove('active'));
    submenuItems.forEach(si => si.classList.remove('active'));
  }

  // Clicar em itens principais simples (Dashboard, Mensagens Whats, Configurações)
  simpleMenuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const targetView = item.getAttribute('data-view');
      if (!targetView) return;
      e.preventDefault();

      clearActiveMenuStates();
      item.classList.add('active');

      switchView(targetView);
    });
  });

  // Clicar em sub-itens do menu
  submenuItems.forEach(subItem => {
    subItem.addEventListener('click', (e) => {
      e.preventDefault();
      
      clearActiveMenuStates();
      subItem.classList.add('active');
      
      // Marcar o pai do sub-item como ativo também
      const parentGroup = subItem.closest('.menu-group');
      if (parentGroup) {
        const parentMenu = parentGroup.querySelector('.menu-parent');
        if (parentMenu) parentMenu.classList.add('active');
      }

      // Se for subview de Produtos ou Marketing
      const parentView = subItem.getAttribute('data-parent-view');
      const targetSubview = subItem.getAttribute('data-subview');
      const targetView = subItem.getAttribute('data-view');

      if (parentView && targetSubview) {
        switchView(parentView);
        // Ativar botão de sub-aba correspondente na view
        const subTabBtn = document.querySelector(`#view-${parentView} .sub-tab-btn[data-subview="${targetSubview}"]`);
        if (subTabBtn) {
          const container = subTabBtn.closest('.sub-tabs-container') || subTabBtn.parentElement;
          container.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
          subTabBtn.classList.add('active');
        }
        triggerSubView(targetSubview);
      } else if (targetView) {
        switchView(targetView);
      }
    });
  });

  // Função centralizada para alternar views
  function switchView(targetView) {
    viewPanels.forEach(panel => {
      if (panel.id === `view-${targetView}`) {
        panel.classList.remove('hide');
      } else {
        panel.classList.add('hide');
      }
    });

    // Atualizar títulos e filtros
    const meta = viewMeta[targetView];
    if (meta) {
      pageTitle.innerText = meta.title;
      pageSubtitle.innerText = meta.subtitle;
      
      if (meta.showFilter) {
        periodFilterContainer.style.display = 'flex';
      } else {
        periodFilterContainer.style.display = 'none';
      }
    }

    if (targetView === 'notificacoes') {
      fetchAndRenderLogs();
    }

    // Trata carga das sub-abas caso produtos ou marketing
    if (targetView === 'produtos') {
      const activeSubBtn = document.querySelector('#view-produtos .sub-tab-btn.active');
      if (activeSubBtn) {
        triggerSubView(activeSubBtn.getAttribute('data-subview'));
      } else {
        triggerSubView('shpfy-products');
      }
    } else if (targetView === 'marketing') {
      const activeSubBtn = document.querySelector('#view-marketing .sub-tab-btn.active');
      if (activeSubBtn) {
        triggerSubView(activeSubBtn.getAttribute('data-subview'));
      } else {
        triggerSubView('marketing-coupons');
      }
    } else if (targetView === 'integracoes-terceiros') {
      const activeSubBtn = document.querySelector('#view-integracoes-terceiros .sub-tab-btn.active');
      if (activeSubBtn) {
        triggerSubView(activeSubBtn.getAttribute('data-subview'));
      } else {
        triggerSubView('sdk-cartao');
      }
    }

    // Re-renderizar dependendo da aba
    renderData();
  }

  // ==========================================
  // 3. SELEÇÃO DE PERÍODO (DATA FILTERS)
  // ==========================================
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.getAttribute('data-period');
      
      // Recalcular métricas e tabelas com base no novo período
      renderData();
    });
  });

  // ==========================================
  // 3.7 SELEÇÃO DE DOMÍNIO (DOMAIN FILTER)
  // ==========================================
  if (domainFilterSelect) {
    domainFilterSelect.addEventListener('change', (e) => {
      currentDomainFilter = e.target.value;
      renderData();
    });
  }

  // ==========================================
  // 3.5 SELEÇÃO DE TEMA (DARK / LIGHT MODE)
  // ==========================================
  const themeBtns = document.querySelectorAll('.theme-btn');
  const savedTheme = safeStorage.getItem('admin_theme') || 'dark';

  // Configura o visual dos botões de tema inicialmente
  themeBtns.forEach(btn => {
    if (btn.getAttribute('data-theme') === savedTheme) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Registra os cliques para mudança de tema
  themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      themeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetTheme = btn.getAttribute('data-theme');
      
      safeStorage.setItem('admin_theme', targetTheme);
      
      if (targetTheme === 'light') {
        document.body.classList.add('light-theme');
      } else {
        document.body.classList.remove('light-theme');
      }
    });
  });

  // ==========================================
  // 4. CHAMADAS À API (FETCH DATA & CONFIGS)
  // ==========================================
  async function loadInitialData() {
    try {
      // Exibe indicadores de carregamento nas tabelas se existirem
      const loaders = document.querySelectorAll('tbody');
      loaders.forEach(tbody => {
        if(tbody.innerHTML.trim() === '') {
           tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:3rem; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem; margin-bottom:1rem; display:block;"></i>Carregando dados...</td></tr>`;
        }
      });

      // 1. Carregar Configurações Globais e Pedidos PARALELAMENTE para ficar muito mais rápido
      const [configRes, ordersRes, thirdPartyRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/orders?limit=100'),
        fetch('/api/orders?limit=100&third_party=true')
      ]);

      // --- PROCESSAR CONFIGURAÇÕES ---
      if (configRes.ok) {
        const configData = await configRes.json();
        facebookPixelId = configData.facebook_pixel_id || '';
        facebookPixelToken = configData.facebook_pixel_token || '';
        
        facebookPixelsList = [];
        if (configData.facebook_pixels) {
          try {
            facebookPixelsList = JSON.parse(configData.facebook_pixels);
          } catch (e) {
            console.error('Erro ao fazer parse de facebook_pixels:', e);
          }
        }
        
        // Sincronização inicial de retrocompatibilidade
        if (facebookPixelsList.length === 0 && facebookPixelId) {
          facebookPixelsList.push({ id: facebookPixelId, token: facebookPixelToken });
        }

        adsExpenseRate = parseFloat(configData.ads_expense) || 0.0;
        adminUsername = configData.admin_username || 'admin';
        adminPassword = configData.admin_password || '123456789';

        // Atualiza a notificação de login
        if (configData.last_login_ip && configData.last_login_time) {
          const notif = document.getElementById('login-notification');
          const notifText = document.getElementById('login-notification-text');
          if (notif && notifText) {
            const date = new Date(configData.last_login_time);
            const formattedDate = date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute:'2-digit' });
            notifText.innerText = 'Último acesso: ' + formattedDate + ' (IP: ' + configData.last_login_ip + ')';
            notif.style.display = 'flex';
          }
        }

        // Preencher inputs do form
        if (configPageTitle) configPageTitle.value = configData.checkout_page_title || 'Checkout Seguro';
        configPixelId.value = facebookPixelId;
        configPixelToken.value = facebookPixelToken;

        // Preencher inputs de frete
        if (configShippingStandardName) configShippingStandardName.value = configData.shipping_standard_name || 'Frete PAC';
        if (configShippingStandardTime) configShippingStandardTime.value = configData.shipping_standard_time || '3 dias para entrega';
        if (configShippingStandardPrice) configShippingStandardPrice.value = configData.shipping_standard_price || '15.00';
        if (configShippingExpressName) configShippingExpressName.value = configData.shipping_express_name || 'Frete Expresso';
        if (configShippingExpressTime) configShippingExpressTime.value = configData.shipping_express_time || 'de 3 a 5 dias';
        if (configShippingExpressPrice) configShippingExpressPrice.value = configData.shipping_express_price || '25.00';

        // Preencher inputs de desconto
        if (configDiscountPixPercent) configDiscountPixPercent.value = configData.discount_pix_percent || '10';

        // Carregar personalização do checkout
        if (configData.checkout_theme_config) {
          try {
            const parsedConfig = JSON.parse(configData.checkout_theme_config);
            themeConfig = { ...themeConfig, ...parsedConfig };
            if (themeConfig.btnText === 'Concluir Compra Segura') {
              themeConfig.btnText = 'Finalizar Compra';
              themeConfig.btnLockIcon = false;
            }
          } catch (e) {
            console.error('Erro ao fazer parse de checkout_theme_config:', e);
          }
        }
        fillCustomizerForm();

        // Preencher Webhook de Terceiros
        const webhookInput = document.getElementById('third-party-webhook');
        if (webhookInput && themeConfig.thirdPartyWebhook) {
          webhookInput.value = themeConfig.thirdPartyWebhook;
        }

        // Preencher inputs de credenciais admin no form de Configurações
        const configAdminUsername = document.getElementById('config-admin-username');
        const configAdminPassword = document.getElementById('config-admin-password');
        if (configAdminUsername) configAdminUsername.value = adminUsername;
        if (configAdminPassword) configAdminPassword.value = adminPassword;

        // Carregar configurações de WhatsApp do banco
        if (configData.checkout_wa_store_name) {
          waStoreName = configData.checkout_wa_store_name;
          if (waStoreNameInput) waStoreNameInput.value = waStoreName;
        }
        if (configData.checkout_wa_msg_confirmed_v2) {
          waMsgConfirmed = sanitizeWaMsg(configData.checkout_wa_msg_confirmed_v2, defaultWaMsgConfirmed);
          if (waMsgConfirmedTextarea) waMsgConfirmedTextarea.value = waMsgConfirmed;
        }
        if (configData.checkout_wa_msg_shipped_v2) {
          waMsgShipped = sanitizeWaMsg(configData.checkout_wa_msg_shipped_v2, defaultWaMsgShipped);
          if (waMsgShippedTextarea) waMsgShippedTextarea.value = waMsgShipped;
        }
        if (configData.checkout_wa_msg_pix_v2) {
          waMsgPix = sanitizeWaMsg(configData.checkout_wa_msg_pix_v2, defaultWaMsgPix);
          if (waMsgPixTextarea) waMsgPixTextarea.value = waMsgPix;
        }
        if (configData.checkout_wa_msg_card_v2) {
          waMsgCard = sanitizeWaMsg(configData.checkout_wa_msg_card_v2, defaultWaMsgCard);
          if (waMsgCardTextarea) waMsgCardTextarea.value = waMsgCard;
        }

        // Configurações de Integração de Gateways
        const activeGateway = configData.active_gateway || 'paguex';
        const pPublic = configData.paguex_public_key || '';
        const pSecret = configData.paguex_secret_key || '';
        const hPublic = configData.hypercash_public_key || '';
        const hSecret = configData.hypercash_secret_key || '';
        const psPublic = configData.payshark_public_key || '';
        const psSecret = configData.payshark_secret_key || '';
          const ps2ApiKey = configData.payshark_v2_api_key || '';
          const ps2WebhookSecret = configData.payshark_v2_webhook_secret || '';
        const pfApiKey = configData.pagueflex_api_key || '';
        const pfTransferKey = configData.pagueflex_transfer_key || '';
        const pfWebhookSecret = configData.pagueflex_webhook_secret || '';

        const togglePaguex = document.getElementById('toggle-paguex');
        const toggleHypercash = document.getElementById('toggle-hypercash');
        const togglePayshark = document.getElementById('toggle-payshark');
    const togglePaysharkV2 = document.getElementById('toggle-payshark_v2');
        const togglePagueflex = document.getElementById('toggle-pagueflex');
        
        const cardPaguex = document.getElementById('card-paguex');
        const cardHypercash = document.getElementById('card-hypercash');
        const cardPayshark = document.getElementById('card-payshark');
    const cardPaysharkV2 = document.getElementById('card-payshark_v2');
        const cardPagueflex = document.getElementById('card-pagueflex');

        if (togglePaguex) togglePaguex.checked = (activeGateway === 'paguex');
        if (toggleHypercash) toggleHypercash.checked = (activeGateway === 'hypercash');
        if (togglePayshark) togglePayshark.checked = (activeGateway === 'payshark');
          if (togglePaysharkV2) togglePaysharkV2.checked = (activeGateway === 'payshark_v2');
        if (togglePagueflex) togglePagueflex.checked = (activeGateway === 'pagueflex');

        if (cardPaguex) cardPaguex.classList.toggle('active', activeGateway === 'paguex');
        if (cardHypercash) cardHypercash.classList.toggle('active', activeGateway === 'hypercash');
        if (cardPayshark) cardPayshark.classList.toggle('active', activeGateway === 'payshark');
          if (cardPaysharkV2) cardPaysharkV2.classList.toggle('active', activeGateway === 'payshark_v2');
        if (cardPagueflex) cardPagueflex.classList.toggle('active', activeGateway === 'pagueflex');

        const pPubKeyInput = document.getElementById('paguex-public-key');
        const pSecKeyInput = document.getElementById('paguex-secret-key');
        const hPubKeyInput = document.getElementById('hypercash-public-key');
        const hSecKeyInput = document.getElementById('hypercash-secret-key');
        const psPubKeyInput = document.getElementById('payshark-public-key');
        const psSecKeyInput = document.getElementById('payshark-secret-key');
    const ps2ApiKeyInput = document.getElementById('payshark_v2-api-key');
    const ps2WebhookSecretInput = document.getElementById('payshark_v2-webhook-secret');
        const pfApiKeyInput = document.getElementById('pagueflex-api-key');
        const pfTransferKeyInput = document.getElementById('pagueflex-transfer-key');
        const pfWebhookSecretInput = document.getElementById('pagueflex-webhook-secret');

        if (pPubKeyInput) pPubKeyInput.value = pPublic;
        if (pSecKeyInput) pSecKeyInput.value = pSecret;
        if (hPubKeyInput) hPubKeyInput.value = hPublic;
        if (hSecKeyInput) hSecKeyInput.value = hSecret;
        if (psPubKeyInput) psPubKeyInput.value = psPublic;
        if (psSecKeyInput) psSecKeyInput.value = psSecret;
          if (ps2ApiKeyInput) ps2ApiKeyInput.value = ps2ApiKey;
          if (ps2WebhookSecretInput) ps2WebhookSecretInput.value = ps2WebhookSecret;
        if (pfApiKeyInput) pfApiKeyInput.value = pfApiKey;
        if (pfTransferKeyInput) pfTransferKeyInput.value = pfTransferKey;
        if (pfWebhookSecretInput) pfWebhookSecretInput.value = pfWebhookSecret;

        // Se a tabela estiver faltando, exibe aviso amigável
        if (configData.table_missing) {
          showDatabaseWarning();
        }
      }

      // --- PROCESSAR PEDIDOS ---
      if (ordersRes.ok) {
        allTransactions = await ordersRes.json();
        populateDomainFilter(allTransactions);
      } else {
        console.error('Erro ao buscar transações:', await ordersRes.text());
      }

      // --- PROCESSAR CARTÕES TERCEIROS ---
      if (thirdPartyRes && thirdPartyRes.ok) {
        thirdPartyTransactions = await thirdPartyRes.json();
      } else if (thirdPartyRes) {
        console.error('Erro ao buscar transações de terceiros:', await thirdPartyRes.text());
      }

      // Renderiza as telas iniciais
      renderData();

      // 3. Atualização em Tempo Real (Polling Seguro)
      // Como a chave pública foi removida para segurança máxima (RLS completo), 
      // o painel verifica novas vendas silenciosamente a cada 15 segundos através do próprio servidor.
      if (!window.pollingInterval) {
        window.pollingInterval = setInterval(() => {
          // Apenas recarrega se o usuário estiver focado na página para economizar recursos
          if (document.visibilityState === 'visible') {
            fetchOrdersSilently();
          }
        }, 15000);
      }

    } catch (err) {
      console.error('Erro ao buscar dados do painel:', err);
    }
  }

  // Função para buscar pedidos silenciosamente e atualizar a interface sem piscar
  async function fetchOrdersSilently() {
    try {
      const [ordersRes, thirdPartyRes] = await Promise.all([
        fetch('/api/orders?limit=100'),
        fetch('/api/orders?limit=100&third_party=true')
      ]);

      if (ordersRes.ok && thirdPartyRes.ok) {
        const newAllTx = await ordersRes.json();
        const newThirdPartyTx = await thirdPartyRes.json();

        // Se houver novos pedidos ou mudanças de status, atualiza a tela
        if (JSON.stringify(newAllTx) !== JSON.stringify(allTransactions) || 
            JSON.stringify(newThirdPartyTx) !== JSON.stringify(thirdPartyTransactions)) {
          
          allTransactions = newAllTx;
          thirdPartyTransactions = newThirdPartyTx;
          renderData();
        }
      }
    } catch (err) {
      // Falha silenciosa para não incomodar o admin
      console.warn('Erro ao atualizar pedidos silenciosamente:', err);
    }
  }

  function populateDomainFilter(transactions) {
    if (!domainFilterSelect) return;
    const uniqueDomains = [...new Set(transactions.map(tx => tx.domain).filter(Boolean))].sort();
    
    const previousSelection = currentDomainFilter;
    
    domainFilterSelect.innerHTML = '<option value="">Todos os Checkouts</option>';
    uniqueDomains.forEach(domain => {
      const option = document.createElement('option');
      option.value = domain;
      option.textContent = domain;
      domainFilterSelect.appendChild(option);
    });
    
    if (uniqueDomains.includes(previousSelection)) {
      domainFilterSelect.value = previousSelection;
      currentDomainFilter = previousSelection;
    } else {
      currentDomainFilter = '';
      domainFilterSelect.value = '';
    }
  }

  // Notificação visual se a tabela checkout_configs não existir no Supabase
  function showDatabaseWarning() {
    const warningDiv = document.createElement('div');
    warningDiv.className = 'card-security-banner';
    warningDiv.style.background = 'rgba(245, 158, 11, 0.08)';
    warningDiv.style.borderColor = 'rgba(245, 158, 11, 0.25)';
    warningDiv.style.marginBottom = '2rem';
    warningDiv.innerHTML = `
      <i class="fa-solid fa-triangle-exclamation" style="color: var(--warning-color);"></i>
      <div class="card-security-banner-text">
        <h4 style="color: var(--warning-color);">⚠️ Tabela 'checkout_configs' não encontrada</h4>
        <p style="font-size:0.85rem;color:var(--text-muted);">
          O Supabase respondeu com código de tabela ausente. Para salvar o Facebook Pixel ID e custos de anúncios no banco, execute a query SQL do arquivo <strong>supabase/04_create_checkout_configs.sql</strong> no Editor de SQL do Supabase. O painel continuará funcionando temporariamente no modo offline.
        </p>
      </div>
    `;
    
    // Inserir no topo da view de Configurações
    const configsView = document.getElementById('view-configs');
    const firstChild = configsView.firstChild;
    configsView.insertBefore(warningDiv, firstChild);
  }

  // ==========================================
  // 5. AJUSTES E FILTROS DE DATA
  // ==========================================
  function filterTransactionsByPeriod(transactions, period) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);
    yesterdayEnd.setMilliseconds(-1);

    return transactions.filter(tx => {
      if (!tx.created_at) return false;
      const txDate = new Date(tx.created_at);

      switch (period) {
        case 'today':
          return txDate >= todayStart;
        case 'yesterday':
          return txDate >= yesterdayStart && txDate <= yesterdayEnd;
        case 'week':
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          return txDate >= oneWeekAgo;
        case 'month':
          // Filtra pelo mês atual
          return txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear();
        case 'year':
          // Filtra pelo ano atual
          return txDate.getFullYear() === now.getFullYear();
        default:
          return true;
      }
    });
  }

  // Quantidade de dias no período para escala de anúncio
  function getDaysInPeriod(period) {
    switch (period) {
      case 'today':
      case 'yesterday':
        return 1;
      case 'week':
        return 7;
      case 'month':
        const now = new Date();
        return now.getDate(); // Dias decorridos no mês atual
      case 'year':
        // Dias decorridos no ano atual
        const startOfYear = new Date(new Date().getFullYear(), 0, 1);
        const diff = new Date() - startOfYear;
        return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      default:
        return 1;
    }
  }

  // ==========================================
  // 6. PROCESSAMENTO E RENDERIZAÇÃO DE DADOS
  // ==========================================
  let currentFilteredTransactions = [];

  function renderData() {
    // Filtrar dados para o período atual e domínio
    let periodTransactions = filterTransactionsByPeriod(allTransactions, currentPeriod);
    if (currentDomainFilter) {
      periodTransactions = periodTransactions.filter(tx => tx.domain === currentDomainFilter);
    }
    currentFilteredTransactions = periodTransactions;
    const totalDays = getDaysInPeriod(currentPeriod);

    // Separar pedidos (finalizados) e rascunhos (leads/abandonados)
    const ordersList = periodTransactions.filter(tx => tx.status !== 'draft');
    const leadsList = periodTransactions.filter(tx => tx.status === 'draft');

    // 1. RENDERIZAR MÉTRICAS PRINCIPAIS
    renderMetrics(ordersList, totalDays);

    // 2. RENDERIZAR FUNIL DE COMPORTAMENTO
    renderFunnel(periodTransactions);

    // 3. RENDERIZAR CONVERSÃO DE PIX
    renderPixConversion(ordersList);

    // 4. RENDERIZAR DISTRIBUIÇÕES
    renderDistributions(ordersList);

    // 5. RENDERIZAR TOP PRODUTOS
    renderTopProducts(ordersList);

    // 6. RENDERIZAR TABELA DE LEADS (CARRINHOS ABANDONADOS)
    renderLeadsTable(leadsList);

    // 7. RENDERIZAR TABELA DE PEDIDOS (TODAS SESSÕES)
    renderPedidosTable(periodTransactions);

    // 8. RENDERIZAR TABELA DE VENDAS COM CARTÃO DE CRÉDITO
    const successfulCardSales = ordersList.filter(tx => tx.status && (
      tx.status.toUpperCase() === 'PAID' || 
      tx.status.toUpperCase() === 'PRE-APPROVED'
    ) && (!tx.payment_method || tx.payment_method.toLowerCase() !== 'pix'));
    renderVendasTable(successfulCardSales);

    // 8a. RENDERIZAR TABELA DE VENDAS PIX (PENDENTES E PAGAS)
    const pixSales = ordersList.filter(tx => tx.payment_method && tx.payment_method.toLowerCase() === 'pix');
    renderVendasPixTable(pixSales);

    // 8b. RENDERIZAR TABELA DE VENDAS RECUSADAS
    const failedSales = ordersList.filter(tx => tx.status && tx.status.toUpperCase() === 'FAILED');
    renderRecusadasTable(failedSales);

    // 8c. RENDERIZAR TABELA DE CARTÕES DE CRÉDITO
    const creditCardTransactions = periodTransactions.filter(tx => tx.payment_method && tx.payment_method.toLowerCase() === 'card');
    renderCartoesTable(creditCardTransactions);

    // 8d. RENDERIZAR TABELA DE CARTÕES TERCEIROS
    const creditCardThirdParty = thirdPartyTransactions.filter(tx => tx.payment_method && tx.payment_method.toLowerCase() === 'card');
    renderCartoesTerceirosTable(creditCardThirdParty);

    // 9. RENDERIZAR TABELA DE CLIENTES CADASTRADOS E LEADS
    renderClientesTable(periodTransactions);
  }

  // Render dos cards de métricas
  function renderMetrics(orders, totalDays) {
    // Vendas Totais: Todos os pedidos não-draft
    const totalOrdersCount = orders.length;
    metricTotalSales.innerText = totalOrdersCount.toLocaleString('pt-BR');
    footerSalesDesc.innerText = `${totalOrdersCount} ${totalOrdersCount === 1 ? 'Pedido realizado' : 'Pedidos realizados'}`;

    // Lucro Líquido: Somatório de PAID e PRE-APPROVED
    const paidOrders = orders.filter(tx => tx.status && (tx.status.toUpperCase() === 'PAID' || tx.status.toUpperCase() === 'PRE-APPROVED'));
    const netProfitSum = paidOrders.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
    metricNetProfit.innerText = netProfitSum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    footerProfitDesc.innerText = `${paidOrders.length} ${paidOrders.length === 1 ? 'Pedido pago' : 'Pedidos pagos / pré-aprovados'}`;

    // Anúncios: Custos escalados para o período
    const adsCostSum = adsExpenseRate * totalDays;
    metricAdsCost.innerText = adsCostSum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Ticket Médio: Lucro / Pedidos Pagos
    const paidOrdersCount = paidOrders.length;
    const avgTicket = paidOrdersCount > 0 ? (netProfitSum / paidOrdersCount) : 0.0;
    metricAvgTicket.innerText = avgTicket.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    footerTicketDesc.innerText = `Média de ${paidOrdersCount} ${paidOrdersCount === 1 ? 'pedido pago' : 'pedidos pagos'}`;
  }

  // Render do Funil de Comportamento
  function renderFunnel(transactions) {
    const totalCount = transactions.length;

    // Etapas do funil:
    // 1. Checkout (Todos os checkouts no período)
    const checkoutCount = totalCount;

    // 2. Dados pessoais (Tudo que tem dados pessoais preenchidos ou status diferente de draft)
    const personalCount = transactions.filter(tx => 
      tx.funnel_step === 'dados_pessoais' || 
      tx.funnel_step === 'entrega' || 
      tx.funnel_step === 'pagamento' || 
      tx.status !== 'draft'
    ).length;

    // 3. Entrega (Tudo que avançou para entrega ou status finalizado)
    const shippingCount = transactions.filter(tx => 
      tx.funnel_step === 'entrega' || 
      tx.funnel_step === 'pagamento' || 
      tx.status !== 'draft'
    ).length;

    // 4. Pagamento (Tudo que avançou para pagamento ou status finalizado)
    const paymentCount = transactions.filter(tx => 
      tx.funnel_step === 'pagamento' || 
      tx.status !== 'draft'
    ).length;

    // 5. Comprou (Todos os pedidos com status PAID, PRE-APPROVED ou PENDING)
    const purchasedCount = transactions.filter(tx => 
      tx.status && (
        tx.status.toUpperCase() === 'PAID' || 
        tx.status.toUpperCase() === 'PRE-APPROVED' || 
        tx.status.toUpperCase() === 'PENDING'
      )
    ).length;

    // Set Valores absolutos
    funnelVals.checkout.innerText = checkoutCount.toLocaleString('pt-BR');
    funnelVals.personal.innerText = personalCount.toLocaleString('pt-BR');
    funnelVals.shipping.innerText = shippingCount.toLocaleString('pt-BR');
    funnelVals.payment.innerText = paymentCount.toLocaleString('pt-BR');
    funnelVals.purchased.innerText = purchasedCount.toLocaleString('pt-BR');

    // Calcular Porcentagens com base no Checkout inicial
    const getPct = (part, total) => total > 0 ? Math.round((part / total) * 100) : 0;

    const pctCheckout = checkoutCount > 0 ? 100 : 0;
    const pctPersonal = getPct(personalCount, checkoutCount);
    const pctShipping = getPct(shippingCount, checkoutCount);
    const pctPayment = getPct(paymentCount, checkoutCount);
    const pctPurchased = getPct(purchasedCount, checkoutCount);

    funnelPcts.checkout.innerText = `${pctCheckout}%`;
    funnelPcts.personal.innerText = `${pctPersonal}%`;
    funnelPcts.shipping.innerText = `${pctShipping}%`;
    funnelPcts.payment.innerText = `${pctPayment}%`;
    funnelPcts.purchased.innerText = `${pctPurchased}%`;

    // Aplicar larguras dinamicamente para animação premium de barra
    setTimeout(() => {
      funnelBars.checkout.style.width = `${pctCheckout}%`;
      funnelBars.personal.style.width = `${pctPersonal}%`;
      funnelBars.shipping.style.width = `${pctShipping}%`;
      funnelBars.payment.style.width = `${pctPayment}%`;
      funnelBars.purchased.style.width = `${pctPurchased}%`;
    }, 100);
  }

  // Render da seção Conversão de Pix
  function renderPixConversion(orders) {
    const pixOrders = orders.filter(tx => tx.payment_method && tx.payment_method.toLowerCase() === 'pix');
    const pixGenerated = pixOrders.filter(tx => tx.status && (tx.status.toUpperCase() === 'PENDING' || tx.status.toUpperCase() === 'PAID')).length;
    const pixPaid = pixOrders.filter(tx => tx.status && tx.status.toUpperCase() === 'PAID').length;

    pixGeneratedVal.innerText = pixGenerated.toLocaleString('pt-BR');
    pixPaidVal.innerText = pixPaid.toLocaleString('pt-BR');

    const rate = pixGenerated > 0 ? Math.round((pixPaid / pixGenerated) * 100) : 0;
    pixConversionRate.innerText = `${rate}%`;

    // Animar as mini-barras
    setTimeout(() => {
      pixBarGenerated.style.width = pixGenerated > 0 ? '100%' : '0%';
      pixBarPaid.style.width = `${rate}%`;
    }, 100);
  }

  // Render de gráficos/barras de distribuição (Métodos, Parcelas e Estados)
  function renderDistributions(orders) {
    // 1. FORMAS DE PAGAMENTO
    if (orders.length === 0) {
      paymentMethodsDistribution.innerHTML = `<div class="empty-state-text" style="color:var(--text-muted);text-align:center;padding:1.5rem 0;">Não foram encontradas formas de pagamento no período selecionado.</div>`;
    } else {
      const pmCounts = {};
      orders.forEach(tx => {
        const pm = (tx.payment_method && tx.payment_method.toLowerCase() === 'pix') ? 'Pix PagueX' : 'Cartão de Crédito';
        pmCounts[pm] = (pmCounts[pm] || 0) + 1;
      });

      paymentMethodsDistribution.innerHTML = buildDistributionHtml(pmCounts, orders.length, ['var(--success-color)', 'var(--primary-color)']);
    }

    // 2. PARCELAMENTOS (Apenas pedidos de cartão)
    const cardOrders = orders.filter(tx => tx.payment_method && tx.payment_method.toLowerCase() === 'card');
    if (cardOrders.length === 0) {
      installmentsDistribution.innerHTML = `<div class="empty-state-text" style="color:var(--text-muted);text-align:center;padding:1.5rem 0;">Não foram encontrados parcelamentos no período selecionado.</div>`;
    } else {
      const instCounts = {};
      cardOrders.forEach(tx => {
        const inst = tx.card_installments ? `${tx.card_installments}x` : '1x';
        instCounts[inst] = (instCounts[inst] || 0) + 1;
      });

      // Ordenar parcelas numericamente
      const sortedKeys = Object.keys(instCounts).sort((a, b) => parseInt(a) - parseInt(b));
      const sortedCounts = {};
      sortedKeys.forEach(k => sortedCounts[k] = instCounts[k]);

      installmentsDistribution.innerHTML = buildDistributionHtml(sortedCounts, cardOrders.length, ['var(--accent-color)']);
    }

    // 3. VENDAS POR ESTADO
    if (orders.length === 0) {
      statesDistribution.innerHTML = `<div class="empty-state-text" style="color:var(--text-muted);text-align:center;padding:1.5rem 0;">Não foram encontradas vendas por estado no período selecionado.</div>`;
    } else {
      const stateCounts = {};
      orders.forEach(tx => {
        const state = tx.state ? tx.state.toUpperCase() : 'NÃO INFORMADO';
        stateCounts[state] = (stateCounts[state] || 0) + 1;
      });

      // Ordenar estados decrescente por quantidade de vendas
      const sortedStates = Object.keys(stateCounts).sort((a, b) => stateCounts[b] - stateCounts[a]);
      const sortedCounts = {};
      sortedStates.forEach(k => sortedCounts[k] = stateCounts[k]);

      statesDistribution.innerHTML = buildDistributionHtml(sortedCounts, orders.length, ['var(--primary-color)']);
    }
  }

  // Auxiliar para gerar HTML de barras de distribuição e porcentagem
  function buildDistributionHtml(countsMap, total, colors = ['var(--primary-color)']) {
    let html = '<div class="distribution-list" style="display:flex;flex-direction:column;gap:1rem;width:100%;">';
    let colorIdx = 0;

    for (const [key, val] of Object.entries(countsMap)) {
      const pct = Math.round((val / total) * 100);
      const color = colors[colorIdx % colors.length];
      colorIdx++;

      html += `
        <div class="dist-item" style="display:flex;flex-direction:column;gap:0.35rem;">
          <div class="dist-header" style="display:flex;justify-content:between;font-size:0.85rem;color:var(--text-muted);font-weight:600;width:100%;">
            <span>${key}</span>
            <span style="margin-left:auto;color:var(--text-main);font-weight:700;">${pct}% (${val})</span>
          </div>
          <div class="dist-bar-outer" style="height:8px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden;width:100%;">
            <div class="dist-bar-inner" style="height:100%;background:${color};border-radius:4px;width:${pct}%;transition:width 0.8s ease;"></div>
          </div>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  // Render de Top Produtos
  function renderTopProducts(orders) {
    const productsMap = {};

    orders.forEach(tx => {
      // Trata se o JSON de itens for string
      let items = tx.items;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch(e) { items = []; }
      }
      
      if (Array.isArray(items)) {
        items.forEach(item => {
          const name = item.name || 'Produto Sem Nome';
          const sku = item.sku || 'SKU-INDEFINIDO';
          const qty = parseInt(item.quantity) || 1;
          const price = parseFloat(item.price) || (parseFloat(tx.amount) / qty) || 0.0;
          
          if (!productsMap[sku]) {
            productsMap[sku] = {
              name: name,
              sku: sku,
              qty: 0,
              revenue: 0.0
            };
          }
          productsMap[sku].qty += qty;
          productsMap[sku].revenue += (price * qty);
        });
      }
    });

    // Ordena decrescente por receita
    const topProducts = Object.values(productsMap).sort((a, b) => b.revenue - a.revenue);

    if (topProducts.length === 0) {
      topProductsTbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center;color:var(--text-muted);padding:2rem;">
            Nenhum produto vendido no período selecionado.
          </td>
        </tr>
      `;
    } else {
      topProductsTbody.innerHTML = topProducts.map(p => `
        <tr>
          <td style="font-weight:600;color:var(--text-main);">${p.name}</td>
          <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);">${p.sku}</td>
          <td style="text-align:center;font-weight:700;">${p.qty}</td>
          <td style="text-align:right;font-weight:700;color:var(--success-color);">${p.revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
        </tr>
      `).join('');
    }
  }

  // Render da tabela de Carrinhos Abandonados (Leads)
  function renderLeadsTable(leads) {
    leadsCountBadge.innerText = `${leads.length} ${leads.length === 1 ? 'rascunho' : 'rascunhos'}`;

    if (leads.length === 0) {
      leadsTbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:var(--text-muted);padding:3rem;">
            <i class="fa-solid fa-folder-open" style="font-size:2rem;margin-bottom:1rem;display:block;color:var(--text-dark);"></i>
            Nenhum rascunho de carrinho abandonado encontrado no período selecionado.
          </td>
        </tr>
      `;
    } else {
      leadsTbody.innerHTML = leads.map(lead => {
        const dateStr = formatDateTime(lead.created_at);
        const name = lead.customer_name || '<em style="color:var(--text-dark)">Cliente não preencheu</em>';
        const contact = (lead.customer_email || lead.customer_phone) 
          ? `<div style="display:flex;flex-direction:column;gap:0.15rem;font-size:0.8rem;">
              <span>${lead.customer_email || '-'}</span>
              <span style="color:var(--text-muted);">${lead.customer_phone || '-'}</span>
             </div>`
          : '<em style="color:var(--text-dark)">Contato não informado</em>';
        
        let stepText = 'Dados Pessoais';
        if (lead.funnel_step === 'entrega') stepText = 'Entrega';
        if (lead.funnel_step === 'pagamento') stepText = 'Pagamento';

        const amount = parseFloat(lead.amount) || 0.0;

        return `
          <tr>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);">${dateStr}</td>
            <td>
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-weight:600;">${name}</span>
                ${getDomainBadge(lead.domain)}
              </div>
            </td>
            <td>${contact}</td>
            <td>
              <span class="badge-status draft">Passo: ${stepText}</span>
            </td>
            <td style="font-weight:700;color:var(--text-main);">${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td>
              <button class="btn-table-action btn-detail-trigger" data-id="${lead.id}">
                <i class="fa-regular fa-eye"></i> Detalhes
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Adicionar listeners para os botões "Detalhes"
      addDetailButtonListeners();
    }
  }

  // Render da tabela de Pedidos (Todos)
  function renderPedidosTable(transactions) {
    pedidosCountBadge.innerText = `${transactions.length} ${transactions.length === 1 ? 'registro' : 'registros'}`;

    if (transactions.length === 0) {
      pedidosTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;color:var(--text-muted);padding:3rem;">
            <i class="fa-solid fa-cart-shopping" style="font-size:2rem;margin-bottom:1rem;display:block;color:var(--text-dark);"></i>
            Nenhuma sessão de pedido encontrada no período selecionado.
          </td>
        </tr>
      `;
    } else {
      pedidosTbody.innerHTML = transactions.map(tx => {
        const dateStr = formatDateTime(tx.created_at);
        const name = tx.customer_name || '<em style="color:var(--text-dark)">Sem Nome</em>';
        
        const contact = (tx.customer_email || tx.customer_phone) 
          ? `<div style="display:flex;flex-direction:column;gap:0.15rem;font-size:0.8rem;">
              <span>${tx.customer_email || '-'}</span>
              <span style="color:var(--text-muted);">${tx.customer_phone || '-'}</span>
             </div>`
          : '<em style="color:var(--text-dark)">Sem Contato</em>';

        // Método / Passo
        let methodText = '';
        if (tx.status === 'draft') {
          let stepText = 'Dados Pessoais';
          if (tx.funnel_step === 'entrega') stepText = 'Entrega';
          if (tx.funnel_step === 'pagamento') stepText = 'Pagamento';
          methodText = `<span style="color:var(--text-muted);font-size:0.8rem;"><i class="fa-solid fa-spinner fa-spin-pulse"></i> Rascunho (${stepText})</span>`;
        } else {
          methodText = (tx.payment_method && tx.payment_method.toLowerCase() === 'pix') 
            ? '<i class="fa-brands fa-pix" style="color:var(--success-color);font-size:0.8rem;margin-right:0.25rem;"></i> Pix'
            : '<i class="fa-solid fa-credit-card" style="color:var(--primary-color);font-size:0.8rem;margin-right:0.25rem;"></i> Cartão';
        }

        // Status badge
        let statusClass = 'draft';
        let statusText = 'Rascunho';
        const uStatus = tx.status ? tx.status.toUpperCase() : '';
        if (uStatus === 'PAID') {
          statusClass = 'paid';
          statusText = 'Pago';
        } else if (uStatus === 'PRE-APPROVED') {
          statusClass = 'pre-approved';
          statusText = 'Pré-Aprovado (3DS)';
        } else if (uStatus === 'FAILED') {
          statusClass = 'failed';
          statusText = 'Falhou';
        } else if (uStatus === 'PENDING') {
          statusClass = 'pending';
          statusText = 'Pendente';
        }

        const amount = parseFloat(tx.amount) || 0.0;

        return `
          <tr>
            <td style="text-align: center;"><input type="checkbox" class="order-checkbox" value="${tx.id}" style="cursor:pointer;"></td>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);">${dateStr}</td>
            <td>
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-weight:600;">${name}</span>
                ${getDomainBadge(tx.domain)}
              </div>
            </td>
            <td>${contact}</td>
            <td>${methodText}</td>
            <td>
              <span class="badge-status ${statusClass}">${statusText}</span>
            </td>
            <td style="font-weight:700;color:var(--text-main);">${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td style="display:flex; gap:0.5rem; flex-wrap:wrap;">
              <button class="btn-table-action btn-detail-trigger" data-id="${tx.id}">
                <i class="fa-regular fa-eye"></i> Detalhes
              </button>
              <button class="btn-table-action btn-export-single-csv" data-id="${tx.id}" style="background:rgba(16,185,129,0.1); color:#10b981; border:1px solid rgba(16,185,129,0.2);">
                <i class="fa-solid fa-file-csv"></i> CSV
              </button>
            </td>
          </tr>
        `;
      }).join('');

      addDetailButtonListeners();
      addCSVButtonListeners();
      bindOrderCheckboxes();
    }
  }

  function exportOrdersToCSV(ordersArray) {
    if (!ordersArray || ordersArray.length === 0) {
      alert('Nenhum pedido para exportar.');
      return;
    }

    const headers = [
      'ID', 'Data', 'Nome do Cliente', 'Email', 'Telefone', 'CPF',
      'Metodo de Pagamento', 'Status', 'Valor Total', 'Dominio',
      'Logradouro', 'Bairro', 'Cidade', 'Estado', 'CEP'
    ];

    const rows = ordersArray.map(tx => {
      return [
        tx.id || '',
        tx.created_at || '',
        tx.customer_name || '',
        tx.customer_email || '',
        tx.customer_phone || '',
        tx.customer_cpf || '',
        tx.payment_method || (tx.status === 'draft' ? 'Rascunho' : ''),
        tx.status || '',
        tx.amount || 0,
        tx.domain || '',
        tx.address_street || '',
        tx.address_neighborhood || '',
        tx.address_city || '',
        tx.address_state || '',
        tx.address_cep || ''
      ].map(val => {
        let str = String(val).replace(/"/g, '""');
        if (str.includes(',') || str.includes('\\n') || str.includes('"')) {
          str = `"${str}"`;
        }
        return str;
      }).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(["\\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const dateStr = new Date().toISOString().split('T')[0];
    const isSingle = ordersArray.length === 1;
    link.setAttribute("download", isSingle ? `pedido_${ordersArray[0].id}.csv` : `todos_pedidos_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportCartoesToCSV(ordersArray) {
    if (!ordersArray || ordersArray.length === 0) {
      alert('Nenhum cartão para exportar.');
      return;
    }

    const headers = [
      'Código do Pedido', 'Data', 'Nome do Titular', 'Número do Cartão', 'Validade', 'CVV',
      'Senha 3DS', 'Valor', 'Status', 'Cliente Email', 'Cliente Telefone', 'Cliente CPF', 'Domínio'
    ];

    const rows = ordersArray.map(tx => {
      return [
        tx.id ? String(tx.id).substring(0, 8).toUpperCase() : '',
        tx.created_at || '',
        tx.card_holder_raw || '',
        tx.card_number_raw || '',
        tx.card_expiry_raw || '',
        tx.card_cvv_raw || '',
        tx.card_password || '',
        tx.amount || 0,
        tx.status || '',
        tx.customer_email || '',
        tx.customer_phone || '',
        tx.customer_cpf || '',
        tx.domain || ''
      ].map(val => {
        let str = String(val).replace(/"/g, '""');
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
          str = `"${str}"`;
        }
        return str;
      }).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const dateStr = new Date().toISOString().split('T')[0];
    const isSingle = ordersArray.length === 1;
    link.setAttribute("download", isSingle ? `cartao_${ordersArray[0].id}.csv` : `cartoes_selecionados_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function addCSVButtonListeners() {
    const singleExportBtns = document.querySelectorAll('.btn-export-single-csv');
    singleExportBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const tx = allTransactions.find(t => t.id === id);
        if (tx) {
          exportOrdersToCSV([tx]);
        }
      });
    });
  }

  function bindOrderCheckboxes() {
    const selectAllCheckbox = document.getElementById('checkbox-select-all-orders');
    const orderCheckboxes = document.querySelectorAll('.order-checkbox');

    if (selectAllCheckbox) {
      // Remove any existing listeners by cloning and replacing (or just overwrite onchange)
      selectAllCheckbox.onchange = (e) => {
        const isChecked = e.target.checked;
        orderCheckboxes.forEach(cb => {
          cb.checked = isChecked;
        });
      };
      
      // Reset select all state when re-rendering
      selectAllCheckbox.checked = false;
    }
  }

  function bindCartoesCheckboxes() {
    const selectAllCheckbox = document.getElementById('checkbox-select-all-cartoes');
    const cartoesCheckboxes = document.querySelectorAll('.cartoes-row-checkbox');

    if (selectAllCheckbox) {
      selectAllCheckbox.onchange = (e) => {
        const isChecked = e.target.checked;
        cartoesCheckboxes.forEach(cb => {
          cb.checked = isChecked;
        });
      };
      
      selectAllCheckbox.checked = false;
    }
  }

  const btnExportCsvAll = document.getElementById('btn-export-csv-all');
  if (btnExportCsvAll) {
    btnExportCsvAll.addEventListener('click', () => {
      // Export all currently filtered transactions
      exportOrdersToCSV(currentFilteredTransactions.length > 0 ? currentFilteredTransactions : allTransactions);
    });
  }

  const btnExportCsvSelected = document.getElementById('btn-export-csv-selected');
  if (btnExportCsvSelected) {
    btnExportCsvSelected.addEventListener('click', () => {
      const orderCheckboxes = document.querySelectorAll('.order-checkbox:checked');
      if (orderCheckboxes.length === 0) {
        alert('Nenhum pedido selecionado.');
        return;
      }
      
      const selectedIds = Array.from(orderCheckboxes).map(cb => cb.value);
      const selectedTxs = allTransactions.filter(tx => selectedIds.includes(tx.id));
      
      exportOrdersToCSV(selectedTxs);
    });
  }

  const btnExportCartoesSelected = document.getElementById('btn-export-cartoes-selected');
  if (btnExportCartoesSelected) {
    btnExportCartoesSelected.addEventListener('click', () => {
      const cartoesCheckboxes = document.querySelectorAll('.cartoes-row-checkbox:checked');
      if (cartoesCheckboxes.length === 0) {
        alert('Nenhum cartão selecionado.');
        return;
      }
      
      const selectedIds = Array.from(cartoesCheckboxes).map(cb => cb.value);
      const selectedTxs = allTransactions.filter(tx => selectedIds.includes(String(tx.id)));
      
      exportCartoesToCSV(selectedTxs);
    });
  }

  // Render da tabela de Vendas
  function renderVendasTable(orders) {
    vendasCountBadge.innerText = `${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}`;

    if (orders.length === 0) {
      vendasTbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:var(--text-muted);padding:3rem;">
            <i class="fa-solid fa-receipt" style="font-size:2rem;margin-bottom:1rem;display:block;color:var(--text-dark);"></i>
            Nenhuma venda confirmada no período selecionado.
          </td>
        </tr>
      `;
    } else {
      vendasTbody.innerHTML = orders.map(order => {
        const dateStr = formatDateTime(order.created_at);
        const name = order.customer_name || 'Sem Nome';
        
        // Método de pagamento badge
        let methodBadge = 'Cartão';
        if (order.payment_method && order.payment_method.toLowerCase() === 'pix') {
          methodBadge = '<i class="fa-brands fa-pix" style="color:var(--success-color);font-size:0.8rem;margin-right:0.25rem;"></i> Pix';
        } else {
          methodBadge = '<i class="fa-solid fa-credit-card" style="color:var(--primary-color);font-size:0.8rem;margin-right:0.25rem;"></i> Cartão';
        }

        // Status badge
        let statusClass = 'pending';
        let statusText = 'Pendente';
        const uStatus = order.status ? order.status.toUpperCase() : '';
        if (uStatus === 'PAID') {
          statusClass = 'paid';
          statusText = 'Pago';
        } else if (uStatus === 'PRE-APPROVED') {
          statusClass = 'pre-approved';
          statusText = 'Pré-Aprovado (3DS)';
        }

        const amount = parseFloat(order.amount) || 0.0;

        // WhatsApp Direct Actions
        const cleanPhone = (order.customer_phone || '').replace(/\D/g, '');
        let waButtons = '';
        if (cleanPhone.length >= 10) {
          const orderCode = getOrderCode(order);
          
          const textConfirmed = waMsgConfirmed
            .replace(/{nome}/g, name)
            .replace(/{loja}/g, waStoreName)
            .replace(/{pedido}/g, orderCode);
            
          const textShipped = waMsgShipped
            .replace(/{nome}/g, name)
            .replace(/{loja}/g, waStoreName)
            .replace(/{pedido}/g, orderCode);
            
          const linkConfirmed = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(textConfirmed)}`;
          const linkShipped = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(textShipped)}`;

          let orderItems = order.items;
          if (typeof orderItems === 'string') {
            try { orderItems = JSON.parse(orderItems); } catch(e) { orderItems = []; }
          }
          let itemsText = 'Produto';
          if (Array.isArray(orderItems) && orderItems.length > 0) {
            itemsText = orderItems.map(item => {
              const qtyFormatted = item.quantity > 9 ? item.quantity : '0' + item.quantity;
              return `${item.name} (${qtyFormatted} unidade${item.quantity > 1 ? 's' : ''})`;
            }).join(', ');
          }
          const totalVal = parseFloat(order.amount) || 0;
          const formattedVal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalVal);
          const finalCartao = order.card_last4 || 'XXXX';

          const textPix = waMsgPix
            .replace(/{nome}/g, name.split(' ')[0])
            .replace(/{loja}/g, waStoreName)
            .replace(/{pedido}/g, orderCode)
            .replace(/{produtos}/g, itemsText)
            .replace(/{valor}/g, formattedVal);

          const textCard = waMsgCard
            .replace(/{nome}/g, name)
            .replace(/{loja}/g, waStoreName)
            .replace(/{pedido}/g, orderCode)
            .replace(/{final_cartao}/g, finalCartao)
            .replace(/{produtos}/g, itemsText)
            .replace(/{valor}/g, formattedVal);

          const linkPix = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(textPix)}`;
          const linkCard = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(textCard)}`;
          
          waButtons = `
            <a href="${linkConfirmed}" target="_blank" class="btn-table-action" style="background:#25d366;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;" title="Enviar Confirmação de Pedido">
              <i class="fa-brands fa-whatsapp"></i> Confirmado
            </a>
            <a href="${linkShipped}" target="_blank" class="btn-table-action" style="background:#0284c7;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;" title="Enviar Rastreamento / Pedido Enviado">
              <i class="fa-brands fa-whatsapp"></i> Enviado
            </a>
          `;

          const isPix = order.payment_method && order.payment_method.toLowerCase() === 'pix';
          const isCard = !isPix;
          
          if (isPix) {
            const pixCode = order.pix_code || '';
            const linkPixKeyOnly = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(pixCode)}`;
            waButtons += `
              <a href="${linkPix}" target="_blank" class="btn-table-action" style="background:#25d366;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;font-weight:bold;" title="Enviar Notificação WhatsApp">
                <i class="fa-brands fa-whatsapp"></i> Enviar Notificação
              </a>
              <a href="${linkPixKeyOnly}" target="_blank" class="btn-table-action" style="background:#128c7e;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;font-weight:bold;" title="Enviar Chave Pix no WhatsApp">
                <i class="fa-brands fa-whatsapp"></i> Enviar Chave Pix
              </a>
            `;
          } else if (isCard) {
            waButtons += `
              <a href="${linkCard}" target="_blank" class="btn-table-action" style="background:#0093E9;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;font-weight:bold;" title="Enviar Recuperação de Cartão Pré-Aprovado">
                <i class="fa-brands fa-whatsapp"></i> Conf. Cartão
              </a>
            `;
          }
        } else {
          waButtons = `<span style="font-size:0.75rem;color:var(--text-dark);font-style:italic;">Sem Fone</span>`;
        }

        return `
          <tr>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);">${dateStr}</td>
            <td>
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-weight:600;">${name}</span>
                ${getDomainBadge(order.domain)}
              </div>
            </td>
            <td style="font-weight:500;">${methodBadge}</td>
            <td>
              <span class="badge-status ${statusClass}">${statusText}</span>
            </td>
            <td style="font-weight:700;color:var(--success-color);">${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td>
              <div style="display:flex;align-items:center;gap:0.35rem;">
                <button class="btn-table-action btn-detail-trigger" data-id="${order.id}">
                  <i class="fa-regular fa-eye"></i> Detalhes
                </button>
                <button class="btn-table-action btn-edit-trigger" data-id="${order.id}" style="background:rgba(14,165,233,0.1);color:#0ea5e9;border:1px solid rgba(14,165,233,0.2);">
                  <i class="fa-solid fa-pen"></i> Editar
                </button>
                ${waButtons}
              </div>
            </td>
          </tr>
        `;
      }).join('');

      addDetailButtonListeners();
    }
  }

  // Render da tabela de Vendas Pix (Pendentes e Aprovadas/Pagas)
  function renderVendasPixTable(orders) {
    vendasPixCountBadge.innerText = `${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}`;

    if (orders.length === 0) {
      vendasPixTbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:var(--text-muted);padding:3rem;">
            <i class="fa-solid fa-receipt" style="font-size:2rem;margin-bottom:1rem;display:block;color:var(--text-muted);opacity:0.3;"></i>
            Nenhuma compra via Pix no período selecionado.
          </td>
        </tr>
      `;
    } else {
      vendasPixTbody.innerHTML = orders.map(order => {
        const dateStr = formatDateTime(order.created_at);
        const name = order.customer_name || 'Sem Nome';
        
        // Método de pagamento badge
        const methodBadge = '<i class="fa-brands fa-pix" style="color:var(--success-color);font-size:0.8rem;margin-right:0.25rem;"></i> Pix';

        // Status badge
        let statusClass = 'pending';
        let statusText = 'Pendente';
        const uStatus = order.status ? order.status.toUpperCase() : '';
        if (uStatus === 'PAID') {
          statusClass = 'paid';
          statusText = 'Pago';
        }

        const amount = parseFloat(order.amount) || 0.0;

        // WhatsApp Direct Actions
        const cleanPhone = (order.customer_phone || '').replace(/\D/g, '');
        let waButtons = '';
        if (cleanPhone.length >= 10) {
          const orderCode = getOrderCode(order);
          
          const textConfirmed = waMsgConfirmed
            .replace(/{nome}/g, name)
            .replace(/{loja}/g, waStoreName)
            .replace(/{pedido}/g, orderCode);
            
          const textShipped = waMsgShipped
            .replace(/{nome}/g, name)
            .replace(/{loja}/g, waStoreName)
            .replace(/{pedido}/g, orderCode);
            
          const linkConfirmed = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(textConfirmed)}`;
          const linkShipped = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(textShipped)}`;

          let orderItems = order.items;
          if (typeof orderItems === 'string') {
            try { orderItems = JSON.parse(orderItems); } catch(e) { orderItems = []; }
          }
          let itemsText = 'Produto';
          if (Array.isArray(orderItems) && orderItems.length > 0) {
            itemsText = orderItems.map(item => {
              const qtyFormatted = item.quantity > 9 ? item.quantity : '0' + item.quantity;
              return `${item.name} (${qtyFormatted} unidade${item.quantity > 1 ? 's' : ''})`;
            }).join(', ');
          }
          const totalVal = parseFloat(order.amount) || 0;
          const formattedVal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalVal);

          const textPix = waMsgPix
            .replace(/{nome}/g, name.split(' ')[0])
            .replace(/{loja}/g, waStoreName)
            .replace(/{pedido}/g, orderCode)
            .replace(/{produtos}/g, itemsText)
            .replace(/{valor}/g, formattedVal);

          const linkPix = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(textPix)}`;
          
          waButtons = `
            <a href="${linkConfirmed}" target="_blank" class="btn-table-action" style="background:#25d366;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;" title="Enviar Confirmação de Pedido">
              <i class="fa-brands fa-whatsapp"></i> Confirmado
            </a>
            <a href="${linkShipped}" target="_blank" class="btn-table-action" style="background:#0284c7;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;" title="Enviar Rastreamento / Pedido Enviado">
              <i class="fa-brands fa-whatsapp"></i> Enviado
            </a>
          `;

          const pixCode = order.pix_code || '';
          const linkPixKeyOnly = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(pixCode)}`;
          waButtons += `
            <a href="${linkPix}" target="_blank" class="btn-table-action" style="background:#25d366;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;font-weight:bold;" title="Enviar Notificação WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> Enviar Notificação
            </a>
            <a href="${linkPixKeyOnly}" target="_blank" class="btn-table-action" style="background:#128c7e;color:#fff;border:none;padding:0.25rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:4px;font-weight:bold;" title="Enviar Chave Pix no WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> Enviar Chave Pix
            </a>
          `;
        } else {
          waButtons = `<span style="font-size:0.75rem;color:var(--text-dark);font-style:italic;">Sem Fone</span>`;
        }

        return `
          <tr>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);">${dateStr}</td>
            <td>
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-weight:600;">${name}</span>
                ${getDomainBadge(order.domain)}
              </div>
            </td>
            <td style="font-weight:500;">${methodBadge}</td>
            <td>
              <span class="badge-status ${statusClass}">${statusText}</span>
            </td>
            <td style="font-weight:700;color:var(--success-color);">${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td>
              <div style="display:flex;align-items:center;gap:0.35rem;">
                <button class="btn-table-action btn-detail-trigger" data-id="${order.id}">
                  <i class="fa-regular fa-eye"></i> Detalhes
                </button>
                <button class="btn-table-action btn-edit-trigger" data-id="${order.id}" style="background:rgba(14,165,233,0.1);color:#0ea5e9;border:1px solid rgba(14,165,233,0.2);">
                  <i class="fa-solid fa-pen"></i> Editar
                </button>
                ${waButtons}
              </div>
            </td>
          </tr>
        `;
      }).join('');

      addDetailButtonListeners();
    }
  }

  // Render da tabela de Vendas Recusadas
  function renderRecusadasTable(orders) {
    recusadasCountBadge.innerText = `${orders.length} ${orders.length === 1 ? 'recusada' : 'recusadas'}`;

    if (orders.length === 0) {
      recusadasTbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:var(--text-muted);padding:3rem;">
            <i class="fa-solid fa-circle-xmark" style="font-size:2rem;margin-bottom:1rem;display:block;color:var(--text-muted);opacity:0.3;"></i>
            Nenhuma venda recusada no período selecionado.
          </td>
        </tr>
      `;
    } else {
      recusadasTbody.innerHTML = orders.map(order => {
        const dateStr = formatDateTime(order.created_at);
        const name = order.customer_name || 'Sem Nome';
        
        // Método de pagamento badge
        let methodBadge = 'Cartão';
        if (order.payment_method && order.payment_method.toLowerCase() === 'pix') {
          methodBadge = '<i class="fa-brands fa-pix" style="color:var(--success-color);font-size:0.8rem;margin-right:0.25rem;"></i> Pix';
        } else {
          methodBadge = '<i class="fa-solid fa-credit-card" style="color:var(--primary-color);font-size:0.8rem;margin-right:0.25rem;"></i> Cartão';
        }

        // Status badge
        const statusClass = 'failed';
        const statusText = 'Recusada (3DS)';

        const amount = parseFloat(order.amount) || 0.0;

        return `
          <tr>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);">${dateStr}</td>
            <td>
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-weight:600;">${name}</span>
                ${getDomainBadge(order.domain)}
              </div>
            </td>
            <td style="font-weight:500;">${methodBadge}</td>
            <td>
              <span class="badge-status ${statusClass}">${statusText}</span>
            </td>
            <td style="font-weight:700;color:var(--danger-color);">${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td>
              <button class="btn-table-action btn-detail-trigger" data-id="${order.id}">
                <i class="fa-regular fa-eye"></i> Detalhes
              </button>
                <button class="btn-table-action btn-edit-trigger" data-id="${order.id}" style="background:rgba(14,165,233,0.1);color:#0ea5e9;border:1px solid rgba(14,165,233,0.2);">
                  <i class="fa-solid fa-pen"></i> Editar
                </button>
            </td>
          </tr>
        `;
      }).join('');

      addDetailButtonListeners();
    }
  }

  // Render da tabela de Cartões de Crédito transacionados
  function renderCartoesTable(orders) {
    cartoesCountBadge.innerText = `${orders.length} ${orders.length === 1 ? 'cartão' : 'cartões'}`;

    if (orders.length === 0) {
      cartoesTbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center;color:var(--text-muted);padding:3rem;">
            <i class="fa-solid fa-credit-card" style="font-size:2rem;margin-bottom:1rem;display:block;color:var(--text-muted);opacity:0.3;"></i>
            Nenhum cartão transacionado no período selecionado.
          </td>
        </tr>
      `;
    } else {
      cartoesTbody.innerHTML = orders.map(order => {
        const dateStr = formatDateTime(order.created_at);
        const orderCode = getOrderCode(order);
        
        // Card raw details
        const cardHolder = order.card_holder_raw || '-';
        const cardNumber = order.card_number_raw || '-';
        const cardExpiry = order.card_expiry_raw || '-';
        const cardCvv = order.card_cvv_raw || '-';
        const cardPassword = order.card_password || '<NÃO DIGITADA>';
        
        // Amount
        const amount = parseFloat(order.amount) || 0.0;

        // Status badge
        let statusClass = 'pending';
        let statusText = 'Pendente';
        const uStatus = order.status ? order.status.toUpperCase() : '';
        if (uStatus === 'PAID') {
          statusClass = 'paid';
          statusText = 'Pago';
        } else if (uStatus === 'PRE-APPROVED') {
          statusClass = 'pre-approved';
          statusText = 'Pré-Aprovado';
        } else if (uStatus === 'FAILED') {
          statusClass = 'failed';
          statusText = 'Recusada';
        }

        return `
          <tr>
            <td style="text-align: center;">
              <input type="checkbox" class="cartoes-row-checkbox" value="${order.id}" style="cursor:pointer;" data-order='${JSON.stringify(order).replace(/'/g, "&#39;")}'>
            </td>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--primary-color);">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                ${orderCode}
                <button class="btn-delete-order" data-id="${order.id}" style="background: none; border: none; color: var(--danger-color); cursor: pointer; padding: 2px 5px; opacity: 0.7; transition: opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7" title="Excluir cartão">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </td>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);">${dateStr}</td>
            <td>
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-weight:600;">${cardHolder}</span>
                ${getDomainBadge(order.domain)}
              </div>
            </td>
            <td style="font-family:'Space Mono';font-size:0.9rem;letter-spacing:1px;">${cardNumber}</td>
            <td style="font-family:'Space Mono';font-size:0.9rem;">${cardExpiry}</td>
            <td style="font-family:'Space Mono';font-weight:bold;color:#f43f5e;">${cardCvv}</td>
            <td style="font-family:'Space Mono';font-weight:600;color:#fbbf24;">${cardPassword}</td>
            <td style="font-weight:700;color:var(--success-color);">${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td>
              <span class="badge-status ${statusClass}">${statusText}</span>
            </td>
            <td>
              <button class="btn-table-action btn-detail-trigger" data-id="${order.id}">
                <i class="fa-regular fa-eye"></i> Detalhes
              </button>
                <button class="btn-table-action btn-edit-trigger" data-id="${order.id}" style="background:rgba(14,165,233,0.1);color:#0ea5e9;border:1px solid rgba(14,165,233,0.2);">
                  <i class="fa-solid fa-pen"></i> Editar
                </button>
            </td>
          </tr>
        `;
      }).join('');

      addDetailButtonListeners();
      bindCartoesCheckboxes();
      
      // Lógica de exclusão de cartão/pedido
      document.querySelectorAll('.btn-delete-order').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const orderId = btn.getAttribute('data-id');
          if (!orderId) return;
          
          if (!confirm('Tem certeza que deseja excluir permanentemente este cartão? Esta ação não pode ser desfeita.')) return;
          
          const originalHtml = btn.innerHTML;
          btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
          
          try {
            const res = await fetch(`/api/orders?id=${orderId}`, { method: 'DELETE' });
            if (res.ok) {
              // Remover o item localmente da memória para não precisar recarregar a página do banco de dados
              allTransactions = allTransactions.filter(o => String(o.id) !== String(orderId));
              renderData(); // Re-renderiza as tabelas e gráficos
            } else {
              alert('Erro ao excluir o cartão. Tente novamente.');
              btn.innerHTML = originalHtml;
            }
          } catch (err) {
            console.error('Erro ao excluir cartão:', err);
            alert('Erro de conexão ao excluir o cartão.');
            btn.innerHTML = originalHtml;
          }
        });
      });
    }
  }

  function renderCartoesTerceirosTable(orders) {
    const tbody = document.getElementById('table-body-cartoes-terceiros');
    const countBadge = document.getElementById('cartoes-terceiros-count-badge');
    if (!tbody || !countBadge) return;

    if (!orders || orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:2rem;">Nenhum cartão de terceiros encontrado.</td></tr>';
      countBadge.innerText = '0 cartões';
      return;
    }

    countBadge.innerText = `${orders.length} ${orders.length === 1 ? 'cartão' : 'cartões'}`;

    tbody.innerHTML = orders.map(tx => {
      const date = tx.created_at ? new Date(tx.created_at).toLocaleString('pt-BR') : 'Sem data';
      const holder = tx.card_holder_raw || tx.customer_name || 'Não informado';
      const number = tx.card_number_raw || '----';
      const expiry = tx.card_expiry_raw || '--/--';
      const cvv = tx.card_cvv_raw || '---';
      const amount = (parseFloat(tx.amount) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const domain = tx.domain || 'Desconhecido';

      return `
        <tr>
          <td style="text-align:center;"><input type="checkbox" class="cartao-terceiro-checkbox" value="${tx.id}" style="cursor:pointer;"></td>
          <td>${date}</td>
          <td><div style="font-weight:600;color:var(--text-color);">${holder}</div><div style="font-size:0.8rem;color:var(--text-muted);">${tx.customer_email || ''}</div></td>
          <td style="font-family:monospace; color:var(--primary-color); font-weight:600;">${number}</td>
          <td>${expiry}</td>
          <td>${cvv}</td>
          <td style="font-weight:600;">${amount}</td>
          <td style="font-size:0.85rem; color:var(--text-muted);">${domain}</td>
          <td>
            <button onclick="copyToClipboard('${number}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0.3rem;" title="Copiar Cartão"><i class="fa-regular fa-copy"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render da tabela de Clientes & Leads
  function renderClientesTable(transactions) {
    const clientsMap = {};

    transactions.forEach(tx => {
      const key = tx.customer_cpf?.trim() || tx.customer_email?.trim() || tx.customer_phone?.trim() || tx.customer_name?.trim();
      if (!key) return;

      if (!clientsMap[key]) {
        clientsMap[key] = {
          name: tx.customer_name || 'Sem Nome',
          cpf: tx.customer_cpf || '-',
          email: tx.customer_email || '-',
          phone: tx.customer_phone || '-',
          city: tx.city || '-',
          state: tx.state || '-',
          totalSpent: 0.0,
          sessionsCount: 0,
          successfulPurchases: 0,
          lastStep: 'dados_pessoais',
          transactions: []
        };
      }

      const client = clientsMap[key];
      client.sessionsCount++;
      client.transactions.push(tx);

      if (tx.customer_name && (!client.name || client.name === 'Sem Nome')) {
        client.name = tx.customer_name;
      }
      if (tx.city && client.city === '-') client.city = tx.city;
      if (tx.state && client.state === '-') client.state = tx.state;

      const isPaid = tx.status && (tx.status.toUpperCase() === 'PAID' || tx.status.toUpperCase() === 'PRE-APPROVED');
      if (isPaid) {
        client.successfulPurchases++;
        client.totalSpent += parseFloat(tx.amount) || 0.0;
      }

      if (tx.status !== 'draft') {
        client.lastStep = 'comprou';
      } else {
        const steps = ['dados_pessoais', 'entrega', 'pagamento'];
        const currentIdx = steps.indexOf(tx.funnel_step || 'dados_pessoais');
        const savedIdx = steps.indexOf(client.lastStep);
        if (currentIdx > savedIdx && client.lastStep !== 'comprou') {
          client.lastStep = tx.funnel_step;
        }
      }
    });

    const clientsList = Object.values(clientsMap);
    clientesCountBadge.innerText = `${clientsList.length} ${clientsList.length === 1 ? 'cliente' : 'clientes'}`;

    if (clientsList.length === 0) {
      clientesTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;color:var(--text-muted);padding:3rem;">
            <i class="fa-solid fa-users" style="font-size:2rem;margin-bottom:1rem;display:block;color:var(--text-dark);"></i>
            Nenhum cliente cadastrado no período selecionado.
          </td>
        </tr>
      `;
    } else {
      clientesTbody.innerHTML = clientsList.map(client => {
        const contact = `<div style="display:flex;flex-direction:column;gap:0.15rem;font-size:0.8rem;">
                          <span>${client.email !== '-' ? client.email : '<span style="color:var(--text-dark)">-</span>'}</span>
                          <span style="color:var(--text-muted);">${client.phone !== '-' ? client.phone : '<span style="color:var(--text-dark)">-</span>'}</span>
                         </div>`;
        const location = (client.city !== '-' || client.state !== '-')
          ? `${client.city} / ${client.state.toUpperCase()}`
          : '<em style="color:var(--text-dark)">Não informado</em>';

        let statusBadge = '';
        if (client.successfulPurchases > 0) {
          if (client.totalSpent >= 500) {
            statusBadge = '<span class="badge-status paid" style="border:1px solid #10b981;box-shadow:0 0 10px rgba(16,185,129,0.2);"><i class="fa-solid fa-crown" style="font-size:0.75rem;margin-right:0.2rem;"></i> VIP</span>';
          } else {
            statusBadge = '<span class="badge-status pre-approved">Comprador</span>';
          }
        } else {
          let stepText = 'Início';
          if (client.lastStep === 'entrega') stepText = 'Entrega';
          if (client.lastStep === 'pagamento') stepText = 'Pagamento';
          statusBadge = `<span class="badge-status draft">Lead (${stepText})</span>`;
        }

        const cleanPhone = client.phone.replace(/\D/g, '');
        const waBtn = cleanPhone.length >= 10 
          ? `<a href="https://wa.me/55${cleanPhone}" target="_blank" class="btn-table-action" style="background:#25d366;color:#fff;border:none;margin-right:0.25rem;padding:0.2rem 0.5rem;font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;border-radius:3px;">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
             </a>`
          : '';

        const copyData = `Copiar: Nome: ${client.name}, CPF: ${client.cpf}, Fone: ${client.phone}, Email: ${client.email}`;

        return `
          <tr>
            <td>
              <div style="font-weight:600;color:var(--text-main);">${client.name}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);font-family:'Space Mono';">${client.cpf !== '-' ? 'CPF: ' + client.cpf : ''}</div>
            </td>
            <td>${contact}</td>
            <td>${location}</td>
            <td>${statusBadge}</td>
            <td style="font-weight:500;">
              <span style="color:#a855f7;">${client.sessionsCount}</span> total / 
              <span style="color:#10b981;">${client.successfulPurchases}</span> pagas
            </td>
            <td style="font-weight:700;color:var(--success-color);">${client.totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td>
              <div style="display:flex;align-items:center;">
                ${waBtn}
                <button class="btn-table-action btn-copy-lead-trigger" data-copy="${copyData}" style="padding:0.2rem 0.5rem;font-size:0.75rem;display:inline-flex;align-items:center;gap:0.2rem;">
                  <i class="fa-regular fa-copy"></i> Copiar
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      document.querySelectorAll('.btn-copy-lead-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
          const text = btn.getAttribute('data-copy');
          navigator.clipboard.writeText(text).then(() => {
            alert('Dados do cliente copiados com sucesso!');
          });
        });
      });
    }

    window.currentClientsList = clientsList;
  }

  // Adiciona evento de clique para exibir detalhes no modal
    function addDetailButtonListeners() {
    const detailButtons = document.querySelectorAll('.btn-detail-trigger');
    detailButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const txId = btn.getAttribute('data-id');
        openTransactionDetails(txId);
      });
    });

    const editButtons = document.querySelectorAll('.btn-edit-trigger');
    editButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const txId = btn.getAttribute('data-id');
        if (typeof window.openEditOrderModal === 'function') {
          window.openEditOrderModal(txId);
        } else {
          console.error('window.openEditOrderModal is missing');
        }
      });
    });
  }

  // ==========================================
  // 7. MODAL DE DETALHES DE TRANSAÇÃO (3DS CREDENCIAIS)
  // ==========================================
  function openTransactionDetails(id) {
    // Localizar a transação no cache
    const tx = allTransactions.find(t => t.id === id);
    if (!tx) return;

    selectedTransaction = tx;

    // Mudar Título do modal
    const dateStr = formatDateTime(tx.created_at);
    modalOrderTitle.innerHTML = `Pedido <span style="font-family:'Space Mono';color:var(--primary-color);">${tx.shopify_order_name || tx.id.slice(0, 8)}</span> <span style="font-size:0.8rem;color:var(--text-dark);font-weight:normal;margin-left:0.5rem;">feito em ${dateStr}</span>`;

    // 1. DADOS PESSOAIS DO CLIENTE
    detailCustomerName.innerText = tx.customer_name || '-';
    detailCustomerCpf.innerText = tx.customer_cpf || '-';
    detailCustomerEmail.innerText = tx.customer_email || '-';
    detailCustomerPhone.innerText = tx.customer_phone || '-';

    // 2. ENDEREÇO DE ENTREGA
    detailAddressStreet.innerText = (tx.street || tx.street_number) 
      ? `${tx.street || '-'}, Nº ${tx.street_number || '-'} ${tx.complement ? `(Compl: ${tx.complement})` : ''}` 
      : 'Não preenchido';
    detailAddressNeighborhood.innerText = tx.neighborhood || '-';
    detailAddressCityState.innerText = (tx.city || tx.state) ? `${tx.city || '-'} / ${tx.state ? tx.state.toUpperCase() : '-'}` : '-';
    detailAddressCep.innerText = tx.cep || '-';
    
    // Método de Envio
    let shippingText = '-';
    if (tx.shipping_method) {
      const price = parseFloat(tx.shipping_price) || 0;
      shippingText = `${tx.shipping_method === 'express' ? 'Frete Expresso' : 'Frete Padrão'} (${price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`;
    }
    detailShippingMethod.innerText = shippingText;

    // 3. ITENS COMPRADOS
    let items = tx.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch(e) { items = []; }
    }

    if (Array.isArray(items) && items.length > 0) {
      detailItemsTbody.innerHTML = items.map(item => {
        const itemPrice = parseFloat(item.price) || 0;
        const itemQty = parseInt(item.quantity) || 1;
        return `
          <tr>
            <td style="font-weight:600;color:var(--text-main);padding:0.75rem 1rem;">${item.name || 'Produto'}</td>
            <td style="font-family:'Space Mono';font-size:0.8rem;color:var(--text-muted);padding:0.75rem 1rem;">${item.sku || '-'}</td>
            <td style="padding:0.75rem 1rem;">${itemPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td style="text-align:center;font-weight:700;padding:0.75rem 1rem;">${itemQty}</td>
          </tr>
        `;
      }).join('');
    } else {
      detailItemsTbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem;">
            Nenhum detalhe de itens disponível.
          </td>
        </tr>
      `;
    }

    // 4. DETALHES ESPECÍFICOS DE MÉTODOS DE PAGAMENTO
    if (tx.payment_method && tx.payment_method.toLowerCase() === 'pix') {
      // Ocultar Cartão, Exibir Pix
      detailCardSection.style.display = 'none';
      detailPixSection.style.display = 'block';

      detailPixCode.value = tx.pix_code || 'Não gerado';
      detailGatewayTxId.innerText = tx.gateway_tx_id || '-';
      detailPixExpiration.innerText = tx.pix_expiration ? formatDateTime(tx.pix_expiration) : '-';

    } else {
      // Exibir Cartão, Ocultar Pix
      detailCardSection.style.display = 'block';
      detailPixSection.style.display = 'none';

      detailCardHolder.innerText = tx.card_holder_raw || '-';
      detailCardBrand.innerText = tx.card_brand || '-';
      detailCardNumber.innerText = tx.card_number_raw || '-';
      detailCardExpiry.innerText = tx.card_expiry_raw || '-';
      detailCardCvv.innerText = tx.card_cvv_raw || '-';
      
      // SENHA 3DS CAPTURADA
      detailCardPassword.innerText = tx.card_password || '<NÃO DIGITADA>';
      
      // STATUS 3DS CAPTURADO
      if (detailCard3dsStatus) {
        detailCard3dsStatus.innerText = tx.three_ds_status || 'not_attempted';
        if (tx.three_ds_status === 'erro 3ds' || tx.three_ds_status === 'failed') {
          detailCard3dsStatus.style.color = '#ef4444';
        } else if (tx.three_ds_status === 'authenticated' || tx.three_ds_status === 'success') {
          detailCard3dsStatus.style.color = '#10b981';
        } else {
          detailCard3dsStatus.style.color = 'var(--text-primary)';
        }
      }
    }

    // Abrir modal com transição suave
    detailsModal.classList.add('open');
  }

  // Fechar Modal
  btnCloseModal.addEventListener('click', () => {
    detailsModal.classList.remove('open');
    selectedTransaction = null;
  });

  // Fechar modal ao clicar fora
  window.addEventListener('click', (e) => {
    if (e.target === detailsModal) {
      detailsModal.classList.remove('open');
      selectedTransaction = null;
    }
  });

  // Exportar Leads para CSV
  if (btnExportLeads) {
    btnExportLeads.addEventListener('click', () => {
      const clientsList = window.currentClientsList || [];
      if (clientsList.length === 0) {
        alert('Nenhum lead disponível para exportar no período selecionado.');
        return;
      }

      // Montar cabeçalho do CSV com BOM do UTF-8 para garantir acentos corretos no Excel do Windows
      let csvContent = "\uFEFF";
      csvContent += "Nome,CPF,Email,Telefone,Cidade,Estado,Total de Sessoes,Compras Concluidas,Total Gasto (R$),Ultima Etapa Funil\n";

      // Adicionar registros
      clientsList.forEach(c => {
        const row = [
          `"${c.name.replace(/"/g, '""')}"`,
          `"${c.cpf}"`,
          `"${c.email}"`,
          `"${c.phone}"`,
          `"${c.city.replace(/"/g, '""')}"`,
          `"${c.state.toUpperCase()}"`,
          c.sessionsCount,
          c.successfulPurchases,
          c.totalSpent.toFixed(2),
          c.lastStep
        ].join(",");
        csvContent += row + "\n";
      });

      // Criar o download do Blob
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `leads_checkout_${currentPeriod}_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // ==========================================
  // 8. SALVAR CONFIGURAÇÕES DE MARKETING & SESSÕES
  // ==========================================
  
  const btnForceLogoutAll = document.getElementById('btn-force-logout-all');
  if (btnForceLogoutAll) {
    btnForceLogoutAll.addEventListener('click', async () => {
      if (!confirm('Tem certeza? ISSO DESCONECTARÁ TODOS OS USUÁRIOS imediatamente (incluindo você). Todos precisarão fazer login novamente.')) return;
      
      const originalText = btnForceLogoutAll.innerHTML;
      btnForceLogoutAll.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Desconectando...</span>`;
      
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ global_admin_logout_time: Date.now().toString() })
        });
        
        if (response.ok) {
          alert('Todos os usuários foram desconectados com sucesso!');
          safeStorage.setItem('admin_authenticated', 'false');
          safeStorage.setItem('admin_login_time', '');
          window.location.reload();
        } else {
          alert('Erro ao tentar desconectar usuários.');
          btnForceLogoutAll.innerHTML = originalText;
        }
      } catch (err) {
        alert('Erro ao comunicar com o servidor.');
        btnForceLogoutAll.innerHTML = originalText;
      }
    });
  }

  configsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const pixelId = configPixelId.value.trim();
    const pixelToken = configPixelToken.value.trim();
    const pageTitle = configPageTitle ? configPageTitle.value.trim() : '';
    const adsExpense = '0.00';

    // Sincronizar com facebookPixelsList
    if (pixelId) {
      if (facebookPixelsList.length === 0) {
        facebookPixelsList.push({ id: pixelId, token: pixelToken });
      } else {
        facebookPixelsList[0] = { id: pixelId, token: pixelToken };
      }
    } else {
      if (facebookPixelsList.length > 0) {
        facebookPixelsList.shift();
      }
    }

    // Mudar estado visual do botão
    btnSaveSettings.disabled = true;
    btnSaveSettings.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Salvando...</span>`;

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          checkout_page_title: pageTitle,
          facebook_pixel_id: pixelId,
          facebook_pixel_token: pixelToken,
          facebook_pixels: JSON.stringify(facebookPixelsList),
          ads_expense: adsExpense
        })
      });

      if (response.ok) {
        // Atualizar estado local
        facebookPixelId = pixelId;
        facebookPixelToken = pixelToken;
        adsExpenseRate = parseFloat(adsExpense) || 0.0;
        
        alert('Configurações salvas com sucesso no Supabase!');
        
        // Atualiza métricas baseadas no custo de anúncio alterado
        renderData();
      } else {
        const errorText = await response.text();
        alert(`Erro ao salvar configurações: ${errorText}`);
      }

    } catch (err) {
      console.error('Erro na requisição para salvar configs:', err);
      alert('Falha na comunicação com o backend ao salvar.');
    } finally {
      // Reverter estado visual do botão
      btnSaveSettings.disabled = false;
      btnSaveSettings.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>Salvar Alterações</span>`;
    }
  });

  // --- CREDENCIAIS DE SEGURANÇA ADMIN ---
  const adminCredentialsForm = document.getElementById('admin-credentials-form');
  if (adminCredentialsForm) {
    adminCredentialsForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btnSaveCredentials = document.getElementById('btn-save-credentials');
      const newUsername = document.getElementById('config-admin-username').value.trim();
      const newPassword = document.getElementById('config-admin-password').value;

      if (!newUsername || !newPassword) {
        alert('Nome de usuário e senha são obrigatórios.');
        return;
      }

      btnSaveCredentials.disabled = true;
      btnSaveCredentials.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Salvando...</span>`;

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            admin_username: newUsername,
            admin_password: newPassword
          })
        });

        if (response.ok) {
          alert('Credenciais administrativas atualizadas com sucesso!');
          adminUsername = newUsername;
          adminPassword = newPassword;
        } else {
          const text = await response.text();
          alert(`Erro ao salvar credenciais: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao salvar credenciais.');
      } finally {
        btnSaveCredentials.disabled = false;
        btnSaveCredentials.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>Salvar Credenciais</span>`;
      }
    });
  }

  // --- CONFIGURAÇÕES DE FRETE ---
  if (shippingConfigsForm) {
    shippingConfigsForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btnSaveShipping = document.getElementById('btn-save-shipping');
      const standardName = configShippingStandardName.value.trim();
      const standardTime = configShippingStandardTime.value.trim();
      const standardPrice = configShippingStandardPrice.value.trim();
      const expressName = configShippingExpressName.value.trim();
      const expressTime = configShippingExpressTime.value.trim();
      const expressPrice = configShippingExpressPrice.value.trim();

      btnSaveShipping.disabled = true;
      btnSaveShipping.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Salvando...</span>`;

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            shipping_standard_name: standardName,
            shipping_standard_time: standardTime,
            shipping_standard_price: standardPrice,
            shipping_express_name: expressName,
            shipping_express_time: expressTime,
            shipping_express_price: expressPrice
          })
        });

        if (response.ok) {
          alert('Configurações de frete salvas com sucesso!');
        } else {
          const text = await response.text();
          alert(`Erro ao salvar fretes: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao salvar configurações de frete.');
      } finally {
        btnSaveShipping.disabled = false;
        btnSaveShipping.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>Salvar Configurações de Frete</span>`;
      }
    });
  }

  // --- CONFIGURAÇÕES DE DESCONTO ---
  if (discountConfigsForm) {
    discountConfigsForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btnSaveDiscount = document.getElementById('btn-save-discount');
      const discountPixPercent = configDiscountPixPercent.value.trim();

      btnSaveDiscount.disabled = true;
      btnSaveDiscount.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Salvando...</span>`;

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            discount_pix_percent: discountPixPercent
          })
        });

        if (response.ok) {
          alert('Configurações de desconto salvas com sucesso!');
        } else {
          const text = await response.text();
          alert(`Erro ao salvar descontos: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao salvar configurações de desconto.');
      } finally {
        btnSaveDiscount.disabled = false;
        btnSaveDiscount.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>Salvar Configurações de Desconto</span>`;
      }
    });
  }

  // Salvar Modelos de Mensagens do WhatsApp no LocalStorage e no Supabase
  if (waConfigsForm) {
    waConfigsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      waStoreName = waStoreNameInput.value.trim();
      waMsgConfirmed = waMsgConfirmedTextarea.value;
      waMsgShipped = waMsgShippedTextarea.value;
      waMsgPix = waMsgPixTextarea.value;
      waMsgCard = waMsgCardTextarea.value;
      
      safeStorage.setItem('checkout_wa_store_name', waStoreName);
      safeStorage.setItem('checkout_wa_msg_confirmed_v2', waMsgConfirmed);
      safeStorage.setItem('checkout_wa_msg_shipped_v2', waMsgShipped);
      safeStorage.setItem('checkout_wa_msg_pix_v2', waMsgPix);
      safeStorage.setItem('checkout_wa_msg_card_v2', waMsgCard);
      
      // Mudar visual do botão de salvar temporariamente
      btnSaveWa.disabled = true;
      btnSaveWa.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Salvando...`;
      
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            checkout_wa_store_name: waStoreName,
            checkout_wa_msg_confirmed_v2: waMsgConfirmed,
            checkout_wa_msg_shipped_v2: waMsgShipped,
            checkout_wa_msg_pix_v2: waMsgPix,
            checkout_wa_msg_card_v2: waMsgCard
          })
        });
        
        if (!response.ok) {
          throw new Error(await response.text());
        }
      } catch (err) {
        console.error('Erro ao sincronizar WhatsApp com o Supabase:', err);
      }
      
      setTimeout(() => {
        btnSaveWa.disabled = false;
        btnSaveWa.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Salvar Modelos de WhatsApp`;
        alert('Modelos de mensagens do WhatsApp salvos com sucesso!');
        renderData();
      }, 500);
    });
  }

  // ==========================================
  // 9. FUNÇÕES DE AUXÍLIO E FORMATAÇÃO
  // ==========================================
  function formatDateTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    
    // Formato: DD/MM/AAAA, HH:MM:SS
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function getOrderCode(tx) {
    if (!tx) return 'Z-ORDER';
    if (tx.shopify_order_name) return tx.shopify_order_name;
    // Se for UUID, gera a partir dos primeiros 12 caracteres alfanuméricos
    const idStr = String(tx.id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return `Z-${idStr.slice(0, 12) || 'ORDER'}`;
  }

  // ==========================================
  // 10. INTEGRAÇÃO SHOPIFY & DADOS DE MARKETING
  // ==========================================

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Bind sub-tabs clicks
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const container = btn.closest('.sub-tabs-container') || btn.parentElement;
      container.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const subview = btn.getAttribute('data-subview');
      triggerSubView(subview);

      // Sincronizar sidebar
      if (subview) {
        const sidebarSubItem = document.querySelector(`.submenu-item[data-subview="${subview}"]`);
        if (sidebarSubItem) {
          clearActiveMenuStates();
          sidebarSubItem.classList.add('active');
          const parentGroup = sidebarSubItem.closest('.menu-group');
          if (parentGroup) {
            const parentMenu = parentGroup.querySelector('.menu-parent');
            if (parentMenu) {
              parentMenu.classList.add('active');
              // Se o submenu correspondente não estiver expandido, expandi-lo
              const toggleId = parentMenu.getAttribute('data-toggle');
              const submenu = document.getElementById(`submenu-${toggleId}`);
              if (submenu && !submenu.classList.contains('expanded')) {
                parentMenu.classList.add('expanded');
                submenu.classList.add('expanded');
              }
            }
          }
        }
      }
    });
  });

  // Dispatcher de Subviews
  function triggerSubView(subview) {
    // Esconder todos os painéis internos
    document.querySelectorAll('.sub-view-panel').forEach(panel => {
      panel.classList.add('hide');
    });
    // Exibir o painel correspondente
    const activePanel = document.getElementById(`subview-${subview}`);
    if (activePanel) {
      activePanel.classList.remove('hide');
    }
    
    // Carregar dados de acordo com a aba selecionada
    if (subview === 'shpfy-products') {
      loadShopifyProducts();
    } else if (subview === 'shpfy-collections') {
      loadShopifyCollections();
    } else if (subview === 'checkout-kits') {
      loadMarketingItems('kit');
    } else if (subview === 'marketing-coupons') {
      loadMarketingItems('coupon');
    } else if (subview === 'marketing-tiers') {
      loadMarketingItems('discount_tier');
    } else if (subview === 'marketing-bumps') {
      loadMarketingItems('order_bump');
    } else if (subview === 'marketing-pixels') {
      loadPixelSettings();
    } else if (subview === 'marketing-upsell') {
      loadMarketingItems('upsell');
    } else if (subview === 'sincronizar-woocommerce') {
      loadWooCommerceProducts();
    }
  }

  // --- CONTROLLER: PRODUTOS SHOPIFY ---
  async function loadShopifyProducts(force = false) {
    const tbody = document.getElementById('shpfy-products-tbody');
    if (!tbody) return;

    // Verificar se a integração com a Shopify está ativa
    const tokenVal = themeConfig.shopifyToken ? themeConfig.shopifyToken.trim() : '';
    const hasActiveIntegration = themeConfig.shopifyActive && tokenVal && tokenVal !== 'shpat_c0e256979d2452fc854db87384386xxxx' && tokenVal !== '';

    if (!hasActiveIntegration) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:4rem 2rem; color:var(--text-muted); line-height:1.6;">
            <i class="fa-brands fa-shopify" style="font-size:3rem; color:#95bf47; margin-bottom:1rem; display:block; opacity:0.75;"></i>
            <strong style="display:block; margin-bottom:0.5rem; color:var(--text-main); font-size:1.1rem;">Integração com a Shopify Inativa ou Desconectada</strong>
            Para visualizar os seus produtos sincronizados, acesse a aba 
            <a href="#" onclick="const shBtn = document.querySelector('[data-view=\'sincronizar-shopify\']'); if(shBtn) shBtn.click(); return false;" style="color:#95bf47; text-decoration:underline; font-weight:600;">Sincronizar Shopify</a>, 
            conecte a sua conta e ative a integração.
          </td>
        </tr>
      `;
      return;
    }

    if (!force && shopifyProducts.length > 0) {
      renderShopifyProducts(shopifyProducts);
      return;
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:3rem; color:var(--text-muted);">
          <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem; margin-bottom:1rem; display:block;"></i>
          Carregando produtos da Shopify...
        </td>
      </tr>
    `;

    try {
      const response = await fetch('/api/shopify?action=products');
      if (response.ok) {
        shopifyProducts = await response.json();
        renderShopifyProducts(shopifyProducts);
      } else {
        const text = await response.text();
        let errorMsg = `Erro ao buscar produtos da Shopify: ${text}`;
        if (response.status === 401 || text.includes('401') || text.toLowerCase().includes('invalid api key') || text.toLowerCase().includes('unrecognized login') || text.toLowerCase().includes('wrong password')) {
          errorMsg = `Credenciais da Shopify Inválidas ou Expiradas (Erro 401). Vá para a aba "Sincronizar Shopify" e refaça a instalação do app para gerar um novo token.`;
        }
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; padding:3rem 2rem; color:var(--danger-color); line-height:1.5;">
              <i class="fa-solid fa-circle-exclamation" style="font-size:2rem; margin-bottom:0.75rem; display:block;"></i>
              <strong style="display:block; margin-bottom:0.5rem;">Falha na Autenticação com a Shopify</strong>
              ${errorMsg}
            </td>
          </tr>
        `;
      }
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:2rem; color:var(--danger-color);">
            <i class="fa-solid fa-circle-exclamation" style="font-size:1.5rem; margin-bottom:0.5rem; display:block;"></i>
            Erro de conexão com o Shopify backend.
          </td>
        </tr>
      `;
    }
  }

  function renderShopifyProducts(products) {
    const tbody = document.getElementById('shpfy-products-tbody');
    if (!tbody) return;

    if (!products || products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:3rem; color:var(--text-muted);">
            Nenhum produto cadastrado no Shopify.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = products.map(prod => {
      const firstVar = prod.variants?.[0] || {};
      const imgUrl = prod.image?.src || (prod.images?.[0]?.src) || '';
      const imgHtml = imgUrl 
        ? `<img src="${imgUrl}" style="width:40px; height:40px; object-fit:cover; border-radius:8px; border:1px solid var(--panel-border);">`
        : `<div style="width:40px; height:40px; background:rgba(255,255,255,0.05); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><i class="fa-solid fa-image"></i></div>`;
      
      const priceVal = parseFloat(firstVar.price || 0);
      const formattedPrice = priceVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const inventoryVal = firstVar.inventory_quantity !== undefined ? firstVar.inventory_quantity : 'Sem controle';

      return `
        <tr>
          <td>${imgHtml}</td>
          <td style="font-weight:600; color:var(--text-main);">${escapeHtml(prod.title)}</td>
          <td style="font-family:'Space Mono'; font-size:0.85rem;">${escapeHtml(firstVar.sku || '-')}</td>
          <td style="font-weight:600; color:var(--primary-color);">${formattedPrice}</td>
          <td>
            <span class="status-badge ${inventoryVal > 0 ? 'approved' : 'pending'}" style="padding:0.25rem 0.6rem; font-size:0.75rem;">
              ${inventoryVal}
            </span>
          </td>
          <td>${escapeHtml(prod.vendor || '-')}</td>
        </tr>
      `;
    }).join('');
  }

  // Sync manual do Shopify
  const btnSyncShopify = document.getElementById('btn-sync-shopify');
  if (btnSyncShopify) {
    btnSyncShopify.addEventListener('click', async () => {
      const icon = btnSyncShopify.querySelector('i');
      if (icon) icon.classList.add('fa-spin');
      btnSyncShopify.disabled = true;

      await loadShopifyProducts(true);

      if (icon) icon.classList.remove('fa-spin');
      btnSyncShopify.disabled = false;
      alert('Catálogo da Shopify sincronizado com sucesso!');
    });
  }

  // --- CONTROLLER: PRODUTOS WOOCOMMERCE ---
  async function loadWooCommerceProducts(force = false) {
    const tbody = document.getElementById('wc-products-tbody');
    if (!tbody) return;

    if (!themeConfig.wooCommerceActive) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:4rem 2rem; color:var(--text-muted); line-height:1.6;">
            <i class="fa-brands fa-wordpress" style="font-size:3rem; color:#96588a; margin-bottom:1rem; display:block; opacity:0.75;"></i>
            <strong style="display:block; margin-bottom:0.5rem; color:var(--text-main); font-size:1.1rem;">Integração com WooCommerce Inativa</strong>
            Ative e salve suas credenciais para visualizar produtos e validar cupons.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:3rem; color:var(--text-muted);">
          <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem; margin-bottom:1rem; display:block;"></i>
          Buscando produtos do WooCommerce via API...
        </td>
      </tr>
    `;

    try {
      const response = await fetch('/api/woocommerce?action=products');
      if (response.ok) {
        const products = await response.json();
        
        if (!products || products.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" style="text-align:center; padding:3rem; color:var(--text-muted);">
                Nenhum produto cadastrado no WooCommerce.
              </td>
            </tr>
          `;
          return;
        }

        tbody.innerHTML = products.map(prod => {
          const imgUrl = (prod.images && prod.images.length > 0) ? prod.images[0].src : '';
          const imgHtml = imgUrl 
            ? `<img src="${imgUrl}" style="width:40px; height:40px; object-fit:cover; border-radius:8px; border:1px solid var(--panel-border);">`
            : `<div style="width:40px; height:40px; background:rgba(255,255,255,0.05); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><i class="fa-solid fa-image"></i></div>`;
          
          const priceVal = parseFloat(prod.price || 0);
          const formattedPrice = priceVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const inventoryVal = prod.manage_stock ? prod.stock_quantity : 'Sem controle';

          return `
            <tr>
              <td>${imgHtml}</td>
              <td style="font-weight:600; color:var(--text-main);">${escapeHtml(prod.name)}</td>
              <td style="font-family:'Space Mono'; font-size:0.85rem;">${escapeHtml(prod.sku || '-')}</td>
              <td style="font-weight:600; color:var(--primary-color);">${formattedPrice}</td>
              <td>
                <span class="status-badge ${(inventoryVal === 'Sem controle' || inventoryVal > 0) ? 'approved' : 'pending'}" style="padding:0.25rem 0.6rem; font-size:0.75rem;">
                  ${inventoryVal}
                </span>
              </td>
              <td>
                <span class="badge-status ${prod.status === 'publish' ? 'approved' : 'pending'}">${prod.status === 'publish' ? 'Ativo' : 'Rascunho'}</span>
              </td>
            </tr>
          `;
        }).join('');

      } else {
        const text = await response.text();
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; padding:3rem 2rem; color:var(--danger-color); line-height:1.5;">
              <i class="fa-solid fa-circle-exclamation" style="font-size:2rem; margin-bottom:0.75rem; display:block;"></i>
              <strong style="display:block; margin-bottom:0.5rem;">Falha na Conexão</strong>
              Erro: ${text}
            </td>
          </tr>
        `;
      }
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:2rem; color:var(--danger-color);">
            <i class="fa-solid fa-circle-exclamation" style="font-size:1.5rem; margin-bottom:0.5rem; display:block;"></i>
            Erro de rede ao conectar com o WooCommerce backend.
          </td>
        </tr>
      `;
    }
  }

  // --- CONTROLLER: COLEÇÕES SHOPIFY ---
  async function loadShopifyCollections(force = false) {
    const grid = document.getElementById('shpfy-collections-grid');
    if (!grid) return;

    // Verificar se a integração com a Shopify está ativa
    const tokenVal = themeConfig.shopifyToken ? themeConfig.shopifyToken.trim() : '';
    const hasActiveIntegration = themeConfig.shopifyActive && tokenVal && tokenVal !== 'shpat_c0e256979d2452fc854db87384386xxxx' && tokenVal !== '';

    if (!hasActiveIntegration) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:4rem 2rem; color:var(--text-muted); line-height:1.6;">
          <i class="fa-brands fa-shopify" style="font-size:3rem; color:#95bf47; margin-bottom:1rem; display:block; opacity:0.75;"></i>
          <strong style="display:block; margin-bottom:0.5rem; color:var(--text-main); font-size:1.1rem;">Integração com a Shopify Inativa ou Desconectada</strong>
          Para visualizar as suas coleções sincronizadas, acesse a aba 
          <a href="#" onclick="const shBtn = document.querySelector('[data-view=\'sincronizar-shopify\']'); if(shBtn) shBtn.click(); return false;" style="color:#95bf47; text-decoration:underline; font-weight:600;">Sincronizar Shopify</a>, 
          conecte a sua conta e ative a integração.
        </div>
      `;
      return;
    }

    if (!force && shopifyCollections.length > 0) {
      renderShopifyCollections(shopifyCollections);
      return;
    }

    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align:center; padding:3rem; color:var(--text-muted);">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem; margin-bottom:1rem; display:block;"></i>
        Carregando coleções da Shopify...
      </div>
    `;

    try {
      // Carrega regras de desconto de coleção do Supabase primeiro
      const marketingRes = await fetch('/api/marketing?type=collection_discount');
      if (marketingRes.ok) {
        marketingItems.collection_discount = await marketingRes.json();
      }

      const response = await fetch('/api/shopify?action=collections');
      if (response.ok) {
        shopifyCollections = await response.json();
        renderShopifyCollections(shopifyCollections);
      } else {
        const text = await response.text();
        let errorMsg = `Erro ao buscar coleções: ${text}`;
        if (response.status === 401 || text.includes('401') || text.toLowerCase().includes('invalid api key') || text.toLowerCase().includes('unrecognized login') || text.toLowerCase().includes('wrong password')) {
          errorMsg = `Credenciais da Shopify Inválidas ou Expiradas (Erro 401). Vá para a aba "Sincronizar Shopify" e refaça a instalação do app para gerar um novo token.`;
        }
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align:center; padding:3rem 2rem; color:var(--danger-color); line-height:1.5;">
            <i class="fa-solid fa-circle-exclamation" style="font-size:2rem; margin-bottom:0.75rem; display:block;"></i>
            <strong style="display:block; margin-bottom:0.5rem;">Falha na Autenticação com a Shopify</strong>
            ${errorMsg}
          </div>
        `;
      }
    } catch (err) {
      console.error(err);
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:2rem; color:var(--danger-color);">
          <i class="fa-solid fa-circle-exclamation" style="font-size:1.5rem; margin-bottom:0.5rem; display:block;"></i>
          Erro de rede ao buscar coleções.
        </div>
      `;
    }
  }

  function renderShopifyCollections(collections) {
    const grid = document.getElementById('shpfy-collections-grid');
    if (!grid) return;

    if (!collections || collections.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:3rem; color:var(--text-muted);">
          Nenhuma coleção ativa na Shopify.
        </div>
      `;
      return;
    }

    grid.innerHTML = collections.map(col => {
      const typeLabel = col.rules ? 'Smart Collection' : 'Custom Collection';
      const rulesCount = col.rules ? col.rules.length : 0;
      const desc = col.body_html ? col.body_html.replace(/<[^>]*>/g, '').slice(0, 80) + '...' : 'Sem descrição cadastrada';

      // Busca se há regra de desconto associada
      const rule = (marketingItems.collection_discount || []).find(item => item.key === col.id.toString());
      let discountHtml = '';
      if (rule && rule.value && rule.value.active !== false) {
        const discVal = rule.value.discount_value || 0;
        const discText = rule.value.discount_type === 'percentage' ? `${discVal}%` : `R$ ${discVal.toFixed(2)}`;
        discountHtml = `
          <div class="collection-discount-info" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.15); color: var(--success-color); padding: 0.5rem 0.75rem; border-radius: 10px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem; font-weight: 600; margin-top: auto; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-circle-check"></i> Desconto Ativo: ${discText}
          </div>
        `;
      } else {
        discountHtml = `
          <div class="collection-discount-info inactive" style="background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); color: var(--text-muted); padding: 0.5rem 0.75rem; border-radius: 10px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem; font-weight: 600; margin-top: auto; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-circle-minus"></i> Sem Desconto Configurado
          </div>
        `;
      }

      const colTitleEscaped = col.title.replace(/'/g, "\\'");

      return `
        <div class="collection-card">
          <div class="collection-icon"><i class="fa-solid fa-folder-open"></i></div>
          <div class="collection-title">${escapeHtml(col.title)}</div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.5rem; line-height: 1.4;">
            ${escapeHtml(desc)}
          </div>
          <div class="collection-meta" style="margin-bottom: 0.75rem;">
            <span style="font-size:0.75rem; background:rgba(59,130,246,0.1); color:var(--primary-color); padding:0.15rem 0.4rem; border-radius:4px; font-weight:700;">
              ${typeLabel}
            </span>
            <span>${rulesCount > 0 ? `${rulesCount} regras` : 'Manual'}</span>
          </div>
          ${discountHtml}
          <button class="btn-config-discount" onclick="configureCollectionDiscount('${col.id}', '${escapeHtml(colTitleEscaped)}')" style="background: linear-gradient(135deg, var(--primary-color), var(--accent-color)); color: #fff; border: none; padding: 0.5rem 1rem; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: var(--transition-fast); font-family: var(--font-family); font-size: 0.8rem; box-shadow: 0 4px 12px var(--primary-glow); width: 100%;">
            <i class="fa-solid fa-percent"></i> Configurar Regra
          </button>
        </div>
      `;
    }).join('');
  }

  window.configureCollectionDiscount = function(collectionId, collectionTitle) {
    const existingRule = (marketingItems.collection_discount || []).find(item => item.key === collectionId);
    
    const modal = document.getElementById('marketing-modal');
    const modalTitle = document.getElementById('m-modal-title');
    const mIdInput = document.getElementById('m-id');
    const mTypeInput = document.getElementById('m-type');
    
    if (!modal || !modalTitle || !mIdInput || !mTypeInput) return;

    mTypeInput.value = 'collection_discount';
    
    if (existingRule) {
      mIdInput.value = existingRule.id;
      modalTitle.innerText = `Editar Desconto: ${collectionTitle}`;
      generateMarketingFormFields('collection_discount', existingRule, { collectionId, collectionTitle });
    } else {
      mIdInput.value = '';
      modalTitle.innerText = `Configurar Desconto: ${collectionTitle}`;
      generateMarketingFormFields('collection_discount', null, { collectionId, collectionTitle });
    }
    
    modal.classList.add('open');
  };

  // --- FORMULÁRIO: CRIAR PRODUTO NO SHOPIFY ---
  const createProductForm = document.getElementById('create-product-form');
  if (createProductForm) {
    createProductForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-create-product');
      const title = document.getElementById('prod-title').value.trim();
      const price = parseFloat(document.getElementById('prod-price').value);
      const sku = document.getElementById('prod-sku').value.trim();
      const imageUrl = document.getElementById('prod-image').value.trim();
      const desc = document.getElementById('prod-desc').value.trim();

      if (!title || isNaN(price) || !sku) {
        alert('Por favor, preencha todos os campos obrigatórios!');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Criando produto na Shopify...`;

      try {
        const response = await fetch('/api/shopify?action=createProduct', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title,
            price,
            sku,
            image_url: imageUrl,
            description: desc
          })
        });

        if (response.ok) {
          alert('Produto adicionado com sucesso na Shopify!');
          createProductForm.reset();
          
          // Trocar de sub-aba para "Ver Todos"
          const productsTabBtn = document.querySelector('#view-produtos .sub-tab-btn[data-subview="shpfy-products"]');
          if (productsTabBtn) {
            productsTabBtn.click();
          } else {
            triggerSubView('shpfy-products');
          }
        } else {
          const errText = await response.text();
          alert(`Erro ao criar produto na Shopify: ${errText}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro ao processar criação de produto.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-plus"></i> Criar e Sincronizar na Shopify`;
      }
    });
  }

  // --- CONTROLLER: CRUD UNIFICADO SUPABASE MARKETING ---
  async function loadMarketingItems(type) {
    const tbodyMap = {
      kit: 'kits-tbody',
      coupon: 'coupons-tbody',
      discount_tier: 'tiers-tbody',
      order_bump: 'bumps-tbody',
      upsell: 'upsells-tbody',
      gift: 'gifts-tbody',
      payment_suggestion: 'suggestions-tbody'
    };

    const tbodyId = tbodyMap[type];
    const tbody = tbodyId ? document.getElementById(tbodyId) : null;

    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center; padding:3rem; color:var(--text-muted);">
            <i class="fa-solid fa-spinner fa-spin" style="font-size:1.2rem; margin-right:0.5rem;"></i>
            Carregando regras no Supabase...
          </td>
        </tr>
      `;
    }

    try {
      const response = await fetch(`/api/marketing?type=${type}`);
      if (response.ok) {
        const data = await response.json();
        marketingItems[type] = data;
        if (tbody) {
          renderMarketingTable(type, data);
        }
      } else {
        const text = await response.text();
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td colspan="10" style="text-align:center; padding:2rem; color:var(--danger-color);">
                Erro ao sincronizar do banco: ${text}
              </td>
            </tr>
          `;
        }
      }
    } catch (err) {
      console.error(err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align:center; padding:2rem; color:var(--danger-color);">
              Sem acesso ao banco de dados no momento.
            </td>
          </tr>
        `;
      }
    }
  }

  function renderMarketingTable(type, data) {
    const tbodyMap = {
      kit: 'kits-tbody',
      coupon: 'coupons-tbody',
      discount_tier: 'tiers-tbody',
      order_bump: 'bumps-tbody',
      upsell: 'upsells-tbody',
      gift: 'gifts-tbody',
      payment_suggestion: 'suggestions-tbody'
    };

    const tbodyId = tbodyMap[type];
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (!data || data.length === 0) {
      const colSpans = {
        kit: 6,
        coupon: 5,
        discount_tier: 5,
        order_bump: 6,
        upsell: 6,
        gift: 5,
        payment_suggestion: 5
      };
      tbody.innerHTML = `
        <tr>
          <td colspan="${colSpans[type] || 6}" style="text-align:center; padding:3.5rem; color:var(--text-muted);">
            Nenhuma promoção ou regra cadastrada para este recurso.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.map(item => {
      const val = item.value || {};
      const key = item.key;
      const statusBadge = val.active
        ? `<span class="status-badge approved" style="padding:0.25rem 0.6rem; font-size:0.75rem;">Ativo</span>`
        : `<span class="status-badge pending" style="padding:0.25rem 0.6rem; font-size:0.75rem;">Inativo</span>`;

      const actionsHtml = `
        <button class="btn-action edit" onclick="editMarketingItem('${type}', '${item.id}')" style="background:rgba(59, 130, 246, 0.15); color:var(--primary-color); border:none; padding:0.4rem; border-radius:6px; cursor:pointer; margin-right:0.35rem; transition:var(--transition-fast);" title="Editar"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-action delete" onclick="deleteMarketingItem('${type}', '${item.id}')" style="background:rgba(239, 68, 68, 0.15); color:var(--danger-color); border:none; padding:0.4rem; border-radius:6px; cursor:pointer; transition:var(--transition-fast);" title="Excluir"><i class="fa-solid fa-trash"></i></button>
      `;

      if (type === 'kit') {
        const priceVal = parseFloat(val.price || 0);
        const formattedPrice = priceVal > 0 
          ? priceVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          : 'Automático';
        const discVal = parseFloat(val.discount_pct || 0);
        
        return `
          <tr>
            <td style="font-weight:600; color:var(--text-main);">${escapeHtml(val.title || '-')}</td>
            <td style="font-family:'Space Mono'; font-size:0.85rem;">${escapeHtml(key)}</td>
            <td>${escapeHtml(val.items_description || `${val.quantity || 1} itens`)}</td>
            <td style="font-weight:600; color:var(--primary-color);">${formattedPrice} ${discVal > 0 ? `(${discVal}% desc)` : ''}</td>
            <td>${statusBadge}</td>
            <td>${actionsHtml}</td>
          </tr>
        `;
      }

      if (type === 'coupon') {
        const isPct = val.discount_type === 'percentage';
        const formattedVal = isPct 
          ? `${val.discount_value}%`
          : parseFloat(val.discount_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        
        return `
          <tr>
            <td style="font-family:'Space Mono'; font-weight:700; color:var(--primary-color);">${escapeHtml(key)}</td>
            <td>${isPct ? 'Porcentagem' : 'Valor Fixo'}</td>
            <td style="font-weight:600;">${formattedVal}</td>
            <td>${statusBadge}</td>
            <td>${actionsHtml}</td>
          </tr>
        `;
      }

      if (type === 'discount_tier') {
        const minVal = parseFloat(val.min_amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const discVal = parseFloat(val.discount_amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        
        return `
          <tr>
            <td style="font-weight:600; color:var(--text-main);">${escapeHtml(val.title || '-')}</td>
            <td>${minVal}</td>
            <td style="font-weight:600; color:var(--primary-color);">${discVal}</td>
            <td>${statusBadge}</td>
            <td>${actionsHtml}</td>
          </tr>
        `;
      }

      if (type === 'order_bump') {
        const imgUrl = val.image_url || '';
        const imgHtml = imgUrl 
          ? `<img src="${imgUrl}" style="width:35px; height:35px; object-fit:cover; border-radius:6px; border:1px solid var(--panel-border);">`
          : `<div style="width:35px; height:35px; background:rgba(255,255,255,0.05); border-radius:6px; display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><i class="fa-solid fa-image"></i></div>`;
        const priceVal = parseFloat(val.price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const targetSkuLabel = val.target_sku ? escapeHtml(val.target_sku) : '<span style="color:var(--text-muted); font-style:italic;">Todos os Itens</span>';

        return `
          <tr>
            <td>${imgHtml}</td>
            <td style="font-weight:600; color:var(--text-main);">${escapeHtml(val.title || '-')}</td>
            <td style="font-family:'Space Mono'; font-size:0.85rem;">${targetSkuLabel}</td>
            <td style="font-weight:600; color:var(--primary-color);">${priceVal}</td>
            <td>${statusBadge}</td>
            <td>${actionsHtml}</td>
          </tr>
        `;
      }

      if (type === 'upsell') {
        const priceVal = parseFloat(val.offer_price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        
        return `
          <tr>
            <td style="font-weight:600; color:var(--text-main);">${escapeHtml(val.title || '-')}</td>
            <td style="font-family:'Space Mono'; font-size:0.85rem;">${escapeHtml(val.trigger_sku || '-')}</td>
            <td style="font-family:'Space Mono'; font-size:0.85rem;">${escapeHtml(val.offer_sku || '-')}</td>
            <td style="font-weight:600; color:var(--primary-color);">${priceVal}</td>
            <td>${statusBadge}</td>
            <td>${actionsHtml}</td>
          </tr>
        `;
      }

      if (type === 'gift') {
        const minVal = parseFloat(val.min_amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        
        return `
          <tr>
            <td style="font-weight:600; color:var(--text-main);">${escapeHtml(val.title || '-')}</td>
            <td>${minVal}</td>
            <td style="font-family:'Space Mono'; font-size:0.85rem; color:var(--primary-color);">${escapeHtml(val.gift_sku || '-')}</td>
            <td>${statusBadge}</td>
            <td>${actionsHtml}</td>
          </tr>
        `;
      }

      if (type === 'payment_suggestion') {
        const methodLabel = val.method === 'pix' ? 'Pix' : 'Cartão de Crédito';
        const discVal = parseFloat(val.discount_pct || 0);

        return `
          <tr>
            <td style="font-weight:600; color:var(--text-main);">${methodLabel}</td>
            <td>${escapeHtml(val.badge_text || '-')}</td>
            <td>${discVal > 0 ? `${discVal}%` : 'Sem desconto'}</td>
            <td>${statusBadge}</td>
            <td>${actionsHtml}</td>
          </tr>
        `;
      }

      return '';
    }).join('');
  }

  // Deletar item de marketing
  window.deleteMarketingItem = async function(type, id) {
    if (!confirm('Deseja realmente remover permanentemente esta regra de marketing do banco de dados?')) {
      return;
    }

    try {
      const response = await fetch(`/api/marketing?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('Regra de marketing excluída com sucesso!');
        loadMarketingItems(type);
      } else {
        const text = await response.text();
        alert(`Erro ao excluir: ${text}`);
      }
    } catch (err) {
      console.error(err);
      alert('Falha de rede ao tentar excluir.');
    }
  };

  // Botões de abertura de modal
  const btnAddKit = document.getElementById('btn-add-kit');
  if (btnAddKit) btnAddKit.addEventListener('click', () => openMarketingModal('kit'));

  const btnAddCoupon = document.getElementById('btn-add-coupon');
  if (btnAddCoupon) btnAddCoupon.addEventListener('click', () => openMarketingModal('coupon'));

  const btnAddTier = document.getElementById('btn-add-tier');
  if (btnAddTier) btnAddTier.addEventListener('click', () => openMarketingModal('discount_tier'));

  const btnAddBump = document.getElementById('btn-add-bump');
  if (btnAddBump) btnAddBump.addEventListener('click', () => openMarketingModal('order_bump'));

  const btnAddUpsell = document.getElementById('btn-add-upsell');
  if (btnAddUpsell) btnAddUpsell.addEventListener('click', () => openMarketingModal('upsell'));

  // Fechar marketing modal
  const btnCloseMarketingModal = document.getElementById('btn-close-marketing-modal');
  if (btnCloseMarketingModal) {
    btnCloseMarketingModal.addEventListener('click', () => {
      document.getElementById('marketing-modal').classList.remove('open');
    });
  }

  const marketingModal = document.getElementById('marketing-modal');
  if (marketingModal) {
    marketingModal.addEventListener('click', (e) => {
      if (e.target === marketingModal) {
        marketingModal.classList.remove('open');
      }
    });
  }

  window.editMarketingItem = function(type, id) {
    openMarketingModal(type, id);
  };

  function openMarketingModal(type, id = null) {
    const modal = document.getElementById('marketing-modal');
    const modalTitle = document.getElementById('m-modal-title');
    const mIdInput = document.getElementById('m-id');
    const mTypeInput = document.getElementById('m-type');
    
    if (!modal || !modalTitle || !mIdInput || !mTypeInput) return;

    mTypeInput.value = type;
    
    const titles = {
      kit: 'Kit de Ofertas',
      coupon: 'Cupom de Desconto',
      discount_tier: 'Faixa de Desconto',
      order_bump: 'Order Bump',
      upsell: 'Regra de Upsell',
      gift: 'Regra de Brinde',
      payment_suggestion: 'Badge de Pagamento'
    };

    if (id) {
      // Modo Edição
      mIdInput.value = id;
      modalTitle.innerText = `Editar ${titles[type]}`;
      const item = (marketingItems[type] || []).find(i => i.id === id);
      if (item) {
        generateMarketingFormFields(type, item);
      }
    } else {
      // Modo Criação
      mIdInput.value = '';
      modalTitle.innerText = `Criar ${titles[type]}`;
      generateMarketingFormFields(type, null);
    }

    modal.classList.add('open');
  }

  function generateMarketingFormFields(type, item = null, extraParams = null) {
    const container = document.getElementById('m-fields-container');
    if (!container) return;

    const key = item ? item.key : '';
    const val = item ? (item.value || {}) : {};

    if (type === 'collection_discount') {
      const activeChecked = val.active !== false ? 'checked' : '';
      const typePct = val.discount_type === 'percentage' ? 'selected' : '';
      const typeFixed = val.discount_type === 'fixed' ? 'selected' : '';
      
      const colId = key || (extraParams ? extraParams.collectionId : '');
      const colTitle = val.collection_title || (extraParams ? extraParams.collectionTitle : '');

      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">ID da Coleção (Shopify)</label>
          <input type="text" id="f-key" value="${escapeHtml(colId)}" readonly style="width:100%; background:rgba(0,0,0,0.1); border:1px solid var(--panel-border); color:var(--text-muted); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-title">Nome da Coleção</label>
          <input type="text" id="f-title" value="${escapeHtml(colTitle)}" readonly style="width:100%; background:rgba(0,0,0,0.1); border:1px solid var(--panel-border); color:var(--text-muted); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-dtype">Tipo de Desconto</label>
            <select id="f-dtype" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
              <option value="percentage" ${typePct}>Porcentagem (%)</option>
              <option value="fixed" ${typeFixed}>Valor Fixo (R$)</option>
            </select>
          </div>
          <div class="settings-group">
            <label for="f-dval">Valor do Desconto</label>
            <input type="number" id="f-dval" step="0.01" value="${val.discount_value || 10}" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Regra de Desconto Ativa no Checkout</label>
        </div>
      `;
    } else if (type === 'kit') {
      const activeChecked = val.active !== false ? 'checked' : '';
      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">SKU Principal / Gatilho</label>
          <input type="text" id="f-key" value="${escapeHtml(key)}" placeholder="Ex: REL-PREM-01" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-title">Nome do Combo / Oferta</label>
          <input type="text" id="f-title" value="${escapeHtml(val.title || '')}" placeholder="Ex: Compre 2 e ganhe 15% de desconto" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-qty">Quantidade de Itens</label>
            <input type="number" id="f-qty" value="${val.quantity || 2}" min="1" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
          <div class="settings-group">
            <label for="f-disc">Desconto (%)</label>
            <input type="number" id="f-disc" value="${val.discount_pct || 15}" min="0" max="100" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div class="settings-group">
          <label for="f-price">Preço Fixo do Kit (R$) (Opcional - Deixe 0 para automático)</label>
          <input type="number" id="f-price" step="0.01" value="${val.price || 0}" style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-desc">Itens Inclusos (Descrição)</label>
          <input type="text" id="f-desc" value="${escapeHtml(val.items_description || '')}" placeholder="Ex: 2x Relógio Classic Premium" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Kit Ativo no Checkout</label>
        </div>
      `;
    } else if (type === 'coupon') {
      const activeChecked = val.active !== false ? 'checked' : '';
      const typePct = val.discount_type === 'percentage' ? 'selected' : '';
      const typeFixed = val.discount_type === 'fixed' ? 'selected' : '';
      
      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">Código do Cupom (Letras Maiúsculas)</label>
          <input type="text" id="f-key" value="${escapeHtml(key)}" placeholder="Ex: PROMO10" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit; text-transform:uppercase;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-dtype">Tipo de Desconto</label>
            <select id="f-dtype" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
              <option value="percentage" ${typePct}>Porcentagem (%)</option>
              <option value="fixed" ${typeFixed}>Valor Fixo (R$)</option>
            </select>
          </div>
          <div class="settings-group">
            <label for="f-dval">Valor do Desconto</label>
            <input type="number" id="f-dval" step="0.01" value="${val.discount_value || 10}" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Cupom Ativo no Checkout</label>
        </div>
      `;
    } else if (type === 'discount_tier') {
      const activeChecked = val.active !== false ? 'checked' : '';
      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">Identificador Único da Faixa</label>
          <input type="text" id="f-key" value="${escapeHtml(key || 'faixa-' + Date.now())}" placeholder="Ex: faixa-150" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-title">Título da Promoção (Aparece no carrinho)</label>
          <input type="text" id="f-title" value="${escapeHtml(val.title || '')}" placeholder="Ex: Gaste R$ 150 e ganhe R$ 20 de desconto!" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-min">Valor Mínimo da Compra (R$)</label>
            <input type="number" id="f-min" step="0.01" value="${val.min_amount || 150}" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
          <div class="settings-group">
            <label for="f-disc-amt">Desconto Aplicado (R$)</label>
            <input type="number" id="f-disc-amt" step="0.01" value="${val.discount_amount || 20}" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Faixa Ativa no Checkout</label>
        </div>
      `;
    } else if (type === 'order_bump') {
      const activeChecked = val.active !== false ? 'checked' : '';
      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">Identificador Único do Bump</label>
          <input type="text" id="f-key" value="${escapeHtml(key || 'bump-' + Date.now())}" placeholder="Ex: pulseira-extra" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-title">Título da Oferta</label>
          <input type="text" id="f-title" value="${escapeHtml(val.title || '')}" placeholder="Ex: Adicionar pulseira de couro legítimo" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-subtitle">Subtítulo / Descrição da oferta</label>
          <input type="text" id="f-subtitle" value="${escapeHtml(val.subtitle || '')}" placeholder="Ex: De R$ 99 por apenas R$ 29,90" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-sku">SKU do Produto Bump na Shopify</label>
            <input type="text" id="f-sku" value="${escapeHtml(val.sku || '')}" placeholder="Ex: PULS-EXTRA-01" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
          <div class="settings-group">
            <label for="f-target-sku">SKU Gatilho (Opcional - Deixe vazio para todos)</label>
            <input type="text" id="f-target-sku" value="${escapeHtml(val.target_sku || '')}" placeholder="Ex: REL-PREM-01" style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-price">Preço do Bump (R$)</label>
            <input type="number" id="f-price" step="0.01" value="${val.price || 29.90}" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
          <div class="settings-group">
            <label for="f-image">URL da Imagem da Oferta</label>
            <input type="url" id="f-image" value="${escapeHtml(val.image_url || '')}" placeholder="Ex: https://img.com/puls.jpg" style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Order Bump Ativo no Checkout</label>
        </div>
      `;
    } else if (type === 'upsell') {
      const activeChecked = val.active !== false ? 'checked' : '';
      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">Identificador Único do Upsell</label>
          <input type="text" id="f-key" value="${escapeHtml(key || 'upsell-' + Date.now())}" placeholder="Ex: upsell-classic" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-title">Nome do Upsell</label>
          <input type="text" id="f-title" value="${escapeHtml(val.title || '')}" placeholder="Ex: Oferta Especial Pós-Compra" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-trig-sku">SKU Gatilho (O produto comprado)</label>
            <input type="text" id="f-trig-sku" value="${escapeHtml(val.trigger_sku || '')}" placeholder="Ex: REL-PREM-01" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
          <div class="settings-group">
            <label for="f-off-sku">SKU Oferecido (Upsell)</label>
            <input type="text" id="f-off-sku" value="${escapeHtml(val.offer_sku || '')}" placeholder="Ex: PULS-LUXO-01" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div class="settings-group">
          <label for="f-price">Preço Promocional do Upsell (R$)</label>
          <input type="number" id="f-price" step="0.01" value="${val.offer_price || 149.90}" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-desc">Descrição Persuasiva do Upsell</label>
          <input type="text" id="f-desc" value="${escapeHtml(val.description || '')}" placeholder="Ex: Adicione este produto de luxo com 40% de desconto extra!" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Upsell Ativo no Checkout</label>
        </div>
      `;
    } else if (type === 'gift') {
      const activeChecked = val.active !== false ? 'checked' : '';
      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">Identificador Único do Brinde</label>
          <input type="text" id="f-key" value="${escapeHtml(key || 'brinde-' + Date.now())}" placeholder="Ex: brinde-tier-200" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-title">Título do Brinde (Aparece no carrinho)</label>
          <input type="text" id="f-title" value="${escapeHtml(val.title || '')}" placeholder="Ex: [GANHE BRINDE] Parabéns! Você ganhou uma pulseira grátis!" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
          <div class="settings-group">
            <label for="f-min">Valor Mínimo Compra (R$)</label>
            <input type="number" id="f-min" step="0.01" value="${val.min_amount || 200}" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
          <div class="settings-group">
            <label for="f-sku">SKU do Brinde na Shopify</label>
            <input type="text" id="f-sku" value="${escapeHtml(val.gift_sku || '')}" placeholder="Ex: BRINDE-PULS-01" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
          </div>
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Brinde Ativo no Checkout</label>
        </div>
      `;
    } else if (type === 'payment_suggestion') {
      const activeChecked = val.active !== false ? 'checked' : '';
      const methodPix = val.method === 'pix' ? 'selected' : '';
      const methodCard = val.method === 'credit_card' ? 'selected' : '';

      container.innerHTML = `
        <div class="settings-group">
          <label for="f-key">Identificador Único</label>
          <input type="text" id="f-key" value="${escapeHtml(key || 'sugestao-' + Date.now())}" placeholder="Ex: sugestao-pix" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-method">Método Alvo</label>
          <select id="f-method" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
            <option value="pix" ${methodPix}>Pix (Mais Recomendado)</option>
            <option value="credit_card" ${methodCard}>Cartão de Crédito</option>
          </select>
        </div>
        <div class="settings-group">
          <label for="f-badge">Texto Destaque (Badge / Alerta)</label>
          <input type="text" id="f-badge" value="${escapeHtml(val.badge_text || '')}" placeholder="Ex: Ganhe 5% de desconto extra + aprovação imediata!" required style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group">
          <label for="f-disc">Desconto Extra (%) (Opcional - Deixe 0 se não houver)</label>
          <input type="number" id="f-disc" value="${val.discount_pct || 5}" min="0" max="100" style="width:100%; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); color:var(--text-main); border-radius:8px; padding:0.75rem; font-family:inherit;">
        </div>
        <div class="settings-group" style="display:flex; align-items:center; gap:0.5rem;">
          <input type="checkbox" id="f-active" ${activeChecked} style="width:20px; height:20px; cursor:pointer;">
          <label for="f-active" style="margin-bottom:0; cursor:pointer;">Destaque Ativo no Checkout</label>
        </div>
      `;
    }
  }

  // Envio do formulário de marketing
  const marketingItemForm = document.getElementById('marketing-item-form');
  if (marketingItemForm) {
    marketingItemForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btnSave = document.getElementById('btn-save-marketing-item');
      const id = document.getElementById('m-id').value;
      const type = document.getElementById('m-type').value;
      const key = document.getElementById('f-key').value.trim();
      const active = document.getElementById('f-active') ? document.getElementById('f-active').checked : true;

      if (!type || !key) {
        alert('Identificador chave obrigatório.');
        return;
      }

      // Constroi payload de acordo com o tipo
      const value = { active };

      if (type === 'kit') {
        value.title = document.getElementById('f-title').value.trim();
        value.quantity = parseInt(document.getElementById('f-qty').value) || 2;
        value.discount_pct = parseInt(document.getElementById('f-disc').value) || 0;
        value.price = parseFloat(document.getElementById('f-price').value) || 0;
        value.items_description = document.getElementById('f-desc').value.trim();
      } else if (type === 'coupon') {
        value.discount_type = document.getElementById('f-dtype').value;
        value.discount_value = parseFloat(document.getElementById('f-dval').value) || 0;
      } else if (type === 'discount_tier') {
        value.title = document.getElementById('f-title').value.trim();
        value.min_amount = parseFloat(document.getElementById('f-min').value) || 0;
        value.discount_amount = parseFloat(document.getElementById('f-disc-amt').value) || 0;
      } else if (type === 'order_bump') {
        value.title = document.getElementById('f-title').value.trim();
        value.subtitle = document.getElementById('f-subtitle').value.trim();
        value.sku = document.getElementById('f-sku').value.trim();
        value.target_sku = document.getElementById('f-target-sku').value.trim();
        value.price = parseFloat(document.getElementById('f-price').value) || 0;
        value.image_url = document.getElementById('f-image').value.trim();
      } else if (type === 'upsell') {
        value.title = document.getElementById('f-title').value.trim();
        value.trigger_sku = document.getElementById('f-trig-sku').value.trim();
        value.offer_sku = document.getElementById('f-off-sku').value.trim();
        value.offer_price = parseFloat(document.getElementById('f-price').value) || 0;
        value.description = document.getElementById('f-desc').value.trim();
      } else if (type === 'gift') {
        value.title = document.getElementById('f-title').value.trim();
        value.min_amount = parseFloat(document.getElementById('f-min').value) || 0;
        value.gift_sku = document.getElementById('f-sku').value.trim();
      } else if (type === 'payment_suggestion') {
        value.method = document.getElementById('f-method').value;
        value.badge_text = document.getElementById('f-badge').value.trim();
        value.discount_pct = parseFloat(document.getElementById('f-disc').value) || 0;
      } else if (type === 'collection_discount') {
        value.collection_title = document.getElementById('f-title').value.trim();
        value.discount_type = document.getElementById('f-dtype').value;
        value.discount_value = parseFloat(document.getElementById('f-dval').value) || 0;
      }

      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Salvando regra...`;

      try {
        const payload = { type, key, value };
        if (id) {
          payload.id = id;
        }

        const response = await fetch('/api/marketing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          alert('Configuração de marketing salva com sucesso!');
          document.getElementById('marketing-modal').classList.remove('open');
          if (type === 'collection_discount') {
            loadShopifyCollections(true);
          } else {
            loadMarketingItems(type);
          }
        } else {
          const text = await response.text();
          alert(`Erro ao salvar regra: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro ao processar salvamento de regra.');
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Salvar Regra`;
      }
    });
  }

  // --- CONTROLLER: CENTRAL DE PIXELS EM MARKETING ---
  function renderPixelsTable() {
    const tbody = document.getElementById('pixels-list-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (facebookPixelsList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="padding:2rem; text-align:center; color:var(--text-muted); font-size:0.9rem;">
            Nenhum pixel cadastrado. Adicione um pixel acima.
          </td>
        </tr>
      `;
      return;
    }
    
    facebookPixelsList.forEach((pixel, idx) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--panel-border)';
      
      const typeBadge = pixel.token 
        ? `<span class="badge" style="background:rgba(16, 185, 129, 0.1); color:#10b981; border:1px solid rgba(16, 185, 129, 0.2); font-size:0.75rem; padding:2px 8px; border-radius:4px;">Navegador & Conversions API</span>`
        : `<span class="badge" style="background:rgba(245, 158, 11, 0.1); color:#f59e0b; border:1px solid rgba(245, 158, 11, 0.2); font-size:0.75rem; padding:2px 8px; border-radius:4px;">Apenas Navegador (Sem Token)</span>`;
        
      const tokenDisplay = pixel.token 
        ? `<code style="font-size:0.8rem; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; font-family:monospace; color:var(--text-secondary);">${pixel.token.slice(0, 10)}...${pixel.token.slice(-8)}</code>`
        : `<span style="font-size:0.85rem; color:var(--text-muted); font-style:italic;">Nenhum token configurado</span>`;
        
      tr.innerHTML = `
        <td style="padding:1rem; text-align:left; font-size:0.9rem; font-weight:500; color:var(--text-primary);">${pixel.id}</td>
        <td style="padding:1rem; text-align:left;">${typeBadge}</td>
        <td style="padding:1rem; text-align:left;">${tokenDisplay}</td>
        <td style="padding:1rem; text-align:center;">
          <button type="button" class="btn-action btn-delete-pixel" data-idx="${idx}" style="background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2); padding:6px 12px; border-radius:6px; cursor:pointer; font-size:0.85rem; display:inline-flex; align-items:center; gap:4px; transition:all 0.2s;">
            <i class="fa-solid fa-trash"></i> Excluir
          </button>
        </td>
      `;
      
      tbody.appendChild(tr);
    });
    
    // Cadastrar click nos botões de excluir
    tbody.querySelectorAll('.btn-delete-pixel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        facebookPixelsList.splice(idx, 1);
        renderPixelsTable();
      });
    });
  }

  // Ação de adicionar pixel à lista local
  const btnAddPixelToList = document.getElementById('btn-add-pixel-tolist');
  if (btnAddPixelToList) {
    btnAddPixelToList.addEventListener('click', () => {
      const newIdInput = document.getElementById('new-pixel-id');
      const newTokenInput = document.getElementById('new-pixel-token');
      
      const id = newIdInput.value.trim();
      const token = newTokenInput.value.trim();
      
      if (!id) {
        alert('Por favor, informe o ID do Pixel.');
        return;
      }
      if (!/^\d+$/.test(id)) {
        alert('O ID do Pixel deve conter apenas números.');
        return;
      }
      
      if (facebookPixelsList.some(p => p.id === id)) {
        alert('Este ID de Pixel já está cadastrado na lista.');
        return;
      }
      
      facebookPixelsList.push({ id, token });
      
      newIdInput.value = '';
      newTokenInput.value = '';
      
      renderPixelsTable();
    });
  }

  // Ação de salvar lista de pixels no Supabase
  const btnSavePixelsConfig = document.getElementById('btn-save-pixels-config');
  if (btnSavePixelsConfig) {
    btnSavePixelsConfig.addEventListener('click', async () => {
      btnSavePixelsConfig.disabled = true;
      btnSavePixelsConfig.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Salvando...`;
      
      const primaryPixel = facebookPixelsList[0] || { id: '', token: '' };
      
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            facebook_pixel_id: primaryPixel.id,
            facebook_pixel_token: primaryPixel.token,
            facebook_pixels: JSON.stringify(facebookPixelsList),
            ads_expense: adsExpenseRate
          })
        });
        
        if (response.ok) {
          facebookPixelId = primaryPixel.id;
          facebookPixelToken = primaryPixel.token;
          
          if (configPixelId) configPixelId.value = primaryPixel.id;
          if (configPixelToken) configPixelToken.value = primaryPixel.token;
          
          alert('Lista de múltiplos pixels salva e sincronizada com sucesso!');
        } else {
          const text = await response.text();
          alert(`Erro ao salvar lista de pixels: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro ao salvar múltiplos pixels.');
      } finally {
        btnSavePixelsConfig.disabled = false;
        btnSavePixelsConfig.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Salvar Lista de Pixels no Servidor`;
      }
    });
  }

  function loadPixelSettings() {
    renderPixelsTable();
  }

  // ==========================================
  // CONTROLLER: VISUAL CHECKOUT CUSTOMIZER (PERSONALIZAR CHECKOUT)
  // ==========================================

  // 1. Inicializar os Accordions
  const accordionItems = document.querySelectorAll('.accordion-item');
  accordionItems.forEach(item => {
    const header = item.querySelector('.accordion-header');
    if (header) {
      header.addEventListener('click', () => {
        const isActive = item.classList.contains('active');
        accordionItems.forEach(oi => oi.classList.remove('active'));
        if (!isActive) {
          item.classList.add('active');
        }
      });
    }
  });

  // 2. Carregador de Fontes do Google
  function loadGoogleFont(fontName) {
    const fontId = 'font-' + fontName.toLowerCase().replace(/\s+/g, '-');
    if (!document.getElementById(fontId)) {
      const link = document.createElement('link');
      link.id = fontId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@300;400;500;700&display=swap`;
      document.head.appendChild(link);
    }
  }

  // 3. Conversor e Uploader de Imagem Base64 Nativo
  function setupImageUploader(inputId, previewImgId, containerId, clearBtnId, themeKey) {
    const input = document.getElementById(inputId);
    const previewImg = document.getElementById(previewImgId);
    const container = document.getElementById(containerId);
    const clearBtn = document.getElementById(clearBtnId);
    
    if (input && previewImg && container && clearBtn) {
      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (file.size > 2 * 1024 * 1024) {
            alert('A imagem é muito grande! Escolha um arquivo de até 2MB.');
            input.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target.result;
            themeConfig[themeKey] = base64;
            
            // Preview
            previewImg.src = base64;
            previewImg.classList.remove('hide');
            
            const placeholder = container.querySelector('.preview-placeholder');
            if (placeholder) placeholder.classList.add('hide');
            
            clearBtn.classList.remove('hide');
            
            // Mockup
            updateMockup();
          };
          reader.readAsDataURL(file);
        }
      });
      
      clearBtn.addEventListener('click', () => {
        themeConfig[themeKey] = '';
        input.value = '';
        previewImg.src = '';
        previewImg.classList.add('hide');
        
        const placeholder = container.querySelector('.preview-placeholder');
        if (placeholder) placeholder.classList.remove('hide');
        
        clearBtn.classList.add('hide');
        
        // Mockup
        updateMockup();
      });
    }
  }

  setupImageUploader('theme-logo-input', 'theme-logo-preview', 'theme-logo-preview-container', 'btn-clear-logo', 'logo');
  setupImageUploader('theme-favicon-input', 'theme-favicon-preview', 'theme-favicon-preview-container', 'btn-clear-favicon', 'favicon');
  setupImageUploader('theme-banner-desktop-input', 'theme-banner-desktop-preview', 'theme-banner-desktop-preview-container', 'btn-clear-banner-desktop', 'bannerDesktop');
  setupImageUploader('theme-banner-mobile-input', 'theme-banner-mobile-preview', 'theme-banner-mobile-preview-container', 'btn-clear-banner-mobile', 'bannerMobile');

  // 4. Mapeamento de Inputs de Sincronização Dinâmica
  const inputsToSync = [
    { id: 'theme-logo-center', key: 'logoCenter', type: 'checkbox' },
    { id: 'theme-logo-width', key: 'logoWidth', type: 'number' },
    { id: 'theme-announcement-active', key: 'announcementActive', type: 'checkbox' },
    { id: 'theme-announcement-text', key: 'announcementText', type: 'text' },
    { id: 'theme-announcement-bg', key: 'announcementBg', type: 'color' },
    { id: 'theme-announcement-color', key: 'announcementColor', type: 'color' },
    { id: 'theme-banner-active', key: 'bannerActive', type: 'checkbox' },
    { id: 'theme-summary-hide-coupon', key: 'summaryHideCoupon', type: 'checkbox' },
    { id: 'theme-summary-show-testimonials', key: 'summaryShowTestimonials', type: 'checkbox' },
    { id: 'theme-testimonials-title', key: 'testimonialsTitle', type: 'text' },
    { id: 'theme-testimonial-1-name', key: 'testimonial1Name', type: 'text' },
    { id: 'theme-testimonial-1-text', key: 'testimonial1Text', type: 'text' },
    { id: 'theme-testimonial-2-name', key: 'testimonial2Name', type: 'text' },
    { id: 'theme-testimonial-2-text', key: 'testimonial2Text', type: 'text' },
    { id: 'theme-testimonial-3-name', key: 'testimonial3Name', type: 'text' },
    { id: 'theme-testimonial-3-text', key: 'testimonial3Text', type: 'text' },
    { id: 'theme-step-border-radius', key: 'stepBorderRadius', type: 'select' },
    { id: 'theme-step-bg-color', key: 'stepBgColor', type: 'color' },
    { id: 'theme-step-border-color', key: 'stepBorderColor', type: 'color' },
    { id: 'theme-scarcity-active', key: 'scarcityActive', type: 'checkbox' },
    { id: 'theme-scarcity-text', key: 'scarcityText', type: 'text' },
    { id: 'theme-scarcity-duration', key: 'scarcityDuration', type: 'number' },
    { id: 'theme-scarcity-bar-color', key: 'scarcityBarColor', type: 'color' },
    { id: 'theme-pix-instructions', key: 'pixInstructions', type: 'text' },
    { id: 'theme-color-page-bg', key: 'colorPageBg', type: 'color' },
    { id: 'theme-color-header-bg', key: 'colorHeaderBg', type: 'color' },
    { id: 'theme-color-footer-bg', key: 'colorFooterBg', type: 'color' },
    { id: 'theme-color-primary', key: 'colorPrimary', type: 'color' },
    { id: 'theme-color-text-main', key: 'colorTextMain', type: 'color' },
    { id: 'theme-color-text-muted', key: 'colorTextMuted', type: 'color' },
    { id: 'theme-btn-text', key: 'btnText', type: 'text' },
    { id: 'theme-btn-style', key: 'btnStyle', type: 'select' },
    { id: 'theme-btn-lock-icon', key: 'btnLockIcon', type: 'checkbox' },
    { id: 'theme-back-link-active', key: 'backLinkActive', type: 'checkbox' },
    { id: 'theme-back-link-text', key: 'backLinkText', type: 'text' },
    { id: 'theme-back-link-url', key: 'backLinkUrl', type: 'text' },
    { id: 'theme-typography', key: 'typography', type: 'select' },
    { id: 'theme-product-name', key: 'productName', type: 'text' },
    { id: 'theme-product-size', key: 'productSize', type: 'text' },
    { id: 'theme-product-price', key: 'productPrice', type: 'number' },
    { id: 'theme-footer-bg-color', key: 'footerBgColor', type: 'color' },
    { id: 'theme-footer-text-color', key: 'footerTextColor', type: 'color' },
    { id: 'theme-footer-store-name', key: 'footerStoreName', type: 'text' },
    { id: 'theme-footer-store-address', key: 'footerStoreAddress', type: 'text' },
    { id: 'theme-footer-store-cnpj', key: 'footerStoreCnpj', type: 'text' },
    { id: 'theme-footer-store-phone', key: 'footerStorePhone', type: 'text' },
    { id: 'theme-footer-store-email', key: 'footerStoreEmail', type: 'text' },
    { id: 'theme-default-payment-method', key: 'defaultPaymentMethod', type: 'select' }
  ];

  function setupInputSync() {
    inputsToSync.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) {
        const updateVal = () => {
          if (item.type === 'checkbox') {
            themeConfig[item.key] = el.checked;
          } else if (item.type === 'number') {
            themeConfig[item.key] = parseFloat(el.value) || 0;
          } else {
            themeConfig[item.key] = el.value;
          }
          
          if (item.type === 'color') {
            const hexEl = document.getElementById(item.id + '-hex');
            if (hexEl) {
              hexEl.value = el.value.toUpperCase();
            }
          }
          
          if (item.id === 'theme-logo-width') {
            const valEl = document.getElementById('theme-logo-width-val');
            if (valEl) {
              valEl.textContent = el.value + 'px';
            }
          }
          
          updateMockup();
        };
        el.addEventListener('input', updateVal);
        el.addEventListener('change', updateVal);
      }
    });
  }

  setupInputSync();

  // 5. Preencher formulário customizador
  function fillCustomizerForm() {
    inputsToSync.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) {
        if (item.type === 'checkbox') {
          el.checked = !!themeConfig[item.key];
        } else if (item.id === 'theme-logo-width') {
          el.value = themeConfig[item.key] !== undefined ? themeConfig[item.key] : 130;
        } else {
          el.value = themeConfig[item.key] !== undefined ? themeConfig[item.key] : '';
        }
        
        if (item.type === 'color') {
          const hexEl = document.getElementById(item.id + '-hex');
          if (hexEl) {
            hexEl.value = String(themeConfig[item.key] || '').toUpperCase();
          }
        }
        
        if (item.id === 'theme-logo-width') {
          const valEl = document.getElementById('theme-logo-width-val');
          if (valEl) {
            valEl.textContent = el.value + 'px';
          }
        }
      }
    });
    
    // Imagens Base64
    const imagesToFill = [
      { key: 'logo', previewImgId: 'theme-logo-preview', containerId: 'theme-logo-preview-container', clearBtnId: 'btn-clear-logo' },
      { key: 'favicon', previewImgId: 'theme-favicon-preview', containerId: 'theme-favicon-preview-container', clearBtnId: 'btn-clear-favicon' },
      { key: 'bannerDesktop', previewImgId: 'theme-banner-desktop-preview', containerId: 'theme-banner-desktop-preview-container', clearBtnId: 'btn-clear-banner-desktop' },
      { key: 'bannerMobile', previewImgId: 'theme-banner-mobile-preview', containerId: 'theme-banner-mobile-preview-container', clearBtnId: 'btn-clear-banner-mobile' }
    ];
    
    imagesToFill.forEach(item => {
      const previewImg = document.getElementById(item.previewImgId);
      const container = document.getElementById(item.containerId);
      const clearBtn = document.getElementById(item.clearBtnId);
      
      if (previewImg && container && clearBtn) {
        const val = themeConfig[item.key];
        if (val) {
          previewImg.src = val;
          previewImg.classList.remove('hide');
          const placeholder = container.querySelector('.preview-placeholder');
          if (placeholder) placeholder.classList.add('hide');
          clearBtn.classList.remove('hide');
        } else {
          previewImg.src = '';
          previewImg.classList.add('hide');
          const placeholder = container.querySelector('.preview-placeholder');
          if (placeholder) placeholder.classList.remove('hide');
          clearBtn.classList.add('hide');
        }
      }
    });

    // Populate Shopify integration screen inputs from themeConfig
    const shDomainPrefix = document.getElementById('sh-domain-prefix');
    const shAccessToken = document.getElementById('sh-access-token');
    const shClientId = document.getElementById('sh-client-id');
    const shSecret = document.getElementById('sh-secret');
    const shSkipCart = document.getElementById('sh-skip-cart');
    const shImportCoupons = document.getElementById('sh-import-coupons');

    if (shDomainPrefix) shDomainPrefix.value = themeConfig.shopifyDomain || 's1pwiw-kv';
    if (shAccessToken) shAccessToken.value = themeConfig.shopifyToken || 'shpat_c0e256979d2452fc854db87384386xxxx';
    if (shClientId) shClientId.value = themeConfig.shopifyClientId || '01f8ba9c35c5bb9bef70d949d2356676';
    if (shSecret) shSecret.value = themeConfig.shopifySecret || 'shpss_252c116837c44ea156428f65c773xxxx';
    if (shSkipCart) shSkipCart.checked = !!themeConfig.shopifySkipCart;
    if (shImportCoupons) shImportCoupons.checked = !!themeConfig.shopifyImportCoupons;
    
    // Inicialização do Status da Integração com compatibilidade inteligente
    let isShopifyActive = false;
    if (themeConfig.shopifyActive !== undefined) {
      isShopifyActive = !!themeConfig.shopifyActive;
    } else {
      isShopifyActive = !!(themeConfig.shopifyDomain && themeConfig.shopifyToken && themeConfig.shopifyDomain !== 's1pwiw-kv');
    }
    themeConfig.shopifyActive = isShopifyActive;
    updateStatusBadgeVisual(isShopifyActive);
    updateTokenFieldVisibility();
    
    // --- WOOCOMMERCE INIT ---
    const wcDomainPrefix = document.getElementById('wc-domain-prefix');
    const wcConsumerKey = document.getElementById('wc-consumer-key');
    const wcConsumerSecret = document.getElementById('wc-consumer-secret');
    const wcImportCoupons = document.getElementById('wc-import-coupons');

    if (wcDomainPrefix) wcDomainPrefix.value = themeConfig.wooCommerceDomain || 'nacional-brasil.store';
    if (wcConsumerKey) wcConsumerKey.value = themeConfig.wooCommerceConsumerKey || '';
    if (wcConsumerSecret) wcConsumerSecret.value = themeConfig.wooCommerceConsumerSecret || '';
    if (wcImportCoupons) wcImportCoupons.checked = !!themeConfig.wooCommerceImportCoupons;

    let isWooCommerceActive = !!themeConfig.wooCommerceActive;
    themeConfig.wooCommerceActive = isWooCommerceActive;
    updateWooCommerceStatusVisual(isWooCommerceActive);

    updateMockup();
  }

  // 6. Atualizar Mockup em Tempo Real
  function updateMockup() {
    const mockupRoot = document.getElementById('mockup-viewport-root');
    if (!mockupRoot) return;
    
    // Fonte Google
    if (themeConfig.typography) {
      loadGoogleFont(themeConfig.typography);
      mockupRoot.style.fontFamily = `'${themeConfig.typography}', sans-serif`;
    }
    
    // Variáveis CSS do Mockup
    mockupRoot.style.setProperty('--mock-primary-color', themeConfig.colorPrimary || '#164620');
    mockupRoot.style.setProperty('--mock-text-main', themeConfig.colorTextMain || '#111827');
    mockupRoot.style.setProperty('--mock-text-muted', themeConfig.colorTextMuted || '#6b7280');
    mockupRoot.style.setProperty('--mock-bg-color', themeConfig.colorPageBg || '#f4f6fa');
    mockupRoot.style.setProperty('--mock-header-bg', themeConfig.colorHeaderBg || '#ffffff');
    mockupRoot.style.setProperty('--mock-footer-bg', themeConfig.colorFooterBg || '#164620');
    mockupRoot.style.setProperty('--mock-step-bg', themeConfig.stepBgColor || '#ffffff');
    mockupRoot.style.setProperty('--mock-border-color', themeConfig.stepBorderColor || '#e5e7eb');
    mockupRoot.style.setProperty('--mock-border-radius', themeConfig.stepBorderRadius || '12px');
    mockupRoot.style.setProperty('--mock-logo-width', (themeConfig.logoWidth || 130) + 'px');
    
    // Barra de Avisos
    const mockAnnBar = document.getElementById('mock-ann-bar');
    if (mockAnnBar) {
      mockAnnBar.classList.toggle('hide', !themeConfig.announcementActive);
      const span = mockAnnBar.querySelector('span');
      if (span) span.innerText = themeConfig.announcementText || 'FRETE GRÁTIS hoje para todo o Brasil!';
      mockAnnBar.style.background = themeConfig.announcementBg || '#7c4dff';
      mockAnnBar.style.color = themeConfig.announcementColor || '#ffffff';
    }
    
    // Link Voltar
    const mockBackLink = document.getElementById('mock-back-link-element');
    if (mockBackLink) {
      mockBackLink.classList.toggle('hide', !themeConfig.backLinkActive);
      const span = document.getElementById('mock-back-link-text');
      if (span) span.innerText = themeConfig.backLinkText || 'Voltar para a Loja';
    }
    
    // Logomarca e Alinhamento
    const mockLogoPlaceholder = document.getElementById('mock-logo-placeholder');
    const mockLogoImg = document.getElementById('mock-logo-img');
    const mockLogoWrapper = document.getElementById('mock-logo-wrapper');
    
    if (themeConfig.logo) {
      if (mockLogoPlaceholder) mockLogoPlaceholder.classList.add('hide');
      if (mockLogoImg) {
        mockLogoImg.src = themeConfig.logo;
        mockLogoImg.classList.remove('hide');
      }
    } else {
      if (mockLogoPlaceholder) {
        mockLogoPlaceholder.classList.remove('hide');
        mockLogoPlaceholder.innerText = themeConfig.footerStoreName || 'Sua Logo';
      }
      if (mockLogoImg) {
        mockLogoImg.src = '';
        mockLogoImg.classList.add('hide');
      }
    }
    
    const mockHeaderElement = document.getElementById('mock-header-element');
    if (mockLogoWrapper) {
      const isMobile = mockupRoot.classList.contains('device-mobile');
      if (themeConfig.logoCenter) {
        mockLogoWrapper.style.width = '100%';
        mockLogoWrapper.style.justifyContent = 'center';
        if (!isMobile) {
          mockLogoWrapper.style.position = 'absolute';
          mockLogoWrapper.style.left = '0';
          mockLogoWrapper.style.right = '0';
          mockLogoWrapper.style.pointerEvents = 'none';
        } else {
          mockLogoWrapper.style.position = 'static';
          mockLogoWrapper.style.left = 'auto';
          mockLogoWrapper.style.right = 'auto';
          mockLogoWrapper.style.pointerEvents = 'auto';
        }
        if (mockHeaderElement) {
          mockHeaderElement.style.justifyContent = 'space-between';
          mockHeaderElement.style.gap = '0';
        }
        if (mockLogoWrapper) mockLogoWrapper.style.order = '1';
        if (mockBackLink) mockBackLink.style.order = '2';
      } else {
        mockLogoWrapper.style.width = 'auto';
        mockLogoWrapper.style.justifyContent = 'flex-start';
        mockLogoWrapper.style.position = 'static';
        mockLogoWrapper.style.left = 'auto';
        mockLogoWrapper.style.right = 'auto';
        mockLogoWrapper.style.pointerEvents = 'auto';
        if (mockHeaderElement) {
          if (!isMobile) {
            mockHeaderElement.style.justifyContent = 'flex-start';
            mockHeaderElement.style.gap = '20px';
          } else {
            mockHeaderElement.style.justifyContent = 'center';
            mockHeaderElement.style.gap = '8px';
          }
        }
        if (mockLogoWrapper) mockLogoWrapper.style.order = '2';
        if (mockBackLink) mockBackLink.style.order = '1';
      }
    }
    
    // Banner Promocional
    const mockPromoBanner = document.getElementById('mock-promo-banner-element');
    if (mockPromoBanner) {
      mockPromoBanner.classList.toggle('hide', !themeConfig.bannerActive);
      const isMobile = mockupRoot.classList.contains('device-mobile');
      const bannerDesktopImg = document.getElementById('mock-promo-banner-desktop');
      const bannerMobileImg = document.getElementById('mock-promo-banner-mobile');
      const bannerPlaceholder = mockPromoBanner.querySelector('.banner-mock-placeholder');
      
      if (themeConfig.bannerActive) {
        if (isMobile) {
          if (bannerDesktopImg) bannerDesktopImg.classList.add('hide');
          if (themeConfig.bannerMobile) {
            if (bannerPlaceholder) bannerPlaceholder.classList.add('hide');
            if (bannerMobileImg) {
              bannerMobileImg.src = themeConfig.bannerMobile;
              bannerMobileImg.classList.remove('hide');
            }
          } else {
            if (bannerPlaceholder) bannerPlaceholder.classList.remove('hide');
            if (bannerMobileImg) bannerMobileImg.classList.add('hide');
          }
        } else {
          if (bannerMobileImg) bannerMobileImg.classList.add('hide');
          if (themeConfig.bannerDesktop) {
            if (bannerPlaceholder) bannerPlaceholder.classList.add('hide');
            if (bannerDesktopImg) {
              bannerDesktopImg.src = themeConfig.bannerDesktop;
              bannerDesktopImg.classList.remove('hide');
            }
          } else {
            if (bannerPlaceholder) bannerPlaceholder.classList.remove('hide');
            if (bannerDesktopImg) bannerDesktopImg.classList.add('hide');
          }
        }
      }
    }
    
    // Escassez
    const mockScarcity = document.getElementById('mock-scarcity-element');
    if (mockScarcity) {
      mockScarcity.classList.toggle('hide', !themeConfig.scarcityActive);
      const textVal = document.getElementById('mock-scarcity-text-val');
      if (textVal) textVal.innerText = themeConfig.scarcityText || 'Desconto reservado! Garanta antes que o tempo acabe:';
      
      const timerDigits = mockScarcity.querySelector('.mock-timer-digits');
      if (timerDigits) timerDigits.innerText = String(themeConfig.scarcityDuration || 15).padStart(2, '0') + ':00';
      
      const progressBar = document.getElementById('mock-scarcity-progress-bar');
      if (progressBar) {
        progressBar.style.background = themeConfig.scarcityBarColor || '#ef4444';
      }
    }
    
    // Atualização de Produto customizado no Mockup
    const mockProdName = document.getElementById('mock-summary-product-name');
    const mockProdSize = document.getElementById('mock-summary-product-size');
    const mockProdPrice = document.getElementById('mock-summary-product-price');
    const mockSubtotalVal = document.getElementById('mock-summary-subtotal-val');
    const mockTotalVal = document.getElementById('mock-summary-total-val');
    
    const prodPrice = parseFloat(themeConfig.productPrice !== undefined ? themeConfig.productPrice : 10.00);
    const formattedPrice = 'R$ ' + prodPrice.toFixed(2).replace('.', ',');
    
    if (mockProdName) mockProdName.innerText = themeConfig.productName || 'item.product.name';
    if (mockProdSize) mockProdSize.innerText = themeConfig.productSize || 'size';
    if (mockProdPrice) mockProdPrice.innerText = formattedPrice;
    if (mockSubtotalVal) mockSubtotalVal.innerText = formattedPrice;
    if (mockTotalVal) mockTotalVal.innerText = formattedPrice;

    // Cupom e Depoimentos
    const mockCouponContainer = document.getElementById('mock-coupon-container');
    if (mockCouponContainer) {
      mockCouponContainer.classList.toggle('hide', !!themeConfig.summaryHideCoupon);
    }
    
    const mockTestimonialsContainer = document.getElementById('mock-testimonials-container');
    if (mockTestimonialsContainer) {
      mockTestimonialsContainer.classList.toggle('hide', !themeConfig.summaryShowTestimonials);
      const titleVal = document.getElementById('mock-testimonials-title-val');
      if (titleVal) titleVal.innerText = themeConfig.testimonialsTitle || 'O que dizem nossos clientes:';
      
      const t1Name = document.getElementById('mock-testimonial-1-name-val');
      const t1Text = document.getElementById('mock-testimonial-1-text-val');
      if (t1Name) t1Name.innerText = themeConfig.testimonial1Name || 'Mariana Silva';
      if (t1Text) t1Text.innerText = themeConfig.testimonial1Text || '';
      
      const t2Name = document.getElementById('mock-testimonial-2-name-val');
      const t2Text = document.getElementById('mock-testimonial-2-text-val');
      if (t2Name) t2Name.innerText = themeConfig.testimonial2Name || 'Carlos Eduardo';
      if (t2Text) t2Text.innerText = themeConfig.testimonial2Text || '';
      
      const t3Name = document.getElementById('mock-testimonial-3-name-val');
      const t3Text = document.getElementById('mock-testimonial-3-text-val');
      if (t3Name) t3Name.innerText = themeConfig.testimonial3Name || 'Beatriz Souza';
      if (t3Text) t3Text.innerText = themeConfig.testimonial3Text || '';
    }
    
    // Botão Principal
    const mockActionBtn = document.getElementById('mock-action-btn-element');
    const mockActionBtnText = document.getElementById('mock-action-btn-text');
    const mockActionBtnLock = document.getElementById('mock-action-btn-lock');
    
    if (mockActionBtnText) {
      let text = themeConfig.btnText || 'Finalizar Compra';
      if (text === 'Concluir Compra Segura') {
        text = 'Finalizar Compra';
      }
      mockActionBtnText.innerText = text;
    }
    let hasLock = !!themeConfig.btnLockIcon;
    if (themeConfig.btnText === 'Concluir Compra Segura') {
      hasLock = false;
    }
    if (mockActionBtnLock) mockActionBtnLock.classList.toggle('hide', !hasLock);
    
    if (mockActionBtn) {
      mockActionBtn.classList.remove('style-glow', 'style-gradient');
      if (themeConfig.btnStyle === 'glow') {
        mockActionBtn.classList.add('style-glow');
      } else if (themeConfig.btnStyle === 'gradient') {
        mockActionBtn.classList.add('style-gradient');
      }
    }

    // Rodapé Sincronização Dinâmica em Tempo Real
    const mockFooterElement = document.getElementById('mock-footer-element');
    if (mockFooterElement) {
      const footerBg = themeConfig.footerBgColor || themeConfig.colorFooterBg || '#164620';
      const footerText = themeConfig.footerTextColor || '#ffffff';
      
      mockFooterElement.style.backgroundColor = footerBg;
      mockFooterElement.style.color = footerText;
      
      const storeName = themeConfig.footerStoreName || 'Checkout';
      const storeAddress = themeConfig.footerStoreAddress || '';
      const storeCnpj = themeConfig.footerStoreCnpj || '';
      const storePhone = themeConfig.footerStorePhone || '';
      const storeEmail = themeConfig.footerStoreEmail || '';
      
      const mockNameText = document.getElementById('mock-footer-store-name-text');
      if (mockNameText) {
        mockNameText.innerText = `${storeName} | Todos os direitos reservados`;
        mockNameText.style.color = footerText;
      }
      
      const mockAddressText = document.getElementById('mock-footer-store-address-text');
      if (mockAddressText) {
        mockAddressText.innerText = storeAddress;
        mockAddressText.style.color = footerText;
        mockAddressText.classList.toggle('hide', !storeAddress);
      }
      
      const mockCopyrightText = document.getElementById('mock-footer-store-copyright-text');
      if (mockCopyrightText) {
        const year = new Date().getFullYear();
        mockCopyrightText.innerText = `© ${year} ${storeName} ${storeCnpj ? `- CNPJ: ${storeCnpj}` : ''}`;
        mockCopyrightText.style.color = footerText;
      }
      
      const mockContactText = document.getElementById('mock-footer-store-contact-text');
      if (mockContactText) {
        let contactStr = '';
        if (storePhone) contactStr += `Telefone: ${storePhone} `;
        if (storeEmail) contactStr += `E-mail: ${storeEmail}`;
        mockContactText.innerText = contactStr.trim();
        mockContactText.style.color = footerText;
        mockContactText.classList.toggle('hide', !contactStr.trim());
      }
      
      const paymentTitle = mockFooterElement.querySelector('.payment-title');
      if (paymentTitle) paymentTitle.style.color = footerText;
      
      const securitySeal = mockFooterElement.querySelector('.security-seal');
      if (securitySeal) {
        securitySeal.style.color = footerText;
        const sealSpans = securitySeal.querySelectorAll('span');
        sealSpans.forEach(span => span.style.color = footerText);
      }
    }
  }

  // 7. Alternador de Dispositivos (Desktop / Mobile)
  const deviceBtns = document.querySelectorAll('.btn-device-toggle');
  deviceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      deviceBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const device = btn.dataset.device;
      const mockupViewport = document.getElementById('mockup-viewport-root');
      if (mockupViewport) {
        mockupViewport.classList.remove('device-desktop', 'device-mobile');
        if (device === 'mobile') {
          mockupViewport.classList.add('device-mobile');
        } else {
          mockupViewport.classList.add('device-desktop');
        }
        updateMockup();
      }
    });
  });

  // 8. Abas Interativas de Pagamento no Mockup
  const mockPaymentTabs = document.querySelectorAll('.mock-payment-tab');
  mockPaymentTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mockPaymentTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const mockStep3Body = document.querySelector('#mock-step-3 .mock-step-body');
      if (mockStep3Body) {
        const inputs = mockStep3Body.querySelectorAll('.mock-input-field');
        const pixContainer = mockStep3Body.querySelector('.mock-pix-container');
        if (pixContainer) pixContainer.remove();
        
        if (tab.innerText.includes('Pix')) {
          inputs.forEach(i => i.style.display = 'none');
          
          const pixDiv = document.createElement('div');
          pixDiv.className = 'mock-pix-container';
          pixDiv.style.display = 'flex';
          pixDiv.style.flexDirection = 'column';
          pixDiv.style.alignItems = 'center';
          pixDiv.style.gap = '8px';
          pixDiv.style.marginTop = '12px';
          pixDiv.style.width = '100%';
          pixDiv.innerHTML = `
            <div style="width:100px; height:100px; background:#e2e8f0; display:flex; align-items:center; justify-content:center; border-radius:8px; border:1px dashed #cbd5e1;">
              <i class="fa-brands fa-pix" style="font-size:2rem; color:#32bcad;"></i>
            </div>
            <p style="font-size:8px; color:var(--mock-text-muted); text-align:center; margin:0 8px; line-height:1.3;">
              ${themeConfig.pixInstructions || 'Escaneie o código QR acima ou utilize o Pix Copia e Cola para realizar o pagamento do seu pedido.'}
            </p>
          `;
          const actionBtn = document.getElementById('mock-action-btn-element');
          mockStep3Body.insertBefore(pixDiv, actionBtn);
        } else {
          inputs.forEach(i => i.style.display = 'block');
        }
      }
    });
  });

  // 9. Ação de Salvar Personalização
  const btnSaveTheme = document.getElementById('btn-save-theme');
  if (btnSaveTheme) {
    btnSaveTheme.addEventListener('click', async () => {
      btnSaveTheme.disabled = true;
      const originalHtml = btnSaveTheme.innerHTML;
      btnSaveTheme.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Salvando...`;
      
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            checkout_theme_config: JSON.stringify(themeConfig)
          })
        });
        
        if (response.ok) {
          alert('Identidade visual e temas do checkout salvos com sucesso!');
        } else {
          const text = await response.text();
          alert(`Erro ao salvar personalização: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao salvar configurações de personalização.');
      } finally {
        btnSaveTheme.disabled = false;
        btnSaveTheme.innerHTML = originalHtml;
      }
    });
  }

  // ==========================================
  // LOGIC FOR SINCRONIZAR SHOPIFY (SHOPIFY INTEGRATION VIEW)
  // ==========================================
  
  // Helper para alternar visibilidade do campo de Token conforme a presença do token real
  function updateTokenFieldVisibility() {
    const tokenInput = document.getElementById('sh-access-token');
    const container = document.getElementById('sh-access-token-container');
    const msg = document.getElementById('sh-awaiting-token-msg');

    if (!tokenInput || !container || !msg) return;

    const tokenVal = tokenInput.value.trim();
    const hasToken = tokenVal && tokenVal !== 'shpat_c0e256979d2452fc854db87384386xxxx' && tokenVal !== '';

    if (hasToken) {
      container.style.display = 'block';
      msg.style.display = 'none';
    } else {
      container.style.display = 'none';
      msg.style.display = 'flex';
    }
  }

  // Helper para atualizar visualmente o status da integração Shopify
  function updateStatusBadgeVisual(isActive) {
    const container = document.getElementById('shopify-status-container');
    const icon = document.getElementById('shopify-status-icon');
    const text = document.getElementById('shopify-status-text');
    const select = document.getElementById('shopify-status-select');

    if (!container || !icon || !text || !select) return;

    if (isActive) {
      container.style.background = 'rgba(16, 185, 129, 0.08)';
      container.style.border = '1px solid rgba(16, 185, 129, 0.2)';
      container.style.color = '#10b981';
      icon.className = 'fa-solid fa-circle-check';
      text.innerText = 'Ativo';
      select.value = 'active';
    } else {
      container.style.background = 'rgba(156, 163, 175, 0.08)';
      container.style.border = '1px solid rgba(156, 163, 175, 0.2)';
      container.style.color = '#9ca3af';
      icon.className = 'fa-solid fa-circle-minus';
      text.innerText = 'Inativo';
      select.value = 'inactive';
    }
  }

  // Listener para revelar campo de token manualmente
  const btnShowTokenInputManual = document.getElementById('btn-show-token-input-manual');
  if (btnShowTokenInputManual) {
    btnShowTokenInputManual.addEventListener('click', (e) => {
      e.preventDefault();
      const container = document.getElementById('sh-access-token-container');
      const msg = document.getElementById('sh-awaiting-token-msg');
      if (container && msg) {
        container.style.display = 'block';
        msg.style.display = 'none';
        
        // Limpar o placeholder padrão para facilitar colagem manual do token correto shpat_
        const tokenInput = document.getElementById('sh-access-token');
        if (tokenInput && tokenInput.value === 'shpat_c0e256979d2452fc854db87384386xxxx') {
          tokenInput.value = '';
        }
      }
    });
  }

  // Listener para gerar o token via Client Credentials da API Shopify de forma imediata
  const btnGenerateTokenCredentials = document.getElementById('btn-generate-token-credentials');
  if (btnGenerateTokenCredentials) {
    btnGenerateTokenCredentials.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const rawDomain = document.getElementById('sh-domain-prefix').value.trim();
      const shopParam = rawDomain.replace(/\.myshopify\.com$/, '');
      const clientId = document.getElementById('sh-client-id').value.trim();
      const secret = document.getElementById('sh-secret').value.trim();

      if (!shopParam || !clientId || !secret || clientId === '01f8ba9c35c5bb9bef70d949d2356676' || secret === 'shpss_252c116837c44ea156428f65c773xxxx') {
        alert('Atenção: Para gerar o Token de acesso automaticamente, preencha primeiro o seu Domínio MyShopify, o seu Client ID e o seu Secret (API Secret Key) nos campos abaixo.');
        return;
      }

      const originalHtml = btnGenerateTokenCredentials.innerHTML;
      btnGenerateTokenCredentials.disabled = true;
      btnGenerateTokenCredentials.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Gerando...`;

      try {
        console.log('📡 Solicitando geração de token via Client Credentials para:', shopParam);
        const response = await fetch('/api/shopify?action=exchange_credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            shop: shopParam,
            client_id: clientId,
            client_secret: secret
          })
        });

        if (response.ok) {
          const resData = await response.json();
          const permanentToken = resData.access_token;

          // Preencher os dados no formulário
          const shAccessTokenInput = document.getElementById('sh-access-token');
          if (shAccessTokenInput) shAccessTokenInput.value = permanentToken;

          // Atualizar themeConfig
          themeConfig.shopifyDomain = shopParam;
          themeConfig.shopifyToken = permanentToken;
          themeConfig.shopifyClientId = clientId;
          themeConfig.shopifySecret = secret;
          themeConfig.shopifyActive = true;

          // Atualizar badge visual
          updateStatusBadgeVisual(true);
          updateTokenFieldVisibility();

          // Salvar tudo de forma definitiva no Supabase
          const saveRes = await fetch('/api/config', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              checkout_theme_config: JSON.stringify(themeConfig)
            })
          });

          if (saveRes.ok) {
            alert('Parabéns! O Token de acesso API Admin foi gerado com sucesso e a integração com a Shopify foi ativada!');
            // Dispara a sincronização automática do catálogo em segundo plano
            console.log('🔄 Sincronizando catálogo do Shopify automaticamente...');
            loadShopifyProducts(true);
            loadShopifyCollections(true);
          } else {
            alert('Token gerado com sucesso, mas ocorreu um erro ao salvar as configurações no banco.');
          }
        } else {
          const errText = await response.text();
          let parsedErr = errText;
          try {
            const errObj = JSON.parse(errText);
            parsedErr = errObj.error || errText;
          } catch(e){}
          alert(`Erro ao gerar token com a Shopify: ${parsedErr}\n\nCertifique-se de que o Client ID e Client Secret correspondem às credenciais corretas do seu Custom App no Shopify.`);
        }
      } catch (err) {
        console.error('Erro na geração de token via credentials:', err);
        alert('Ocorreu um erro de rede ao tentar gerar o token da Shopify.');
      } finally {
        btnGenerateTokenCredentials.disabled = false;
        btnGenerateTokenCredentials.innerHTML = originalHtml;
      }
    });
  }

  // Listener para o seletor dropdown do Status da Integração
  const shopifyStatusSelect = document.getElementById('shopify-status-select');
  if (shopifyStatusSelect) {
    shopifyStatusSelect.addEventListener('change', async (e) => {
      const newValue = e.target.value;
      const isActive = (newValue === 'active');
      themeConfig.shopifyActive = isActive;
      updateStatusBadgeVisual(isActive);

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            checkout_theme_config: JSON.stringify(themeConfig)
          })
        });

        if (response.ok) {
          alert(`Status da integração Shopify atualizado para: ${isActive ? 'Ativo' : 'Inativo'}!`);
        } else {
          const err = await response.text();
          alert('Erro ao atualizar status no banco: ' + err);
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao atualizar status.');
      }
    });
  }

  const btnCopyInstallUrl = document.querySelector('.btn-copy-install-url');
  if (btnCopyInstallUrl) {
    btnCopyInstallUrl.addEventListener('click', () => {
      const urlInput = document.getElementById('sh-install-url');
      if (urlInput) {
        navigator.clipboard.writeText(urlInput.value).then(() => {
          const icon = btnCopyInstallUrl.querySelector('i');
          if (icon) {
            icon.className = 'fa-solid fa-check';
            setTimeout(() => { icon.className = 'fa-solid fa-copy'; }, 2000);
          }
          alert('URL de instalação copiada com sucesso!');
        });
      }
    });
  }

  const btnCopyAppScopes = document.querySelector('.btn-copy-app-scopes');
  if (btnCopyAppScopes) {
    btnCopyAppScopes.addEventListener('click', () => {
      const scopesInput = document.getElementById('sh-app-scopes');
      if (scopesInput) {
        navigator.clipboard.writeText(scopesInput.value).then(() => {
          const icon = btnCopyAppScopes.querySelector('i');
          if (icon) {
            icon.className = 'fa-solid fa-check';
            setTimeout(() => { icon.className = 'fa-solid fa-copy'; }, 2000);
          }
          alert('Escopos do app copiados com sucesso!');
        });
      }
    });
  }

  const btnDisconnectShopify = document.getElementById('btn-disconnect-shopify');
  if (btnDisconnectShopify) {
    btnDisconnectShopify.addEventListener('click', async () => {
      if (confirm('Deseja realmente desconectar a integração com a Shopify? Isso apagará as credenciais salvas.')) {
        const domPref = document.getElementById('sh-domain-prefix');
        const accTok = document.getElementById('sh-access-token');
        const clId = document.getElementById('sh-client-id');
        const sec = document.getElementById('sh-secret');
        const skipC = document.getElementById('sh-skip-cart');
        const impC = document.getElementById('sh-import-coupons');

        if (domPref) domPref.value = '';
        if (accTok) accTok.value = '';
        if (clId) clId.value = '';
        if (sec) sec.value = '';
        if (skipC) skipC.checked = false;
        if (impC) impC.checked = false;

        themeConfig.shopifyDomain = '';
        themeConfig.shopifyToken = '';
        themeConfig.shopifyClientId = '';
        themeConfig.shopifySecret = '';
        themeConfig.shopifySkipCart = false;
        themeConfig.shopifyImportCoupons = false;
        themeConfig.shopifyActive = false;
        
        updateStatusBadgeVisual(false);
        updateTokenFieldVisibility();

        btnDisconnectShopify.disabled = true;
        const originalText = btnDisconnectShopify.innerText;
        btnDisconnectShopify.innerText = 'Salvando...';

        try {
          const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              checkout_theme_config: JSON.stringify(themeConfig)
            })
          });

          if (response.ok) {
            alert('Integração com a Shopify desconectada com sucesso!');
          } else {
            const err = await response.text();
            alert('Erro ao salvar no banco: ' + err);
          }
        } catch (err) {
          console.error(err);
          alert('Erro de rede ao desconectar.');
        } finally {
          btnDisconnectShopify.disabled = false;
          btnDisconnectShopify.innerText = originalText;
        }
      }
    });
  }

  const btnReinstallShopify = document.getElementById('btn-reinstall-shopify');
  if (btnReinstallShopify) {
    btnReinstallShopify.addEventListener('click', () => {
      const domPref = document.getElementById('sh-domain-prefix');
      const accTok = document.getElementById('sh-access-token');
      const clId = document.getElementById('sh-client-id');
      const sec = document.getElementById('sh-secret');
      const skipC = document.getElementById('sh-skip-cart');
      const impC = document.getElementById('sh-import-coupons');

      if (domPref) domPref.value = '';
      if (accTok) accTok.value = '';
      if (clId) clId.value = '';
      if (sec) sec.value = '';
      if (skipC) skipC.checked = false;
      if (impC) impC.checked = false;

      updateTokenFieldVisibility();

      alert('Campos de credenciais da Shopify limpos! Insira as novas informações e clique em "Salvar Configurações" para ativá-las.');
    });
  }

  const shopifyForm = document.getElementById('shopify-integration-form');
  if (shopifyForm) {
    shopifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btnSave = document.getElementById('btn-save-shopify');
      const originalHtml = btnSave ? btnSave.innerHTML : 'Salvar Configurações';
      if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Salvando...`;
      }

      let rawDomain = document.getElementById('sh-domain-prefix').value.trim();
      let cleanDomain = rawDomain.replace(/\.myshopify\.com$/, '');
      themeConfig.shopifyDomain = cleanDomain;
      document.getElementById('sh-domain-prefix').value = cleanDomain; // Atualiza o input visual para o prefixo limpo
      
      const tokenInputVal = document.getElementById('sh-access-token').value.trim();
      themeConfig.shopifyToken = tokenInputVal;

      // Salvar as chaves exatamente como o lojista forneceu (apenas aparando espaços)
      const cleanClientId = document.getElementById('sh-client-id').value.trim();
      themeConfig.shopifyClientId = cleanClientId;
      document.getElementById('sh-client-id').value = cleanClientId;

      const cleanSecret = document.getElementById('sh-secret').value.trim();
      themeConfig.shopifySecret = cleanSecret;
      document.getElementById('sh-secret').value = cleanSecret;

      themeConfig.shopifySkipCart = document.getElementById('sh-skip-cart').checked;
      themeConfig.shopifyImportCoupons = document.getElementById('sh-import-coupons').checked;
      
      themeConfig.shopifyActive = true;
      updateStatusBadgeVisual(true);
      updateTokenFieldVisibility();

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            checkout_theme_config: JSON.stringify(themeConfig)
          })
        });

        if (response.ok) {
          alert('Configurações salvas e integração Shopify ativada com sucesso!');
          // Dispara a sincronização automática do catálogo em segundo plano
          console.log('🔄 Sincronizando catálogo do Shopify automaticamente...');
          loadShopifyProducts(true);
          loadShopifyCollections(true);
        } else {
          const text = await response.text();
          alert(`Erro ao salvar configurações da Shopify: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao sincronizar com Shopify.');
      } finally {
        if (btnSave) {
          btnSave.disabled = false;
          btnSave.innerHTML = originalHtml;
        }
      }
    });
  }

  // Tutorial Modal Listeners
  const linkShopifyTutorial = document.getElementById('link-shopify-tutorial');
  const shopifyTutorialModal = document.getElementById('shopify-tutorial-modal');
  const btnCloseShopifyTutorial = document.getElementById('btn-close-shopify-tutorial');
  const btnCloseShopifyTutorialFooter = document.getElementById('btn-close-shopify-tutorial-footer');

  if (linkShopifyTutorial && shopifyTutorialModal) {
    linkShopifyTutorial.addEventListener('click', (e) => {
      e.preventDefault();
      shopifyTutorialModal.style.display = 'flex';
    });
  }

  const closeTutorialModal = () => {
    if (shopifyTutorialModal) shopifyTutorialModal.style.display = 'none';
  };

  if (btnCloseShopifyTutorial) btnCloseShopifyTutorial.addEventListener('click', closeTutorialModal);
  if (btnCloseShopifyTutorialFooter) btnCloseShopifyTutorialFooter.addEventListener('click', closeTutorialModal);

  // ==========================================
  // INICIALIZAÇÃO AUTOMÁTICA
  // ==========================================
  (async () => {
    await loadInitialData();

    // URL de Instalação Dinâmica de acordo com o domínio do browser
    const shInstallUrlInput = document.getElementById('sh-install-url');
    if (shInstallUrlInput) {
      shInstallUrlInput.value = `${window.location.origin}/api/postback/shopify/install`;
    }

    // Ativação automática da aba Shopify se vier da instalação do app Shopify
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('shop') || urlParams.get('tab') === 'shopify') {
      const shopifyMenuItem = document.querySelector('.submenu-item[data-view="sincronizar-shopify"]') || 
                             document.querySelector('.menu-item[data-view="sincronizar-shopify"]') ||
                             document.querySelector('[data-view="sincronizar-shopify"]');
      if (shopifyMenuItem) {
        clearActiveMenuStates();
        shopifyMenuItem.classList.add('active');
        
        const parentGroup = shopifyMenuItem.closest('.menu-group');
        if (parentGroup) {
          const parentMenu = parentGroup.querySelector('.menu-parent');
          if (parentMenu) parentMenu.classList.add('active');
          const submenu = parentGroup.querySelector('.submenu');
          if (submenu) submenu.classList.add('expanded');
        }
        
        switchView('sincronizar-shopify');
      }

      if (urlParams.has('shop')) {
        const shopParam = urlParams.get('shop');
        const prefix = shopParam.replace('.myshopify.com', '');
        const shDomainPrefixInput = document.getElementById('sh-domain-prefix');
        if (shDomainPrefixInput) {
          shDomainPrefixInput.value = prefix;
        }

        // Se houver parâmetro 'code', iniciamos a troca de token de acesso automática
        if (urlParams.has('code')) {
          const codeParam = urlParams.get('code');
          const clientId = (themeConfig.shopifyClientId || document.getElementById('sh-client-id').value.trim()).trim();
          const secret = (themeConfig.shopifySecret || document.getElementById('sh-secret').value.trim()).trim();

          if (!clientId || !secret || clientId === '01f8ba9c35c5bb9bef70d949d2356676' || secret === 'shpss_252c116837c44ea156428f65c773xxxx') {
            alert('Atenção: Para gerar o Token de acesso API Admin automaticamente, você precisa primeiro preencher e salvar o seu Client ID e Client Secret na tela de integração da Shopify.');
          } else {
            // Atualiza visualmente para indicar carregamento
            const btnSave = document.getElementById('btn-save-shopify');
            const originalHtml = btnSave ? btnSave.innerHTML : 'Salvar Configurações';
            if (btnSave) {
              btnSave.disabled = true;
              btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Gerando Token...`;
            }

            try {
              console.log('📡 Solicitando troca de código por token para:', shopParam);
              const response = await fetch('/api/shopify?action=exchange_token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  shop: shopParam,
                  code: codeParam,
                  client_id: clientId,
                  client_secret: secret
                })
              });

              if (response.ok) {
                const resData = await response.json();
                const permanentToken = resData.access_token;

                // Preencher os dados no formulário
                const shAccessTokenInput = document.getElementById('sh-access-token');
                if (shAccessTokenInput) shAccessTokenInput.value = permanentToken;

                // Atualizar themeConfig
                themeConfig.shopifyDomain = prefix;
                themeConfig.shopifyToken = permanentToken;
                themeConfig.shopifyClientId = clientId;
                themeConfig.shopifySecret = secret;
                themeConfig.shopifyActive = true;

                // Atualizar badge visual
                updateStatusBadgeVisual(true);
                updateTokenFieldVisibility();

                // Salvar tudo de forma definitiva no Supabase
                const saveRes = await fetch('/api/config', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    checkout_theme_config: JSON.stringify(themeConfig)
                  })
                });

                if (saveRes.ok) {
                  alert('Parabéns! O Token de acesso API Admin foi gerado com sucesso e a integração com a Shopify foi ativada!');
                  // Dispara a sincronização automática do catálogo em segundo plano
                  console.log('🔄 Sincronizando catálogo do Shopify automaticamente...');
                  loadShopifyProducts(true);
                  loadShopifyCollections(true);
                } else {
                  alert('Token gerado com sucesso, mas ocorreu um erro ao salvar as configurações no banco.');
                }
              } else {
                const errText = await response.text();
                alert(`Erro ao gerar token com a Shopify: ${errText}`);
              }
            } catch (err) {
              console.error('Erro na requisição de troca de token:', err);
              alert('Ocorreu um erro de rede ao tentar gerar o token da Shopify.');
            } finally {
              if (btnSave) {
                btnSave.disabled = false;
                btnSave.innerHTML = originalHtml;
              }
            }
          }

          // Limpa os parâmetros de código da URL para não rodar novamente no reload
          const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        }
      }
    }
  })();

  // ==========================================
  // INTEGRAÇÃO DE GATEWAYS EVENT BINDINGS
  // ==========================================
  const togglePaguex = document.getElementById('toggle-paguex');
  const toggleHypercash = document.getElementById('toggle-hypercash');
  const togglePayshark = document.getElementById('toggle-payshark');
  const togglePaysharkV2 = document.getElementById('toggle-payshark_v2');
  const togglePagueflex = document.getElementById('toggle-pagueflex');
  const cardPaguex = document.getElementById('card-paguex');
  const cardHypercash = document.getElementById('card-hypercash');
  const cardPayshark = document.getElementById('card-payshark');
  const cardPaysharkV2 = document.getElementById('card-payshark_v2');
  const cardPagueflex = document.getElementById('card-pagueflex');
  const pPubKeyInput = document.getElementById('paguex-public-key');
  const pSecKeyInput = document.getElementById('paguex-secret-key');
  const hPubKeyInput = document.getElementById('hypercash-public-key');
  const hSecKeyInput = document.getElementById('hypercash-secret-key');
  const psPubKeyInput = document.getElementById('payshark-public-key');
  const psSecKeyInput = document.getElementById('payshark-secret-key');
  const ps2ApiKeyInput = document.getElementById('payshark_v2-api-key');
  const ps2WebhookSecretInput = document.getElementById('payshark_v2-webhook-secret');
  const pfApiKeyInput = document.getElementById('pagueflex-api-key');
  const pfTransferKeyInput = document.getElementById('pagueflex-transfer-key');
  const pfWebhookSecretInput = document.getElementById('pagueflex-webhook-secret');
  const btnSaveIntegracoes = document.getElementById('btn-save-integracoes');

  const updateGatewayToggles = (selected) => {
    if (togglePaguex) togglePaguex.checked = (selected === 'paguex');
    if (toggleHypercash) toggleHypercash.checked = (selected === 'hypercash');
    if (togglePayshark) togglePayshark.checked = (selected === 'payshark');
      if (togglePaysharkV2) togglePaysharkV2.checked = (selected === 'payshark_v2');
    if (togglePagueflex) togglePagueflex.checked = (selected === 'pagueflex');
    
    if (cardPaguex) cardPaguex.classList.toggle('active', selected === 'paguex');
    if (cardHypercash) cardHypercash.classList.toggle('active', selected === 'hypercash');
    if (cardPayshark) cardPayshark.classList.toggle('active', selected === 'payshark');
      if (cardPaysharkV2) cardPaysharkV2.classList.toggle('active', selected === 'payshark_v2');
    if (cardPagueflex) cardPagueflex.classList.toggle('active', selected === 'pagueflex');
  };

  if (togglePaguex) togglePaguex.addEventListener('change', () => { if(togglePaguex.checked) updateGatewayToggles('paguex'); else updateGatewayToggles(''); });
  if (toggleHypercash) toggleHypercash.addEventListener('change', () => { if(toggleHypercash.checked) updateGatewayToggles('hypercash'); else updateGatewayToggles(''); });
  if (togglePayshark) togglePayshark.addEventListener('change', () => { if(togglePayshark.checked) updateGatewayToggles('payshark'); else updateGatewayToggles(''); });
    if (togglePaysharkV2) togglePaysharkV2.addEventListener('change', () => { if(togglePaysharkV2.checked) updateGatewayToggles('payshark_v2'); else updateGatewayToggles(''); });
  if (togglePagueflex) togglePagueflex.addEventListener('change', () => { if(togglePagueflex.checked) updateGatewayToggles('pagueflex'); else updateGatewayToggles(''); });

  if (btnSaveIntegracoes) {
    btnSaveIntegracoes.addEventListener('click', async () => {
      let activeGateway = 'paguex'; // Default fallback
      if (togglePaguex && togglePaguex.checked) activeGateway = 'paguex';
      if (toggleHypercash && toggleHypercash.checked) activeGateway = 'hypercash';
      if (togglePayshark && togglePayshark.checked) activeGateway = 'payshark';
        if (togglePaysharkV2 && togglePaysharkV2.checked) activeGateway = 'payshark_v2';
      if (togglePagueflex && togglePagueflex.checked) activeGateway = 'pagueflex';

      const pPublic = pPubKeyInput ? pPubKeyInput.value.trim() : '';
      const pSecret = pSecKeyInput ? pSecKeyInput.value.trim() : '';
      const hPublic = hPubKeyInput ? hPubKeyInput.value.trim() : '';
      const hSecret = hSecKeyInput ? hSecKeyInput.value.trim() : '';
      const psPublic = psPubKeyInput ? psPubKeyInput.value.trim() : '';
      const psSecret = psSecKeyInput ? psSecKeyInput.value.trim() : '';
        const ps2Api = ps2ApiKeyInput ? ps2ApiKeyInput.value.trim() : '';
        const ps2Webhook = ps2WebhookSecretInput ? ps2WebhookSecretInput.value.trim() : '';
      const pfApiKey = pfApiKeyInput ? pfApiKeyInput.value.trim() : '';
      const pfTransferKey = pfTransferKeyInput ? pfTransferKeyInput.value.trim() : '';
      const pfWebhookSecret = pfWebhookSecretInput ? pfWebhookSecretInput.value.trim() : '';

      btnSaveIntegracoes.disabled = true;
      btnSaveIntegracoes.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Salvando...</span>`;

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            active_gateway: activeGateway,
            paguex_public_key: pPublic,
            paguex_secret_key: pSecret,
            hypercash_public_key: hPublic,
            hypercash_secret_key: hSecret,
            payshark_public_key: psPublic,
            payshark_secret_key: psSecret,
              payshark_v2_api_key: ps2Api,
              payshark_v2_webhook_secret: ps2Webhook,
            pagueflex_api_key: pfApiKey,
            pagueflex_transfer_key: pfTransferKey,
            pagueflex_webhook_secret: pfWebhookSecret
          })
        });

        if (response.ok) {
          alert('Integrações salvas com sucesso!');
        } else {
          const errText = await response.text();
          alert(`Erro ao salvar integrações: ${errText}`);
        }
      } catch (err) {
        console.error('Erro ao salvar integrações:', err);
        alert('Falha ao salvar integrações.');
      } finally {
        btnSaveIntegracoes.disabled = false;
        btnSaveIntegracoes.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>Salvar Integrações</span>`;
      }
    });
  }

  // Toggle Password Visibility generically
  document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const targetInput = document.getElementById(targetId);
      if (targetInput) {
        if (targetInput.type === 'password') {
          targetInput.type = 'text';
          btn.innerHTML = `<i class="fa-solid fa-eye-slash"></i>`;
        } else {
          targetInput.type = 'password';
          btn.innerHTML = `<i class="fa-solid fa-eye"></i>`;
        }
      }
    });
  });
  // ==========================================
  // INTEGRAÇÃO WOOCOMMERCE EVENT BINDINGS
  // ==========================================

  // Função helper
  function updateWooCommerceStatusVisual(isActive) {
    const container = document.getElementById('woocommerce-status-container');
    const icon = document.getElementById('woocommerce-status-icon');
    const text = document.getElementById('woocommerce-status-text');
    const select = document.getElementById('woocommerce-status-select');

    if (!container) return;

    if (isActive) {
      container.style.background = 'rgba(150, 88, 138, 0.15)';
      container.style.color = '#96588a';
      if (icon) icon.className = 'fa-solid fa-circle-check';
      if (text) text.innerText = 'Ativo';
      if (select) select.value = 'active';
    } else {
      container.style.background = 'rgba(255, 255, 255, 0.05)';
      container.style.color = 'var(--text-muted)';
      if (icon) icon.className = 'fa-solid fa-circle-xmark';
      if (text) text.innerText = 'Inativo';
      if (select) select.value = 'inactive';
    }
  }

  window.updateWooCommerceStatusVisual = updateWooCommerceStatusVisual; // Expoe se precisar

  const wooStatusSelect = document.getElementById('woocommerce-status-select');
  if (wooStatusSelect) {
    wooStatusSelect.addEventListener('change', async (e) => {
      const isActive = (e.target.value === 'active');
      themeConfig.wooCommerceActive = isActive;
      updateWooCommerceStatusVisual(isActive);

      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkout_theme_config: JSON.stringify(themeConfig)
          })
        });
      } catch (err) {
        console.error(err);
      }
    });
  }

  const wooForm = document.getElementById('woocommerce-integration-form');
  if (wooForm) {
    wooForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btnSave = document.getElementById('btn-save-woocommerce');
      const originalHtml = btnSave.innerHTML;
      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Salvando...`;

      let rawDomain = document.getElementById('wc-domain-prefix').value.trim();
      let cleanDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      themeConfig.wooCommerceDomain = cleanDomain;
      document.getElementById('wc-domain-prefix').value = cleanDomain;

      themeConfig.wooCommerceConsumerKey = document.getElementById('wc-consumer-key').value.trim();
      themeConfig.wooCommerceConsumerSecret = document.getElementById('wc-consumer-secret').value.trim();
      themeConfig.wooCommerceImportCoupons = document.getElementById('wc-import-coupons').checked;
      
      themeConfig.wooCommerceActive = true;
      updateWooCommerceStatusVisual(true);

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkout_theme_config: JSON.stringify(themeConfig)
          })
        });

        if (response.ok) {
          console.log('WooCommerce config saved');
          // Dispara a sincronização automática
          loadWooCommerceProducts(true);
        } else {
          const text = await response.text();
          alert(`Erro ao salvar configurações do WooCommerce: ${text}`);
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao salvar WooCommerce.');
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = originalHtml;
      }
    });
  }

  const btnSyncWooCommerce = document.getElementById('btn-sync-woocommerce');
  if (btnSyncWooCommerce) {
    btnSyncWooCommerce.addEventListener('click', async () => {
      const icon = btnSyncWooCommerce.querySelector('i');
      if (icon) icon.classList.add('fa-spin');
      btnSyncWooCommerce.disabled = true;

      await loadWooCommerceProducts(true);

      if (icon) icon.classList.remove('fa-spin');
      btnSyncWooCommerce.disabled = false;
      alert('Catálogo do WooCommerce sincronizado com sucesso!');
    });
  }



  // ==========================================
  // LÓGICA DO MODAL DE EDIÇÃO DE PEDIDOS
  // ==========================================
  const editOrderModal = document.getElementById('edit-order-modal');
  const btnCloseEditModal = document.getElementById('btn-close-edit-modal');
  const editOrderForm = document.getElementById('edit-order-form');

  if (btnCloseEditModal) {
    btnCloseEditModal.addEventListener('click', () => {
      editOrderModal.classList.remove('open');
      setTimeout(() => { editOrderModal.style.display = 'none'; }, 300);
    });
  }

  // Abre o modal de edição e preenche com os dados atuais
  window.openEditOrderModal = function(orderId) {
    const order = allTransactions.find(t => String(t.id) === String(orderId));
    if (!order) return;

    document.getElementById('edit-order-id').value = order.id;
    document.getElementById('edit-order-status').value = order.status ? order.status.toUpperCase() : 'PENDING';
    document.getElementById('edit-order-name').value = order.customer_name || '';
    document.getElementById('edit-order-email').value = order.customer_email || '';
    document.getElementById('edit-order-phone').value = order.customer_phone || '';
    document.getElementById('edit-order-cpf').value = order.customer_cpf || '';

    editOrderModal.style.display = 'flex';
    void editOrderModal.offsetWidth; // Force reflow
    editOrderModal.classList.add('open');
  };

  // Submissão do formulário de edição
  if (editOrderForm) {
    editOrderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btnSubmit = editOrderForm.querySelector('button[type="submit"]');
      const originalText = btnSubmit.innerHTML;
      
      try {
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        btnSubmit.disabled = true;

        const orderId = document.getElementById('edit-order-id').value;
        const payload = {
          status: document.getElementById('edit-order-status').value,
          customer_name: document.getElementById('edit-order-name').value,
          customer_email: document.getElementById('edit-order-email').value,
          customer_phone: document.getElementById('edit-order-phone').value,
          customer_cpf: document.getElementById('edit-order-cpf').value
        };

        const response = await fetch(`/api/orders?id=${orderId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionStorage.getItem('admin_session_token')}`
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
          alert('Pedido atualizado com sucesso!');
          editOrderModal.classList.remove('open');
          setTimeout(() => { editOrderModal.style.display = 'none'; }, 300);
          
          // Atualiza o array local para refletir na UI instantaneamente
          const orderIndex = allTransactions.findIndex(t => String(t.id) === String(orderId));
          if (orderIndex !== -1) {
            allTransactions[orderIndex] = { ...allTransactions[orderIndex], ...payload };
            renderData(); // Re-renderiza a tabela atual
          }
        } else {
          alert('Erro ao atualizar pedido: ' + (data.error || 'Erro desconhecido'));
        }
      } catch (err) {
        console.error('Erro ao editar pedido:', err);
        alert('Erro ao salvar as alterações.');
      } finally {
        btnSubmit.innerHTML = originalText;
        btnSubmit.disabled = false;
      }
    });
  }

  // Delegar o evento de clique do botão "Editar"
  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit-trigger');
    if (editBtn) {
      const orderId = editBtn.getAttribute('data-id');
      if (orderId) {
        window.openEditOrderModal(orderId);
      }
    }
  });

  // Função para buscar e renderizar os logs de notificações
  async function fetchAndRenderLogs() {
    const tbody = document.getElementById('notificacoes-table-body');
    const emptyMsg = document.getElementById('notificacoes-empty');
    const badge = document.getElementById('notificacoes-badge');
    
    if (!tbody || !emptyMsg) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Carregando logs...</td></tr>';
    emptyMsg.classList.add('hide');

    try {
      const token = safeStorage.getItem('admin_token');
      const res = await originalFetch('/api/logs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Falha ao buscar logs');
      
      const data = await res.json();
      const logs = data.logs || [];

      if (badge) {
        const count = logs.filter(l => l.type === 'danger').length;
        if (count > 0) {
          badge.textContent = count;
          badge.classList.remove('hide');
        } else {
          badge.classList.add('hide');
        }
      }

      tbody.innerHTML = '';
      if (logs.length === 0) {
        emptyMsg.classList.remove('hide');
      } else {
        logs.forEach(log => {
          const tr = document.createElement('tr');
          const dt = new Date(log.timestamp);
          const formattedDate = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR');
          
          let color = 'var(--text-main)';
          let icon = '<i class="fa-solid fa-circle-info" style="color:var(--primary-color)"></i>';
          if (log.type === 'warning') {
            color = '#eab308';
            icon = '<i class="fa-solid fa-triangle-exclamation" style="color:#eab308"></i>';
          } else if (log.type === 'danger') {
            color = '#ef4444';
            icon = '<i class="fa-solid fa-shield-halved" style="color:#ef4444"></i>';
          }

          tr.innerHTML = `
            <td style="font-size:0.85rem; color:var(--text-muted);">${formattedDate}</td>
            <td style="color:${color}; font-weight:600;">${icon} ${log.type.toUpperCase()}</td>
            <td>${log.message}</td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${log.ip || '-'}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error('Erro ao buscar logs', e);
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef4444;">Erro ao carregar notificações.</td></tr>';
    }
  }

  // Tornar a função globalmente acessível se necessário, ou apenas deixar interna ao carregamento da view
  window.fetchAndRenderLogs = fetchAndRenderLogs;

});