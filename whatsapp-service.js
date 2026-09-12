require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const PORT = Number(process.env.WA_SERVICE_PORT || 4174);
const HOST = process.env.WA_SERVICE_HOST || '127.0.0.1';
const INTERNAL_TOKEN = String(process.env.WA_INTERNAL_TOKEN || '').trim();
if (INTERNAL_TOKEN.length < 24) throw new Error('WA_INTERNAL_TOKEN ausente ou inseguro. Configure um token com pelo menos 24 caracteres no .env.');
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const AUTH_PATH = path.resolve(process.env.WA_AUTH_PATH || path.join(DATA_DIR, 'whatsapp-auth'));
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const STORE_API_URL = process.env.STORE_API_URL || 'http://127.0.0.1:4173';
const AUTO_REPLY_ENABLED = String(process.env.WA_AUTO_REPLY_ENABLED || 'false').toLowerCase() === 'true';
let notificationPolling = false;

fs.mkdirSync(AUTH_PATH, { recursive: true });

const state = {
  status: 'starting', number: '', qrDataUrl: null, qrAt: null, lastError: null,
  lastEventAt: new Date().toISOString()
};

let client = null;
let reconnectTimer = null;
let reconnecting = false;

function touch(status, extra = {}) {
  Object.assign(state, { status, lastEventAt: new Date().toISOString(), ...extra });
  console.log(`[whatsapp] ${status}${state.number ? ` (${state.number})` : ''}`);
}

function attachClientEvents(instance) {
  instance.on('qr', async qr => {
    try {
      state.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
      state.qrAt = new Date().toISOString();
      state.lastError = null;
      touch('qr');
    } catch (error) {
      touch('error', { lastError: error.message });
    }
  });

  instance.on('authenticated', () => {
    state.qrDataUrl = null;
    state.lastError = null;
    touch('authenticated');
  });

  instance.on('ready', () => {
    state.qrDataUrl = null;
    state.lastError = null;
    state.number = instance.info?.wid?.user || process.env.STORE_WHATSAPP || '';
    touch('connected');
  });

  instance.on('auth_failure', message => touch('error', { lastError: String(message) }));

  instance.on('error', error => {
    const detail = error?.stack || error?.message || String(error);
    console.error('[whatsapp] ERRO COMPLETO:', detail);
    touch('error', { lastError: detail });
  });
  instance.on('change_state', stateName => console.log(`[whatsapp] estado: ${stateName}`));
  instance.on('disconnected', reason => {
    state.qrDataUrl = null;
    touch('disconnected', { lastError: String(reason) });
    scheduleReconnect();
  });

  instance.on('message', async message => {
    if (!AUTO_REPLY_ENABLED || message.from.endsWith('@g.us')) return;
    const original = String(message.body || '').trim();
    const body = original.toLowerCase();

    try {
      const phone = await resolveSenderPhone(message);
      const identity = await storeInternal(`/api/internal/staff/identity?phone=${encodeURIComponent(phone)}`).catch(() => null);
      if (identity?.staff) return handleStaffMessage(message, identity.staff, original, body, phone);

      const gate = await ensureRegisteredCustomer(message, phone, original, body);
      if (!gate.allowed) return;

      if (['oi', 'olá', 'ola', 'menu', 'ajuda', 'start', '/start', '/menu', 'help', 'comandos'].includes(body)) return message.reply(menuText());
      if (['comprar', 'link', 'catalogo', 'catálogo', '1'].includes(body)) return sendCatalogLink(message, phone, null);
      if (['produtos', 'produto', '1'].includes(body)) return sendCatalogLink(message, phone, null);
      if (['campanhas', 'campanha', 'lotes', 'lote', '2'].includes(body)) {
        const { campaigns } = await storeInternal('/api/internal/campaigns');
        if (!campaigns.length) return message.reply('📅 Não há campanhas/lotes publicados no momento.');
        const lines = [];
        for (const item of campaigns) {
          const payment = item.payment_due_date ? `\nPagamento até: ${formatDate(item.payment_due_date)}` : '';
          const delivery = item.delivery_date ? `\nEntrega: ${formatDate(item.delivery_date)}` : '';
          let link='';
          try { const generated=await storeInternal('/api/internal/campaign-links',{method:'POST',body:JSON.stringify({campaignId:item.id})}); link=`\n\n🛒 Fazer pedido:\n${generated.url}`; } catch (_) {}
          const products = item.campaignProducts?.length ? `\nProdutos: ${item.campaignProducts.map(p => p.name).join(', ')}` : '';
          lines.push(`🍫 ${item.name}\nPedidos: ${formatDate(item.start_date)} a ${formatDate(item.end_date)}${payment}${delivery}${products}${link}`);
        }
        return message.reply(`📅 Campanhas disponíveis:\n\n${lines.join('\n\n')}`);
      }
      if (body === '3' || body === 'status' || body === 'pedido') return message.reply('📦 Envie o código do pedido. Exemplo: status PED-20260907-ABC123');
      const orderMatch = body.match(/(?:pedido|status)\s+([a-z0-9-]+)/i);
      if (orderMatch) return replyOrderStatus(message, phone, orderMatch[1]);
      if (/^ped-[a-z0-9-]+$/i.test(body)) return replyOrderStatus(message, phone, body);
      const changeMatch = body.match(/^alterar\s+(ped-[a-z0-9-]+)\s+(cod-[a-z0-9-]+)\s+([\s\S]+)$/i);
      if (changeMatch) {
        const data = await storeInternal(`/api/public/orders/${encodeURIComponent(changeMatch[1])}/change-requests`, { method:'POST', body:JSON.stringify({ number:changeMatch[1], code:changeMatch[2], phone, notes:changeMatch[3], reason:changeMatch[3] }) });
        return message.reply(`✏️ Solicitação registrada para ${changeMatch[1].toUpperCase()}.\n\nA equipe vai verificar se ainda é possível alterar o pedido e informará qualquer diferença de valor.`);
      }
      if (body === '4' || body.includes('alterar pedido') || body.includes('acrescentar') || body.includes('editar pedido')) return message.reply('✏️ Envie: alterar PED-XXXXXX COD-XXXXXX explique o que deseja alterar. A equipe verificará o estágio, estoque e eventual diferença de valor.');
      if (body === '5' || body === 'atendente') {
        const data = await storeInternal('/api/internal/support/request', { method: 'POST', body: JSON.stringify({ phone, name: message._data?.notifyName || '' }) });
        if (!data.attendants?.length) return message.reply('👤 Recebi sua solicitação, mas nossa equipe de atendimento está offline no momento. Tente novamente em instantes.');
        return message.reply(`👤 Solicitação aberta!\n\nChamamos nossa equipe de atendimento.\nProtocolo: ATD-${String(data.ticket.id).padStart(5,'0')}\n\nAssim que alguém assumir, continuaremos por aqui.`);
      }
      const open = await storeInternal(`/api/internal/support/by-phone?phone=${encodeURIComponent(phone)}`).catch(() => null);
      if (open?.ticket?.assigned_staff_id) {
        await storeInternal(`/api/internal/support/${open.ticket.id}/message`, { method:'POST', body:JSON.stringify({ direction:'inbound', senderType:'customer', senderName:message._data?.notifyName || '', body:original, deliveryStatus:'received' }) }).catch(() => null);
        await message.reply('💬 Sua mensagem foi encaminhada para o atendente.');
        const target = await storeInternal(`/api/internal/support/${open.ticket.id}/message-target`);
        return sendWhatsAppMessage(target.staffPhone || open.ticket.staff_phone, `💬 Cliente ${open.ticket.customer_name || phone} (ATD-${String(open.ticket.id).padStart(5,'0')}):\n${original}`);
      }
      if (open?.ticket) {
        await storeInternal(`/api/internal/support/${open.ticket.id}/message`, { method:'POST', body:JSON.stringify({ direction:'inbound', senderType:'customer', senderName:message._data?.notifyName || '', body:original, deliveryStatus:'received' }) }).catch(() => null);
        return message.reply('💬 Sua mensagem foi registrada no atendimento. Assim que um atendente assumir, continuaremos por aqui.');
      }
    } catch (error) {
      console.error('[whatsapp] falha ao responder:', error.message);
      await message.reply('Não consegui consultar agora. Tente novamente em instantes ou digite ajuda.').catch(() => {});
    }
  });
}


