window.renderCheckoutCart = function() {
  const itemsListContainer = document.getElementById('items-list');
  if (!itemsListContainer) return;

  if (!window.shopifyCartItems || window.shopifyCartItems.length === 0) {
    itemsListContainer.innerHTML = '<div style=\"padding: 20px; text-align: center; color: var(--text-secondary);\">Seu carrinho está vazio.</div>';
    if (window.amountInput) {
      window.amountInput.value = '0.00';
    }
    if (typeof calculateTotals === 'function') calculateTotals();
    return;
  }

  let htmlContent = '';
  let totalBaseAmount = 0;

  window.shopifyCartItems.forEach((item, index) => {
    const priceNum = parseFloat(item.price) || 0;
    const qtyNum = parseInt(item.quantity) || 1;
    const subtotalItem = priceNum * qtyNum;
    totalBaseAmount += subtotalItem;

    const imageHtml = item.image 
      ? \<img src="\" alt="\" style="width: 100%; height: 100%; object-fit: cover;">\ 
      : \<i class="fa-solid fa-wine-bottle" style="font-size: 1.25rem;"></i>\;

    htmlContent += \
      <div class="checkout-product-card" style="margin-bottom: 12px; display: flex; gap: 16px; align-items: center; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 12px; transition: all 0.3s;">
        <div class="checkout-product-icon-box" style="padding: 0; overflow: hidden; background: rgba(124, 77, 255, 0.05); display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 10px; flex-shrink: 0; box-shadow: 0 0 15px rgba(124, 77, 255, 0.2);">
          \
        </div>
        <div class="checkout-product-details" style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; text-align: left;">
          <span class="checkout-product-name" style="font-weight: 600; font-size: 14px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="\">\</span>
          <span class="checkout-product-size" style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">SKU: \</span>
          <div class="checkout-product-controls" style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <div class="checkout-qty-actions" style="display: flex; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 2px;">
              <button type="button" onclick="changeCartItemQty(\, -1)" style="background: transparent; border: none; color: var(--text-secondary); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 4px; font-size: 10px;">
                <i class="fa-solid fa-minus"></i>
              </button>
              <span class="checkout-qty-value" style="font-size: 12px; font-weight: 600; color: var(--text-primary); min-width: 16px; text-align: center;">\</span>
              <button type="button" onclick="changeCartItemQty(\, 1)" style="background: transparent; border: none; color: var(--text-secondary); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 4px; font-size: 10px;">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <span class="checkout-product-price" style="font-weight: 700; color: var(--primary-color); font-size: 14px;">R$ \</span>
              <button type="button" onclick="removeCartItem(\)" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 6px; transition: all 0.2s;" title="Remover item">
                <i class="fa-solid fa-trash-can" style="font-size: 12px;"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    \;
  });

  htmlContent += \<input type="number" id="base-amount" value="\" style="display: none;">\;
  itemsListContainer.innerHTML = htmlContent;

  const amountInput = document.getElementById('amount');
  if (amountInput) {
    amountInput.value = totalBaseAmount.toFixed(2);
    amountInput.disabled = true;
    amountInput.style.opacity = '0.7';
    amountInput.style.cursor = 'not-allowed';
  }

  const firstItem = window.shopifyCartItems[0];
  window.shpfyProductTitle = firstItem.title;
  window.shpfyProductSku = firstItem.sku || 'SHPFY-DEFAULT';
  window.shpfyProductPrice = parseFloat(firstItem.price) || 0;
  window.shpfyProductQuantity = parseInt(firstItem.quantity) || 1;
  window.shpfyVariantId = firstItem.variant_id || null;

  if (typeof calculateTotals === 'function') calculateTotals();
  if (typeof checkCollectionDiscounts === 'function') checkCollectionDiscounts(window.shpfyProductSku, window.shpfyVariantId, window.shpfyProductPrice, '');
};

window.changeCartItemQty = function(index, delta) {
  if (!window.shopifyCartItems || !window.shopifyCartItems[index]) return;
  let newQty = parseInt(window.shopifyCartItems[index].quantity) + delta;
  if (newQty < 1) newQty = 1;
  window.shopifyCartItems[index].quantity = newQty;
  window.renderCheckoutCart();
};

window.removeCartItem = function(index) {
  if (!window.shopifyCartItems || !window.shopifyCartItems[index]) return;
  window.shopifyCartItems.splice(index, 1);
  window.renderCheckoutCart();
};
