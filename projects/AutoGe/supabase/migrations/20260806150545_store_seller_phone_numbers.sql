alter table public.autoge_listing_projections
  add column phone_collection_status text not null default 'not_checked',
  add column seller_phone_numbers jsonb not null default '[]'::jsonb;

create function autoge_private.is_valid_seller_phone_numbers(phone_numbers jsonb)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  phone_number jsonb;
  display_text text;
  digits text;
  supplied_e164 text;
  expected_e164 text;
  seen_digits text[] := '{}';
begin
  if jsonb_typeof(phone_numbers) <> 'array' then
    return false;
  end if;

  if jsonb_array_length(phone_numbers) > 10 then
    return false;
  end if;

  for phone_number in select value from jsonb_array_elements(phone_numbers)
  loop
    if jsonb_typeof(phone_number) <> 'object'
      or jsonb_typeof(phone_number -> 'displayText') <> 'string'
      or jsonb_typeof(phone_number -> 'digits') <> 'string'
      or phone_number - array['displayText', 'digits', 'e164'] <> '{}'::jsonb
    then
      return false;
    end if;

    display_text := phone_number ->> 'displayText';
    digits := phone_number ->> 'digits';

    if length(display_text) not between 1 and 64
      or replace(display_text, chr(160), ' ') !~ E'^[-+0-9 ()\\t.,/;|]+$'
      or digits !~ '^[0-9]{3,15}$'
      or regexp_replace(display_text, '[^0-9]', '', 'g') <> digits
      or digits = any (seen_digits)
    then
      return false;
    end if;

    seen_digits := array_append(seen_digits, digits);
    expected_e164 := case
      when digits ~ '^5[0-9]{8}$' then '+995' || digits
      when digits ~ '^9955[0-9]{8}$' then '+' || digits
      else null
    end;

    if phone_number ? 'e164' then
      if jsonb_typeof(phone_number -> 'e164') <> 'string' then
        return false;
      end if;
      supplied_e164 := phone_number ->> 'e164';
      if expected_e164 is null or supplied_e164 <> expected_e164 then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function autoge_private.is_valid_seller_phone_numbers(jsonb)
  from public, anon, authenticated;
grant usage on schema autoge_private to service_role;
grant execute on function autoge_private.is_valid_seller_phone_numbers(jsonb)
  to service_role;

alter table public.autoge_listing_projections
  add constraint autoge_listing_projections_phone_collection_status_check
  check (
    phone_collection_status in ('observed', 'not_available', 'not_checked')
  ),
  add constraint autoge_listing_projections_seller_phone_numbers_shape_check
  check (autoge_private.is_valid_seller_phone_numbers(seller_phone_numbers)),
  add constraint autoge_listing_projections_phone_collection_consistency_check
  check (
    (
      phone_collection_status = 'observed'
      and jsonb_array_length(seller_phone_numbers) > 0
    )
    or (
      phone_collection_status in ('not_available', 'not_checked')
      and jsonb_array_length(seller_phone_numbers) = 0
    )
  );

comment on column public.autoge_listing_projections.phone_collection_status is
  'Whether seller phone numbers were observed, unavailable, or not checked during discovery.';

comment on column public.autoge_listing_projections.seller_phone_numbers is
  'Ordered seller phone observations: [{"displayText": text, "digits": text, "e164"?: text}].';