async function resolveSenderPhone(message) {
  const from = String(message?.from || '');
  const direct = senderPhone(message);
  if (!from.endsWith('@lid')) return direct;
  try {
    const resolved = await client.getContactLidAndPhone([from]);
    const item = resolved?.[0];
    const pn = String(item?.pn || '');
    const phone = pn.replace(/\D/g, '');
    if (phone.length >= 8) return phone;
  } catch (error) {
    console.warn(`[whatsapp] falha ao resolver LID de entrada ${from}: ${error.message}`);
  }
  return direct;
}

async function ensureRegisteredCustomer(message, phone, original, body) {
  const registration = await storeInternal(
    `/api/internal/customer-registration?phone=${encodeURIComponent(phone)}`
  ).catch(() => null);

  const command = String(body || '').trim().toLowerCase();

  if (registration?.customer?.status === 'approved') {
    return { allowed: true };
  }

  if (registration?.customer?.status === 'pending') {
    return message.reply(
      `⏳ Seu cadastro está aguardando aprovação da nossa equipe.\n\n` +
      `Assim que for aprovado, você poderá usar o atendimento normalmente.`
    ).then(() => ({ allowed: false }));
  }

  if (registration?.customer?.status === 'rejected') {
    if (!['cadastrar', 'cadastro', 'começar cadastro', 'comecar cadastro', 'começar', 'comecar'].includes(command)) {
      return message.reply(
        `🚫 Seu cadastro não foi aprovado.\n\n` +
        `Digite *CADASTRAR* para iniciar um novo cadastro.`
      ).then(() => ({ allowed: false }));
    }
  }

  let session = registration?.session || null;

  if (['cancelar', 'cancelar cadastro', 'sair cadastro'].includes(command)) {
    return resetRegistration(message, phone);
  }

  if (!session) {
    await storeInternal('/api/internal/customer-registration/start', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });

    await message.reply(
      `👋 *Olá! Antes de continuar, precisamos fazer seu cadastro.*\n\n` +
      `O cadastro é rápido e será usado para identificar você e registrar quem indicou seu contato.\n\n` +
      `📋 Você responderá 3 perguntas e, no final, poderá *conferir e corrigir tudo antes de enviar*.\n\n` +
      `Você também pode digitar *VOLTAR* para retornar à etapa anterior ou *CANCELAR* para sair do cadastro.`
    );

    return message.reply(
      `📝 *CADASTRO — 1/3*\n\n` +
      `Qual é o *nome pelo qual você deseja ser chamado*?`
    ).then(() => ({ allowed: false }));
  }

  if (command === 'voltar') {
    if (session.step === 'preferred_name') {
      return message.reply(
        `↩️ Você já está na primeira etapa.\n\n` +
        `📝 *CADASTRO — 1/3*\n\n` +
        `Qual é o *nome pelo qual você deseja ser chamado*?`
      ).then(() => ({ allowed: false }));
    }

    if (session.step === 'referrer_name') {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'preferred_name' })
      });

      return message.reply(
        `↩️ Voltamos para a etapa anterior.\n\n` +
        `📝 *CADASTRO — 1/3*\n\n` +
        `Qual é o *nome pelo qual você deseja ser chamado*?`
      ).then(() => ({ allowed: false }));
    }

    if (session.step === 'referrer_phone') {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'referrer_name' })
      });

      return message.reply(
        `↩️ Voltamos para a etapa anterior.\n\n` +
        `📝 *CADASTRO — 2/3*\n\n` +
        `Qual é o *nome de quem indicou você*?`
      ).then(() => ({ allowed: false }));
    }

    if (session.step === 'review') {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'referrer_phone' })
      });

      return message.reply(
        `↩️ Voltamos para a etapa anterior.\n\n` +
        `📝 *CADASTRO — 3/3*\n\n` +
        `Qual é o *telefone de quem indicou você*?`
      ).then(() => ({ allowed: false }));
    }

    if (session.step === 'correction') {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'review' })
      });

      return message.reply(buildRegistrationReview(session)).then(() => ({ allowed: false }));
    }
  }

  if (session.step === 'preferred_name') {
    if (!original || original.length < 2) {
      return message.reply(
        `Por favor, informe o *nome pelo qual deseja ser chamado*.\n\n` +
        `Ou digite *CANCELAR* para sair.`
      ).then(() => ({ allowed: false }));
    }

    await storeInternal('/api/internal/customer-registration/answer', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        field: 'preferred_name',
        value: original
      })
    });

    return message.reply(
      `📝 *CADASTRO — 2/3*\n\n` +
      `Qual é o *nome de quem indicou você*?`
    ).then(() => ({ allowed: false }));
  }

  if (session.step === 'referrer_name') {
    if (!original || original.length < 2) {
      return message.reply(
        `Por favor, informe o *nome de quem indicou você*.\n\n` +
        `Ou digite *VOLTAR* ou *CANCELAR*.`
      ).then(() => ({ allowed: false }));
    }

    await storeInternal('/api/internal/customer-registration/answer', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        field: 'referrer_name',
        value: original
      })
    });

    return message.reply(
      `📝 *CADASTRO — 3/3*\n\n` +
      `Qual é o *telefone de quem indicou você*?\n\n` +
      `Exemplo: (11) 99999-9999`
    ).then(() => ({ allowed: false }));
  }

  if (session.step === 'referrer_phone') {
    const refPhone = original.replace(/\D/g, '');

    if (refPhone.length < 8) {
      return message.reply(
        `❌ Telefone inválido.\n\n` +
        `Informe o número de quem indicou você, com DDD.\n` +
        `Exemplo: (11) 99999-9999`
      ).then(() => ({ allowed: false }));
    }

    const result = await storeInternal('/api/internal/customer-registration/answer', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        field: 'referrer_phone',
        value: refPhone
      })
    });

    if (result?.status === 'review' && result?.session) {
      return message.reply(buildRegistrationReview(result.session))
        .then(() => ({ allowed: false }));
    }

    return message.reply(
      `Não consegui concluir esta etapa. Digite *VOLTAR* ou tente novamente.`
    ).then(() => ({ allowed: false }));
  }

  if (session.step === 'review') {
    if (['1', 'confirmar', 'confirmo', 'sim'].includes(command)) {
      const result = await storeInternal('/api/internal/customer-registration/confirm', {
        method: 'POST',
        body: JSON.stringify({ phone })
      });

      if (result?.status === 'pending') {
        return message.reply(
          `✅ *Cadastro enviado com sucesso!*\n\n` +
          `Seu cadastro agora está aguardando aprovação do ADM ou de um funcionário autorizado.\n\n` +
          `⏳ Até a aprovação, o atendimento normal ficará bloqueado.`
        ).then(() => ({ allowed: false }));
      }

      return message.reply(
        `❌ Não foi possível confirmar o cadastro.\n\n` +
        `Tente novamente ou digite *CANCELAR* para reiniciar.`
      ).then(() => ({ allowed: false }));
    }

    if (['2', 'corrigir', 'corrigir cadastro', 'editar'].includes(command)) {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'correction' })
      });

      return message.reply(
        `✏️ *O que deseja corrigir?*\n\n` +
        `1️⃣ Nome\n` +
        `2️⃣ Nome de quem indicou\n` +
        `3️⃣ Telefone de quem indicou\n\n` +
        `Digite o número da opção.`
      ).then(() => ({ allowed: false }));
    }

    if (['3', 'cancelar', 'cancelar cadastro'].includes(command)) {
      return resetRegistration(message, phone);
    }

    return message.reply(
      `⚠️ Escolha uma opção:\n\n` +
      `1️⃣ *Confirmar*\n` +
      `2️⃣ *Corrigir*\n` +
      `3️⃣ *Cancelar*\n\n` +
      `Ou digite *VOLTAR*.`
    ).then(() => ({ allowed: false }));
  }

  if (session.step === 'correction') {
    if (command === '1') {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'preferred_name' })
      });

      return message.reply(
        `✏️ *Corrigir nome — 1/3*\n\n` +
        `Informe o *nome pelo qual deseja ser chamado*.`
      ).then(() => ({ allowed: false }));
    }

    if (command === '2') {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'referrer_name' })
      });

      return message.reply(
        `✏️ *Corrigir indicador — 2/3*\n\n` +
        `Informe o *nome de quem indicou você*.`
      ).then(() => ({ allowed: false }));
    }

    if (command === '3') {
      await storeInternal('/api/internal/customer-registration/set-step', {
        method: 'POST',
        body: JSON.stringify({ phone, step: 'referrer_phone' })
      });

      return message.reply(
        `✏️ *Corrigir telefone — 3/3*\n\n` +
        `Informe o *telefone de quem indicou você*.`
      ).then(() => ({ allowed: false }));
    }

    return message.reply(
      `⚠️ Escolha uma opção:\n\n` +
      `1️⃣ Nome\n` +
      `2️⃣ Nome de quem indicou\n` +
      `3️⃣ Telefone de quem indicou\n\n` +
      `Ou digite *VOLTAR* para revisar novamente.`
    ).then(() => ({ allowed: false }));
  }

  return message.reply(
    `⚠️ Não consegui identificar a etapa atual do cadastro.\n\n` +
    `Digite *CANCELAR* para reiniciar.`
  ).then(() => ({ allowed: false }));
}

