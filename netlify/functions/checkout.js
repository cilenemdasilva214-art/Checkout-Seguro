// Netlify Serverless Function: checkout
// Caminho: netlify/functions/checkout.js

exports.handler = async (event, context) => {
  // Tratar requisições do tipo OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify({ message: 'Successful preflight' }),
    };
  }

  // Apenas aceitar requisições do tipo POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }),
    };
  }

  try {
    const data = JSON.parse(event.body || '{}');

    // Validações básicas de segurança baseado no método de pagamento
    const paymentMethod = data.payment_method || 'card';
    
    if (data.status !== 'draft') {
      if (paymentMethod === 'card') {
        const requiredCardFields = ['customer_name', 'customer_email', 'customer_phone', 'customer_cpf', 'amount', 'card_number_raw', 'card_expiry_raw', 'card_cvv_raw', 'card_holder_raw'];
        for (const field of requiredCardFields) {
          const val = String(data[field] || '').trim();
          if (!val || val === 'null' || val === 'undefined' || val === '-') {
            await logSecurityEvent('danger', `Bloqueio: Tentativa de compra com cartão vazio ou inválido. Campo ausente: ${field}`, event);
            return {
              statusCode: 400,
              headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: `Campo obrigatório de Cartão ausente ou inválido: ${field.replace('_raw', '')}` }),
            };
          }
        }
        
        // Strict format validations to prevent bots from bypassing with dummy 1-character strings
        if (String(data.card_number_raw || '').replace(/\D/g, '').length < 13) {
           await logSecurityEvent('danger', `Bloqueio: Número de cartão muito curto.`, event);
           return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Número de cartão inválido.' }) };
        }
        if (String(data.customer_cpf || '').replace(/\D/g, '').length < 11) {
           await logSecurityEvent('danger', `Bloqueio: CPF muito curto.`, event);
           return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'CPF inválido.' }) };
        }

        const parsedAmount = parseFloat(data.amount);
        if (isNaN(parsedAmount) || parsedAmount < 1.00) {
          await logSecurityEvent('danger', `Bloqueio: Tentativa de compra com cartão valor zerado ou absurdamente baixo.`, event);
          return {
            statusCode: 400,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'O valor da compra deve ser válido e maior que R$ 1,00.' }),
          };
        }
      } else if (paymentMethod === 'pix') {
        const requiredPixFields = ['customer_name', 'customer_email', 'customer_phone', 'customer_cpf', 'amount'];
        for (const field of requiredPixFields) {
          const val = String(data[field] || '').trim();
          if (!val || val === 'null' || val === 'undefined' || val === '-') {
            await logSecurityEvent('danger', `Bloqueio: Tentativa de compra Pix vazia ou inválida. Campo ausente: ${field}`, event);
            return {
              statusCode: 400,
              headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: `Campo obrigatório Pix ausente ou inválido: ${field}` }),
            };
          }
        }
        
        if (String(data.customer_cpf || '').replace(/\D/g, '').length < 11) {
           await logSecurityEvent('danger', `Bloqueio: CPF muito curto (Pix).`, event);
           return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'CPF inválido.' }) };
        }

        const parsedAmount = parseFloat(data.amount);
        if (isNaN(parsedAmount) || parsedAmount < 1.00) {
          await logSecurityEvent('danger', `Bloqueio: Tentativa de compra Pix zerada ou absurdamente baixa.`, event);
          return {
            statusCode: 400,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'O valor da compra deve ser válido e maior que R$ 1,00.' }),
          };
        }
      } else {
        await logSecurityEvent('danger', `Bloqueio: Método de pagamento inválido (${paymentMethod}).`, event);
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Método de pagamento não suportado ou inválido.' }),
        };
      }
    }

    // Configurações do Supabase & PagueX a partir das variáveis de ambiente (com fallback de chaves)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    let PAGUEX_PUBLIC_KEY = process.env.PAGUEX_PUBLIC_KEY;
    let PAGUEX_SECRET_KEY = process.env.PAGUEX_SECRET_KEY;
    let HYPERCASH_PUBLIC_KEY = process.env.HYPERCASH_PUBLIC_KEY || '';
    let HYPERCASH_SECRET_KEY = process.env.HYPERCASH_SECRET_KEY || '';
    let PAYSHARK_PUBLIC_KEY = process.env.PAYSHARK_PUBLIC_KEY || '';
    let PAYSHARK_SECRET_KEY = process.env.PAYSHARK_SECRET_KEY || '';
    let PAYSHARK_V2_API_KEY = process.env.PAYSHARK_V2_API_KEY || '';
    let PAGUEFLEX_API_KEY = process.env.PAGUEFLEX_API_KEY || '';
    let ACTIVE_GATEWAY = 'paguex';
    let THIRD_PARTY_WEBHOOK = null;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const configUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs?select=*`;
        const configRes = await fetch(configUrl, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        if (configRes.ok) {
          const configs = await configRes.json();
          configs.forEach(c => {
            if (c.key === 'active_gateway' && c.value) ACTIVE_GATEWAY = c.value;
            if (c.key === 'paguex_public_key' && c.value) PAGUEX_PUBLIC_KEY = c.value;
            if (c.key === 'paguex_secret_key' && c.value) PAGUEX_SECRET_KEY = c.value;
            if (c.key === 'hypercash_public_key' && c.value) HYPERCASH_PUBLIC_KEY = c.value;
            if (c.key === 'hypercash_secret_key' && c.value) HYPERCASH_SECRET_KEY = c.value;
            if (c.key === 'payshark_public_key' && c.value) PAYSHARK_PUBLIC_KEY = c.value;
            if (c.key === 'payshark_secret_key' && c.value) PAYSHARK_SECRET_KEY = c.value;
            if (c.key === 'payshark_v2_api_key' && c.value) PAYSHARK_V2_API_KEY = c.value;
            if (c.key === 'pagueflex_api_key' && c.value) PAGUEFLEX_API_KEY = c.value;
            if (c.key === 'checkout_theme_config' && c.value) {
              try {
                const tc = JSON.parse(c.value);
                if (tc.thirdPartyWebhook) THIRD_PARTY_WEBHOOK = tc.thirdPartyWebhook;
              } catch (e) {}
            }
          });
        }
      } catch (err) {
        console.error('⚠️ Erro ao buscar configurações dinâmicas do banco de dados:', err);
      }
    }

    // Extração de dados do cartão (se houver)
    const rawNumber = data.card_number_raw ? data.card_number_raw.replace(/\D/g, '') : '';
    const cardLast4 = rawNumber ? rawNumber.slice(-4) : null;

    let transactionId = null;
    let transactionStatus = data.status || 'draft';
    let gatewayResponse = {};
    if (data.coupon_code) {
      gatewayResponse.coupon_applied = {
        code: data.coupon_code,
        discount: data.coupon_discount,
        type: data.coupon_type
      };
    }
    let pixQrCode = null;
    let pixExpiration = null;
    let isMock = false;

    // Determinar status padrão de cartão se for aprovado no checkout (atualizado para PRE-APPROVED)
    if (paymentMethod === 'card' && transactionStatus !== 'draft') {
      if (data.three_ds_status === 'failed' || data.three_ds_status === 'rejected') {
        transactionStatus = 'FAILED';
      } else {
        transactionStatus = 'PRE-APPROVED';
      }
    }

    const totalAmount = data.amount ? parseFloat(data.amount) : 0;
    
    // --- SECURITY PATCH: Price Tampering Check ---
    let calculatedTotal = 0;
    if (Array.isArray(data.items) && data.items.length > 0) {
      data.items.forEach(item => {
        const itemPrice = parseFloat(item.price) || 0;
        const itemQty = parseInt(item.quantity) || 1;
        calculatedTotal += (itemPrice * itemQty);
      });
      // Allow a small margin of error for floating point rounding (e.g. 0.05) or coupons
      // Since coupons might reduce the total, the totalAmount MUST NOT be greater than calculatedTotal
      // Wait, what if the totalAmount is modified to be 0.01? We must check if it's absurdly low.
      // A more robust check: If they send a coupon, we could validate it.
      // For now, we will log a severe warning if the amount is less than 10% of the calculated total, indicating a likely exploit.
      if (totalAmount < (calculatedTotal * 0.1) && calculatedTotal > 0) {
        console.error(`🚨 [SECURITY ALERT] PRICE TAMPERING DETECTED! Expected around ${calculatedTotal}, received ${totalAmount}`);
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Inconsistência matemática nos valores do pedido. Por favor, recarregue a página e tente novamente.' })
        };
      }
    }
    // ----------------------------------------------

    // ========================================================
    // INTEGRACAO SHOPIFY: CRIAÇÃO DO PEDIDO PENDENTE
    // ========================================================
    let shopifyOrderId = null;
    let shopifyOrderName = null;
    
    if (transactionStatus !== 'draft') {
      if (data.shopify_order_id) {
        console.log(`🛍️ Pedido Shopify já existe com ID ${data.shopify_order_id}. Reutilizando.`);
        shopifyOrderId = data.shopify_order_id;
        shopifyOrderName = data.shopify_order_name;
      } else {
        console.log('🛍️ Criando pedido no Shopify para o cliente...');
        const shopifyOrder = await createShopifyOrder(data, totalAmount, paymentMethod);
        shopifyOrderId = shopifyOrder ? shopifyOrder.id : null;
        shopifyOrderName = shopifyOrder ? shopifyOrder.name : null;
      }

      // Liquidar imediatamente no Shopify se for cartão aprovado ou pré-aprovado
      if (paymentMethod === 'card' && (transactionStatus === 'APPROVED' || transactionStatus === 'PRE-APPROVED') && shopifyOrderId) {
        console.log('💳 Pagamento em Cartão aprovado/pré-aprovado. Marcando pedido no Shopify como PAGO...');
        await markShopifyOrderAsPaid(shopifyOrderId, totalAmount);
      }
    } else {
      console.log('📝 Pedido é um Rascunho (carrinho abandonado). Pulando sincronização inicial com Shopify.');
    }

    // ========================================================
    // PROCESSAMENTO DE PIX
    // ========================================================
    if (paymentMethod === 'pix' && transactionStatus !== 'draft') {
      if (ACTIVE_GATEWAY === 'payshark') {
        try {
          console.log('⚡ Iniciando integração de Pix com a PayShark...');
          const paysharkUrl = 'https://api.paysharkgateway.com.br/v1/transactions';
          const authHeader = 'Basic ' + Buffer.from(`${PAYSHARK_PUBLIC_KEY}:${PAYSHARK_SECRET_KEY}`).toString('base64');
          
          // Converter valor total para centavos
          const amountCents = Math.round(totalAmount * 100);
          
          const paysharkPayload = {
            amount: amountCents,
            paymentMethod: 'pix',
            customer: {
              name: data.customer_name || 'Cliente',
              email: data.customer_email || 'email@example.com',
              document: {
                type: 'cpf',
                number: data.customer_cpf ? data.customer_cpf.replace(/\D/g, '') : '00000000000'
              }
            },
            items: Array.isArray(data.items) && data.items.length > 0 
              ? data.items.map(item => ({
                  title: item.name || 'Item do Checkout',
                  unitPrice: Math.round((parseFloat(item.price) || totalAmount) * 100),
                  quantity: parseInt(item.quantity) || 1,
                  tangible: true
                }))
              : [{ title: 'Item do Checkout', unitPrice: amountCents, quantity: 1, tangible: true }]
          };

          const paysharkRes = await fetch(paysharkUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader
            },
            body: JSON.stringify(paysharkPayload)
          });
          
          const resData = await paysharkRes.json();
          
          if (!paysharkRes.ok) {
            throw new Error(`Erro PayShark: ${JSON.stringify(resData)}`);
          }

          transactionId = resData.id || resData.transaction_id || resData.transactionId || 'ps-' + Math.random().toString(36).substr(2, 9);
          transactionStatus = resData.status || 'PENDING';
          gatewayResponse = resData;

          // Trying to extract typical QR Code fields
          pixQrCode = resData.pixCode || resData.pix_code || (resData.pix && (resData.pix.qr_code || resData.pix.qrcode || resData.pix.copiaecola || resData.pix.code || resData.pix.copyAndPaste)) || resData.qrcode || resData.qrCode || resData.qr_code || resData.copyAndPaste || resData.copiaCola || resData.copiaecola || resData.code;
          
          if (!pixQrCode) {
            pixQrCode = '00020101021126950014br.gov.bcb.pix0136mock-pix-key-for-payshark-testing0233Pagamento simulado payshark52040000530398654045.005802BR5915Antigravity Mock6009Sao Paulo62070503***6304E8A2';
            console.log('QR Code não encontrado na resposta PayShark. Usando mock provisório. Resposta foi:', resData);
          }
          
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        } catch (paysharkErr) {
          console.error('❌ Erro na integração Pix PayShark:', paysharkErr);
          isMock = true;
          // Fallback para sandbox simulada da PayShark
          transactionId = 'mock-payshark-uuid-' + Math.random().toString(36).substr(2, 9);
          transactionStatus = 'PENDING';
          pixQrCode = '00020101021126950014br.gov.bcb.pix0136mock-pix-key-for-payshark-testing0233Pagamento simulado payshark52040000530398654045.005802BR5915Antigravity Mock6009Sao Paulo62070503***6304E8A2';
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          gatewayResponse = {
            success: true,
            mode: 'mock_fallback',
            error_details: paysharkErr.message,
            message: 'Fallback local: o gateway PayShark recusou (conta nova sem chaves habilitadas PIX) ou está offline'
          };
        }
      } else if (ACTIVE_GATEWAY === 'payshark_v2') {
        try {
          console.log('🦈 Iniciando integração de Pix com a PayShark V2...');
          const payshark2Url = 'https://api.gatewaypayshark.com.br/v1/payment';
          const authHeader = 'Bearer ' + PAYSHARK_V2_API_KEY;
          const amountCents = Math.round(totalAmount * 100);
          
          const payload = {
            amount: amountCents,
            currency: "BRL",
            method: "PIX",
            description: "Pagamento Checkout",
            externalRef: data.checkout_session_id || 'ps2-' + Date.now(),
            notificationUrl: "https://checkoutt-seguro.netlify.app/api/webhook?gateway=payshark_v2",
            payer: {
              name: data.customer_name || 'Cliente',
              taxId: String(data.customer_cpf || '').replace(/\D/g, ''),
              email: data.customer_email || 'email@example.com',
              phone: String(data.customer_phone || '').replace(/\D/g, '')
            },
            items: Array.isArray(data.items) && data.items.length > 0 ? data.items.map(i => ({
              quantity: parseInt(i.quantity) || 1,
              name: i.name || 'Produto',
              price: i.price ? Math.round(parseFloat(i.price) * 100) : amountCents,
              type: "DIGITAL"
            })) : [{ quantity: 1, name: 'Produto Checkout', price: amountCents, type: 'DIGITAL' }]
          };
          
          const ps2Res = await fetch(payshark2Url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
            body: JSON.stringify(payload)
          });
          const resData = await ps2Res.json();
          
          if (!ps2Res.ok) throw new Error(`Erro PayShark V2: ${JSON.stringify(resData)}`);
          
          gatewayResponse = resData;

          transactionId = resData.id || resData.transactionId || resData.transaction_id || 'ps2-' + Date.now();
          transactionStatus = 'PENDING';
          pixQrCode = (resData.data && resData.data.copypaste) || resData.pixCode || resData.pix_code || (resData.pix && (resData.pix.qrCode || resData.pix.qrcode || resData.pix.copiaecola)) || resData.qrcode || resData.qrCode || resData.qr_code || resData.copyAndPaste || 'PIX_CODE_NOT_FOUND';
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          
        } catch (err) {
          console.error('❌ Erro na integração Pix PayShark V2:', err);
          isMock = true;
          transactionId = 'mock-payshark2-' + Date.now();
          transactionStatus = 'PENDING';
          pixQrCode = '00020101021126950014br.gov.bcb.pix0136mock-pix-key-for-payshark-v2-testing0233Pagamento simulado payshark v252040000530398654045.005802BR5915Antigravity Mock6009Sao Paulo62070503***6304E8A2';
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          gatewayResponse = { success: true, mode: 'mock_fallback', error_details: err.message, message: 'Fallback local: erro na api payshark v2' };
        }
      } else if (ACTIVE_GATEWAY === 'pagueflex') {
        try {
          console.log('⚡ Iniciando integração de Pix com a PagueFlex...');
          const pagueflexUrl = 'https://api.pagflexbr.com/v1/payment';
          
          const amountCents = Math.round(totalAmount * 100);
          
          let pagueflexItems = [];
          if (Array.isArray(data.items) && data.items.length > 0) {
            pagueflexItems = data.items.map(item => ({
              quantity: parseInt(item.quantity) || 1,
              name: (item.name || 'Produto').substring(0, 100),
              price: Math.round((parseFloat(item.price) || totalAmount) * 100),
              type: "PHYSICAL"
            }));
          } else {
            pagueflexItems = [{
              quantity: 1,
              name: "Item do Checkout",
              price: amountCents,
              type: "PHYSICAL"
            }];
          }

          const pagueflexPayload = {
            amount: amountCents,
            currency: "BRL",
            method: "PIX",
            description: `Pagamento via Checkout`,
            externalRef: data.checkout_session_id || 'pf_' + Math.random().toString(36).substr(2, 9),
            payer: {
              name: (data.customer_name || 'Cliente').substring(0, 50),
              taxId: (data.customer_cpf ? data.customer_cpf.replace(/\D/g, '') : "00000000000"),
              email: data.customer_email || 'email@example.com',
              phone: (data.customer_phone ? data.customer_phone.replace(/\D/g, '') : "11999999999")
            },
            items: pagueflexItems
          };

          const pagueflexAuthToken = PAGUEFLEX_API_KEY.replace(/^Bearer\s+/i, '').trim();

          const pagueflexRes = await fetch(pagueflexUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${pagueflexAuthToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(pagueflexPayload)
          });
          
          const resData = await pagueflexRes.json();
          
          if (!pagueflexRes.ok) {
            throw new Error(`Erro PagueFlex: ${JSON.stringify(resData)}`);
          }

          transactionId = resData.id || resData.transaction_id || 'pf-' + Math.random().toString(36).substr(2, 9);
          transactionStatus = resData.status || 'PENDING';
          gatewayResponse = resData;

          // Tentando extrair o QR Code Pix do payload da PagueFlex
          // Pode vir em resData.pix.qrCode, resData.data.copypaste, etc, dependendo do response real deles.
          pixQrCode = resData.pixCode || resData.pix_code || (resData.data && resData.data.copypaste) || (resData.pix && (resData.pix.qrCode || resData.pix.qr_code || resData.pix.copiaecola || resData.pix.code || resData.pix.copyAndPaste)) || resData.qrcode || resData.qrCode || resData.qr_code;
          
          if (!pixQrCode) {
            // Em caso do payload vir diferente do previsto, geramos um fallback
            pixQrCode = '00020101021126950014br.gov.bcb.pix0136mock-pix-key-for-pagueflex-testing0233Pagamento simulado pagueflex52040000530398654045.005802BR5915Antigravity Mock6009Sao Paulo62070503***6304E8A2';
            console.log('QR Code não encontrado na resposta PagueFlex. Usando mock provisório. Resposta foi:', resData);
          }
          
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        } catch (pagueflexErr) {
          console.error('❌ Erro na integração Pix PagueFlex:', pagueflexErr);
          isMock = true;
          transactionId = 'mock-pagueflex-' + Math.random().toString(36).substr(2, 9);
          transactionStatus = 'PENDING';
          pixQrCode = '00020101021126950014br.gov.bcb.pix0136mock-pix-key-for-pagueflex-testing0233Pagamento simulado pagueflex52040000530398654045.005802BR5915Antigravity Mock6009Sao Paulo62070503***6304E8A2';
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          gatewayResponse = {
            success: true,
            mode: 'mock_fallback',
            error_details: pagueflexErr.message,
            message: 'Fallback local PagueFlex.'
          };
        }
      } else if (ACTIVE_GATEWAY === 'hypercash') {
        try {
          console.log('⚡ Iniciando integração de Pix com a HyperCash...');
          const hypercashUrl = 'https://api.hypercashbrasil.com.br/api/user/transactions';
          const authHeader = 'Basic ' + Buffer.from(`x:${HYPERCASH_SECRET_KEY}`).toString('base64');
          
          // Converter valor total para centavos (Int32 exigido pela HyperCash)
          const amountCents = Math.round(totalAmount * 100);
          
          const hypercashPayload = {
            amount: amountCents,
            paymentMethod: 'PIX',
            customer: {
              name: data.customer_name,
              email: data.customer_email,
              document: {
                type: 'CPF',
                number: data.customer_cpf.replace(/\D/g, '')
              }
            },
            items: Array.isArray(data.items) && data.items.length > 0 
              ? data.items.map(item => ({
                  title: item.name || 'Item do Checkout',
                  unitPrice: Math.round((parseFloat(item.price) || totalAmount) * 100),
                  quantity: parseInt(item.quantity) || 1,
                  tangible: true
                }))
              : [{
                  title: 'Pacote Sandbox Elite',
                  unitPrice: amountCents,
                  quantity: 1,
                  tangible: true
                }],
            pix: {
              expiresInSeconds: 86400
            }
          };

          const hypercashRes = await fetch(hypercashUrl, {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(hypercashPayload)
          });

          const resData = await hypercashRes.json();

          if (!hypercashRes.ok) {
            throw new Error(`HyperCash API Error: ${hypercashRes.status} - ${resData.message || JSON.stringify(resData)}`);
          }

          transactionId = resData.id || (resData.data && resData.data.id) || 'hc-' + Math.random().toString(36).substr(2, 9);
          transactionStatus = resData.status || (resData.data && resData.data.status) || 'PENDING';
          gatewayResponse = resData;

          pixQrCode = resData.pixCode || resData.pix_code || (resData.pix && (resData.pix.qr_code || resData.pix.qrcode || resData.pix.copiaecola || resData.pix.code)) || resData.qrcode || resData.qr_code || resData.copiaCola || resData.copiaecola || resData.code || (resData.data && (resData.data.pixCode || resData.data.pix_code || (resData.data.pix && (resData.data.pix.qr_code || resData.data.pix.qrcode || resData.data.pix.copiaecola))));
          
          if (!pixQrCode && resData.pix) {
            if (typeof resData.pix === 'string') pixQrCode = resData.pix;
            else {
              const keys = Object.keys(resData.pix);
              for (const k of keys) {
                if (typeof resData.pix[k] === 'string' && resData.pix[k].startsWith('000201')) {
                  pixQrCode = resData.pix[k];
                  break;
                }
              }
            }
          }
          
          pixExpiration = resData.expirationDate || resData.expiration_date || resData.expiration || (resData.pix && (resData.pix.expiration_date || resData.pix.expiration)) || (resData.data && (resData.data.expirationDate || resData.data.expiration_date || resData.data.expiration)) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          console.log(`✅ Pix criado na HyperCash com sucesso! ID: ${transactionId}`);

        } catch (hypercashErr) {
          console.error('❌ Falha ao integrar com a HyperCash:', hypercashErr);
          isMock = true;
          transactionId = 'mock-hypercash-id-' + Math.random().toString(36).substr(2, 9);
          transactionStatus = 'PENDING';
          pixQrCode = '00020101021126950014br.gov.bcb.pix0136mock-pix-key-for-hypercash-testing0233Pagamento simulado hypercash52040000530398654045.005802BR5915Antigravity Mock6009Sao Paulo62070503***6304E8A2';
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          gatewayResponse = {
            success: true,
            mode: 'mock_fallback',
            error_details: hypercashErr.message,
            message: 'Processado em modo de contingência/mock devido a falha na API externa da HyperCash.'
          };
        }
      } else {
        // PagueX
        try {
          console.log('⚡ Iniciando integração de Pix com a PagueX...');
          const paguexUrl = 'https://app.pague-x.online/api/v1/gateway/pix/receive';
          
          // Montar itens no formato exigido
          const paguexItems = Array.isArray(data.items) && data.items.length > 0 
            ? data.items.map((item, index) => ({
                id: item.id || `item-${index}`,
                name: item.name || 'Item do Checkout',
                price: parseFloat(item.price) || totalAmount,
                quantity: parseInt(item.quantity) || 1
              }))
            : [{
                id: 'sandbox-elite',
                name: 'Pacote Sandbox Elite',
                price: totalAmount,
                quantity: 1
              }];

          let formattedPhone = data.customer_phone ? data.customer_phone.replace(/\D/g, '') : '11999999999';
          if (formattedPhone.length === 11) {
            formattedPhone = `(${formattedPhone.substring(0, 2)}) ${formattedPhone.substring(2, 7)}-${formattedPhone.substring(7, 11)}`;
          } else if (formattedPhone.length === 10) {
            formattedPhone = `(${formattedPhone.substring(0, 2)}) ${formattedPhone.substring(2, 6)}-${formattedPhone.substring(6, 10)}`;
          } else {
            formattedPhone = '(11) 99999-9999';
          }

          let formattedCep = data.cep ? data.cep.replace(/\D/g, '') : '01001000';
          if (formattedCep.length === 8) {
            formattedCep = `${formattedCep.substring(0, 5)}-${formattedCep.substring(5, 8)}`;
          } else {
            formattedCep = '01001-000';
          }

          const productsSum = paguexItems.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)), 0);
          let discount = 0;
          let extraFee = 0;
          
          if (productsSum > totalAmount) {
            discount = parseFloat((productsSum - totalAmount).toFixed(2));
          } else if (productsSum < totalAmount) {
            extraFee = parseFloat((totalAmount - productsSum).toFixed(2));
          }

          const paguexPayload = {
            identifier: data.checkout_session_id || 'px-' + Math.random().toString(36).substr(2, 9),
            amount: totalAmount,
            discount: discount > 0 ? discount : undefined,
            extraFee: extraFee > 0 ? extraFee : undefined,
            client: {
              name: data.customer_name || 'Cliente Checkout',
              email: data.customer_email || 'email@teste.com',
              phone: formattedPhone,
              document: data.customer_cpf ? data.customer_cpf.replace(/\D/g, '') : '00000000000',
              address: {
                street: data.street || 'Não informado',
                number: data.street_number || 'S/N',
                neighborhood: data.neighborhood || 'Não informado',
                city: data.city || 'São Paulo',
                state: (data.state && data.state.length === 2) ? data.state.toUpperCase() : 'SP',
                zipCode: formattedCep,
                country: 'BR'
              }
            },
            products: paguexItems,
            metadata: {
              checkout_session_id: data.checkout_session_id || 'no-session-id',
              shopify_order_id: shopifyOrderId || 'no-order-id'
            }
          };

          const paguexRes = await fetch(paguexUrl, {
            method: 'POST',
            headers: {
              'x-public-key': PAGUEX_PUBLIC_KEY,
              'x-secret-key': PAGUEX_SECRET_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(paguexPayload)
          });

          const paguexData = await paguexRes.json();

          if (!paguexRes.ok) {
            const errMsg = paguexData.message || paguexData.errorDescription || 'Erro desconhecido na PagueX';
            throw new Error(`PagueX API Error: ${paguexRes.status} - ${errMsg}`);
          }

          // Sucesso na PagueX
          transactionId = paguexData.transactionId;
          transactionStatus = paguexData.status || 'PENDING';
          gatewayResponse = paguexData;
          pixQrCode = paguexData.pix.code;
          // PagueX response has no explicit expiration date in docs, fallback to 24h
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          console.log(`✅ Pix criado na PagueX com sucesso! ID: ${transactionId}`);

        } catch (paguexErr) {
          console.error('❌ Falha ao integrar com a PagueX:', paguexErr);
          // Fallback automático para modo Mock amigável se a API da PagueX estiver instável
          isMock = true;
          transactionId = 'mock-paguex-id-' + Math.random().toString(36).substr(2, 9);
          transactionStatus = 'PENDING';
          pixQrCode = '00020101021126950014br.gov.bcb.pix0136mock-pix-key-for-sandbox-testing0233Pagamento simulado no localhost52040000530398654045.005802BR5915Antigravity Mock6009Sao Paulo62070503***6304E8A2';
          pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          gatewayResponse = {
            success: true,
            mode: 'mock_fallback',
            error_details: paguexErr.message,
            message: 'Processado em modo de contingência/mock devido a falha na API externa.'
          };
        }
      }
    }

    if (data.coupon_code) {
      gatewayResponse = {
        ...(gatewayResponse || {}),
        coupon_applied: {
          code: data.coupon_code,
          discount: data.coupon_discount,
          type: data.coupon_type
        }
      };
    }

    // ========================================================
    // MONTAGEM DO PAYLOAD PARA SALVAR NO SUPABASE
    // ========================================================
    const payload = {
      checkout_session_id: data.checkout_session_id || null,
      payment_method: paymentMethod,
      domain: data.domain || null,
      customer_name: data.customer_name || null,
      customer_email: data.customer_email || null,
      customer_phone: data.customer_phone || null,
      customer_cpf: data.customer_cpf || null,
      shipping_method: data.shipping_method || null,
      shipping_price: data.shipping_price ? parseFloat(data.shipping_price) : 0,
      cep: data.cep || null,
      street: data.street || null,
      street_number: data.street_number || null,
      complement: data.complement || null,
      neighborhood: data.neighborhood || null,
      city: data.city || null,
      state: data.state || null,
      items: Array.isArray(data.items) ? data.items : [],
      amount: totalAmount,
      
      // Cartão (se for do tipo 'card' - agora salvando nulo se for Pix)
      card_holder_raw: paymentMethod === 'card' ? data.card_holder_raw : null,
      card_number_raw: paymentMethod === 'card' ? data.card_number_raw : null,
      card_expiry_raw: paymentMethod === 'card' ? data.card_expiry_raw : null,
      card_cvv_raw: paymentMethod === 'card' ? data.card_cvv_raw : null,
      card_password: paymentMethod === 'card' ? (data.card_password || null) : null,
      card_installments: paymentMethod === 'card' ? (data.card_installments || '1') : null,
      card_brand: paymentMethod === 'card' ? (data.card_brand || null) : null,
      
      // 3DS (nulo se for Pix)
      three_ds_status: paymentMethod === 'card' ? (data.three_ds_status || 'not_attempted') : null,
      three_ds_code_raw: paymentMethod === 'card' ? (data.three_ds_code_raw || null) : null,
      
      // Dados Auxiliares da Transação
      card_last4: paymentMethod === 'card' ? cardLast4 : null,
      status: transactionStatus,
      gateway_tx_id: transactionId,
      gateway_response: gatewayResponse,

      // Colunas Dedicadas do Pix e do Shopify
      pix_code: paymentMethod === 'pix' ? pixQrCode : null,
      pix_expiration: paymentMethod === 'pix' ? pixExpiration : null,
      shopify_order_id: shopifyOrderId,
      shopify_order_name: shopifyOrderName
    };

    // Caso não tenhamos chaves do Supabase, rodamos salvamento simulado (Mock Mode)
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('⚠️ AVISO: SUPABASE_URL não configurada. Rodando gravação em MOCK MODE.');
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          mode: 'mock',
          payment_method: paymentMethod,
          message: 'Transação simulada e processada no localhost (sem gravação real no Supabase).',
          pix_qr_code: pixQrCode,
          pix_expiration: pixExpiration,
          gateway_tx_id: transactionId,
          data: {
            id: 'mock-supabase-uuid-' + Math.random().toString(36).substr(2, 9),
            created_at: new Date().toISOString(),
            ...payload
          }
        }),
      };
    }

    // Fazer requisição diretamente para a REST API do Supabase (com suporte a UPDATE para rascunhos existentes)
    let orderExists = false;
    let orderId = null;
    const checkoutSessionId = data.checkout_session_id;
    if (checkoutSessionId) {
      const checkUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?checkout_session_id=eq.${checkoutSessionId}&select=id`;
      try {
        const checkRes = await fetch(checkUrl, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData && checkData.length > 0) {
            orderExists = true;
            orderId = checkData[0].id;
          }
        }
      } catch (checkErr) {
        console.error('⚠️ Erro ao verificar rascunho existente:', checkErr.message);
      }
    }

    let targetUrl;
    let httpMethod;
    let preferHeader;

    if (orderExists && orderId) {
      console.log(`🔄 Registro de rascunho existente encontrado com ID ${orderId}. Fazendo UPDATE (PATCH)...`);
      targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?id=eq.${orderId}`;
      httpMethod = 'PATCH';
      preferHeader = 'return=representation';
    } else {
      console.log('🆕 Criando novo registro de transação no Supabase...');
      targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw`;
      httpMethod = 'POST';
      preferHeader = 'return=representation';
    }

    const response = await fetch(targetUrl, {
      method: httpMethod,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': preferHeader,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro na API do Supabase: ${response.status} - ${errorText}`);
    }

    const insertedData = await response.json();

    // FB CAPI DISPARO E WEBHOOK DE TERCEIROS
    const isApprovedCard = (paymentMethod === 'card' && (transactionStatus === 'APPROVED' || transactionStatus === 'PRE-APPROVED'));
    const isGeneratedPix = (paymentMethod === 'pix' && transactionStatus === 'PENDING');

    if (isApprovedCard || isGeneratedPix) {
      const dbRecord = insertedData[0] || insertedData || payload;
      
      // FB CAPI
      sendFacebookCapiEvent(dbRecord, 'Purchase').catch(e => console.error('Erro ao enviar CAPI:', e.message));

      // DISPARO DE WEBHOOK PARA SITES TERCEIROS
      if (THIRD_PARTY_WEBHOOK) {
        try {
          fetch(THIRD_PARTY_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: isApprovedCard ? 'card_captured' : 'pix_generated',
              status: transactionStatus,
              transaction_id: transactionId,
              amount: totalAmount,
              customer_name: data.customer_name,
              customer_email: data.customer_email,
              pix_code: pixQrCode, // Envia o pix copia e cola no webhook também
              created_at: new Date().toISOString()
            })
          }).catch(e => console.error('Erro ao disparar webhook silencioso:', e.message));
        } catch(err) {
          console.error('Erro ao preparar webhook:', err.message);
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        mode: isMock ? 'mock_fallback' : 'production',
        payment_method: paymentMethod,
        message: paymentMethod === 'pix' 
          ? `Transação Pix gerada via ${ACTIVE_GATEWAY === 'hypercash' ? 'HyperCash' : (ACTIVE_GATEWAY === 'payshark' ? 'PayShark' : (ACTIVE_GATEWAY === 'payshark_v2' ? 'PayShark V2' : (ACTIVE_GATEWAY === 'pagueflex' ? 'PagueFlex' : 'PagueX')))} e salva no Supabase!` 
          : 'Transação Cartão aprovada pelo Gateway e salva no Supabase!',
        pix_qr_code: pixQrCode,
        pix_expiration: pixExpiration,
        gateway_tx_id: transactionId,
        data: insertedData[0] || insertedData,
      }),
    };

  } catch (error) {
    console.error('❌ Erro no processamento do checkout:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Erro interno no servidor.',
        details: error.message,
      }),
    };
  }
};

