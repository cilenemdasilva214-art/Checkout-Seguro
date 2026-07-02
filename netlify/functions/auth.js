// Caminho: netlify/functions/auth.js
const crypto = require('crypto');

exports.handler = async (event, context) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
      body: JSON.stringify({ error: 'Supabase credentials missing.' })
    };
  }

  const targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs`;

  // POST: Autenticar usuário
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body || '{}');
      const { username, password } = data;

      if (!username || !password) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Usuário e senha são obrigatórios.' })
        };
      }

      // Fetch configs from DB to check credentials
      const response = await fetch(`${targetUrl}?select=*`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      const configs = await response.json();

      let dbUser = 'admin';
      let dbPass = '123456789';
      let rateLimits = {};

      configs.forEach(c => {
        if (c.key === 'admin_username') dbUser = c.value;
        if (c.key === 'admin_password') dbPass = c.value;
        if (c.key === 'login_rate_limits') {
          try {
            rateLimits = JSON.parse(c.value);
          } catch (e) {}
        }
      });

      // Rastreamento de IP
      const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
      const now = Date.now();
      let ipStatus = rateLimits[clientIp] || { attempts: 0, blocked_until: 0, penalty_level: 0 };

      // Verifica se o IP está bloqueado atualmente
      if (ipStatus.blocked_until > now) {
        const remainingMs = ipStatus.blocked_until - now;
        return {
          statusCode: 429, // Too Many Requests
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Muitas tentativas falhas. Tente novamente mais tarde.', retryAfter: remainingMs })
        };
      }

      if (username === dbUser && password === dbPass) {
        // Sucesso: Zera os erros deste IP
        if (rateLimits[clientIp]) {
          delete rateLimits[clientIp];
          await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([{ key: 'login_rate_limits', value: JSON.stringify(rateLimits), updated_at: new Date().toISOString() }])
          });
        }

        // Authenticated! Generate a secure session token
        const token = crypto.randomUUID();

        // Save session token to the database
        const saveRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify([
            { key: 'admin_session_token', value: token, updated_at: new Date().toISOString() },
            { key: 'last_login_ip', value: clientIp, updated_at: new Date().toISOString() },
            { key: 'last_login_time', value: new Date().toISOString(), updated_at: new Date().toISOString() }
          ])
        });

        if (!saveRes.ok) {
          throw new Error('Falha ao salvar a sessão no banco de dados.');
        }

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, token: token })
        };
      } else {
        // Falha no login: Incrementa as tentativas
        ipStatus.attempts += 1;

        // Lógica de escalonamento do bloqueio rigoroso (3 tentativas):
        // Permite até 2 erros. No 3º erro consecutivo, bloqueia por 1 hora (Level 1).
        // Nos próximos níveis, se errar 3 vezes de novo, vai aumentando o tempo de bloqueio.
        if (ipStatus.penalty_level === 0 && ipStatus.attempts >= 3) {
          ipStatus.blocked_until = now + (60 * 60 * 1000); // 1 hora
          ipStatus.penalty_level = 1;
          ipStatus.attempts = 0; // Zera para a próxima rodada
        } else if (ipStatus.penalty_level > 0 && ipStatus.attempts >= 3) {
          // Escalonamento: Level 1 = 3h, Level 2 = 6h, Level 3+ = 12h
          let hours = 3;
          if (ipStatus.penalty_level === 2) hours = 6;
          if (ipStatus.penalty_level >= 3) hours = 12;
          
          ipStatus.blocked_until = now + (hours * 60 * 60 * 1000);
          ipStatus.penalty_level += 1;
          ipStatus.attempts = 0;
        }

        rateLimits[clientIp] = ipStatus;

        // Salva o novo status no banco
        const saveRateLimitRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify([{ key: 'login_rate_limits', value: JSON.stringify(rateLimits), updated_at: new Date().toISOString() }])
        });

        // Delay artificial de 2 segundos (Tarpit) para desacelerar bruteforce automatizado
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Se o usuário acabou de ser bloqueado nesta tentativa
        if (ipStatus.blocked_until > now) {
          const remainingMs = ipStatus.blocked_until - now;
          return {
            statusCode: 429,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Muitas tentativas falhas. Acesso bloqueado temporariamente.', retryAfter: remainingMs })
          };
        } else {
          return {
            statusCode: 401,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Usuário ou senha incorretos.' })
          };
        }
      }
    } catch (err) {
      console.error('Erro na autenticação:', err);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message })
      };
    }
  }

  // GET: Validate Session Token (Check if it's still valid)
  if (event.httpMethod === 'GET') {
    try {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();

      if (!token) {
        return {
          statusCode: 401,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ valid: false, error: 'Token missing.' })
        };
      }

      const response = await fetch(`${targetUrl}?select=*&key=eq.admin_session_token`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      const rows = await response.json();
      
      const dbToken = (rows && rows.length > 0) ? rows[0].value : null;

      if (dbToken && dbToken === token) {
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ valid: true })
        };
      } else {
        return {
          statusCode: 401,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ valid: false, error: 'Invalid or expired token.' })
        };
      }
    } catch (err) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid: false, error: err.message })
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method Not Allowed' }),
  };
};