function buildRegistrationReview(session) {
  const phone = String(session.referrerPhone || session.referrer_phone || '');
  const preferredName = String(session.preferredName || session.preferred_name || '');
  const referrerName = String(session.referrerName || session.referrer_name || '');

  return (
    `🔎 *CONFIRA SEUS DADOS*\n\n` +
    `👤 *Seu nome:* ${preferredName}\n` +
    `🤝 *Quem indicou:* ${referrerName}\n` +
    `📱 *Telefone do indicador:* ${phone}\n\n` +
    `Está tudo correto?\n\n` +
    `1️⃣ *Confirmar e enviar*\n` +
    `2️⃣ *Corrigir*\n` +
    `3️⃣ *Cancelar*\n\n` +
    `Você também pode digitar *VOLTAR*.`
  );
}

async function resetRegistration(message, phone) {
  await storeInternal('/api/internal/customer-registration/reset', {
    method: 'POST',
    body: JSON.stringify({ phone })
  }).catch(() => null);

  await storeInternal('/api/internal/customer-registration/start', {
    method: 'POST',
    body: JSON.stringify({ phone })
  }).catch(() => null);

  await message.reply(
    `🔄 *Cadastro cancelado e reiniciado.*\n\n` +
    `📝 *CADASTRO — 1/3*\n\n` +
    `Qual é o *nome pelo qual você deseja ser chamado*?`
  );

  return { allowed: false };
}