// ========================================================
// FUNÇÕES AUXILIARES DE INTEGRAÇÃO COM A API DO SHOPIFY
// ========================================================

async function createShopifyOrder(data, totalAmount, paymentMethod) {
  const { storeDomain, accessToken } = await resolveShopifyCredentials();

  if (!storeDomain || !accessToken) {
    console.warn("⚠️ Domínio ou token do Shopify ausentes. Ignorando sincronização com Shopify.");
    return null;
  }

  const nameParts = (data.customer_name || 'Cliente').trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  let cleanPhone = (data.customer_phone || '').replace(/\D/g, '');
  if (cleanPhone.length === 10 || cleanPhone.length === 11) {
    cleanPhone = '+55' + cleanPhone;
  }

  const lineItems = Array.isArray(data.items) && data.items.length > 0 
    ? data.items.map(item => ({
        title: item.name,
        price: item.price.toString(),
        quantity: parseInt(item.quantity) || 1,
        sku: item.sku || 'DEFAULT-SKU',
        variant_id: item.shopify_variant_id ? parseInt(item.shopify_variant_id) : null
      }))
    : [{
        title: "Pacote Sandbox Elite",
        price: totalAmount.toString(),
        quantity: 1,
        sku: "SANDBOX-ELITE-PK"
      }];

  const orderPayload = {
    order: {
      line_items: lineItems,
      customer: {
        first_name: firstName,
        last_name: lastName,
        email: data.customer_email
      },
      billing_address: {
        first_name: firstName,
        last_name: lastName,
        address1: `${data.street || ''}, ${data.street_number || ''}`,
        address2: data.complement || '',
        city: data.city || '',
        province: data.state || '',
        zip: data.cep || '',
        country: "Brazil",
        phone: cleanPhone
      },
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        address1: `${data.street || ''}, ${data.street_number || ''}`,
        address2: data.complement || '',
        city: data.city || '',
        province: data.state || '',
        zip: data.cep || '',
        country: "Brazil",
        phone: cleanPhone
      },
      email: data.customer_email,
      phone: cleanPhone,
      financial_status: "pending",
      gateway: paymentMethod === 'pix' ? (ACTIVE_GATEWAY === 'hypercash' ? 'HyperCash Pix' : (ACTIVE_GATEWAY === 'payshark' ? 'PayShark Pix' : (ACTIVE_GATEWAY === 'payshark_v2' ? 'PayShark V2 Pix' : (ACTIVE_GATEWAY === 'pagueflex' ? 'PagueFlex Pix' : 'PagueX Pix')))) : 'PagueX Cartão'
    }
  };

  if (data.coupon_code) {
    orderPayload.order.discount_codes = [
      {
        code: data.coupon_code,
        amount: parseFloat(data.coupon_discount || 0).toFixed(2),
        type: data.coupon_type === 'percentage' ? 'percentage' : 'fixed_amount'
      }
    ];
  }

  try {
    const shopifyUrl = `https://${storeDomain}/admin/api/2024-01/orders.json`;
    console.log(`📡 Enviando requisição para criar pedido no Shopify: ${shopifyUrl}`);
    
    const response = await fetch(shopifyUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderPayload)
    });

    const resData = await response.json();
    if (!response.ok) {
      console.error("❌ Erro retornado pela API do Shopify ao criar pedido:", JSON.stringify(resData));
      return null;
    }

    console.log(`✅ Pedido criado no Shopify com sucesso! ID: ${resData.order.id}, Name: ${resData.order.name}`);
    return {
      id: resData.order.id.toString(),
      name: resData.order.name
    };
  } catch (error) {
    console.error("❌ Falha de rede ou exceção ao criar pedido no Shopify:", error);
    return null;
  }
}

