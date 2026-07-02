// Netlify Serverless Function: webhook-pagueflex
// Caminho: netlify/functions/webhook-pagueflex.js

exports.handler = async (event, context) => {
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
    console.log('⚡ Webhook da PagueFlex recebido:', JSON.stringify(data));
    console.log('⚡ Headers do Webhook da PagueFlex:', JSON.stringify(event.headers));

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    // NOVO: LOGAR TODO WEBHOOK RECEBIDO NO BANCO PARA DEBUG
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            customer_name: 'WEBHOOK_LOG_RAW',
            status: 'PENDING',
            gateway_response: data
          })
        });
      } catch(e) { console.error('Erro ao logar webhook no banco:', e); }
    }

    // Suporta múltiplos formatos de payload (PagueFlex)
    const txObj = data.transaction || data.payment || data.data || data;
    const transactionId = txObj.externalRef || txObj.id || txObj.transaction_id || txObj.transactionId || (data.metadata && data.metadata.gateway_tx_id) || data.id;
    const status = txObj.status || (txObj.pix && txObj.pix.status) || data.status;

    // TODO: A validação do pagueflex_webhook_secret poderá ser implementada aqui
    // assim que descobrirmos se eles enviam via Header (X-Signature) ou no Body.

    if (!transactionId) {
      console.warn('⚠️ ID da transação ausente no payload do webhook.');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'ID da transação não identificado no webhook.' }),
      };
    }

    console.log(`🔍 Buscando transação no Supabase com gateway_tx_id = ${transactionId}...`);

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('❌ Credenciais do Supabase ausentes no ambiente.');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Configuração do banco de dados ausente no backend.' }),
      };
    }

    // Buscar a transação correspondente no Supabase usando gateway_tx_id
    const selectUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?gateway_tx_id=eq.${transactionId}&select=*`;
    
    const findRes = await fetch(selectUrl, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!findRes.ok) {
      const errText = await findRes.text();
      throw new Error(`Erro ao buscar registro no Supabase: ${findRes.status} - ${errText}`);
    }

    const records = await findRes.json();

    if (!records || records.length === 0) {
      console.warn(`⚠️ Transação com gateway_tx_id = ${transactionId} não encontrada no Supabase.`);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Transação não encontrada para o ID do gateway: ${transactionId}` }),
      };
    }

    const dbRecord = records[0];
    console.log(`✅ Registro encontrado no Supabase! ID Interno: ${dbRecord.id}, Status Atual: ${dbRecord.status}`);

    const isPaidState = ['PAID', 'APPROVED', 'approved', 'paid', 'PRE-APPROVED', 'pre-approved'].includes(status);
    
    // Se o pagamento foi aprovado
    if (isPaidState) {
      console.log(`💰 Status recebido como aprovado (${status}). Sincronizando com Supabase e Shopify...`);

      // FB CAPI DISPARO: PIX OU CARTÃO APROVADO
      if (dbRecord.status !== 'PAID') {
        sendFacebookCapiEvent(dbRecord, 'Purchase').catch(e => console.error('Erro ao enviar CAPI no Webhook:', e.message));
      }

      // 1. Atualizar status no Supabase para PAID
      const patchUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?id=eq.${dbRecord.id}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          status: 'PAID',
          gateway_response: {
            ...dbRecord.gateway_response,
            webhook_event: data,
            webhook_received_at: new Date().toISOString()
          }
        })
      });

      if (!patchRes.ok) {
        const patchErr = await patchRes.text();
        console.error(`❌ Falha ao atualizar status no Supabase: ${patchRes.status} - ${patchErr}`);
      } else {
        console.log(`✅ Transação ${dbRecord.id} atualizada para PAID no Supabase!`);
      }

      // 2. Atualizar status no Shopify para Pago
      if (dbRecord.shopify_order_id) {
        console.log(`🛍️ Pedido Shopify associado encontrado: ${dbRecord.shopify_order_id}. Liquidando pagamento...`);
        const totalAmount = parseFloat(dbRecord.amount) || 0;
        const shopifySuccess = await markShopifyOrderAsPaid(dbRecord.shopify_order_id, totalAmount);
        
        if (shopifySuccess) {
          console.log(`✅ Pedido Shopify ${dbRecord.shopify_order_id} liquidado com sucesso!`);
        } else {
          console.error(`❌ Falha ao liquidar pedido Shopify ${dbRecord.shopify_order_id}.`);
        }
      } else {
        console.log('ℹ️ Esta transação não possui um ID de pedido Shopify associado. Ignorando sincronização com Shopify.');
      }
    } else {
      console.log(`ℹ️ Status do webhook (${status}) não indica pagamento concluído. Apenas registrando evento.`);
      
      // Atualizar resposta do gateway no banco para auditar
      const patchUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?id=eq.${dbRecord.id}`;
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: status || dbRecord.status,
          gateway_response: {
            ...dbRecord.gateway_response,
            webhook_event: data,
            webhook_received_at: new Date().toISOString()
          }
        })
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ success: true, message: 'Webhook processado e integrado com sucesso.' }),
    };

  } catch (error) {
    console.error('❌ Erro no processamento do webhook:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ success: false, error: 'Erro interno no servidor de webhook.', details: error.message }),
    };
  }
};

// Helper para marcar pedido do Shopify como pago
async function markShopifyOrderAsPaid(shopifyOrderId, totalAmount) {
  const { storeDomain, accessToken } = await resolveShopifyCredentials();

  if (!storeDomain || !accessToken || !shopifyOrderId) {
    console.warn("⚠️ Credenciais do Shopify ausentes para registrar pagamento.");
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
    
    const response = await fetch(transactionUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transactionPayload)
    });

    if (!response.ok) {
      const resData = await response.json();
      console.error("❌ Erro retornado pela API do Shopify ao registrar captura:", JSON.stringify(resData));
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Falha de rede ao capturar pagamento no Shopify:", error);
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
        console.error('Erro ao fazer parse de facebook_pixels no servidor webhook:', e.message);
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

      console.log(`📡 Enviando CAPI '${eventName}' para Pixel ${pixel.id} no Webhook...`);
      const response = await fetch(capiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resJson = await response.json();
      console.log(`✅ CAPI Resposta para Pixel ${pixel.id} no Webhook:`, JSON.stringify(resJson));
    }
  } catch (err) {
    console.error('❌ Falha ao enviar evento CAPI no Webhook:', err.message);
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
      console.error('Erro ao buscar credenciais dinâmicas do Shopify no Webhook:', err);
    }
  }

  return { storeDomain, accessToken };
}