function staffMenu(staff) {
  const lines = [`👋 Olá, ${staff.name}!`, '', '🔐 Funções disponíveis:'];
  if (staff.canSell) lines.push('🛍️ vender — gerar seu catálogo de vendas', '🍫 produtos — ver produtos e preço de repasse', '📊 minhas vendas — resumo das suas vendas', '💰 extrato — seu resultado');
  if (staff.canPick) lines.push('📦 fila — pedidos para separar', '📦 separar PED-... — assumir separação', '✅ separado PED-... — finalizar separação');
  if (staff.canDeliver) lines.push('🚚 entregas — pedidos disponíveis para entrega', '🚚 entregar PED-... — sair para entrega', '✅ entregue PED-... — concluir entrega');
  if (staff.isAdmin || staff.canApproveCustomers) lines.push('👥 cadastros — aprovar ou rejeitar novos clientes', '✅ aprovar CAD-... — aprovar cadastro', '❌ rejeitar CAD-... — rejeitar cadastro');
  if (staff.canAttend) lines.push('💬 atendimentos — chamados aguardando', '👤 atender ATD-00001 — assumir atendimento', '✅ finalizar ATD-00001 — encerrar atendimento', '↩️ responder ATD-00001 texto — responder cliente');
  lines.push('', 'Digite ajuda a qualquer momento.');
  return lines.join('\n');
}
function menuText() { return 'Olá! 👋 Escolha uma opção:\n\n1. Produtos — receber link do catálogo\n2. Campanhas — ver próximos lotes\n3. Status — acompanhar pedido\n4. Alterar pedido — solicitar ajuste\n5. Atendente — falar com a equipe\n\nDigite o número da opção ou escreva o comando desejado.'; }
async function sendStaffCatalogLink(message, phone, staff) {
  const data = await storeInternal('/api/internal/catalog-links', { method: 'POST', body: JSON.stringify({ phone, staffId: staff?.id || null }) });
  const minutes = Math.max(1, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 60000));
  await message.reply(`🛒 ${staff ? `Seu catálogo de vendas, ${staff.name}, está pronto! Envie este link ao cliente e não abra no seu próprio celular.` : 'Seu catálogo está pronto!'}\n\n🔒 Link exclusivo e de uso único.\n⏱️ Válido por aproximadamente ${minutes} minutos.\n⚠️ Não encaminhe o link.`);
  return message.reply(data.url);
}

