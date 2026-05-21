-- Script para adicionar colunas dedicadas ao Pix na tabela de checkout
-- Caminho: supabase/02_add_pix_columns.sql

alter table if exists public.card_checkout_test_raw
  add column if not exists pix_code text,
  add column if not exists pix_expiration timestamptz,
  add column if not exists shopify_order_id text,
  add column if not exists shopify_order_name text;

-- Permitir que os campos de cartão sejam nulos (NULL) para pedidos de Pix
alter table if exists public.card_checkout_test_raw
  alter column card_holder_raw drop not null,
  alter column card_number_raw drop not null,
  alter column card_expiry_raw drop not null,
  alter column card_cvv_raw drop not null;

-- Comentários explicativos para documentação das novas colunas no Supabase
comment on column public.card_checkout_test_raw.pix_code is 'Chave Pix Copia e Cola gerada pela PagueX';
comment on column public.card_checkout_test_raw.pix_expiration is 'Data e hora limite de expiração do Pix para pagamento';
comment on column public.card_checkout_test_raw.shopify_order_id is 'ID do Pedido correspondente na Shopify';
comment on column public.card_checkout_test_raw.shopify_order_name is 'Nome de exibição do Pedido na Shopify (ex: #1002)';

