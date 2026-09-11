const state = { products: [], cart: JSON.parse(localStorage.getItem('doce_casa_cart') || '[]'), config: {} };
const $ = (selector) => document.querySelector(selector);
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));

async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível completar a operação.');
  return data;
}

function saveCart() {
  localStorage.setItem('doce_casa_cart', JSON.stringify(state.cart));
  renderCart();
}

function productAvailability(product) {
  if (product.availability === 'made_to_order') return `<span class="availability made">Sob encomenda · ${product.leadTimeDays || 1} dia(s)</span>`;
  if (product.availability === 'unavailable') return '<span class="availability off">Indisponível</span>';
  if (Number(product.stockQty) <= 0) return '<span class="availability off">Esgotado</span>';
  if (Number(product.stockQty) <= Number(product.lowStockThreshold)) return '<span class="availability low">Últimas unidades</span>';
  return '<span class="availability ready">Pronta-entrega</span>';
}

function unitPriceForQuantity(product, quantity) {
  const tiers = Array.isArray(product.priceTiers) ? product.priceTiers : [];
  const match = tiers.filter(tier => quantity >= Number(tier.minQty) && (tier.maxQty === null || quantity <= Number(tier.maxQty))).sort((a, b) => Number(b.minQty) - Number(a.minQty))[0];
  return match ? Number(match.price) : Number(product.price || 0);
}

function tierLabel(product) {
  const tiers = Array.isArray(product.priceTiers) ? product.priceTiers : [];
  if (!tiers.length) return '';
  return `<small class="price-note">Preço por unidade a partir de ${money(tiers[0].price)} · descontos por quantidade</small>`;
}

function canAdd(product) {
  if (product.availability === 'unavailable') return false;
  const item = state.cart.find(item => item.productId === product.id);
  return product.availability === 'made_to_order' || !item || item.quantity < Number(product.stockQty);
}

function renderProducts() {
  const grid = $('#product-grid');
  $('#catalog-status').textContent = `${state.products.length} produto(s)`;
  if (!state.products.length) {
    grid.innerHTML = '<div class="empty-state card-empty"><strong>Catálogo em preparação.</strong><span>Volte em breve para conferir os produtos.</span></div>';
    return;
  }
  grid.innerHTML = state.products.map(product => {
    const disabled = !canAdd(product) || product.availability === 'unavailable' || (product.availability === 'ready' && Number(product.stockQty) <= 0);
    const image = product.imageUrl ? `<img loading="lazy" src="${product.imageUrl}" alt="${escapeHtml(product.name)}">` : `<div class="image-placeholder"><span>doce</span></div>`;
    const description = product.description ? `<p>${escapeHtml(product.description)}</p>` : '<p class="muted">Uma escolha especial da nossa cozinha.</p>';
    return `<article class="product-card">
      <div class="product-image">${image}<span class="image-note">prévia protegida</span></div>
      <div class="product-info"><div class="product-top"><h3>${escapeHtml(product.name)}</h3>${productAvailability(product)}</div>${description}${tierLabel(product)}<div class="product-bottom"><strong>A partir de ${money(product.startingPrice ?? product.price)}</strong><button class="small-button" data-add="${product.id}" ${disabled ? 'disabled' : ''}>${disabled ? 'Indisponível' : 'Adicionar'}</button></div></div>
    </article>`;
  }).join('');
  grid.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => addToCart(Number(button.dataset.add))));
}

function addToCart(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product || !canAdd(product)) return showToast('Este produto não está disponível nessa quantidade.');
  const current = state.cart.find(item => item.productId === productId);
  if (current) current.quantity += 1;
  else state.cart.push({ productId, quantity: 1 });
  saveCart();
  openCart();
  showToast('Produto adicionado ao carrinho.');
}

function cartDetails() {
  return state.cart.map(item => {
    const product = state.products.find(product => product.id === item.productId);
    return product ? { ...item, product } : null;
  }).filter(Boolean);
}

function cartTotal() {
  return cartDetails().reduce((sum, item) => sum + (item.quantity * unitPriceForQuantity(item.product, item.quantity)), 0);
}

function renderCart() {
  const details = cartDetails();
  const count = details.reduce((sum, item) => sum + item.quantity, 0);
  $('#cart-count').textContent = count;
  $('#cart-total').textContent = money(cartTotal());
  $('#checkout-total').textContent = money(cartTotal());
  $('#checkout-button').disabled = !details.length;
  $('#cart-empty').style.display = details.length ? 'none' : 'flex';
  $('#cart-items').innerHTML = details.map(item => `<div class="cart-item">
    <div class="cart-item-thumb">${item.product.imageUrl ? `<img src="${item.product.imageUrl}" alt="">` : 'D'}</div>
    <div class="cart-item-info"><strong>${escapeHtml(item.product.name)}</strong><span>${money(unitPriceForQuantity(item.product, item.quantity))} por unidade · ${money(item.quantity * unitPriceForQuantity(item.product, item.quantity))}</span><div class="quantity"><button data-minus="${item.product.id}" type="button">−</button><b>${item.quantity}</b><button data-plus="${item.product.id}" type="button">+</button></div></div>
    <button class="remove-button" data-remove="${item.product.id}" type="button" aria-label="Remover">×</button>
  </div>`).join('');
  $('#cart-items').querySelectorAll('[data-minus]').forEach(button => button.addEventListener('click', () => changeQuantity(Number(button.dataset.minus), -1)));
  $('#cart-items').querySelectorAll('[data-plus]').forEach(button => button.addEventListener('click', () => changeQuantity(Number(button.dataset.plus), 1)));
  $('#cart-items').querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => removeFromCart(Number(button.dataset.remove))));
}