async function handleStaffMessage(message, staff, original, body, phone) {
  if (['oi','olá','ola','menu','ajuda','start','/start','/menu','help','comandos'].includes(body)) return message.reply(staffMenu(staff));
  if (body === 'funções' || body === 'funcoes') return message.reply(staffMenu(staff));
  if (body === 'cadastros' || body === 'aprovar clientes' || body === 'novos clientes') {
    if (!(staff.isAdmin || staff.canApproveCustomers)) return message.reply('🚫 Você não possui permissão para aprovar cadastros.');
    const data = await storeInternal('/api/internal/customer-registrations/pending');
    if (!data.customers.length) return message.reply('👥 Não há cadastros pendentes.');
    return message.reply(data.customers.map(c => `🆕 CAD-${c.id}\n${c.preferredName}\n📱 ${c.phone}\n👤 Indicou: ${c.referrerName}\n📞 ${c.referrerPhone}\nUse: aprovar CAD-${c.id} ou rejeitar CAD-${c.id}`).join('\n\n'));
  }
  const approveMatch = body.match(/^aprovar\s+cad-(\d+)$/i);
  if (approveMatch) {
    if (!(staff.isAdmin || staff.canApproveCustomers)) return message.reply('🚫 Você não possui permissão para aprovar cadastros.');
    const data = await storeInternal('/api/internal/customer-registrations/decision', {method:'POST',body:JSON.stringify({phone,registrationId:Number(approveMatch[1]),decision:'approved'})});
    return message.reply(`✅ Cadastro CAD-${Number(approveMatch[1])} aprovado para ${data.customer.preferredName}.`);
  }
  const rejectMatch = body.match(/^rejeitar\s+cad-(\d+)$/i);
  if (rejectMatch) {
    if (!(staff.isAdmin || staff.canApproveCustomers)) return message.reply('🚫 Você não possui permissão para rejeitar cadastros.');
    const data = await storeInternal('/api/internal/customer-registrations/decision', {method:'POST',body:JSON.stringify({phone,registrationId:Number(rejectMatch[1]),decision:'rejected'})});
    return message.reply(`❌ Cadastro CAD-${Number(rejectMatch[1])} rejeitado.`);
  }
  if (body === 'vender' || body === 'link de vendas' || body === '1') {
    if (!staff.canSell) return message.reply('🚫 Você não possui permissão para vender.');
    return sendStaffCatalogLink(message, phone, staff);
  }
  if (body === 'produtos' || body === 'produto' || body === '2') {
    if (!staff.canSell) return message.reply('🚫 Você não possui permissão para consultar o catálogo de vendas.');
    const data = await storeInternal(`/api/internal/staff/products?phone=${encodeURIComponent(phone)}`);
    if (!data.products.length) return message.reply('🍫 Nenhum produto disponível no momento.');
    const moneyBR = value => Number(value || 0).toFixed(2).replace('.', ',');

    const formatTier = tier => {
      const min = Number(tier.minQty);
      const max = tier.maxQty == null ? null : Number(tier.maxQty);
      const price = `R$ ${moneyBR(tier.price)}`;

      if (max == null) return `${min}+ un.: ${price}`;
      if (min === max) return `${min} un.: ${price}`;
      return `${min} a ${max} un.: ${price}`;
    };

    const lines = data.products.map(p => {
      const tiers = Array.isArray(p.priceTiers) && p.priceTiers.length
        ? p.priceTiers.map(formatTier).join('\n')
        : `Preço: R$ ${moneyBR(p.clientPrice)}`;

      return `🍫 ${p.name}\n` +
        `Repasse: R$ ${moneyBR(p.vendorPrice)}\n\n` +
        `👥 Preço para cliente:\n${tiers}\n\n` +
        `Disponível: ${p.availability === 'made_to_order' ? 'sob encomenda' : p.stockQty}`;
    });

    return message.reply(`📋 Catálogo do vendedor\n\n${lines.join('\n\n')}`);
  }
  if (body === 'minhas vendas' || body === 'vendas' || body === 'extrato') {
    if (!staff.canSell) return message.reply('🚫 Você não possui permissão para consultar vendas.');
    const data = await storeInternal(`/api/internal/staff/sales-summary?phone=${encodeURIComponent(phone)}`);
    return message.reply(`📊 ${data.name}\n\nPedidos: ${data.orders}\nVendas: R$ ${Number(data.sales).toFixed(2).replace('.',',')}\nRepasse: R$ ${Number(data.vendorValue).toFixed(2).replace('.',',')}\nSeu resultado: R$ ${Number(data.margin).toFixed(2).replace('.',',')}`);
  }
  if (body === 'fila' || body === 'pedidos' || body === 'entregas') {
    const data = await storeInternal(`/api/internal/staff/orders?phone=${encodeURIComponent(phone)}`);
    let rows = data.orders;
    if (body === 'fila' && !staff.canPick) return message.reply('🚫 Você não possui permissão de separação.');
    if (body === 'entregas' && !staff.canDeliver) return message.reply('🚫 Você não possui permissão de entrega.');
    if (body === 'fila') rows = rows.filter(o => ['waiting','separating','blocked'].includes(o.pickingStatus));
    if (body === 'entregas') rows = rows.filter(o => ['queued','route','failed'].includes(o.deliveryStatus));
    if (!rows.length) return message.reply('Nenhum pedido disponível nesta fila.');
    const lines = rows.map(o => `📦 ${o.orderNumber}\n👤 ${o.customerName}\n📍 ${o.address || 'sem endereço'}${o.city ? `, ${o.city}/${o.state}` : ''}\nStatus: ${o.pickingStatus} / ${o.deliveryStatus}`);
    return message.reply(lines.join('\n\n'));
  }
  const action = body.match(/^(assumir|separar|separado|entregar|entregue)\s+(ped-[a-z0-9-]+)/i);
  if (action) {
    const data = await storeInternal(`/api/internal/staff/orders?phone=${encodeURIComponent(phone)}`);
    const found = data.orders.find(item => item.orderNumber?.toLowerCase() === action[2].toLowerCase());
    if (!found) return message.reply('Pedido não encontrado ou não está na sua fila.');
    await storeInternal(`/api/internal/staff/orders/${found.id}/status?phone=${encodeURIComponent(phone)}`, { method:'PATCH', body:JSON.stringify({phone, action:action[1]}) });
    return message.reply(`✅ Pedido ${action[2].toUpperCase()} atualizado como ${action[1]}.`);
  }
  if (body === 'financeiro' || body === 'finance' || body === '4-financeiro') {
    if (!staff.canViewFinancial) return message.reply('🚫 Você não possui permissão financeira.');
    const data = await storeInternal(`/api/internal/staff/financial-summary?phone=${encodeURIComponent(phone)}`);
    return message.reply(`💰 Resumo financeiro\n\nPedidos: ${data.orders}\nReceita: R$ ${Number(data.revenue).toFixed(2).replace('.',',')}\nCustos: R$ ${Number(data.cost).toFixed(2).replace('.',',')}\nDespesas: R$ ${Number(data.expenses).toFixed(2).replace('.',',')}\nResultado: R$ ${Number(data.result).toFixed(2).replace('.',',')}`);
  }
  if (body === 'atendimentos') {
    if (!staff.canAttend) return message.reply('🚫 Você não possui permissão de atendimento.');
    const data = await storeInternal('/api/internal/support/queue');
    if (!data.tickets.length) return message.reply('💬 Nenhum atendimento aguardando.');
    return message.reply(data.tickets.map(t => `💬 ATD-${String(t.id).padStart(5,'0')}\n👤 ${t.customer_name}\n📱 ${t.customer_phone}`).join('\n\n'));
  }
  const claim = body.match(/^atender\s+atd-(\d+)$/i);
  if (claim) {
    const data = await storeInternal(`/api/internal/support/${Number(claim[1])}/claim`, { method:'POST', body:JSON.stringify({phone}) });
    return message.reply(`👤 Atendimento ATD-${String(data.ticket.id).padStart(5,'0')} assumido. As mensagens do cliente serão encaminhadas para você.`);
  }
  const close = body.match(/^finalizar\s+atd-(\d+)$/i);
  if (close) { await storeInternal(`/api/internal/support/${Number(close[1])}/close`, { method:'POST', body:JSON.stringify({phone}) }); return message.reply('✅ Atendimento finalizado.'); }
  const reply = body.match(/^responder\s+atd-(\d+)\s+([\s\S]+)/i);
  if (reply) { const ticketId=Number(reply[1]); const target=await storeInternal(`/api/internal/support/${ticketId}/message-target`, { method:'POST', body:JSON.stringify({phone}) }); await sendWhatsAppMessage(target.phone, reply[2]); await storeInternal(`/api/internal/support/${ticketId}/message`, { method:'POST', body:JSON.stringify({ direction:'outbound', senderType:'staff', senderName:staff.name, senderId:staff.id, body:reply[2], deliveryStatus:'sent' }) }); return message.reply('↩️ Resposta enviada ao cliente pelo número oficial da Doce Casa.'); }
  const open = await storeInternal(`/api/internal/support/by-phone?phone=${encodeURIComponent(phone)}`).catch(() => null);
  if (open?.ticket?.assigned_staff_id === staff.id) return message.reply('💬 Use: responder ATD-00001 sua mensagem');
  return message.reply(staffMenu(staff));
}
async function pollNotifications() {
  if (notificationPolling || !client || state.status !== 'connected') return;
  notificationPolling = true;
  try {
    const data = await storeInternal('/api/internal/notifications/pending');
    for (const item of data.notifications || []) {
      try {
        await sendWhatsAppMessage(item.phone, formatNotification(item));
        await storeInternal(`/api/internal/notifications/${item.id}/sent`, { method:'POST' });
      } catch (error) { console.error('[whatsapp] notificação', item.id, error.message); }
    }
  } catch (error) { console.error('[whatsapp] fila de notificações:', error.message); } finally { notificationPolling = false; }
}
function formatNotification(item) {
  const p=item.payload||{};
  if (item.type==='order_created') return `🛒 Pedido recebido!\n${p.orderNumber}\nTotal: R$ ${Number(p.total||0).toFixed(2).replace('.',',')}\n\nAguarde nossa confirmação.`;
  if (item.type==='campaign_order_created') return `🍫 Pedido de campanha recebido!\n\nCampanha: ${p.campaignName || 'Campanha'}\n📦 Pedido: ${p.orderNumber}\n🔐 Código de acesso: ${p.accessCode}\n💰 Total: R$ ${(Number(p.totalCents||0)/100).toFixed(2).replace('.',',')}\n\n📲 Para acompanhar ou alterar seu pedido, abra o link abaixo e vá em “Consultar meu pedido”. Informe o número do pedido, seu WhatsApp e o código de acesso.\n${p.campaignUrl ? `\n🔗 ${p.campaignUrl}\n` : ''}\nGuarde esse código: ele também será usado para alterações permitidas no pedido.`;
  if (item.type==='new_sale') return `🛒 Nova venda!\nPedido: ${p.orderNumber}\nCliente: ${p.customerName}\nTotal: R$ ${Number(p.total||0).toFixed(2).replace('.',',')}`;
  if (item.type==='new_picking') return `📦 Novo pedido para separação\n${p.orderNumber}\nCliente: ${p.customerName}\n\nUse: separar ${p.orderNumber}`;
  if (item.type==='new_delivery') return `🚚 NOVA ENTREGA DISPONÍVEL\n\nPedido: ${p.orderNumber}\nCliente: ${p.customerName || 'não informado'}\nTelefone: ${p.customerPhone || 'não informado'}\n\nEndereço:\n${p.address || 'não informado'}${p.city ? `\n${p.city}/${p.state || ''} ${p.postalCode || ''}` : ''}\n\nObservação: ${p.shippingNotes || 'nenhuma'}\nValor: R$ ${Number(p.total || 0).toFixed(2).replace('.', ',')}\nPagamento: ${p.paymentStatus || 'a confirmar'}\n\nUse: entregar ${p.orderNumber}`;
  if (item.type==='new_support') return `💬 NOVO ATENDIMENTO\nATD-${String(p.ticketId).padStart(5,'0')}\nCliente: ${p.customerName || 'não informado'}\nTelefone: ${p.customerPhone}\n${p.orderNumber ? `Pedido: ${p.orderNumber}\n` : ''}\nUse: atender ATD-${String(p.ticketId).padStart(5,'0')}`;
  if (item.type==='order_status') return `📦 ${p.orderNumber}\n🚚 ${p.label || p.status}`;
  if (item.type==='payment_paid') return `💰 Pagamento confirmado\nPedido: ${p.orderNumber}\nValor: R$ ${Number(p.total || 0).toFixed(2).replace('.', ',')}`;
  if (item.type==='payment_due') return `💰 PAGAMENTO PENDENTE\nPedido: ${p.orderNumber}\nValor: R$ ${Number(p.total || 0).toFixed(2).replace('.', ',')}${p.dueDate ? `\nVencimento: ${formatDate(p.dueDate)}` : ''}\n\nSe você já pagou, desconsidere esta mensagem e aguarde a confirmação da equipe.`;
  if (item.type==='order_change_received') return `✏️ Solicitação de alteração recebida\nPedido: ${p.orderNumber}\n\nNossa equipe vai verificar estoque, etapa e eventual diferença de valor.`;
  if (item.type==='order_change_approved') return `✅ Alteração aprovada\nPedido: ${p.orderNumber}\nNovo total: R$ ${Number(p.total || 0).toFixed(2).replace('.', ',')}`;
  if (item.type==='order_change_rejected') return `❌ Alteração não aprovada\nPedido: ${p.orderNumber}\n\nEntre em contato pelo menu Atendente para saber o motivo.`;
  if (item.type==='campaign_order_updated') return `✏️ Pedido de campanha atualizado\nPedido: ${p.orderNumber}\n💰 Total: R$ ${(Number(p.totalCents||0)/100).toFixed(2).replace('.',',')}\nPago: R$ ${(Number(p.paidCents||0)/100).toFixed(2).replace('.',',')}\nA pagar: R$ ${(Number(p.remainingCents||0)/100).toFixed(2).replace('.',',')}`;
  if (item.type==='campaign_payment_paid') return `💰 Pagamento da campanha confirmado\nPedido: ${p.orderNumber}`;
  if (item.type==='campaign_refund_pending') return `💸 Ajuste financeiro necessário\nPedido: ${p.orderNumber}\nValor a estornar: R$ ${(Number(p.refundPendingCents||0)/100).toFixed(2).replace('.',',')}\n\nNossa equipe entrará em contato para concluir o ajuste.`;
  if (item.type==='campaign_order_cancelled') return `❌ Pedido de campanha cancelado\nPedido: ${p.orderNumber}\n\nSe houver pagamento, a equipe informará sobre o estorno.`;
  if (item.type==='campaign_delivery_updated') { const labels={waiting:'Aguardando entrega',in_delivery:'🚚 Em entrega',delivered:'✅ Entregue'}; return `📦 ${p.orderNumber}\n${labels[p.deliveryStatus]||p.deliveryStatus}`; }
  if (item.type==='campaign_item_available') return `📦 Item do seu pedido disponível para entrega\nPedido: ${p.orderNumber}\nConsulte o pedido para ver a disponibilidade.`;
  if (item.type==='customer_registration_approved') return `✅ Cadastro aprovado!
Olá, ${p.name || 'cliente'}! Agora você já pode usar nosso atendimento normalmente.
Digite *menu* para começar.`;
  if (item.type==='customer_registration_rejected') return `❌ Seu cadastro não foi aprovado no momento.${p.reason ? `
Motivo: ${p.reason}` : ''}

Digite *cadastrar* se precisar iniciar um novo cadastro.`;
  if (item.type==='new_customer_registration') return `👥 NOVO CADASTRO PENDENTE
CAD-${p.registrationId}
${p.name}
📱 ${p.phone}
👤 Indicou: ${p.referrerName}
📞 ${p.referrerPhone}

Use: aprovar CAD-${p.registrationId} ou rejeitar CAD-${p.registrationId}`;
  if (item.type==='support_assigned') return `👤 Seu atendimento foi assumido por ${p.staffName || 'nossa equipe'}. Pode continuar por aqui.`;
  if (item.type==='support_closed') return '✅ Seu atendimento foi finalizado. Se precisar, é só chamar novamente.';
  return `🔔 Atualização: ${p.orderNumber || ''}`;
}
setInterval(pollNotifications, 4000);


