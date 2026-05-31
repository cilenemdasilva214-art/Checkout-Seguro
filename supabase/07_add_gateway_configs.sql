-- Script SQL para inicializar chaves dos gateways de pagamento na tabela checkout_configs
-- Caminho: supabase/07_add_gateway_configs.sql

insert into public.checkout_configs (key, value)
values 
  ('active_gateway', 'paguex'),
  ('paguex_public_key', ''),
  ('paguex_secret_key', ''),
  ('hypercash_public_key', ''),
  ('hypercash_secret_key', '')
on conflict (key) do nothing;
