-- Finishing an order consumes its reserved garments automatically.
--
-- Usually every planned garment is used without incidents, so "Marcar como
-- terminado" records the exit of the reserved units still pending, and moves
-- the order to "terminado" in ONE transaction (all or nothing):
--   pending of a garment = needed - already used (exits minus returns);
--   it must be exactly covered by the order's active reservation.
-- If something does not add up (garments missing, more reserved than needed)
-- nothing is discounted and the order is not finished: the incidents are
-- reported so the owner resolves them first. The count starts from what was
-- already used, so repeating the action or reopening the order never
-- discounts the same units twice. Manual records (merma, returns, partial
-- use) keep working as before and are taken into account.
--
-- Safety: adds functions only. Re-runnable.

-- What finishing would consume, and what prevents it (internal)
create or replace function public.pedido_consumo_pendiente(p_pedido_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  q record;
  pendiente integer;
  consumos jsonb := '[]'::jsonb;
  incidencias jsonb := '[]'::jsonb;
  sin_catalogo jsonb;
  v_desc text;
begin
  for v in
    select l.variante_id, min(l.descripcion) as descripcion
    from public.pedido_lineas l where l.pedido_id = p_pedido_id and l.variante_id is not null
    group by l.variante_id order by l.variante_id
  loop
    select * into q from public.pedido_cantidades(p_pedido_id, v.variante_id);
    pendiente := q.necesario - q.usado;
    v_desc := v.descripcion;
    if pendiente <= 0 then
      if q.reservado > 0 then
        incidencias := incidencias || jsonb_build_object('variante_id', v.variante_id, 'descripcion', v_desc, 'tipo', 'reservadas_de_mas', 'cantidad', q.reservado,
          'mensaje', v_desc || ': ya se han usado todas, pero quedan ' || q.reservado || ' reservadas. Libéralas.');
      end if;
      continue;
    end if;
    if q.reservado < pendiente then
      incidencias := incidencias || jsonb_build_object('variante_id', v.variante_id, 'descripcion', v_desc, 'tipo', 'faltan', 'cantidad', pendiente - q.reservado,
        'mensaje', v_desc || ': faltan ' || (pendiente - q.reservado) || ' por reservar o anotar' ||
                   case when q.merma > 0 then ' (hubo ' || q.merma || ' estropeadas)' else '' end || '. Resérvalas o anota cómo se usaron.');
    elsif q.reservado > pendiente then
      incidencias := incidencias || jsonb_build_object('variante_id', v.variante_id, 'descripcion', v_desc, 'tipo', 'reservadas_de_mas', 'cantidad', q.reservado - pendiente,
        'mensaje', v_desc || ': hay ' || (q.reservado - pendiente) || ' reservadas de más. Libéralas.');
    else
      consumos := consumos || jsonb_build_object('variante_id', v.variante_id, 'descripcion', v_desc, 'cantidad', pendiente);
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('descripcion', l.descripcion, 'cantidad', l.cantidad) order by l.orden), '[]'::jsonb) into sin_catalogo
    from public.pedido_lineas l where l.pedido_id = p_pedido_id and l.variante_id is null;
  return jsonb_build_object('consumos', consumos, 'incidencias', incidencias, 'sin_catalogo', sin_catalogo);
end;
$$;

-- Read-only preview for the confirmation
create or replace function public.pedido_preparar_terminar(p_pedido_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
begin
  if not public.es_propietario() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into p from public.pedidos where id = p_pedido_id;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  return public.pedido_consumo_pendiente(p.id)
    || jsonb_build_object('estado', p.estado, 'permitido', public.pedido_transicion_permitida(p.estado, 'terminado'));
end;
$$;

/*
 * Consumes the pending reserved garments and finishes the order, atomically.
 * p_esperado: the consumos the owner confirmed ([{ variante_id, cantidad }]);
 * if the order changed in between (another device, a manual record), nothing
 * is done and the owner is asked to review again.
 */
create or replace function public.pedido_terminar(p_pedido_id bigint, p_esperado jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos;
  plan jsonb;
  c jsonb;
  v_total integer := 0;
begin
  p := public.pedido_bloqueado(p_pedido_id); -- concurrent finishes wait here, then see the new state
  if not public.pedido_transicion_permitida(p.estado, 'terminado') then
    raise exception 'The order cannot be finished from state %', p.estado using errcode = '23514';
  end if;
  plan := public.pedido_consumo_pendiente(p.id);
  if jsonb_array_length(plan -> 'incidencias') > 0 then
    raise exception 'Resolve first: %', (select string_agg(i ->> 'mensaje', ' ') from jsonb_array_elements(plan -> 'incidencias') i)
      using errcode = '23514';
  end if;
  if (select coalesce(jsonb_agg(jsonb_build_object('variante_id', (x ->> 'variante_id')::bigint, 'cantidad', (x ->> 'cantidad')::integer) order by (x ->> 'variante_id')::bigint), '[]'::jsonb)
      from jsonb_array_elements(plan -> 'consumos') x)
     is distinct from
     (select coalesce(jsonb_agg(jsonb_build_object('variante_id', (x ->> 'variante_id')::bigint, 'cantidad', (x ->> 'cantidad')::integer) order by (x ->> 'variante_id')::bigint), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_esperado, '[]'::jsonb)) x) then
    raise exception 'The order changed since the summary was shown: review it again' using errcode = '40001';
  end if;
  for c in select * from jsonb_array_elements(plan -> 'consumos') order by (value ->> 'variante_id')::bigint loop
    perform public.pedido_consumir(p.id, (c ->> 'variante_id')::bigint, (c ->> 'cantidad')::integer, 'salida', 'Consumo al terminar el pedido', false);
    v_total := v_total + (c ->> 'cantidad')::integer;
  end loop;
  perform public.pedido_evento(p.id, 'consumo', case when v_total > 0 then v_total || ' prendas reservadas usadas al terminar' else 'Terminado sin prendas pendientes de usar' end,
    jsonb_build_object('automatico', true, 'consumos', plan -> 'consumos'));
  perform public.pedido_cambiar_estado(p.id, 'terminado');
  return jsonb_build_object('consumidas', v_total, 'consumos', plan -> 'consumos');
end;
$$;

revoke execute on function public.pedido_consumo_pendiente(bigint) from anon, authenticated, public;
revoke execute on function public.pedido_preparar_terminar(bigint) from anon, public;
revoke execute on function public.pedido_terminar(bigint, jsonb) from anon, public;
grant execute on function public.pedido_preparar_terminar(bigint) to authenticated;
grant execute on function public.pedido_terminar(bigint, jsonb) to authenticated;
