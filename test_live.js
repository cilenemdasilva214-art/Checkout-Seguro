const https = require('https');

const payload = JSON.stringify({
  amount: 100.50,
  payment_method: 'pix',
  customer_name: 'Felipe Santos Ferreira',
  customer_cpf: '85921275565',
  customer_email: 'teste@gmail.com',
  customer_phone: '11999999999',
  cep: '01001000',
  street: 'Rua Teste',
  street_number: '123',
  neighborhood: 'Centro',
  city: 'São Paulo',
  state: 'SP',
  items: [
    { id: '1', name: 'Produto 1', price: 97.00, quantity: 1 }
  ],
  amount: 87.30
});

const discount = parseFloat((97.00 - 87.30).toFixed(2));


const options = {
    hostname: 'checkoutt-seguro.netlify.app',
    port: 443,
    path: '/.netlify/functions/checkout',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
};

console.log("Enviando requisição de teste para o site oficial (produção)...");
const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        try {
            const parsed = JSON.parse(data);
            console.log(`Mode: ${parsed.mode}`);
            console.log(`Message: ${parsed.message}`);
            if (parsed.gateway_response && parsed.gateway_response.error_details) {
                console.log(`Error Details: ${parsed.gateway_response.error_details}`);
            }
            if (parsed.pix_qr_code) {
               console.log("Pix gerado com sucesso!");
               console.log("QR Code começa com:", parsed.pix_qr_code.substring(0, 30));
            }
        } catch (e) {
            console.log(`Raw Body: ${data}`);
        }
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.write(payload);
req.end();
