// Netlify Serverless Function: logs
// Caminho: netlify/functions/logs.js

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: JSON.stringify({ message: 'Successful preflight' }),
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Configuração do banco de dados ausente' }),
    };
  }

  const configTargetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs`;

  // === AUTENTICAÇÃO ===
  // Pode ser o token de administrador (login) ou uma chave interna (para POSTs internos de outros lambdas)
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  
  if (!token) {
    return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Não autorizado.' }) };
  }
  
  // Validar se o token é válido no Supabase (se for o admin_session_token) ou se é a própria ANON_KEY (acesso interno)
  let isAuthenticated = false;
  
  if (token === SUPABASE_ANON_KEY || token === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    isAuthenticated = true;
  } else {
    try {
      const authResponse = await fetch(`${configTargetUrl}?select=*&key=eq.admin_session_token`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
      });
      const authRows = await authResponse.json();
      const dbToken = (authRows && authRows.length > 0) ? authRows[0].value : null;
      if (dbToken && dbToken === token) {
        isAuthenticated = true;
      }
    } catch (e) { }
  }

  if (!isAuthenticated) {
    return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Sessão inválida ou não autorizada.' }) };
  }

  // BUSCAR LOGS
  if (event.httpMethod === 'GET') {
    try {
      const logRes = await fetch(`${configTargetUrl}?select=*&key=eq.admin_logs`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
      });
      const logRows = await logRes.json();
      
      let logs = [];
      if (logRows && logRows.length > 0 && logRows[0].value) {
        try {
          logs = JSON.parse(logRows[0].value);
        } catch(e) { logs = []; }
      }
      
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, logs: logs }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }
  }

  // GRAVAR UM LOG
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body || '{}');
      if (!data.type || !data.message) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltando type ou message' }) };
      }

      // 1. Buscar array atual
      const logRes = await fetch(`${configTargetUrl}?select=*&key=eq.admin_logs`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
      });
      const logRows = await logRes.json();
      
      let logs = [];
      let rowExists = false;
      if (logRows && logRows.length > 0) {
        rowExists = true;
        if (logRows[0].value) {
          try {
            logs = JSON.parse(logRows[0].value);
          } catch(e) { logs = []; }
        }
      }

      // 2. Adicionar o novo log no inicio
      const newLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        timestamp: new Date().toISOString(),
        type: data.type, // 'info', 'warning', 'danger'
        message: data.message,
        ip: data.ip || event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'Desconhecido',
        userAgent: data.userAgent || event.headers['user-agent'] || 'Desconhecido'
      };

      logs.unshift(newLog);
      
      // Manter apenas os últimos 150 para não estourar a coluna json
      if (logs.length > 150) {
        logs = logs.slice(0, 150);
      }

      // 3. Salvar de volta
      const saveMethod = rowExists ? 'PATCH' : 'POST';
      const saveUrl = rowExists 
        ? `${configTargetUrl}?key=eq.admin_logs` 
        : configTargetUrl;
      
      const payload = rowExists 
        ? { value: JSON.stringify(logs) } 
        : { key: 'admin_logs', value: JSON.stringify(logs) };

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

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, log: newLog }),
      };

    } catch (error) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }
  }

  return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Method Not Allowed' };
};
