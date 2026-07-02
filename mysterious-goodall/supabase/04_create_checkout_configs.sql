-- Script SQL para criar a tabela de configurações do checkout (Pixel do Facebook e Custos de Anúncios)
-- Caminho: supabase/04_create_checkout_configs.sql

create table if not exists public.checkout_configs (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Habilitar RLS (Row Level Security) - para simplificar em sandbox, podemos deixar livre ou criar políticas simples
alter table public.checkout_configs disable row level security;

-- Inserir registros padrões iniciais se não existirent
insert into public.checkout_configs (key, value)
values 
  ('facebook_pixel_id', ''),
  ('ads_expense', '0.00'),
  ('admin_username', 'admin'),
  ('admin_password', '123456789'),
  ('shipping_standard_name', 'Frete PAC'),
  ('shipping_standard_time', '3 dias para entrega'),
  ('shipping_standard_price', '15.00'),
  ('shipping_express_name', 'Frete Expresso'),
  ('shipping_express_time', 'de 3 a 5 dias'),
  ('shipping_express_price', '25.00'),
  ('discount_pix_percent', '10')
on conflict (key) do nothing;


-- Adicionar a coluna funnel_step na tabela principal de checkouts para rastreamento preciso
alter table if exists public.card_checkout_test_raw
  add column if not exists funnel_step text;

comment on column public.card_checkout_test_raw.funnel_step is 'Passo do funil alcançado pelo cliente: dados_pessoais, entrega, pagamento, comprou';
comment on table public.checkout_configs is 'Configurações globais do checkout gerenciadas via Painel Admin';

