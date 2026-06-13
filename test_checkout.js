process.env.PAGUEX_PUBLIC_KEY = 'pk_3ad3635882f4295a09881f2ffecce4764ed8fa38';
process.env.PAGUEX_SECRET_KEY = 'sk_404d97529041ae3c66999699eb8d5d6b10019a71';

const { handler } = require('./netlify/functions/checkout.js');

async function test() {
  const event = {
    httpMethod: 'POST',
    body: JSON.stringify({
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
    })
  };

  const context = {};

  try {
    const res = await handler(event, context);
    console.log("Status:", res.statusCode);
    console.log("Body:", res.body);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