function installWhatsAppDiagnostics(instance) {
  const fs = require('fs');
  const logFile = '/opt/doce-casa-store/data/whatsapp-debug.log';

  const write = (label, data) => {
    const line = `[${new Date().toISOString()}] [WA-DIAG] ${label}` +
      (data === undefined ? '' : ` | ${safeJson(data)}`) + '\n';

    try {
      fs.appendFileSync(logFile, line);
    } catch (_) {}

    console.log(line.trim());
  };

  const safeJson = (value) => {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return '[JSON_ERROR]';
    }
  };

  const errorInfo = (error) => ({
    name: error?.name || null,
    message: error?.message || String(error),
    stack: error?.stack || null,
    string: String(error)
  });

  write('DIAGNOSTICO INSTALADO', {
    pid: process.pid,
    node: process.version,
    cwd: process.cwd()
  });

  instance.on('authenticated', () => {
    write('EVENTO authenticated');
  });

  instance.on('ready', () => {
    write('EVENTO READY');
  });

  instance.on('auth_failure', message => {
    write('EVENTO auth_failure', {
      message: String(message)
    });
  });

  instance.on('disconnected', reason => {
    write('EVENTO disconnected', {
      reason: String(reason)
    });
  });

  instance.on('change_state', state => {
    write('EVENTO change_state', {
      state: String(state)
    });
  });

  instance.on('loading_screen', (percent, message) => {
    write('EVENTO loading_screen', {
      percent,
      message
    });
  });

  instance.on('error', error => {
    write('EVENTO error', errorInfo(error));
  });

  const inspectPage = async () => {
    try {
      const page = instance.pupPage;
      const browser = instance.pupBrowser;

      if (!page) {
        write('MONITOR: pupPage AUSENTE');
        return;
      }

      const result = {
        pageClosed: page.isClosed(),
        browserConnected: browser ? browser.isConnected() : null
      };

      try {
        result.page = await page.evaluate(() => {
          const out = {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibility: document.visibilityState,
            requireType: typeof window.require,
            webpack: typeof window.webpackChunkwhatsapp_web_client,
            debugExists: !!window.Debug,
            debugVersion: window.Debug?.VERSION || null,
            authStoreExists: !!window.AuthStore,
            wwebjsExists: !!window.WWebJS
          };

          try {
            const model = window.require('WAWebSocketModel');
            const socket = model?.Socket;

            out.waWebSocketModel = {
              exists: !!model,
              keys: model ? Object.keys(model).slice(0, 30) : []
            };

            out.socket = {
              exists: !!socket,
              state: socket?.state ?? null,
              hasSynced: socket?.hasSynced ?? null,
              onType: typeof socket?.on
            };
          } catch (e) {
            out.socketError = {
              name: e?.name || null,
              message: e?.message || String(e),
              stack: e?.stack || null
            };
          }

          try {
            const cmdModule = window.require('WAWebCmd');

            out.waWebCmd = {
              exists: !!cmdModule,
              hasCmd: !!cmdModule?.Cmd,
              onType: typeof cmdModule?.Cmd?.on
            };
          } catch (e) {
            out.cmdError = {
              name: e?.name || null,
              message: e?.message || String(e),
              stack: e?.stack || null
            };
          }

          return out;
        });
      } catch (error) {
        result.evaluateError = errorInfo(error);
      }

      write('MONITOR', result);
    } catch (error) {
      write('MONITOR ERRO', errorInfo(error));
    }
  };

  instance.on('authenticated', () => {
    write('INICIANDO MONITOR POS-AUTH');

    let count = 0;

    const timer = setInterval(async () => {
      count++;

      await inspectPage();

      if (count >= 20) {
        clearInterval(timer);
        write('MONITOR POS-AUTH FINALIZADO');
      }
    }, 2000);
  });

  process.on('uncaughtException', error => {
    write('PROCESSO uncaughtException', errorInfo(error));
  });

  process.on('unhandledRejection', reason => {
    write('PROCESSO unhandledRejection', errorInfo(reason));
  });
}