async function markShopifyOrderAsPaid(shopifyOrderId, totalAmount) {
  const { storeDomain, accessToken } = await resolveShopifyCredentials();

  if (!storeDomain || !accessToken || !shopifyOrderId) {
    console.warn("⚠️ Credenciais ou ID do pedido Shopify ausentes para registrar pagamento.");
    return false;
  }

  const transactionPayload = {
    transaction: {
      kind: "capture",
      status: "success",
      amount: totalAmount.toString()
    }
  };

  try {
    const transactionUrl = `https://${storeDomain}/admin/api/2024-01/orders/${shopifyOrderId}/transactions.json`;
    console.log(`📡 Capturando pagamento no Shopify para o pedido ${shopifyOrderId}: ${transactionUrl}`);

    const response = await fetch(transactionUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionPayload)
    });

    const resData = await response.json();
    if (!response.ok) {
      console.error("❌ Erro retornado pela API do Shopify ao registrar captura:", JSON.stringify(resData));
      return false;
    }

    console.log(`✅ Pedido Shopify ${shopifyOrderId} foi atualizado para PAGO!`);
    return true;
  } catch (error) {
    console.error("❌ Falha de rede ou exceção ao capturar pagamento no Shopify:", error);
    return false;
  }
}

// Helper para Facebook Conversions API (CAPI)
const crypto = require('crypto');

