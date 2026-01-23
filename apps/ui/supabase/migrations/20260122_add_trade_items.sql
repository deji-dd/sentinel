-- Trade items master list
create table if not exists public.trade_items (
  item_id integer primary key,
  name text not null,
  category text not null,
  is_active boolean not null default true
);
