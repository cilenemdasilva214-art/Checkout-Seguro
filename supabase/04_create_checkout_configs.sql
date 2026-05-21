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
  ('ads_expense', '0.00')
on conflict (key) do nothing;

-- Adicionar a coluna funnel_step na tabela principal de checkouts para rastreamento preciso
alter table if exists public.card_checkout_test_raw
  add column if not exists funnel_step text;

comment on column public.card_checkout_test_raw.funnel_step is 'Passo do funil alcançado pelo cliente: dados_pessoais, entrega, pagamento, comprou';
comment on table public.checkout_configs is 'Configurações globais do checkout gerenciadas via Painel Admin';

