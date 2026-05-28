-- Script SQL para adicionar a coluna domain na tabela de checkouts
-- Caminho: supabase/06_add_domain_column.sql

alter table if exists public.card_checkout_test_raw
  add column if not exists domain text;

comment on column public.card_checkout_test_raw.domain is 'Domínio de origem do checkout (ex: checkout-seguro.com)';