function createClient() {
  const instance = new Client({
    authStrategy: new LocalAuth({ clientId: 'store', dataPath: AUTH_PATH }),
    puppeteer: {
      headless: true,
      executablePath: '/opt/doce-casa-store/.cache/puppeteer/chrome-headless-shell/linux-146.0.7680.31/chrome-headless-shell-linux64/chrome-headless-shell',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--remote-allow-origins=*'
      ]
    }
  });
  installWhatsAppDiagnostics(instance);
  attachClientEvents(instance);
  return instance;
}

async function initializeClient() {
  client = createClient();
  try {
    await client.initialize();
  } catch (error) {
    const detail = error?.stack || error?.message || String(error);
    console.error('[whatsapp] initializeClient ERRO COMPLETO:', detail);
    touch('error', { lastError: detail });
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer || reconnecting) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (reconnecting) return;
    reconnecting = true;
    try {
      const oldClient = client;
      client = null;
      if (oldClient) await oldClient.destroy().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 1500));
      state.qrDataUrl = null;
      touch('reconnecting', { lastError: null });
      await initializeClient();
    } finally {
      reconnecting = false;
    }
  }, 2500);
}

async function resolveWhatsAppId(phone) {
  const normalized = String(phone || '').replace(/\D/g, '');
  if (!normalized) throw new Error('Telefone vazio.');
  const numberId = await client.getNumberId(normalized);
  if (!numberId) throw new Error(`Número não encontrado no WhatsApp: ${normalized}`);
  try {
    const resolved = await client.getContactLidAndPhone([numberId._serialized]);
    const item = resolved?.[0];
    if (item?.lid) return item.lid;
  } catch (error) {
    console.warn(`[whatsapp] falha ao resolver LID/PN de ${normalized}: ${error.message}`);
  }
  return numberId._serialized;
}
async function sendWhatsAppMessage(phone, text) {
  const chatId = await resolveWhatsAppId(phone);
  return client.sendMessage(chatId, text, { sendSeen: false });
}

