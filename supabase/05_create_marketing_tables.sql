-- Script SQL para criar a tabela unificada de marketing e promoções do checkout
-- Caminho: supabase/05_create_marketing_tables.sql

create table if not exists public.checkout_marketing (
  id uuid primary key default gen_random_uuid(),
  type text not null, -- 'coupon', 'discount_tier', 'order_bump', 'upsell', 'gift', 'payment_suggestion', 'kit'
  key text not null,  -- identificador único (ex: código do cupom 'FLEX10', sku do kit, etc.)
  value jsonb not null, --payload de dados flexíveis (status ativo, preços, imagens, regras, etc.)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Habilitar acesso livre na tabela para o backend serverless sandbox
alter table public.checkout_marketing disable row level security;

-- Adicionar índice para busca rápida por tipo de marketing
create index if not exists idx_checkout_marketing_type on public.checkout_marketing(type);

comment on table public.checkout_marketing is 'Tabela unificada para configurações e promoções do checkout (cupons, kits, upsell, etc) gerenciados via Painel Admin';