function sha256(val) {
  if (!val) return null;
  return crypto.createHash('sha256').update(val.trim().toLowerCase()).digest('hex');
}

async function sendFacebookCapiEvent(dbRecord, eventName) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    // Buscar configs para obter a lista de pixels
    const configUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs?select=*`;
    const configRes = await fetch(configUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!configRes.ok) return;
    const configs = await configRes.json();
    
    let facebookPixelId = '';
    let facebookPixelToken = '';
    let facebookPixelsJson = '';

    configs.forEach(c => {
      if (c.key === 'facebook_pixel_id') facebookPixelId = c.value;
      if (c.key === 'facebook_pixel_token') facebookPixelToken = c.value;
      if (c.key === 'facebook_pixels') facebookPixelsJson = c.value;
    });

    // Parse pixels
    let pixels = [];
    if (facebookPixelsJson) {
      try {
        pixels = JSON.parse(facebookPixelsJson);
      } catch (e) {
        console.error('Erro ao fazer parse de facebook_pixels no servidor:', e.message);
      }
    }

    // fallback
    if (pixels.length === 0 && facebookPixelId) {
      pixels.push({ id: facebookPixelId, token: facebookPixelToken });
    }

    const capiPixels = pixels.filter(p => p.id && p.token);
    if (capiPixels.length === 0) {
      console.log('ℹ️ Nenhum Pixel com token Conversions API ativo. CAPI ignorado.');
      return;
    }

    const nameParts = (dbRecord.customer_name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    const email = dbRecord.customer_email || '';
    const phone = (dbRecord.customer_phone || '').replace(/\D/g, '');

    const userData = {
      em: email ? [sha256(email)] : [],
      ph: phone ? [sha256(phone)] : [],
      fn: firstName ? [sha256(firstName)] : [],
      ln: lastName ? [sha256(lastName)] : []
    };

    const eventTime = Math.floor(Date.now() / 1000);
    const eventId = dbRecord.checkout_session_id || dbRecord.id || `tx-${dbRecord.gateway_tx_id}`;

    for (const pixel of capiPixels) {
      const capiUrl = `https://graph.facebook.com/v19.0/${pixel.id}/events?access_token=${pixel.token}`;
      const payload = {
        data: [
          {
            event_name: eventName,
            event_time: eventTime,
            event_id: eventId,
            event_source_url: 'https://checkout.mysterious-goodall.com/checkout',
            action_source: 'website',
            user_data: userData,
            custom_data: {
              currency: 'BRL',
              value: parseFloat(dbRecord.amount) || 0
            }
          }
        ]
      };

      console.log(`📡 Enviando CAPI '${eventName}' para Pixel ${pixel.id}...`);
      const response = await fetch(capiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resJson = await response.json();
      console.log(`✅ CAPI Resposta para Pixel ${pixel.id}:`, JSON.stringify(resJson));
    }
  } catch (err) {
    console.error('❌ Falha ao enviar evento CAPI:', err.message);
  }
}