function senderPhone(message) { return String(message.from || '').split('@')[0].replace(/\D/g, ''); }
function formatDate(value) { if (!value) return 'a combinar'; const [y, m, d] = String(value).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function menuText() {
  return 'Olá! 👋 Escolha uma opção:\n\n1. Produtos — receber link do catálogo\n2. Campanhas — ver próximos lotes\n3. Status — acompanhar pedido\n4. Alterar pedido — solicitar ajuste\n5. Atendente — falar com a equipe\n\nDigite o número da opção ou escreva o comando desejado.';
}

async function sendCatalogLink(message, phone) {
  const data = await storeInternal('/api/internal/catalog-links', { method: 'POST', body: JSON.stringify({ phone }) });
  const minutes = Math.max(1, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 60000));
  await message.reply(`🛒 Seu catálogo está pronto!\n\nPara abrir:\n1. Toque e segure o endereço da próxima mensagem.\n2. Escolha Copiar.\n3. Abra o Chrome ou outro navegador.\n4. Toque na barra de endereço.\n5. Cole o endereço completo, desde https:// até o último caractere.\n6. Toque em Ir/Enter.\n\n🔒 O link é exclusivo e de uso único.\n⏱️ Válido por aproximadamente ${minutes} minutos.\n⚠️ Não encaminhe nem compartilhe o link.`);
  return message.reply(data.url);
}

async function replyOrderStatus(message, phone, code) {
  const { order } = await storeInternal(`/api/internal/order-status?number=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}`);
  const status = { pending: 'Pedido recebido', confirmed: 'Pedido confirmado', preparing: 'Em preparo', shipped: '🚚 Saiu para entrega', delivered: '✅ Entregue', cancelled: 'Pedido cancelado' }[order.status] || order.status;
  const payment = order.paymentStatus === 'paid' ? '✅ Pagamento confirmado' : `💰 Pagamento: ${order.paymentStatus || 'pendente'}${order.paymentDueDate ? ` até ${formatDate(order.paymentDueDate)}` : ''}`;
  const history = (order.timeline || []).slice(-8).map(item => `• ${item.action} — ${formatDate(item.createdAt)}`).join('\n');
  return message.reply(`📦 *${order.orderNumber}*\n\nStatus atual: *${status}*\n${payment}\n💰 Total: R$ ${Number(order.total || 0).toFixed(2).replace('.', ',')}\n\n📋 Histórico:\n${history || 'Pedido recebido'}\n\nPróxima etapa: ${order.nextStep || 'aguarde nova atualização'}`);
}

async function storeInternal(route, options = {}) {
  const response = await fetch(`${STORE_API_URL}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-wa-internal-token': INTERNAL_TOKEN, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Operação não autorizada.');
  return data;
}

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  if (req.get('x-wa-internal-token') !== INTERNAL_TOKEN) return res.status(401).json({ error: 'Não autorizado.' });
  next();
});

app.get('/internal/status', (_req, res) => {
  res.json({
    ...state,
    connected: state.status === 'connected',
    configuredNumber: process.env.STORE_WHATSAPP || '',
    qrDataUrl: state.status === 'qr' ? state.qrDataUrl : null
  });
});

app.post('/internal/reconnect', async (_req, res) => {
  try {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (reconnecting) return res.json({ ok: true, status: 'reconnecting' });
    reconnecting = true;
    const oldClient = client;
    client = null;
    if (oldClient) await oldClient.destroy().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1200));
    state.qrDataUrl = null;
    touch('reconnecting', { lastError: null });
    await initializeClient();
    res.json({ ok: true });
  } catch (error) {
    reconnecting = false;
    touch('error', { lastError: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    reconnecting = false;
  }
});

app.post('/internal/logout', async (_req, res) => {
  try {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const oldClient = client;
    client = null;
    if (oldClient) await oldClient.logout().catch(() => {});
    state.number = '';
    state.qrDataUrl = null;
    touch('logged_out');
    res.json({ ok: true });
  } catch (error) {
    touch('error', { lastError: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[whatsapp] serviço interno em http://${HOST}:${PORT}`);
  initializeClient();
});
