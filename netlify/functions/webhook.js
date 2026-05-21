// Netlify Serverless Function: webhook
// Caminho: netlify/functions/webhook.js

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
    console.log('⚡ Webhook da PagueX recebido:', JSON.stringify(data));

    // Suporta múltiplos formatos de payload (plano ou aninhado sob 'data')
    const transactionId = data.id || (data.data && data.data.id) || data.transaction_id || (data.metadata && data.metadata.gateway_tx_id);
    const status = data.status || (data.data && data.data.status) || (data.data && data.data.pix && data.data.pix.status);

    if (!transactionId) {
      console.warn('⚠️ ID da transação ausente no payload do webhook.');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'ID da transação não identificado no webhook.' }),
      };
    }

    console.log(`🔍 Buscando transação no Supabase com gateway_tx_id = ${transactionId}...`);

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

    const isPaidState = ['PAID', 'APPROVED', 'approved', 'paid'].includes(status);
    
    // Se o pagamento foi aprovado
    if (isPaidState) {
      console.log(`💰 Status recebido como aprovado (${status}). Sincronizando com Supabase e Shopify...`);

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
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

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