function changeQuantity(productId, delta) {
  const item = state.cart.find(item => item.productId === productId);
  const product = state.products.find(product => product.id === productId);
  if (!item || !product) return;
  const next = item.quantity + delta;
  if (next <= 0) return removeFromCart(productId);
  if (product.availability === 'ready' && next > Number(product.stockQty)) return showToast('Quantidade acima do estoque disponível.');
  item.quantity = next;
  saveCart();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter(item => item.productId !== productId);
  saveCart();
}

function openCart() { $('#cart-drawer').classList.add('open'); $('#drawer-backdrop').classList.add('open'); $('#cart-drawer').setAttribute('aria-hidden', 'false'); }
function closeCart() { $('#cart-drawer').classList.remove('open'); $('#drawer-backdrop').classList.remove('open'); $('#cart-drawer').setAttribute('aria-hidden', 'true'); }
function openCheckout() { closeCart(); $('#checkout-error').textContent = ''; $('#checkout-modal').classList.add('open'); $('#checkout-backdrop').classList.add('open'); $('#checkout-modal').setAttribute('aria-hidden', 'false'); }
function closeCheckout() { $('#checkout-modal').classList.remove('open'); $('#checkout-backdrop').classList.remove('open'); $('#checkout-modal').setAttribute('aria-hidden', 'true'); }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }

async function submitOrder(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  $('#checkout-error').textContent = '';
  try {
    const result = await getJson('/api/public/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { name: form.get('name'), phone: form.get('phone'), email: form.get('email') },
        shipping: { postalCode: form.get('postalCode'), address: form.get('address'), city: form.get('city'), state: form.get('state') },
        paymentMethod: form.get('paymentMethod'), notes: form.get('notes'), items: state.cart
      })
    });
    const orderNumber = result.order.order_number;
    const total = money(result.order.total);
    state.cart = [];
    saveCart();
    event.target.reset();
    closeCheckout();
    showToast(`Pedido ${orderNumber} recebido.`);
    setTimeout(() => alert(`Pedido recebido!\n\nNúmero: ${orderNumber}\nTotal: ${total}\n\nEm breve entraremos em contato para confirmar o pagamento e o envio.`), 250);
  } catch (error) {
    $('#checkout-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderCampaigns(campaigns) {
  const section = $('#campaign-section');
  const card = $('#campaign-card');
  if (!campaigns?.length) { section.hidden = true; return; }
  const campaign = campaigns[0];
  const fmt = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR') : 'A combinar';
  const products = campaign.products?.length ? `<p><strong>Produtos disponíveis:</strong> ${campaign.products.map(p => escapeHtml(p.name)).join(', ')}</p>` : '';
  card.innerHTML = `<div class="campaign-public"><span class="status-pill paid">Campanha ativa</span><h3>${escapeHtml(campaign.name)}</h3>${campaign.description ? `<p>${escapeHtml(campaign.description)}</p>` : ''}<p><strong>Pedidos:</strong> ${fmt(campaign.start_date)} a ${fmt(campaign.end_date)}</p><p><strong>Pagamento até:</strong> ${fmt(campaign.payment_due_date)}</p><p><strong>Entrega:</strong> ${fmt(campaign.delivery_date)}</p>${products}</div>`;
  section.hidden = false;
}

function normalizeCheckoutInputs() {
  const phone = document.querySelector('#checkout-form [name=phone]');
  const cep = document.querySelector('#checkout-form [name=postalCode]');
  if (phone) phone.addEventListener('input', () => { phone.value = phone.value.replace(/[^0-9+()\- ]/g, ''); });
  if (cep) cep.addEventListener('input', () => { cep.value = cep.value.replace(/\D/g, '').slice(0, 8); });
}
async function init() {
  try {
    const [config, products, campaigns] = await Promise.all([getJson('/api/public/config'), getJson('/api/public/products'), getJson('/api/public/campaigns')]);
    state.config = config;
    state.products = products.products;
    renderCampaigns(campaigns.campaigns);
    $('#store-name').textContent = config.storeName;
    document.title = config.storeName;
    renderProducts();
    renderCart();
  } catch (error) {
    $('#catalog-status').textContent = 'Não foi possível carregar';
    $('#product-grid').innerHTML = `<div class="empty-state card-empty"><strong>Catálogo indisponível.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

$('#open-cart').addEventListener('click', openCart);
$('#close-cart').addEventListener('click', closeCart);
$('#drawer-backdrop').addEventListener('click', closeCart);
$('#checkout-button').addEventListener('click', openCheckout);
$('#close-checkout').addEventListener('click', closeCheckout);
$('#checkout-backdrop').addEventListener('click', closeCheckout);
$('#checkout-form').addEventListener('submit', submitOrder);
init();