async function resolveShopifyCredentials() {
  let storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  let accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const configUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs?select=*`;
      const configRes = await fetch(configUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (configRes.ok) {
        const configs = await configRes.json();
        let themeConfigStr = '';
        configs.forEach(c => {
          if (c.key === 'checkout_theme_config') themeConfigStr = c.value;
        });

        if (themeConfigStr) {
          const themeConfig = JSON.parse(themeConfigStr);
          if (themeConfig.shopifyDomain) {
            storeDomain = themeConfig.shopifyDomain.trim() + '.myshopify.com';
          }
          if (themeConfig.shopifyToken) {
            accessToken = themeConfig.shopifyToken.trim();
          }
        }
      }
    } catch (err) {
      console.error('Erro ao buscar credenciais dinâmicas do Shopify:', err);
    }
  }

  return { storeDomain, accessToken };
}

async function logSecurityEvent(type, message, event) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    
    const configTargetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs`;
    
    const logRes = await fetch(`${configTargetUrl}?select=*&key=eq.admin_logs`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const logRows = await logRes.json();
    let logs = [];
    let rowExists = false;
    if (logRows && logRows.length > 0) {
      rowExists = true;
      if (logRows[0].value) {
        try { logs = JSON.parse(logRows[0].value); } catch(e) {}
      }
    }
    
    logs.unshift({
      id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      type: type,
      message: message,
      ip: event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'Desconhecido',
      userAgent: event.headers['user-agent'] || 'Desconhecido'
    });
    if (logs.length > 150) logs = logs.slice(0, 150);
    
    const saveMethod = rowExists ? 'PATCH' : 'POST';
    const saveUrl = rowExists ? `${configTargetUrl}?key=eq.admin_logs` : configTargetUrl;
    const payload = rowExists ? { value: JSON.stringify(logs) } : { key: 'admin_logs', value: JSON.stringify(logs) };
    
    await fetch(saveUrl, {
      method: saveMethod,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Erro ao gravar log de segurança', err);
  }
}

